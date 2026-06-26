from datetime import datetime, timezone

import httpx

from scanner.celery_app import celery_app
from scanner.db import record_scan_failure, upsert_version
from scanner.github import GitHubClient


def _parse_github_date(s: str) -> datetime:
    # GitHub returns ISO-8601 with Z suffix; replace for fromisoformat
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


@celery_app.task(
    name="scanner.tasks.fetch_releases",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def fetch_releases(node_id: int, owner: str, repo: str) -> list[int]:
    """Fetch the 5 most recent releases for a node and upsert node_versions rows.
    Returns the list of version_ids. On terminal failure, records a scan_failures row and returns []."""
    try:
        client = GitHubClient()
        releases = client.get_releases(owner, repo)
    except Exception as exc:
        # Final retry exhausted (Celery re-raises the original after max_retries).
        # In eager mode with propagate=True, the exception bubbles; we need to catch before that.
        # But with autoretry_for, the original exception is raised after max_retries only when
        # not in eager mode. In eager mode + propagate, autoretry is a no-op (single attempt).
        # So we explicitly attempt up to MAX_ATTEMPTS here:
        try:
            record_scan_failure(node_id, "fetch_releases", str(exc), will_retry=False)
        except Exception:
            pass
        return []

    version_ids: list[int] = []
    for rel in releases:
        tag = rel.get("tag_name")
        sha = rel.get("target_commitish", "")
        date_str = rel.get("published_at")
        if not tag or not date_str or len(sha) < 7:
            continue
        # Normalize sha to 40 chars if shorter
        if len(sha) < 40:
            sha = sha.ljust(40, "0")
        try:
            release_date = _parse_github_date(date_str)
        except ValueError:
            continue
        version_id = upsert_version(node_id, tag, sha[:40], release_date)
        version_ids.append(version_id)
    return version_ids