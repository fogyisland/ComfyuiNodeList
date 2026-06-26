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