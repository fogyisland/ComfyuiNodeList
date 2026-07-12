# Plan 5.1 — Fix `target_commitish` silent corruption in fetch_releases

**Date:** 2026-07-12
**Status:** Approved (brainstormed with user 2026-07-12)
**Parent plan:** Plan 5 (Production Deployment), Task 9 reviewer deferral

## Problem

`scanner/tasks/fetch_releases.py:42-48` silently corrupts data when GitHub returns a non-SHA `target_commitish`:

```python
sha = rel.get("target_commitish", "")
date_str = rel.get("published_at")
if not tag or not date_str or len(sha) < 7:
    continue
# Normalize sha to 40 chars if shorter
if len(sha) < 40:
    sha = sha.ljust(40, "0")  # ← bug
```

**Real-world failure mode:** GitHub's `target_commitish` field is often a **branch name** (`"main"`, `"master"`, `"develop"`, `"release"`), not a SHA. The current code:

1. `len("main") < 7` is `True`, so most branch names get dropped (acceptable loss)
2. `len("develop") >= 7` passes the filter, then gets padded: `"develop".ljust(40, "0")` → `"develop000000000000000000000000000000000000"` — stored as `git_sha`
3. This is **silent data corruption**: the stored `git_sha` is a synthetic string, not a real commit SHA. Downstream code (parsers, conflict checks, future git_refs lookups) may fail mysteriously or compare against wrong data.

## Solution

Detect non-SHA `target_commitish` values (anything not matching `^[0-9a-f]{40}$`) and resolve them to real SHAs via the GitHub `git/ref/heads/{branch}` API. Cache resolutions for **7 days** (matches weekly Celery beat scan cadence) to avoid re-resolving unchanged branch tips.

## Scope

**In scope:**

- Fix `fetch_releases.py` to detect branch names and resolve to real SHAs
- New helper `resolve_branch_sha()` in `scanner/github.py`
- New caching table `gitsha_resolutions` (owner/repo/ref → sha, 7-day TTL)
- New daily Celery task `prune_expired_resolutions` to clean stale cache
- 5 new tests (cache hit, cache miss, 404, TTL prune, end-to-end branch resolution)
- Minimal additions to existing mocks (add 1 branch-name case to `test_github.py`)

**Out of scope (deferred):**

- `.superpowers/sdd/.gitignore` whitelist for `plan-*.md` artifacts
- Retroactive `Co-Authored-By` lines on 7 historical commits
- Backfill migration to clean up existing corrupted `git_sha` rows (none exist in this dev environment; production deploy is brand-new)
- Refactoring scan_failures to a richer error taxonomy (current `scan_failure_kind` column is sufficient)

## Design

### Component 1: New table `gitsha_resolutions`

Added to the canonical schema in `web/prisma/schema.prisma` and migrated to both MySQL and SQLite (test) databases.

```prisma
model GitShaResolution {
  id          Int      @id @default(autoincrement())
  owner       String   @db.VarChar(255)
  repo        String   @db.VarChar(255)
  ref         String   @db.VarChar(255)  // branch name, e.g. "main"
  sha         String   @db.Char(40)      // resolved 40-hex SHA
  resolved_at DateTime @default(now())   @db.DateTime

  @@unique([owner, repo, ref])
  @@index([resolved_at])  // for TTL prune queries
}
```

**Why a separate table (not extending `node_versions`):** `node_versions.git_sha` is `CHAR(40)` and pinned to that semantic — a synthetic "branch name" would violate the column's invariant. Keeping the cache separate preserves `node_versions.git_sha`'s meaning.

**TTL reasoning:** 7 days = Celery beat weekly scan cadence. First scan: cache miss, fill. Second scan (6 days later): cache hit. Third scan (7+ days after first): stale entry pruned + refilled by the daily `prune_expired_resolutions` task.

### Component 2: New helper `resolve_branch_sha()`

In `scanner/github.py`:

```python
class GitHubClient:
    # ... existing methods ...

    def resolve_branch_sha(self, owner: str, repo: str, ref: str) -> str | None:
        """Resolve a branch name (e.g. 'main') to a 40-hex SHA via git/ref/heads API.
        Caches results in gitsha_resolutions for 7 days.
        Returns None if the branch cannot be resolved (404, 403, network error after retry)."""
        from scanner.db import lookup_branch_sha, upsert_branch_sha

        cached = lookup_branch_sha(owner, repo, ref)
        if cached is not None:
            return cached

        # Cache miss + stale (>7d) → resolve via API
        try:
            data = self._request_with_retry(
                "GET",
                f"/repos/{owner}/{repo}/git/ref/heads/{ref}",
            )
            sha = data["object"]["sha"]
        except httpx.HTTPStatusError as exc:
            # Terminal 4xx (Plan 5 Task 2 classification) — skip + log
            if exc.response.status_code in (404, 403):
                logger.info("branch %s/%s/%s not resolvable: %s", owner, repo, ref, exc)
                return None
            raise

        upsert_branch_sha(owner, repo, ref, sha)
        return sha
```

**Uses existing `_request_with_retry`** (Plan 5 Task 2) — gets 4xx/5xx/rate_limit classification for free. 5xx retries automatically; 404/403 fail immediately.

### Component 3: Modified `fetch_releases.py`

```python
# scanner/tasks/fetch_releases.py

import re

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")  # 40-hex SHA1

@celery_app.task(...)
def fetch_releases(node_id: int, owner: str, repo: str) -> list[int]:
    # ... existing try/except around client.get_releases ...

    version_ids: list[int] = []
    for rel in releases:
        tag = rel.get("tag_name")
        sha = rel.get("target_commitish", "")
        date_str = rel.get("published_at")
        if not tag or not date_str:
            continue

        # Detect SHA vs branch name
        if _SHA_RE.match(sha):
            resolved_sha = sha
        else:
            # Branch name → resolve via git_refs API
            resolved_sha = client.resolve_branch_sha(owner, repo, sha)
            if resolved_sha is None:
                record_scan_failure(
                    node_id,
                    "fetch_releases",
                    f"target_commitish_resolve_failed: branch={sha}, owner={owner}, repo={repo}",
                )
                continue

        try:
            release_date = _parse_github_date(date_str)
        except ValueError:
            continue

        version_id = upsert_version(node_id, tag, resolved_sha, release_date)
        version_ids.append(version_id)
    return version_ids
```

**Key changes:**
- `len(sha) < 7` filter **removed** (it incorrectly dropped valid release rows)
- `sha.ljust(40, "0")` padding **removed entirely** (no more silent corruption)
- New `resolve_branch_sha()` call replaces the drop-or-pad logic
- Failures recorded with `record_scan_failure` for observability

### Component 4: DB helpers + daily prune task

In `scanner/db.py`:

```python
def lookup_branch_sha(owner: str, repo: str, ref: str) -> str | None:
    """Return cached SHA if present and <7 days old. Otherwise None."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sha FROM gitsha_resolutions "
                "WHERE owner=%s AND repo=%s AND ref=%s "
                "AND resolved_at > NOW() - INTERVAL 7 DAY",
                (owner, repo, ref),
            )
            row = cur.fetchone()
    return row["sha"] if row else None

def upsert_branch_sha(owner: str, repo: str, ref: str, sha: str) -> None:
    """Insert or refresh cache entry. Called on successful API resolution."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO gitsha_resolutions (owner, repo, ref, sha, resolved_at) "
                "VALUES (%s, %s, %s, %s, NOW()) "
                "ON DUPLICATE KEY UPDATE sha=VALUES(sha), resolved_at=NOW()",
                (owner, repo, ref, sha),
            )

def prune_expired_resolutions() -> int:
    """Delete cache entries older than 7 days. Returns count deleted."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM gitsha_resolutions WHERE resolved_at < NOW() - INTERVAL 7 DAY"
            )
            count = cur.rowcount
    return count
```

In `scanner/tasks/cache.py` (new file):

```python
from scanner.celery_app import celery_app
from scanner.db import prune_expired_resolutions

@celery_app.task(name="scanner.tasks.prune_expired_resolutions")
def prune_expired_resolutions_task() -> int:
    """Daily Celery task to clean stale gitsha_resolutions cache entries."""
    try:
        deleted = prune_expired_resolutions()
    except Exception:
        logger.exception("prune_expired_resolutions failed")
        return 0
    if deleted:
        logger.info("pruned %d expired gitsha_resolutions entries", deleted)
    return deleted
```

**Celery beat schedule:** extend `scanner.celery_app` to add a daily 04:00 UTC entry for `prune_expired_resolutions_task`. (Existing weekly Mon 03:00 UTC schedule stays; daily 04:00 UTC is the new entry.)

### Component 5: Migration

Prisma migration applied to both production MySQL and dev/SQLite test DBs:

```sql
CREATE TABLE gitsha_resolutions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner VARCHAR(255) NOT NULL,
  repo VARCHAR(255) NOT NULL,
  ref VARCHAR(255) NOT NULL,
  sha CHAR(40) NOT NULL,
  resolved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_gitsha_resolutions_owner_repo_ref (owner, repo, ref),
  KEY idx_gitsha_resolutions_resolved_at (resolved_at)
);
```

For SQLite (test DB): equivalent via `prisma db push --force-reset` after schema change.

For production: `web/prisma migrate deploy` will apply this on the next build-prod.sh run (same flow as Task 1).

## Data flow

```
fetch_releases(43, "foo", "bar")
  │
  ├─→ GitHubClient.get_releases("foo", "bar")
  │     └─→ GET /repos/foo/bar/releases?per_page=5
  │           → [{tag:"v1.0", target_commitish:"main", ...},
  │              {tag:"v0.9", target_commitish:"abcdef1234567890abcdef1234567890abcdef12", ...}]
  │
  ├─→ For each release:
  │     ├─→ sha = rel["target_commitish"]
  │     ├─→ if _SHA_RE.match(sha): use as-is
  │     ├─→ else:  # branch name
  │     │     ├─→ resolve_branch_sha("foo", "bar", "main")
  │     │     │     ├─→ lookup_branch_sha() check cache
  │     │     │     │     ├─→ hit (age <7d): return cached SHA
  │     │     │     │     └─→ miss: GET /repos/foo/bar/git/ref/heads/main
  │     │     │     │           ├─→ success: upsert_branch_sha(), return SHA
  │     │     │     │           └─→ 404/403: log + return None
  │     │     │     └─→ on None: record_scan_failure(...) + continue
  │     │     └─→ upsert_version(node_id, tag, real_sha, date)
  │     └─→ version_ids.append(version_id)
  │
  └─→ return version_ids
```

## Error handling

| Scenario | Behavior |
|---|---|
| git_refs returns 404 (branch renamed/deleted) | Log + return `None`. Caller records `scan_failures` row, skips release. No retry. |
| git_refs returns 403 (private repo or token lacks access) | Same as 404. |
| git_refs returns 5xx | Existing `_request_with_retry` exponential backoff (Plan 5 Task 2). After MAX_RETRIES, the outer try/except in `fetch_releases` catches and records scan_failure for the whole task. |
| git_refs returns 401 (token invalid) | Terminal 4xx in `_classify_response`. Caller fails fast. |
| Rate limit (403/429 + `X-RateLimit-Reset`) | Wait until reset, retry up to MAX_RETRIES. |
| Cache write fails (DB error in `upsert_branch_sha`) | Log warning, **return SHA anyway** (don't block scan on cache write failure). |
| `prune_expired_resolutions` task fails | Log error, return 0. Next day's run will retry. |
| Existing `node_versions.git_sha` rows with padded-garbage values | **Not migrated** — out of scope. Production is brand-new; no live data to fix. |

## Testing

5 new tests + 1 mock data update.

### New tests in `scanner/tests/test_github.py`

```python
def test_resolve_branch_sha_returns_cached(httpx_mock, db_eager):
    """Cache hit: returns SHA from DB without API call."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        json={"object": {"sha": "deadbeef" * 5}},  # 40 hex
        is_reusable=True,
    )
    upsert_branch_sha("foo", "bar", "main", "deadbeef" * 5)
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") == "deadbeef" * 5
    # httpx_mock assertion: no additional requests were made


def test_resolve_branch_sha_calls_api_on_cache_miss(httpx_mock, db_eager):
    """Cache miss: hits git_refs API, caches result, returns SHA."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        json={"object": {"sha": "feedface" * 5}},
    )
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") == "feedface" * 5
    # Cache populated for next call
    assert lookup_branch_sha("foo", "bar", "main") == "feedface" * 5


def test_resolve_branch_sha_returns_none_on_404(httpx_mock, db_eager):
    """404 response: returns None, caller records scan_failure."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        status_code=404,
    )
    client = GitHubClient(token="t")
    assert client.resolve_branch_sha("foo", "bar", "main") is None


def test_prune_expired_resolutions_removes_old_entries(db_eager):
    """TTL boundary: entries with resolved_at < NOW() - 7d are deleted."""
    upsert_branch_sha("foo", "bar", "main", "deadbeef" * 5)  # fresh
    # Insert an 8-day-old entry directly via DB
    db.execute(
        "INSERT INTO gitsha_resolutions (owner, repo, ref, sha, resolved_at) "
        "VALUES (%s, %s, %s, %s, NOW() - INTERVAL 8 DAY)",
        ("foo", "bar", "old-branch", "feedface" * 5),
    )
    deleted = prune_expired_resolutions()
    assert deleted == 1
    assert lookup_branch_sha("foo", "bar", "old-branch") is None
    assert lookup_branch_sha("foo", "bar", "main") == "deadbeef" * 5


def test_fetch_releases_resolves_branch_name(httpx_mock, db_eager):
    """End-to-end: release with target_commitish='main' gets real SHA written to DB."""
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[{"tag_name": "v1.0", "target_commitish": "main",
               "published_at": "2026-06-01T00:00:00Z",
               "tarball_url": "https://api.github.com/repos/foo/bar/tarball/v1.0"}],
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/git/ref/heads/main",
        json={"object": {"sha": "abcdef12" * 5}},  # 40 hex
    )
    insert_node(...)  # helper from test_db.py
    ids = fetch_releases(node_id, "foo", "bar")
    assert len(ids) == 1
    row = db.execute("SELECT git_sha FROM node_versions WHERE id = %s", ids[0])
    assert row["git_sha"] == "abcdef12" * 5  # NOT "main00000..."
```

### Mock data update

Add **one** additional release entry to `test_fetch_releases_inserts_node_versions` in `scanner/tests/test_tasks.py` (currently 2 releases at lines 64-65) that uses `target_commitish: "main"` to lock in the new resolution path. The accompanying `httpx_mock` for the `git/ref/heads/main` URL provides the resolved SHA. **Note:** the `test_get_releases_returns_5_most_recent` test in `test_github.py` calls `GitHubClient.get_releases()` (raw API data, no SHA handling) so it's unaffected by the change. All other test mocks keep their 40-hex `target_commitish` values (minimum change).

### Schema test

`scanner/tests/test_db.py`: extend `test_apply_migrations_creates_all_tables` (or equivalent) to verify `gitsha_resolutions` exists with the expected columns and unique key.

## Acceptance criteria

- [ ] `target_commitish` of `"main"`, `"master"`, etc. no longer produces padded-garbage in `node_versions.git_sha`
- [ ] Real 40-hex SHAs continue to flow through unchanged
- [ ] Cached resolutions are reused for 7 days, reducing API calls
- [ ] Failed branch resolutions are recorded in `scan_failures` with `target_commitish_resolve_failed: branch=...` reason
- [ ] Celery beat schedules `prune_expired_resolutions` daily at 04:00 UTC
- [ ] All existing scanner + web tests continue to pass
- [ ] Migration applies cleanly on fresh DB
- [ ] Smoke test re-run passes (web 167/167, scanner 51+/+, tsc 0 errors)

## Migration plan

1. Add `GitShaResolution` model to `web/prisma/schema.prisma`
2. Generate Prisma migration: `prisma migrate dev --name add_gitsha_resolutions`
3. Verify migration SQL matches the schema above
4. Run `deploy/scripts/build-prod.sh` (idempotent) — applies the new migration via `npm run prisma:migrate:deploy`
5. New code in scanner reads/writes the table; existing data is unaffected

## Followups (not in Plan 5.1)

- Future improvement: a `/admin/cache/gitsha` UI to inspect and manually invalidate cache entries
- Future improvement: add `gitsha_resolutions` partitioning by `resolved_at` month if table grows past ~100k rows
- Plan 5.2+ candidate: 7 historical commits missing `Co-Authored-By` line
