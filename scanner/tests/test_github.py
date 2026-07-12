import time

import httpx
import pytest
from pytest_httpx import httpx_mock

from scanner.github import GitHubClient


def test_get_releases_returns_5_most_recent(httpx_mock):
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[
            {"tag_name": "v1.0.0", "target_commitish": "abc123", "published_at": "2026-06-01T00:00:00Z", "tarball_url": "https://api.github.com/repos/foo/bar/tarball/v1.0.0"},
            {"tag_name": "v0.9.0", "target_commitish": "def456", "published_at": "2026-05-01T00:00:00Z", "tarball_url": "https://api.github.com/repos/foo/bar/tarball/v0.9.0"},
        ],
    )
    client = GitHubClient(token="test_token")
    releases = client.get_releases("foo", "bar")
    assert len(releases) == 2
    assert releases[0]["tag_name"] == "v1.0.0"


def test_get_releases_sends_auth_header_when_token_set(httpx_mock):
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[],
    )
    client = GitHubClient(token="ghp_abc123")
    client.get_releases("foo", "bar")
    # Inspect the last request
    request = httpx_mock.get_request()
    assert request.headers.get("authorization") == "Bearer ghp_abc123"


def test_get_releases_no_auth_header_when_token_none(httpx_mock):
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[],
    )
    client = GitHubClient(token=None)
    client.get_releases("foo", "bar")
    request = httpx_mock.get_request()
    assert "authorization" not in {k.lower() for k in request.headers.keys()}


def test_retries_on_5xx_then_succeeds(httpx_mock):
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=500,
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[{"tag_name": "v1.0.0", "target_commitish": "x", "published_at": "2026-06-01T00:00:00Z", "tarball_url": "u"}],
    )
    client = GitHubClient(token="t")
    releases = client.get_releases("foo", "bar")
    assert releases[0]["tag_name"] == "v1.0.0"
    assert len(httpx_mock.get_requests()) == 2  # retried once


def test_terminal_404_raises_immediately_no_retry(httpx_mock):
    """A 404 (repo not found, release not found) must raise on the first attempt,
    not retry. Saves 3 × MAX_RETRIES wasted attempts."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=404,
    )
    client = GitHubClient(token="t")
    start = time.monotonic()
    with pytest.raises(httpx.HTTPStatusError):
        client.get_releases("foo", "bar")
    elapsed = time.monotonic() - start
    # Should be near-instant, not 3+ seconds of exponential backoff
    assert elapsed < 0.5, f"404 took {elapsed:.2f}s (expected <0.5s)"
    # Only 1 request should have been made (no retries)
    assert len(httpx_mock.get_requests()) == 1


def test_terminal_401_raises_immediately_no_retry(httpx_mock):
    """A 401 (bad token) must raise on the first attempt."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=401,
    )
    client = GitHubClient(token="bad")
    with pytest.raises(httpx.HTTPStatusError):
        client.get_releases("foo", "bar")
    assert len(httpx_mock.get_requests()) == 1


def test_rate_limit_429_with_reset_retries(httpx_mock):
    """A 429 with X-RateLimit-Reset in the future must retry (per spec §7.3)."""
    future_reset = str(int(time.time()) + 2)
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=429,
        headers={"X-RateLimit-Reset": future_reset},
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[{"tag_name": "v1.0.0", "target_commitish": "x", "published_at": "2026-06-01T00:00:00Z", "tarball_url": "u"}],
    )
    client = GitHubClient(token="t")
    releases = client.get_releases("foo", "bar")
    assert len(releases) == 1
    assert len(httpx_mock.get_requests()) == 2


def test_rate_limit_403_with_reset_retries(httpx_mock):
    """A 403 with X-RateLimit-Reset is also a rate limit (GitHub returns 403 for secondary rate limits)."""
    future_reset = str(int(time.time()) + 2)
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=403,
        headers={"X-RateLimit-Reset": future_reset},
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[],
    )
    client = GitHubClient(token="t")
    releases = client.get_releases("foo", "bar")
    assert releases == []
    assert len(httpx_mock.get_requests()) == 2


def test_403_without_reset_header_raises_immediately(httpx_mock):
    """A 403 without X-RateLimit-Reset (e.g., 'repo blocked' or 'token lacks access')
    is a terminal error and should raise without retry."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        status_code=403,
        # No X-RateLimit-Reset header
    )
    client = GitHubClient(token="t")
    with pytest.raises(httpx.HTTPStatusError):
        client.get_releases("foo", "bar")
    assert len(httpx_mock.get_requests()) == 1


def test_resolve_branch_sha_returns_cached_without_api_call(httpx_mock, db_eager):
    """Cache hit: returns SHA from DB without making any HTTP request."""
    from scanner.db import lookup_branch_sha, upsert_branch_sha
    sha = "deadbeef" * 5  # 40 hex chars
    upsert_branch_sha("foo", "bar", "main", sha)
    # If resolve_branch_sha tries to hit the network, the absence of any
    # httpx_mock.add_response() entry will cause the test to fail with
    # "no response registered" or similar.
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") == sha
    # No requests should have been made
    assert len(httpx_mock.get_requests()) == 0
    # Cache value unchanged
    assert lookup_branch_sha("foo", "bar", "main") == sha


def test_resolve_branch_sha_calls_api_on_cache_miss(httpx_mock, db_eager):
    """Cache miss: hits git/refs/heads API, caches result, returns SHA."""
    sha = "feedface" * 5
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        json={"object": {"sha": sha}},
    )
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") == sha
    # Cache populated for next call
    from scanner.db import lookup_branch_sha
    assert lookup_branch_sha("foo", "bar", "main") == sha


def test_resolve_branch_sha_returns_none_on_404(httpx_mock, db_eager):
    """404 response (branch deleted/renamed): returns None, caller records scan_failure."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        status_code=404,
    )
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") is None
