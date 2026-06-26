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

    def _request_with_retry(self, method: str, url: str, **kwargs) -> httpx.Response:
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.request(method, url, headers=self._headers(), **kwargs)
                if response.status_code == 403 or response.status_code == 429:
                    reset = int(response.headers.get("X-RateLimit-Reset", time.time() + 60))
                    wait = max(reset - int(time.time()), 1)
                    if attempt < self.MAX_RETRIES:
                        time.sleep(min(wait, 60))  # cap wait at 60s in tests
                        continue
                    response.raise_for_status()
                if response.status_code >= 500 and attempt < self.MAX_RETRIES:
                    time.sleep(2 ** attempt)
                    continue
                response.raise_for_status()
                return response
            except httpx.HTTPError as e:
                last_exc = e
                if attempt < self.MAX_RETRIES:
                    time.sleep(2 ** attempt)
                    continue
                raise
        # Unreachable: loop always returns or raises. But be defensive.
        raise last_exc if last_exc else RuntimeError("request failed after retries")

    def get_releases(self, owner: str, repo: str) -> list[dict[str, Any]]:
        url = f"{self.BASE_URL}/repos/{owner}/{repo}/releases?per_page=5"
        response = self._request_with_retry("GET", url)
        return response.json()

    def download_tarball(self, url: str) -> bytes:
        response = self._request_with_retry("GET", url)
        return response.content