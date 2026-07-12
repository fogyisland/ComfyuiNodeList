import re
from datetime import datetime, timezone

import httpx

from scanner.celery_app import celery_app
from scanner.db import record_scan_failure, upsert_version
from scanner.github import GitHubClient

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


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

    For each release:
      - tag and published_at are required (missing → skip).
      - target_commitish is matched against ^[0-9a-f]{40}$:
          * If it's a SHA, use it directly.
          * Otherwise it's a branch name → resolve via GitHubClient.resolve_branch_sha()
            (which checks the 7-day `gitsha_resolutions` cache first, then hits the
            git/refs/heads API on miss).
          * If resolution returns None (branch renamed/deleted, 404/403), record a
            scan_failure with reason `target_commitish_resolve_failed: branch=...`
            and skip the release.

    Returns the list of version_ids. On terminal failure (e.g., all retries
    exhausted on the releases API itself), records a scan_failures row and
    returns [].
    """
    try:
        client = GitHubClient()
        releases = client.get_releases(owner, repo)
    except Exception as exc:
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
        if not tag or not date_str:
            continue

        # Detect SHA vs branch name (Plan 5.1 spec §Component 3).
        if _SHA_RE.match(sha):
            resolved_sha = sha
        else:
            resolved_sha = client.resolve_branch_sha(owner, repo, sha)
            if resolved_sha is None:
                try:
                    record_scan_failure(
                        node_id,
                        "fetch_releases",
                        f"target_commitish_resolve_failed: branch={sha}, owner={owner}, repo={repo}",
                        False,
                    )
                except Exception:
                    pass
                continue

        try:
            release_date = _parse_github_date(date_str)
        except ValueError:
            continue

        version_id = upsert_version(node_id, tag, resolved_sha, release_date)
        version_ids.append(version_id)
    return version_ids
