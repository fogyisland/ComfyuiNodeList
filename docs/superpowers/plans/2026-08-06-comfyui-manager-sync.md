# ComfyUI Manager Catalog Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot manual sync that pulls ComfyUI Manager's `custom-node-list.json` and writes each previously-unseen node as a pending `node_submissions` row, so admins can approve them through the existing review UI.

**Architecture:** One new Celery task (`scanner.tasks.sync_manager_catalog`) fetches the JSON via `httpx`, parses each entry's `reference` URL to `(github_owner, github_repo)`, dedups against `nodes` (any status) + `node_submissions` (status='pending'), and inserts pending rows attributed to a dedicated system user `comfyui-manager`. Triggered by a new admin button on `/admin` that hits `POST /api/v1/admin/manager/sync` → trigger_api's new `POST /trigger-manager-sync` → enqueue the task. Versions are NOT synced — admin approval lets the existing weekly scanner pick them up. 0 schema migrations; 0 new dependencies.

**Tech Stack:**
- Python 3.11+ (existing `scanner/` infra)
- Celery 5 + Redis broker (existing)
- `httpx`, `pymysql`, `urllib.parse` (all existing)
- Next.js 15 + existing `requireAdmin()` + `api-helpers.ts`

## Global Constraints

Verbatim from spec `docs/superpowers/specs/2026-08-06-comfyui-manager-sync-design.md` — every task's requirements implicitly include this section:

- **Data source:** `https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json`
- **JSON shape:** top-level is a dict keyed by node id; each entry has `reference` (repo URL) among other fields — this spec only consumes `reference` (other fields ignored, YAGNI)
- **Write target:** `node_submissions` table with `status='pending'` (existing schema)
- **Submitter identity:** system user `username='comfyui-manager'`, `role='user'`, `github_id=NULL`, `password_hash=NULL`, `email=NULL`, `avatar_url=''` — created idempotently in `web/prisma/seed.ts`
- **Trigger:** manual admin button on `/admin` only — no Celery beat schedule
- **Dedup rule:** skip if `(github_owner, github_repo)` exists in `nodes` (any status) OR in `node_submissions` where `status='pending'`. `approved` and `rejected` submissions are NOT in the dedup set (allows re-import).
- **URL parsing:** `urlparse(reference)`; require `netloc == 'github.com'`; first two non-empty `path` segments = `owner`/`repo`; ignore fragments and queries; lowercase both
- **Versions NOT synced** — rely on existing weekly scanner after admin approval
- **No schema migrations.** System user created via `prisma db seed`
- **No new dependencies.** `httpx`, `pymysql`, `urllib.parse` are existing
- **No sync history table, no client polling, no SSE** — admin reloads `/admin/submissions` to see new pending rows
- **Testing:** pytest covers the Python task (httpx mocked, real `comfyui_nodes_test` DB); vitest covers the Next.js route (mocked fetch); UI button verified manually
- **Per-row autocommit; no transaction wrapping the batch** — partial insert failures leave partial state for admin to reject
- **No `autoretry_for`** on the new Celery task

## File Structure

### New files (4)

| File | Responsibility |
|---|---|
| `scanner/tasks/sync_manager_catalog.py` | The Celery task: fetch JSON → parse → dedup → insert |
| `scanner/tests/fixtures/manager_catalog.json` | Test fixture: 5 representative entries |
| `scanner/tests/test_sync_manager_catalog.py` | pytest covering all spec test cases |
| `web/app/api/v1/admin/manager/sync/route.ts` | Next.js POST handler: auth + forward to trigger_api |
| `web/tests/api/admin-manager-sync.test.ts` | vitest covering auth + 5xx + timeout + happy path |

### Modified files (5)

| File | Change |
|---|---|
| `scanner/db.py` | +3 helpers: `fetch_existing_owner_repo_pairs`, `fetch_system_submitter_id`, `insert_pending_submission` |
| `scanner/tests/test_db.py` | +tests for the 3 new helpers |
| `scanner/conftest.py` | +`system_user` fixture (idempotent prisma upsert of `comfyui-manager`) |
| `scanner/trigger_api.py` | +`POST /trigger-manager-sync` endpoint |
| `web/prisma/seed.ts` | +idempotent `seedSystemUsers()` call at end of `main()` |
| `web/app/(admin)/_components/AdminDashboard.tsx` | +`<ManagerSyncButton managerSystemUserId={id\|null} />` client island |
| `web/app/admin/page.tsx` | +lookup of `comfyui-manager` user id, pass to AdminDashboard |

### Files this plan does NOT touch

- `web/prisma/schema.prisma` — no schema changes
- `scanner/celery_app.py` — `autodiscover_tasks` already picks up new tasks
- `scanner/tasks/fetch_pending_nodes.py` — unchanged; still scans `nodes` table
- Any admin UI page other than the dashboard component

### File ordering rationale

Task 1 (helpers) provides the foundation. Task 2 (Celery task) consumes them. Task 3 (trigger chain) wraps the task with HTTP layers. Task 4 (UI) lets humans invoke it. Each task is independently reviewable: after Task 1 the new db.py functions have tests; after Task 2 the full sync flow has tests; after Task 3 the HTTP chain has tests; after Task 4 the end-user feature works.

---

## Task 1: scanner/db.py helpers

**Files:**
- Modify: `scanner/db.py` (add 3 functions at end)
- Modify: `scanner/tests/test_db.py` (add ~6 tests)
- Modify: `scanner/conftest.py` (add `system_user` fixture)

**Interfaces:**
- Consumes: existing `get_connection()` context manager
- Produces:
  - `fetch_existing_owner_repo_pairs() -> set[tuple[str, str]]`
  - `fetch_system_submitter_id(username: str = "comfyui-manager") -> int | None`
  - `insert_pending_submission(submitter_id: int, github_url: str) -> int`

- [ ] **Step 1: Write failing test for `fetch_existing_owner_repo_pairs`**

Append to `scanner/tests/test_db.py`:

```python
def test_fetch_existing_owner_repo_pairs_empty(db):
    from scanner.db import fetch_existing_owner_repo_pairs
    assert fetch_existing_owner_repo_pairs() == set()


def test_fetch_existing_owner_repo_pairs_includes_nodes(db):
    _insert_node(db, "foo", "bar", "active")
    _insert_node(db, "BAZ", "QUX", "deprecated")  # any status counts
    from scanner.db import fetch_existing_owner_repo_pairs
    pairs = fetch_existing_owner_repo_pairs()
    assert pairs == {("foo", "bar"), ("baz", "qux")}  # lowercased


def test_fetch_existing_owner_repo_pairs_includes_pending_submissions(db):
    # Insert pending submission for foo/bar (via helper we'll add in Step 3)
    from scanner.db import insert_pending_submission, fetch_existing_owner_repo_pairs
    submitter = _insert_user(db, username="u1")
    insert_pending_submission(submitter, "https://github.com/foo/bar")
    pairs = fetch_existing_owner_repo_pairs()
    assert ("foo", "bar") in pairs


def test_fetch_existing_owner_repo_pairs_excludes_approved_submissions(db):
    # Approved submissions are NOT in dedup set (per spec invariant #1)
    from scanner.db import insert_pending_submission, fetch_existing_owner_repo_pairs
    from scanner.db import get_connection
    submitter = _insert_user(db, username="u1")
    new_id = insert_pending_submission(submitter, "https://github.com/foo/bar")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='approved' WHERE id=%s", (new_id,))
        conn.commit()
    assert ("foo", "bar") not in fetch_existing_owner_repo_pairs()
```

Also append helper used by these tests at top of `test_db.py` (near the existing `_insert_node`):

```python
def _insert_user(db, username="u", role="user"):
    """Insert a user with no github_id / password_hash (system-style)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, avatar_url, role, created_at) "
                "VALUES (%s, '', %s, NOW())",
                (username, role),
            )
            user_id = cur.lastrowid
        conn.commit()
        return user_id
```

- [ ] **Step 2: Run tests, confirm FAIL**

Run from repo root:
```bash
cd scanner && pytest tests/test_db.py -v -k "fetch_existing_owner_repo_pairs"
```
Expected: `ImportError` / `AttributeError: module 'scanner.db' has no attribute 'fetch_existing_owner_repo_pairs'` for each new test.

- [ ] **Step 3: Implement `fetch_existing_owner_repo_pairs`**

Append to `scanner/db.py`:

```python
def fetch_existing_owner_repo_pairs() -> set[tuple[str, str]]:
    """Return set of (owner_lower, repo_lower) pairs that exist in
    `nodes` (any status) or in `node_submissions` where status='pending'.

    Used by sync_manager_catalog to skip already-known entries. Approved/
    rejected submissions are NOT included (intentional: allows re-import).
    """
    pairs: set[tuple[str, str]] = set()
    with get_connection() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT github_owner, github_repo FROM nodes")
            for row in cur.fetchall():
                pairs.add((row["github_owner"].lower(), row["github_repo"].lower()))
            cur.execute("SELECT github_url FROM node_submissions WHERE status='pending'")
            for row in cur.fetchall():
                parsed = _parse_github_url(row["github_url"])
                if parsed is not None:
                    pairs.add(parsed)
    return pairs


def _parse_github_url(url: str) -> tuple[str, str] | None:
    """Parse a GitHub repo URL into (owner_lower, repo_lower), or None if invalid.

    Accepts: https://github.com/owner/repo, https://github.com/owner/repo/...
    Ignores: fragments, query strings, case (lowercased).
    Rejects: non-github.com hosts, empty owner/repo, fewer than 2 path segments.
    """
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.netloc.lower() != "github.com":
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None
    return (parts[0].lower(), parts[1].lower())
```

Note: `_parse_github_url` is a private helper reused by both helpers and the Celery task. Place it adjacent to `fetch_existing_owner_repo_pairs`.

- [ ] **Step 4: Run tests, confirm PASS**

```bash
cd scanner && pytest tests/test_db.py -v -k "fetch_existing_owner_repo_pairs"
```
Expected: 4 passed.

- [ ] **Step 5: Write failing test for `fetch_system_submitter_id`**

Append to `scanner/tests/test_db.py`:

```python
def test_fetch_system_submitter_id_missing(db):
    from scanner.db import fetch_system_submitter_id
    assert fetch_system_submitter_id() is None


def test_fetch_system_submitter_id_found(db):
    from scanner.db import fetch_system_submitter_id
    _insert_user(db, username="comfyui-manager")
    uid = fetch_system_submitter_id()
    assert uid is not None
    assert isinstance(uid, int)
```

- [ ] **Step 6: Run test, confirm FAIL**

```bash
cd scanner && pytest tests/test_db.py -v -k "fetch_system_submitter_id"
```
Expected: `AttributeError: module 'scanner.db' has no attribute 'fetch_system_submitter_id'`.

- [ ] **Step 7: Implement `fetch_system_submitter_id`**

Append to `scanner/db.py`:

```python
def fetch_system_submitter_id(username: str = "comfyui-manager") -> int | None:
    """Return users.id for the system submitter user, or None if missing.

    The 'comfyui-manager' user is created by `web/prisma/seed.ts` (idempotent
    upsert). If it's missing, sync_manager_catalog must fail-fast so admins
    know to run `pnpm prisma:seed`.
    """
    with get_connection() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT id FROM users WHERE username = %s", (username,))
            row = cur.fetchone()
    return int(row["id"]) if row else None
```

- [ ] **Step 8: Run test, confirm PASS**

```bash
cd scanner && pytest tests/test_db.py -v -k "fetch_system_submitter_id"
```
Expected: 2 passed.

- [ ] **Step 9: Write failing test for `insert_pending_submission`**

Append to `scanner/tests/test_db.py`:

```python
def test_insert_pending_submission_creates_pending_row(db):
    from scanner.db import insert_pending_submission, get_connection
    submitter = _insert_user(db, username="alice")
    new_id = insert_pending_submission(submitter, "https://github.com/foo/bar")
    assert new_id > 0
    with get_connection() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT submitter_id, github_url, status FROM node_submissions WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["submitter_id"] == submitter
    assert row["github_url"] == "https://github.com/foo/bar"
    assert row["status"] == "pending"
```

- [ ] **Step 10: Run test, confirm FAIL**

```bash
cd scanner && pytest tests/test_db.py -v -k "insert_pending_submission_creates_pending_row"
```
Expected: `AttributeError: module 'scanner.db' has no attribute 'insert_pending_submission'`.

- [ ] **Step 11: Implement `insert_pending_submission`**

Append to `scanner/db.py`:

```python
def insert_pending_submission(submitter_id: int, github_url: str) -> int:
    """INSERT one row into node_submissions (status='pending'). Returns new id.

    Raises pymysql.IntegrityError on FK violation (shouldn't happen given dedup).
    Per-row autocommit; caller decides whether to abort the loop on errors.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO node_submissions (submitter_id, github_url, status) "
                "VALUES (%s, %s, 'pending')",
                (submitter_id, github_url),
            )
            new_id = cur.lastrowid
        conn.commit()
        return new_id
```

- [ ] **Step 12: Run test, confirm PASS**

```bash
cd scanner && pytest tests/test_db.py -v -k "insert_pending_submission_creates_pending_row"
```
Expected: 1 passed.

- [ ] **Step 13: Add `system_user` pytest fixture to `scanner/conftest.py`**

Append to `scanner/conftest.py` (after the existing `db` fixture, before any imports that would break ordering):

```python
@pytest.fixture
def system_user(db):
    """Idempotently upsert the 'comfyui-manager' system user.

    Mirrors what `web/prisma/seed.ts` does in dev/prod. Returns the user's id.
    """
    from scanner.db import get_connection
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, avatar_url, role, created_at) "
                "VALUES ('comfyui-manager', '', 'user', NOW()) "
                "ON DUPLICATE KEY UPDATE username = username",
            )
            cur.execute("SELECT id FROM users WHERE username = 'comfyui-manager'")
            row = cur.fetchone()
        conn.commit()
    return int(row[0]) if isinstance(row, tuple) else int(row["id"])
```

- [ ] **Step 14: Run all test_db.py tests**

```bash
cd scanner && pytest tests/test_db.py -v
```
Expected: All existing tests pass + 7 new tests pass (4 fetch_existing + 2 fetch_system + 1 insert_pending = 7).

- [ ] **Step 15: Commit**

```bash
cd ..
git add scanner/db.py scanner/tests/test_db.py scanner/conftest.py
git commit -m "feat(scanner): add 3 db helpers for Manager catalog sync"
```

---

## Task 2: sync_manager_catalog Celery task

**Files:**
- Create: `scanner/tasks/sync_manager_catalog.py`
- Create: `scanner/tests/fixtures/manager_catalog.json`
- Create: `scanner/tests/test_sync_manager_catalog.py`

**Interfaces:**
- Consumes:
  - `httpx` (with the existing `pytest-httpx` mock infrastructure)
  - `scanner.db.fetch_existing_owner_repo_pairs()`, `fetch_system_submitter_id()`, `insert_pending_submission()`
  - The `_parse_github_url` helper from Task 1
  - `celery_app` from `scanner.celery_app`
- Produces:
  - Celery task `scanner.tasks.sync_manager_catalog` returning a result dict per spec §Data flow step 6

- [ ] **Step 1: Create the fixture JSON file**

Create `scanner/tests/fixtures/manager_catalog.json`:

```json
{
  "valid-node": {
    "author": "alice",
    "title": "Valid Node",
    "reference": "https://github.com/alice/valid-node",
    "id": "valid-node"
  },
  "no-reference": {
    "author": "bob",
    "title": "Missing Reference",
    "id": "no-reference"
  },
  "non-github": {
    "author": "carol",
    "title": "GitLab Node",
    "reference": "https://gitlab.com/carol/non-github",
    "id": "non-github"
  },
  "nested-path": {
    "author": "dave",
    "title": "Node With Nested Path",
    "reference": "https://github.com/dave/nested-path/tree/main",
    "id": "nested-path"
  },
  "null-reference": {
    "author": "eve",
    "title": "Null Reference",
    "reference": null,
    "id": "null-reference"
  }
}
```

- [ ] **Step 2: Create the test file with happy-path test (failing)**

Create `scanner/tests/test_sync_manager_catalog.py`:

```python
"""Tests for scanner.tasks.sync_manager_catalog.

Uses:
- `db_eager` fixture (resets test DB + enables Celery eager mode)
- `system_user` fixture (idempotent 'comfyui-manager' user)
- `httpx_mock` (pytest-httpx) for HTTP interception
"""
import json
import os

# Force eager mode BEFORE importing celery_app
os.environ.setdefault("CELERY_TEST_EAGER", "1")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from pytest_httpx import httpx_mock

from scanner.celery_app import celery_app
from scanner.db import get_connection, insert_pending_submission
from scanner.tasks.sync_manager_catalog import sync_manager_catalog


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "manager_catalog.json")
MANAGER_URL = "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"


def _load_fixture() -> dict:
    with open(FIXTURE_PATH) as f:
        return json.load(f)


def _pending_submissions() -> list[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT github_url, submitter_id, status FROM node_submissions ORDER BY id")
            return list(cur.fetchall())


def test_happy_path(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json=_load_fixture())
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    # 3 entries have valid github URLs: valid-node, nested-path; null-reference's reference=None counts as invalid
    # Wait — let me recount: valid-node ✓, no-reference (missing field) ✗, non-github ✗, nested-path ✓ (parses to dave/nested-path), null-reference (None) ✗
    assert result["added"] == 2
    assert result["skipped_invalid_url"] == 3
    assert result["skipped_existing"] == 0
    assert result["skipped_pending"] == 0
    assert result["errors"] == []
    rows = _pending_submissions()
    assert len(rows) == 2
    assert {r["github_url"] for r in rows} == {
        "https://github.com/alice/valid-node",
        "https://github.com/dave/nested-path",
    }
    for r in rows:
        assert r["submitter_id"] == system_user
        assert r["status"] == "pending"
```

- [ ] **Step 3: Run test, confirm FAIL**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v
```
Expected: `ModuleNotFoundError: No module named 'scanner.tasks.sync_manager_catalog'`.

- [ ] **Step 4: Implement the Celery task (minimum for happy path)**

Create `scanner/tasks/sync_manager_catalog.py`:

```python
"""One-shot sync: pull ComfyUI Manager's custom-node-list.json, dedup, insert
pending node_submissions for admin review.

Idempotent: re-runs are no-ops for already-known nodes (per spec invariant #1).
"""
from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

import httpx

from scanner.celery_app import celery_app
from scanner.db import (
    fetch_existing_owner_repo_pairs,
    fetch_system_submitter_id,
    insert_pending_submission,
)

logger = logging.getLogger(__name__)

MANAGER_CATALOG_URL = (
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
)
HTTP_TIMEOUT_SECONDS = 30.0


@celery_app.task(name="scanner.tasks.sync_manager_catalog")
def sync_manager_catalog() -> dict:
    """Fetch ComfyUI Manager catalog → dedup → INSERT pending submissions.

    Returns dict with status, fetched, added, skipped_existing, skipped_pending,
    skipped_invalid_url, errors[]. See spec §Data flow step 6.
    """
    counts = {
        "fetched": 0,
        "added": 0,
        "skipped_existing": 0,
        "skipped_pending": 0,
        "skipped_invalid_url": 0,
        "errors": [],
    }

    # Step 1: Fetch catalog
    try:
        resp = httpx.get(MANAGER_CATALOG_URL, timeout=HTTP_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("manager catalog fetch failed: %s", exc)
        return {"status": "failed", "stage": "fetch", "error": str(exc)}

    # Step 2: Parse JSON
    try:
        catalog = resp.json()
    except json.JSONDecodeError as exc:
        logger.warning("manager catalog not valid JSON: %s", exc)
        return {"status": "failed", "stage": "parse", "error": "malformed JSON"}
    if not isinstance(catalog, dict):
        return {"status": "failed", "stage": "parse", "error": "catalog top-level must be a dict"}

    counts["fetched"] = len(catalog)

    # Step 3: Parse each entry's reference URL
    parsed_entries: list[tuple[str, str, str]] = []  # (entry_id, owner, repo)
    for entry_id, entry in catalog.items():
        ref = entry.get("reference") if isinstance(entry, dict) else None
        parsed = _parse_github_url(ref) if isinstance(ref, str) and ref else None
        if parsed is None:
            counts["skipped_invalid_url"] += 1
            continue
        parsed_entries.append((entry_id, parsed[0], parsed[1]))

    # Step 4: Dedup against nodes + pending submissions
    try:
        existing = fetch_existing_owner_repo_pairs()
    except Exception as exc:
        logger.exception("dedup query failed")
        return {"status": "failed", "stage": "dedup", "error": str(exc)}

    new_entries: list[tuple[str, str, str]] = []
    for entry_id, owner, repo in parsed_entries:
        if (owner, repo) in existing:
            # Distinguish: is it in nodes (existing) or pending submissions?
            # For simplicity, count all as skipped_pending unless we know otherwise.
            # We can split later; spec doesn't require the split to be precise.
            counts["skipped_pending"] += 1  # we'll refine below if needed
        else:
            new_entries.append((entry_id, owner, repo))

    # Refine the split: re-query to know which entries are in nodes vs pending.
    # (Optimization deferred — current implementation is correct but imprecise.)

    # Step 5: Look up system user
    submitter_id = fetch_system_submitter_id()
    if submitter_id is None:
        return {
            "status": "failed",
            "stage": "system_user",
            "error": "system user missing; run pnpm prisma:seed",
        }

    # Step 6: INSERT each new entry
    for entry_id, owner, repo in new_entries:
        url = f"https://github.com/{owner}/{repo}"
        try:
            insert_pending_submission(submitter_id, url)
            counts["added"] += 1
        except Exception as exc:
            logger.warning("insert failed for %s: %s", entry_id, exc)
            counts["errors"].append({"entry_id": entry_id, "error": str(exc)})

    return {"status": "ok", **counts}


def _parse_github_url(url: str) -> tuple[str, str] | None:
    """Parse a GitHub repo URL into (owner_lower, repo_lower), or None if invalid.

    Accepts: https://github.com/owner/repo, https://github.com/owner/repo/...
    Ignores: fragments, query strings, case (lowercased).
    Rejects: non-github.com hosts, empty owner/repo, fewer than 2 path segments.
    """
    parsed = urlparse(url)
    if parsed.netloc.lower() != "github.com":
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None
    return (parts[0].lower(), parts[1].lower())
```

Note: This implementation reuses `_parse_github_url` from `scanner/db.py` (Task 1). The local copy in this file is a duplicate; consolidate in Step 4b below.

- [ ] **Step 4b: Remove the duplicate `_parse_github_url` in `sync_manager_catalog.py`**

The task should import the helper from `scanner.db`:

```python
from scanner.db import (
    _parse_github_url,  # private import OK within the scanner package
    fetch_existing_owner_repo_pairs,
    fetch_system_submitter_id,
    insert_pending_submission,
)
```

And remove the local definition.

(Or alternatively: move `_parse_github_url` from `scanner/db.py` to a new `scanner/_url_helpers.py` module to make the import less awkward. The current Task 1 placement (private helper in `db.py`) is fine — promote only if a reviewer flags it.)

- [ ] **Step 5: Run happy-path test, confirm PASS**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "happy_path"
```
Expected: 1 passed.

- [ ] **Step 6: Add remaining test cases (dedup, parse, errors, idempotency)**

Append to `scanner/tests/test_sync_manager_catalog.py`:

```python
def _insert_node_helper(db_eager, owner="x", repo="y", status="active"):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, NOW(), NOW())",
                (owner, repo, owner, "x", status),
            )
            node_id = cur.lastrowid
        conn.commit()
        return node_id


def _insert_user_helper(db_eager, username="u", role="user"):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, avatar_url, role, created_at) "
                "VALUES (%s, '', %s, NOW())",
                (username, role),
            )
            user_id = cur.lastrowid
        conn.commit()
        return user_id


def test_all_existing_in_nodes(db_eager, system_user, httpx_mock):
    _insert_node_helper(db_eager, "alice", "valid-node")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1  # Now we know it's in nodes, not pending


def test_all_pending_in_submissions(db_eager, system_user, httpx_mock):
    # Pre-seed alice/valid-node as pending
    other = _insert_user_helper(db_eager, username="bob")
    insert_pending_submission(other, "https://github.com/alice/valid-node")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_pending"] == 1
    assert result["skipped_existing"] == 0


def test_approved_not_in_dedup(db_eager, system_user, httpx_mock):
    other = _insert_user_helper(db_eager, username="bob")
    new_id = insert_pending_submission(other, "https://github.com/alice/valid-node")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='approved' WHERE id=%s", (new_id,))
        conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 1  # approved submission doesn't block re-import


def test_rejected_not_in_dedup(db_eager, system_user, httpx_mock):
    other = _insert_user_helper(db_eager, username="bob")
    new_id = insert_pending_submission(other, "https://github.com/alice/valid-node")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='rejected' WHERE id=%s", (new_id,))
        conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 1  # rejected doesn't block re-import


def test_case_insensitive_dedup(db_eager, system_user, httpx_mock):
    _insert_node_helper(db_eager, "Foo", "Bar")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/foo/bar"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1


def test_github_url_with_query_and_fragment(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"n1": {"reference": "https://github.com/alice/valid-node?ref=manager#readme"}},
    )
    result = sync_manager_catalog()
    assert result["added"] == 1


def test_malformed_json(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, text="not json {")
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "parse"


def test_json_top_level_is_list(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json=[{"reference": "https://github.com/a/b"}])
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "parse"


def test_empty_json(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={})
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["fetched"] == 0
    assert result["added"] == 0


def test_http_500(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, status_code=503)
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "fetch"


def test_system_user_missing(db_eager, httpx_mock):
    # No system_user fixture — task must fail-fast
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/a/b"}})
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "system_user"
    assert "system user missing" in result["error"]


def test_idempotent_rerun(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    first = sync_manager_catalog()
    assert first["added"] == 1
    second = sync_manager_catalog()  # same httpx_mock response
    assert second["added"] == 0
    assert second["skipped_pending"] == 1


def test_partial_insert_failure(db_eager, system_user, httpx_mock, monkeypatch):
    """If INSERT #3 fails (e.g. FK violation), the other 2 should still succeed."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={
            "n1": {"reference": "https://github.com/alice/valid-node"},
            "n2": {"reference": "https://github.com/dave/nested-path"},
            "n3": {"reference": "https://github.com/eve/another"},
        },
    )

    real_insert = insert_pending_submission
    call_count = {"n": 0}

    def flaky_insert(submitter_id, url):
        call_count["n"] += 1
        if call_count["n"] == 3:
            raise RuntimeError("simulated DB failure")
        return real_insert(submitter_id, url)

    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.insert_pending_submission", flaky_insert)
    result = sync_manager_catalog()
    assert result["added"] == 2
    assert len(result["errors"]) == 1
    assert result["errors"][0]["entry_id"] == "n3"
```

- [ ] **Step 7: Run all sync tests, confirm PASS**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v
```
Expected: 12 passed (1 happy path + 11 added).

If `test_all_existing_in_nodes` fails because the implementation counts it as `skipped_pending` instead of `skipped_existing`, refine the implementation:

In `scanner/tasks/sync_manager_catalog.py`, replace the dedup step (steps 4 + the optimization comment) with:

```python
    # Step 4: Dedup — split between nodes (skipped_existing) and pending submissions (skipped_pending).
    try:
        existing = fetch_existing_owner_repo_pairs()
        from scanner.db import get_connection as _gc
        with _gc() as _conn:
            with _conn.cursor() as _cur:
                _cur.execute("SELECT github_owner, github_repo FROM nodes")
                node_pairs = {(r["github_owner"].lower(), r["github_repo"].lower()) for r in _cur.fetchall()}
    except Exception as exc:
        logger.exception("dedup query failed")
        return {"status": "failed", "stage": "dedup", "error": str(exc)}

    new_entries: list[tuple[str, str, str]] = []
    for entry_id, owner, repo in parsed_entries:
        pair = (owner, repo)
        if pair in existing:
            if pair in node_pairs:
                counts["skipped_existing"] += 1
            else:
                counts["skipped_pending"] += 1
        else:
            new_entries.append((entry_id, owner, repo))
```

- [ ] **Step 8: Run all tests again, confirm PASS**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v
```
Expected: all 12 passed.

- [ ] **Step 9: Run the full scanner test suite to confirm no regressions**

```bash
cd scanner && pytest -v
```
Expected: all tests pass (existing + new).

- [ ] **Step 10: Commit**

```bash
cd ..
git add scanner/tasks/sync_manager_catalog.py scanner/tests/test_sync_manager_catalog.py scanner/tests/fixtures/manager_catalog.json
git commit -m "feat(scanner): add sync_manager_catalog task for ComfyUI Manager"
```

---

## Task 3: trigger_api endpoint + Next.js route

**Files:**
- Modify: `scanner/trigger_api.py` (add `POST /trigger-manager-sync`)
- Create: `web/app/api/v1/admin/manager/sync/route.ts`
- Create: `web/tests/api/admin-manager-sync.test.ts`

**Interfaces:**
- Consumes: existing `trigger_api.py` Flask app, `celery_app.send_task`, Next.js 15 `requireAdmin()`, `api-helpers.ts` `json()`/`error()`
- Produces:
  - Flask endpoint `POST /trigger-manager-sync` (202 + task_id, 503 on broker fail)
  - Next route `POST /api/v1/admin/manager/sync` (202/401/403/502)

- [ ] **Step 1: Write failing vitest for the Next route**

Create `web/tests/api/admin-manager-sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.stubGlobal('fetch', fetchMock);

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { POST } from '@/app/api/v1/admin/manager/sync/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/manager/sync', () => {
  beforeEach(async () => {
    authMock.mockReset();
    fetchMock.mockReset();
    await setup();
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('returns 202 with task_id when trigger-api succeeds', async () => {
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'queued', task_id: 'mgr-xyz' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.task_id).toBe('mgr-xyz');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/trigger-manager-sync'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns 502 when trigger-api is unreachable', async () => {
    const admin = await makeUser(3n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8081'));
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe('trigger-api unreachable');
  });

  it('returns 502 when trigger-api returns non-2xx', async () => {
    const admin = await makeUser(4n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(new Response('redis down', { status: 503 }));
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe('trigger-api error');
  });

  it('uses default SCANNER_TRIGGER_API_URL when env unset', async () => {
    const prev = process.env.SCANNER_TRIGGER_API_URL;
    delete process.env.SCANNER_TRIGGER_API_URL;
    const admin = await makeUser(5n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'queued', task_id: 't' }), { status: 202 })
    );
    await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8081/trigger-manager-sync',
      expect.any(Object)
    );
    if (prev !== undefined) process.env.SCANNER_TRIGGER_API_URL = prev;
  });
});
```

- [ ] **Step 2: Run test, confirm FAIL**

```bash
cd web && pnpm vitest run tests/api/admin-manager-sync.test.ts
```
Expected: `Failed to resolve import` for `@/app/api/v1/admin/manager/sync/route`.

- [ ] **Step 3: Create the Next.js route**

Create `web/app/api/v1/admin/manager/sync/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

const TRIGGER_API_URL = process.env.SCANNER_TRIGGER_API_URL ?? 'http://127.0.0.1:8081';
const TRIGGER_TIMEOUT_MS = 5000;

export async function POST(_req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const res = await fetch(`${TRIGGER_API_URL}/trigger-manager-sync`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return error(502, 'trigger-api error', detail.slice(0, 500));
    }
    const body = (await res.json()) as { status: string; task_id?: string };
    return json({ status: body.status, task_id: body.task_id }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(502, 'trigger-api unreachable', msg);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**

```bash
cd web && pnpm vitest run tests/api/admin-manager-sync.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Write failing test for the Flask endpoint**

Create `scanner/tests/test_trigger_api.py`:

```python
"""Smoke tests for trigger_api endpoints (manager-sync + existing scan)."""
import json
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture
def client():
    from scanner.trigger_api import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_trigger_manager_sync_queues_task(client):
    fake = MagicMock()
    fake.id = "mgr-abc-123"
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.return_value = fake
        res = client.post("/trigger-manager-sync")
    assert res.status_code == 202
    body = json.loads(res.data)
    assert body["status"] == "queued"
    assert body["task_id"] == "mgr-abc-123"
    mock_celery.send_task.assert_called_once_with("scanner.tasks.sync_manager_catalog")


def test_trigger_manager_sync_returns_503_on_broker_failure(client):
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.side_effect = RuntimeError("redis down")
        res = client.post("/trigger-manager-sync")
    assert res.status_code == 503
    body = json.loads(res.data)
    assert body["error"] == "broker unavailable"


def test_trigger_scan_still_works(client):
    """Regression: the existing /trigger-scan endpoint is unchanged."""
    fake = MagicMock()
    fake.id = "scan-xyz"
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.return_value = fake
        res = client.post("/trigger-scan")
    assert res.status_code == 202
    mock_celery.send_task.assert_called_once_with("scanner.tasks.fetch_pending_nodes")
```

- [ ] **Step 6: Run test, confirm FAIL**

```bash
cd scanner && pytest tests/test_trigger_api.py -v
```
Expected: 3 errors (`werkzeug.routing.exceptions.NotFound` for `/trigger-manager-sync`).

- [ ] **Step 7: Add the Flask endpoint**

Modify `scanner/trigger_api.py`. After the existing `trigger_scan()` function, add:

```python
@app.post("/trigger-manager-sync")
def trigger_manager_sync():
    """Enqueue the sync_manager_catalog task. Returns 202 + task_id on success, 503 on broker failure."""
    try:
        async_result = celery_app.send_task("scanner.tasks.sync_manager_catalog")
    except Exception as exc:
        logger.exception("send_task failed")
        return jsonify({"error": "broker unavailable", "detail": str(exc)}), 503
    return jsonify({"status": "queued", "task_id": async_result.id}), 202
```

- [ ] **Step 8: Run test, confirm PASS**

```bash
cd scanner && pytest tests/test_trigger_api.py -v
```
Expected: 3 passed.

- [ ] **Step 9: Run the full test suites (no regressions)**

```bash
cd .. && cd scanner && pytest -v
cd ../web && pnpm vitest run
```
Expected: all pass (existing + new).

- [ ] **Step 10: Commit**

```bash
cd ..
git add scanner/trigger_api.py scanner/tests/test_trigger_api.py web/app/api/v1/admin/manager/sync/route.ts web/tests/api/admin-manager-sync.test.ts
git commit -m "feat: add /trigger-manager-sync endpoint + Next.js route"
```

---

## Task 4: seed.ts system user + Admin UI button + manual smoke

**Files:**
- Modify: `web/prisma/seed.ts`
- Modify: `web/app/(admin)/_components/AdminDashboard.tsx`
- Create: `web/app/(admin)/_components/ManagerSyncButton.tsx`
- Modify: `web/app/admin/page.tsx`

**Interfaces:**
- Consumes: existing `prisma` client in `seed.ts`; existing `AdminDashboard` props
- Produces:
  - System user `username='comfyui-manager'` (idempotent) created by `pnpm prisma:seed`
  - New `<ManagerSyncButton managerSystemUserId={id | null} />` client island
  - `AdminDashboard` accepts new optional prop `managerSystemUserId: number | null`
  - `web/app/admin/page.tsx` looks up the system user id and passes it

(No automated tests for this task — per spec §Testing: "UI tests for button + flash message verified manually". The seed user is tested indirectly via Task 2's `test_system_user_missing`.)

- [ ] **Step 1: Add idempotent `seedSystemUsers()` to `web/prisma/seed.ts`**

At the bottom of `main()`, after the `console.log('Seed complete:', counts)` line, add:

```ts
  // Idempotently create system users (e.g. 'comfyui-manager' for sync attribution).
  await prisma.user.upsert({
    where: { username: 'comfyui-manager' },
    update: {},
    create: {
      username: 'comfyui-manager',
      avatar_url: '',
      role: 'user',
      // github_id, password_hash, email all default to null (Prisma nullable fields)
    },
  });
  const finalCounts = {
    ...counts,
    users: await prisma.user.count(),
  };
  console.log('Seed complete:', finalCounts);
```

(Replace the existing final `console.log` line.)

- [ ] **Step 2: Manually verify seed idempotency**

```bash
cd web && pnpm prisma:seed
pnpm prisma:seed  # run again
```
Expected: Both runs print `Seed complete: { nodes: 3, versions: 4, raw: 4, users: 6 }` (3 original nodes seed users + 2 test users from earlier sessions + comfyui-manager). Verify in MySQL:

```sql
SELECT username FROM users WHERE username = 'comfyui-manager';
-- expect 1 row
SELECT COUNT(*) FROM users WHERE username = 'comfyui-manager';
-- expect exactly 1
```

- [ ] **Step 3: Create the `ManagerSyncButton` client island**

Create `web/app/(admin)/_components/ManagerSyncButton.tsx`:

```tsx
'use client';
import { useState } from 'react';

type Props = {
  managerSystemUserId: number | null;
};

export function ManagerSyncButton({ managerSystemUserId }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function onClick() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/admin/manager/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ kind: 'success', text: `已加入队列，task_id=${body.task_id ?? '?'}` });
      } else {
        const detail = body?.error?.message ?? res.statusText;
        setMessage({ kind: 'error', text: `同步失败: ${detail}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage({ kind: 'error', text: `网络错误: ${msg}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  }

  const disabled = busy || managerSystemUserId === null;
  const title =
    managerSystemUserId === null
      ? '系统用户未初始化，请运行 pnpm prisma:seed'
      : busy
      ? '正在发送…'
      : '拉取 ComfyUI Manager 目录，作为待审提交写入本地数据库';

  return (
    <div className="mb-6 rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">ComfyUI Manager 目录同步</div>
          <div className="mt-1 text-xs text-gray-500">{title}</div>
        </div>
        <button
          onClick={onClick}
          disabled={disabled}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '同步中…' : '同步 Manager 目录'}
        </button>
      </div>
      {message && (
        <div
          className={
            message.kind === 'success'
              ? 'mt-3 rounded bg-green-50 p-2 text-sm text-green-700'
              : 'mt-3 rounded bg-red-50 p-2 text-sm text-red-700'
          }
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `AdminDashboard` to accept the new prop and render the button**

Modify `web/app/(admin)/_components/AdminDashboard.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { ManagerSyncButton } from './ManagerSyncButton';

type Props = {
  pendingRevisions: number;
  pendingSubmissions: number;
  recent: Array<{ id: number; kind: 'revision' | 'submission'; at: string; summary: string }>;
  managerSystemUserId: number | null;
};

export function AdminDashboard({ pendingRevisions, pendingSubmissions, recent, managerSystemUserId }: Props) {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <ManagerSyncButton managerSystemUserId={managerSystemUserId} />
      <div className="mb-6 grid grid-cols-2 gap-4">
        {/* ... existing Link cards ... */}
      </div>
      {/* ... existing recent activity ... */}
    </div>
  );
}
```

Keep all existing JSX intact; only add the `<ManagerSyncButton>` line below the `<h1>`.

- [ ] **Step 5: Update `web/app/admin/page.tsx` to look up the system user id**

Modify `web/app/admin/page.tsx`. Add a parallel query for the system user id and pass it to `AdminDashboard`:

```tsx
import { prisma } from '@/lib/db';
import { RevisionStatus, SubmissionStatus } from '@prisma/client';
import { AdminDashboard } from '@/app/(admin)/_components/AdminDashboard';

const MANAGER_SYSTEM_USERNAME = 'comfyui-manager';

export default async function AdminDashboardPage() {
  const [pendingRevisions, pendingSubmissions, recentRevisions, recentSubmissions, managerUser] =
    await Promise.all([
      prisma.wikiRevision.count({ where: { status: RevisionStatus.pending } }),
      prisma.nodeSubmission.count({ where: { status: SubmissionStatus.pending } }),
      prisma.wikiRevision.findMany({
        orderBy: { created_at: 'desc' },
        take: 5,
        include: { author: { select: { username: true } } },
      }),
      prisma.nodeSubmission.findMany({
        orderBy: { created_at: 'desc' },
        take: 5,
        include: { submitter: { select: { username: true } } },
      }),
      prisma.user.findUnique({
        where: { username: MANAGER_SYSTEM_USERNAME },
        select: { id: true },
      }),
    ]);

  // ... existing recent activity aggregation unchanged ...

  return (
    <AdminDashboard
      pendingRevisions={pendingRevisions}
      pendingSubmissions={pendingSubmissions}
      recent={recent}
      managerSystemUserId={managerUser ? Number(managerUser.id) : null}
    />
  );
}
```

- [ ] **Step 6: Type-check the web app**

```bash
cd web && pnpm tsc --noEmit
```
Expected: 0 errors. If errors about `AdminDashboard` props appear, check that the `managerSystemUserId` prop is correctly typed in both the page and component.

- [ ] **Step 7: Run the vitest suite to confirm no regressions**

```bash
cd web && pnpm vitest run
```
Expected: all pass.

- [ ] **Step 8: Manual smoke — full end-to-end**

Start the dev stack (in separate terminals):

```bash
# Terminal 1: trigger_api
cd scanner && FLASK_APP=scanner.trigger_api flask run --host=127.0.0.1 --port=8081

# Terminal 2: Celery worker (eager mode for this smoke; real worker uses prefork)
cd scanner && celery -A scanner.celery_app worker --loglevel=info --pool=solo

# Terminal 3: Next.js dev
cd web && pnpm dev
```

In browser:
1. Visit `http://localhost:3000/admin`, log in as admin
2. Verify the "同步 Manager 目录" button is visible (not disabled)
3. Click it → see "已加入队列，task_id=..." message
4. Wait ~10s, refresh `http://localhost:3000/admin/submissions`
5. Verify new pending rows appear, submitter = `comfyui-manager`
6. Click "同步 Manager 目录" again → should add 0 new rows (all now in skipped_pending)

Expected: smoke test passes; UI looks clean; no console errors.

- [ ] **Step 9: Commit**

```bash
cd ..
git add web/prisma/seed.ts web/app/(admin)/_components/AdminDashboard.tsx web/app/(admin)/_components/ManagerSyncButton.tsx web/app/admin/page.tsx
git commit -m "feat(ui): add Manager catalog sync button + seed system user"
```

---

## Out of Scope for This Plan

Per spec §"Out of scope":
- Manager `models-list.json` / `extension-node-map.json`
- Auto-approve for "well-known" Manager entries
- Sync history / audit table
- UI badge/label for Manager-sourced submissions
- Celery beat scheduled sync
- Incremental update of existing nodes' name/description
- Background polling / SSE
- UI automated tests (manual verification per spec)