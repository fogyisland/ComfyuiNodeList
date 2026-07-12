import os
import time
from typing import Any

import httpx


class GitHubClient:
    BASE_URL = "https://api.github.com"
    MAX_RETRIES = 3

    def __init__(self, token: str | None = None, timeout: float = 30.0):
        self.token = token if token is not None else os.environ.get("SCANNER_GITHUB_TOKEN")
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _classify_response(self, response: httpx.Response) -> str:
        """Return one of: 'success', 'rate_limit', 'transient_5xx', 'terminal_4xx'.

        `rate_limit` is a 403/429 WITH an X-RateLimit-Reset header (transient, must wait).
        `transient_5xx` is any 5xx (server errors are transient).
        `terminal_4xx` is any other 4xx (404, 401, 403-without-reset, etc.) — raise immediately.
        """
        code = response.status_code
        if 200 <= code < 300:
            return "success"
        if code in (403, 429) and "X-RateLimit-Reset" in response.headers:
            return "rate_limit"
        if 500 <= code < 600:
            return "transient_5xx"
        return "terminal_4xx"

    def _request_with_retry(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Execute an HTTP request with retry for rate-limit and transient 5xx errors.

        Classification (per `_classify_response`):
        - success: return immediately
        - rate_limit (403/429 with X-RateLimit-Reset): wait until reset, then retry up to MAX_RETRIES
        - transient_5xx: exponential backoff (2^attempt seconds), retry up to MAX_RETRIES
        - terminal_4xx (404, 401, 403-without-reset, etc.): raise immediately, no retry

        Network errors (httpx.HTTPError) are also retried with exponential backoff.
        """
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.request(method, url, headers=self._headers(), **kwargs)
            except httpx.HTTPError as e:
                # Network-level error — retry with exponential backoff.
                last_exc = e
                if attempt < self.MAX_RETRIES:
                    time.sleep(2 ** attempt)
                    continue
                raise
            # Response received — classify it.
            classification = self._classify_response(response)
            if classification == "success":
                return response
            if classification == "terminal_4xx":
                # Raise immediately without retrying. raise_for_status() raises
                # HTTPStatusError which is NOT caught by the network-error handler above.
                response.raise_for_status()
            if classification == "rate_limit":
                reset = int(response.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait = max(reset - int(time.time()), 1)
                if attempt < self.MAX_RETRIES:
                    time.sleep(min(wait, 60))  # cap wait at 60s in tests
                    continue
                response.raise_for_status()  # exhausted retries on rate limit
            # transient_5xx
            if attempt < self.MAX_RETRIES:
                time.sleep(2 ** attempt)
                continue
            response.raise_for_status()  # exhausted retries on 5xx
        # Unreachable: loop always returns or raises. But be defensive.
        raise last_exc if last_exc else RuntimeError("request failed after retries")

    def get_releases(self, owner: str, repo: str) -> list[dict[str, Any]]:
        url = f"{self.BASE_URL}/repos/{owner}/{repo}/releases?per_page=5"
        response = self._request_with_retry("GET", url)
        return response.json()

    def download_tarball(self, url: str) -> bytes:
        response = self._request_with_retry("GET", url)
        return response.content

    def resolve_branch_sha(self, owner: str, repo: str, ref: str) -> str | None:
        """Resolve a branch name (e.g. 'main') to a 40-hex SHA via git/refs/heads API.

        Caches results in `gitsha_resolutions` for 7 days (matches Celery beat
        weekly scan cadence — see plan 5.1 spec §Component 2).

        Returns:
            The 40-hex SHA on success (cache hit or fresh API resolution).
            None if the branch cannot be resolved (404, 403-without-reset).

        Raises:
            httpx.HTTPError / httpx.HTTPStatusError: terminal 4xx (other than
                404/403) or exhausted retries on 5xx/rate-limit. The outer
                try/except in `fetch_releases` records these as scan failures.
        """
        from scanner.db import lookup_branch_sha, upsert_branch_sha

        cached = lookup_branch_sha(owner, repo, ref)
        if cached is not None:
            return cached

        try:
            data = self._request_with_retry(
                "GET",
                f"{self.BASE_URL}/repos/{owner}/{repo}/git/ref/heads/{ref}",
            ).json()
        except httpx.HTTPStatusError as exc:
            # Terminal 4xx (per `_classify_response`): 404 (branch missing),
            # 401 (bad token), or 403-without-reset (token lacks access).
            # The caller records a scan_failure with a specific reason.
            if exc.response.status_code in (404, 403):
                return None
            raise

        sha = data["object"]["sha"]

        # Cache write — best-effort. If the DB write fails, return the SHA
        # anyway so the scan doesn't block on cache problems.
        try:
            upsert_branch_sha(owner, repo, ref, sha)
        except Exception:
            pass

        return sha
