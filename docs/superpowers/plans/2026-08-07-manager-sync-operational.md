# Manager sync operational — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote ComfyUI Manager catalog sync from manual-only to operational: daily Celery beat schedule, name/description/author backfill into pending submissions AND existing nodes (COALESCE-preserved), and a "Manager" UI badge in both admin review and public node card.

**Architecture:** Extend the existing `scanner.tasks.sync_manager_catalog` to write `title`/`description` from Manager JSON into new pending submissions, and to `UPDATE nodes SET source_manager=true, name=COALESCE(...), description=COALESCE(...), author=COALESCE(...)` on existing nodes. Add one `beat_schedule` entry in `scanner/celery_app.py` (daily 05:00 UTC). Add one Boolean column `nodes.source_manager` via Prisma migration. Update `web/lib/submissions.ts::approveSubmission` to set `source_manager=true` on the newly-created node row when the submission's submitter is `comfyui-manager`. Add a `manager` kind to existing `Badge` component. Admin review row gets a "Manager" badge derived from `submitter.username === 'comfyui-manager'`; public `NodeCard` gets a "via Manager" badge driven by `nodes.source_manager`. Manual admin button and existing trigger_api endpoint unchanged — beat runs alongside manual.

**Tech Stack:**
- Python 3.11+ / Celery 5 / Redis (existing scanner infra)
- `httpx`, `pymysql`, `urllib.parse` (existing)
- Prisma 5 / MySQL 8 (existing)
- Next.js 15 / React 19 (existing)
- Vitest 2 + jsdom 30 (existing test infra)
- pytest + pytest-httpx (existing test infra)
- No new dependencies

## Global Constraints

Verbatim binding requirements — every task's requirements implicitly include this section:

- **Beat schedule:** `sync-manager-catalog-daily` runs `scanner.tasks.sync_manager_catalog` at `crontab(hour=5, minute=0)` (05:00 UTC daily). Avoids the existing 03:00 weekly-scan and 04:00 prune slots.
- **Manual button preserved:** `POST /api/v1/admin/manager/sync` and the trigger_api endpoint remain. Admin can still trigger ad-hoc syncs. Beat does NOT disable the button.
- **Beat and manual share the same task.** No "scheduled_only" task variant. Same dedup, same error handling, same stage=fetch/parse/dedup/system_user reporting.
- **Sync task behavior change for new entries:** `INSERT INTO node_submissions` with `name = entry.title`, `description = entry.description` (both nullable). `github_url`, `submitter_id`, `status` unchanged.
- **Sync task behavior change for skipped_existing entries:** call `update_node_from_manager(owner, repo, name=None, description=None, author=None)` which performs `UPDATE nodes SET source_manager=true, name=COALESCE(%s, name), description=COALESCE(%s, description), author=COALESCE(%s, author) WHERE LOWER(github_owner) = %s AND LOWER(github_repo) = %s`. Idempotent. COALESCE means Manager JSON missing fields don't wipe existing DB values.
- **skipped_pending entries:** nothing changes. The pending submission row already exists with the system user; re-flagging source_manager would be redundant since the eventual approval will set it.
- **`nodes.source_manager` column:** `Boolean @default(false)`. New Prisma migration `20260807_add_node_source_manager`. Migration is metadata-only (add column with default). Existing rows backfill to false. Subsequent syncs flip matching rows to true.
- **Approve path:** when admin approves a pending submission with `submitter.username = 'comfyui-manager'`, the create-node path in `approveSubmission` must also set `source_manager = true` AND propagate `name`/`description` from the submission row to the newly-created node row. Same Prisma transaction as the node INSERT.
- **Admin UI badge:** `SubmissionsClient` shows a "Manager" badge next to `submitterUsername` when `submitterSource === 'manager'`. Server-side determines the flag from `submitter.username === 'comfyui-manager'` — the client never reads system-user magic strings.
- **Public UI badge:** `NodeCard` shows a "via Manager" badge after the `name` (next to `CardTitle`) when `sourceManager === true`. Server-side prop; client-side conditional render. Badge uses muted neutral styling (`kind="manager"`).
- **No JSON shape expansion.** Sync still only consumes `reference` (for dedup), `title`/`description` (for INSERT columns + UPDATE columns), and `author` (for UPDATE columns). `stars`, `last_update`, `files`, `install_option` remain ignored (YAGNI per original spec §Global Constraints).
- **No new dependencies.** `httpx`, `pymysql`, `urllib.parse`, Prisma client, Next.js, React — all already in the project.
- **No UI tests required** for the badge text/style beyond what this plan specifies (3 NodeCard cases + 2 SubmissionsClient cases + 1 Badge manager-kind case).
- **No background polling / SSE** for the admin button — unchanged from original spec.
- **No sync history / audit table** — unchanged from original spec.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `web/prisma/schema.prisma` | Modify (+1 field) | Add `source_manager Boolean @default(false)` on `Node` model |
| `web/prisma/migrations/20260807_add_node_source_manager/migration.sql` | Create | `ALTER TABLE nodes ADD COLUMN source_manager BOOLEAN NOT NULL DEFAULT false` |
| `scanner/db.py` | Modify (signature + new helper) | `insert_pending_submission(..., name=None, description=None)` gains optional kwargs; new `update_node_from_manager(owner, repo, name=None, description=None, author=None) -> int` |
| `scanner/tasks/sync_manager_catalog.py` | Modify (extend loop body) | Pass `name=title, description=description` on INSERT; call `update_node_from_manager(owner, repo, title, description, author)` on `skipped_existing`; add `updated_nodes` counter to return dict |
| `scanner/celery_app.py` | Modify (+1 beat_schedule entry) | Register `sync-manager-catalog-daily` at 05:00 UTC |
| `web/lib/submissions.ts` | Modify (`approveSubmission`) | Read submission's `submitter.username`; when creating node row, set `source_manager=true` and propagate `name`/`description` from submission if non-null |
| `web/app/_components/Badge.tsx` | Modify (+1 kind) | Add `'manager'` kind with neutral muted styling (e.g., `bg-slate-50 text-slate-600`) |
| `web/app/admin/submissions/page.tsx` | Modify | Pass `submitterSource: 'manager' \| 'user'` per row to `SubmissionsClient` based on `submitter.username === 'comfyui-manager'` |
| `web/app/admin/submissions/SubmissionsClient.tsx` | Modify (+1 column, +1 conditional render) | Add "来源" column showing `<Badge kind="manager">Manager</Badge>` for manager-sourced rows |
| `web/app/(public)/_components/NodeCard.tsx` | Modify (+1 prop, +1 conditional render) | Add `sourceManager: boolean` prop; render `<Badge kind="manager">via Manager</Badge>` after `CardTitle` when true |
| `web/app/(public)/nodes/page.tsx` | Modify | Add `source_manager: true` to Prisma select; pass `sourceManager={n.source_manager}` to `NodeCard` |
| `scanner/tests/test_sync_manager_catalog.py` | Modify (+7 test cases) | Per spec §Testing Layer 1 |
| `scanner/tests/test_db.py` (or new `test_db_helpers.py`) | Modify (+3 test cases for new helpers) | `insert_pending_submission` with name/description; `update_node_from_manager` happy path + COALESCE |
| `web/tests/_components/Badge.test.tsx` | Modify (+1 test case) | `manager` kind uses correct classes |
| `web/tests/_components/NodeCard.test.tsx` (new file) | Create (+3 test cases) | badge rendering per spec §Testing Layer 3 |
| `web/tests/api/admin-submissions-pending.test.ts` (existing) | Modify (data shape update) | Existing tests now receive `submitterSource` field; add 1 new test for Manager-sourced row |
| `web/tests/api/admin-submissions-approve.test.ts` (existing) | Modify (+2 test cases) | Approve Manager-sourced → `nodes.source_manager=true`; propagate name/description |

---

## Task Decomposition

7 reviewable tasks. Each ends with an independently testable deliverable.

---

### Task 1: Add `nodes.source_manager` column + Prisma migration

**Files:**
- Modify: `web/prisma/schema.prisma:53-70` (Node model)
- Create: `web/prisma/migrations/20260807_add_node_source_manager/migration.sql`

**Interfaces:**
- Consumes: existing `Node` model
- Produces: `Node.source_manager: boolean @default(false)` available to Prisma client; existing rows backfill to `false`

- [ ] **Step 1: Add `source_manager` field to schema**

In `web/prisma/schema.prisma`, on the `Node` model (currently line 53-70), insert a new line after line 60 (`status NodeStatus @default(active)`):

```prisma
model Node {
  id             BigInt     @id @default(autoincrement())
  github_owner   String     @db.VarChar(128)
  github_repo    String     @db.VarChar(128)
  name           String     @db.VarChar(255)
  author         String     @db.VarChar(128)
  description    String?    @db.Text
  status         NodeStatus @default(active)
+ source_manager Boolean    @default(false)
  created_at     DateTime   @default(now())
  updated_at     DateTime   @updatedAt
  ...
}
```

- [ ] **Step 2: Generate Prisma migration**

Run from `web/`:
```bash
cd web && npx prisma migrate dev --name add_node_source_manager
```

Expected: `prisma/migrations/20260807_add_node_source_manager/migration.sql` created with content matching:
```sql
-- AlterTable
ALTER TABLE `nodes` ADD COLUMN `source_manager` BOOLEAN NOT NULL DEFAULT false;
```

If Prisma generates additional statements (e.g., recreating indexes), **stop and ask** — the expected migration is exactly one ALTER TABLE. If hand-editing is needed to remove unwanted statements, do so before committing.

- [ ] **Step 3: Apply migration to dev DB and verify**

```bash
cd web && npx prisma migrate status
```

Expected output: `"Database schema is up to date!"`

- [ ] **Step 4: Verify Prisma client exposes the new field**

```bash
cd web && node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.\$disconnect().then(() => console.log('source_manager' in p.node.fields ? 'OK' : 'MISSING'));"
```

Expected: `OK`

- [ ] **Step 5: Run existing test suites to confirm no regression**

```bash
cd web && pnpm test
```

Expected: all existing vitest cases pass (167 baseline).

- [ ] **Step 6: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/20260807_add_node_source_manager/migration.sql
git commit -m "feat(schema): add nodes.source_manager boolean column (Plan 5.1.3)"
```

---

### Task 2: Extend `scanner/db.py` — `insert_pending_submission` signature + new `update_node_from_manager` helper

**Files:**
- Modify: `scanner/db.py` (find `insert_pending_submission` and append `update_node_from_manager`)
- Modify: `scanner/tests/test_db.py` (or create `scanner/tests/test_db_helpers.py` if test_db.py doesn't cover these)

**Interfaces:**
- Consumes: existing `get_connection()` context manager
- Produces:
  - `insert_pending_submission(submitter_id: int, github_url: str, name: str | None = None, description: str | None = None) -> int`
  - `update_node_from_manager(owner: str, repo: str, name: str | None = None, description: str | None = None, author: str | None = None) -> int`

- [ ] **Step 1: Read existing `insert_pending_submission` to understand its current shape**

```bash
grep -n -A20 "^def insert_pending_submission" scanner/db.py
```

Note its current signature, SQL, and return value (inserted id). Keep the existing `name`/`description` columns nullable per schema.

- [ ] **Step 2: Write failing tests**

In `scanner/tests/test_db.py` (or new `scanner/tests/test_db_helpers.py`), add:

```python
import pytest
from scanner.db import insert_pending_submission, update_node_from_manager, get_connection


@pytest.fixture
def fresh_db():
    """Reset test DB tables; relies on existing conftest.py fixtures."""
    pass  # conftest handles it


def test_insert_pending_submission_with_name_and_description(fresh_db):
    """New signature accepts optional name/description kwargs."""
    submitter_id = 1
    url = "https://github.com/foo/bar"
    new_id = insert_pending_submission(submitter_id, url, name="Foo Title", description="Foo description")
    assert isinstance(new_id, int) and new_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["name"] == "Foo Title"
    assert row["description"] == "Foo description"


def test_insert_pending_submission_without_name_description(fresh_db):
    """When name/description omitted, columns are NULL (existing default behavior)."""
    submitter_id = 1
    url = "https://github.com/baz/qux"
    new_id = insert_pending_submission(submitter_id, url)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["name"] is None
    assert row["description"] is None


def test_update_node_from_manager_sets_source_manager_and_fields(fresh_db):
    """Helper sets source_manager=true and overrides name/description/author."""
    # Pre-seed a node
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES (%s, %s, %s, %s, %s, false)",
                ("foo", "bar", "OldName", "OldAuthor", "OldDesc"),
            )
            conn.commit()
    # Run the helper
    affected = update_node_from_manager("foo", "bar", name="NewName", description="NewDesc", author="NewAuthor")
    assert affected == 1
    # Verify post-state
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='foo' AND github_repo='bar'")
            row = cur.fetchone()
    assert row["name"] == "NewName"
    assert row["author"] == "NewAuthor"
    assert row["description"] == "NewDesc"
    assert row["source_manager"] is True


def test_update_node_from_manager_coalesce_preserves_existing(fresh_db):
    """When Manager kwargs are None, COALESCE preserves existing DB values."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES (%s, %s, %s, %s, %s, false)",
                ("x", "y", "ExistingName", "ExistingAuthor", "ExistingDesc"),
            )
            conn.commit()
    affected = update_node_from_manager("x", "y")  # all kwargs None
    assert affected == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='x' AND github_repo='y'")
            row = cur.fetchone()
    assert row["name"] == "ExistingName"
    assert row["author"] == "ExistingAuthor"
    assert row["description"] == "ExistingDesc"
    assert row["source_manager"] is True  # still flipped even when fields None


def test_update_node_from_manager_case_insensitive_match(fresh_db):
    """Owner/repo matching uses LOWER() on both sides."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES (%s, %s, %s, %s, %s, false)",
                ("Foo", "Bar", "n", "a", "d"),
            )
            conn.commit()
    affected = update_node_from_manager("FOO", "BAR", name="Updated")
    assert affected == 1
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd scanner && pytest tests/test_db.py -v -k "test_insert_pending_submission_with or test_insert_pending_submission_without or test_update_node_from_manager"
```

Expected: 5 failures (TypeError on missing `name`/`description` kwargs for `insert_pending_submission`; `NameError` or `ImportError` on `update_node_from_manager`).

- [ ] **Step 4: Update `insert_pending_submission` signature in `scanner/db.py`**

Modify the existing function signature and SQL to accept optional `name`/`description` and include them in the INSERT. Example diff (adjust to actual existing code):

```python
def insert_pending_submission(
    submitter_id: int,
    github_url: str,
    name: str | None = None,
    description: str | None = None,
) -> int:
    """INSERT one row into node_submissions (status='pending'). Returns new id.
    Raises pymysql.IntegrityError on duplicate (shouldn't happen given dedup)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO node_submissions (submitter_id, github_url, name, description, status) "
                "VALUES (%s, %s, %s, %s, 'pending')",
                (submitter_id, github_url, name, description),
            )
            new_id = cur.lastrowid
        conn.commit()
    return new_id
```

- [ ] **Step 5: Append `update_node_from_manager` to `scanner/db.py`**

```python
def update_node_from_manager(
    owner: str,
    repo: str,
    name: str | None = None,
    description: str | None = None,
    author: str | None = None,
) -> int:
    """UPDATE nodes SET source_manager=true, name=COALESCE(...), description=COALESCE(...),
    author=COALESCE(...) WHERE LOWER(github_owner)=%s AND LOWER(github_repo)=%s.
    Returns rows affected. Idempotent. COALESCE preserves existing column values
    when corresponding Manager JSON field is missing/None."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE nodes "
                "SET source_manager = true, "
                "    name = COALESCE(%s, name), "
                "    description = COALESCE(%s, description), "
                "    author = COALESCE(%s, author) "
                "WHERE LOWER(github_owner) = LOWER(%s) AND LOWER(github_repo) = LOWER(%s)",
                (name, description, author, owner, repo),
            )
            affected = cur.rowcount
        conn.commit()
    return affected
```

(Note: explicit `LOWER(col) = LOWER(%s)` is preferred over parameter-side `LOWER(%s)` for index usage — match what other helpers in `db.py` do, e.g., `fetch_existing_owner_repo_pairs` if it uses LOWER().)

- [ ] **Step 6: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_db.py -v -k "test_insert_pending_submission_with or test_insert_pending_submission_without or test_update_node_from_manager"
```

Expected: 5 passes.

- [ ] **Step 7: Run full pytest to confirm no regression**

```bash
cd scanner && pytest
```

Expected: all 64 existing + 5 new = 69/69 pass.

- [ ] **Step 8: Commit**

```bash
git add scanner/db.py scanner/tests/test_db.py
git commit -m "feat(db): insert_pending_submission name/description + update_node_from_manager helper (Plan 5.1.3)"
```

---

### Task 3: Extend `sync_manager_catalog` task — name/description on INSERT, update existing nodes

**Files:**
- Modify: `scanner/tasks/sync_manager_catalog.py` (extend Step 3 retention, Step 6 INSERT, add Step 6 skipped_existing branch)
- Modify: `scanner/tests/test_sync_manager_catalog.py` (+5 test cases per spec §Testing Layer 1; the beat-schedule test is in Task 4)

**Interfaces:**
- Consumes: `insert_pending_submission(submitter_id, url, name=title, description=description)` from Task 2; `update_node_from_manager(owner, repo, title, description, author)` from Task 2
- Produces: same task signature; return dict gains `"updated_nodes": <int>` field; behavior extended as per spec §Data Flow Step 6

- [ ] **Step 1: Read current `sync_manager_catalog.py` body**

```bash
cat scanner/tasks/sync_manager_catalog.py
```

Identify the four Step 6 branches (`new`, `skipped_existing`, `skipped_pending`, `skipped_invalid_url`).

- [ ] **Step 2: Write failing tests**

In `scanner/tests/test_sync_manager_catalog.py`, add:

```python
def test_pending_submission_includes_name_and_description(monkeypatch_httpx, fresh_db):
    """Sync writes entry.title/entry.description into the new pending submission row."""
    fake_json = {
        "node-a": {
            "reference": "https://github.com/aa/bb",
            "title": "Node A Title",
            "description": "Node A description text",
        },
    }
    monkeypatch_httpx(fake_json)
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["added"] == 1
    assert result["updated_nodes"] == 0
    # Verify DB
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE github_url='https://github.com/aa/bb'")
            row = cur.fetchone()
    assert row["name"] == "Node A Title"
    assert row["description"] == "Node A description text"


def test_pending_submission_null_name_description_when_missing(monkeypatch_httpx, fresh_db):
    """Missing title/description in JSON → NULL columns (existing default)."""
    fake_json = {
        "node-b": {"reference": "https://github.com/cc/dd"},
    }
    monkeypatch_httpx(fake_json)
    result = sync_manager_catalog()
    assert result["added"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE github_url='https://github.com/cc/dd'")
            row = cur.fetchone()
    assert row["name"] is None
    assert row["description"] is None


def test_existing_node_updated_from_manager(monkeypatch_httpx, fresh_db):
    """skipped_existing entry → UPDATE source_manager + name/description/author."""
    # Pre-seed a node
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES ('ee', 'ff', 'OldName', 'OldAuthor', 'OldDesc', false)",
            )
            conn.commit()
    fake_json = {
        "node-c": {
            "reference": "https://github.com/ee/ff",
            "title": "NewName",
            "description": "NewDesc",
            "author": "NewAuthor",
        },
    }
    monkeypatch_httpx(fake_json)
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1
    assert result["updated_nodes"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='ee' AND github_repo='ff'")
            row = cur.fetchone()
    assert row["name"] == "NewName"
    assert row["author"] == "NewAuthor"
    assert row["description"] == "NewDesc"
    assert row["source_manager"] is True


def test_existing_node_coalesce_preserves_existing_when_manager_missing(monkeypatch_httpx, fresh_db):
    """Manager entry missing title/description/author → COALESCE keeps existing DB values."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES ('gg', 'hh', 'KeptName', 'KeptAuthor', 'KeptDesc', false)",
            )
            conn.commit()
    fake_json = {
        "node-d": {"reference": "https://github.com/gg/hh"},
        # no title / description / author
    }
    monkeypatch_httpx(fake_json)
    result = sync_manager_catalog()
    assert result["updated_nodes"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='gg' AND github_repo='hh'")
            row = cur.fetchone()
    assert row["name"] == "KeptName"
    assert row["author"] == "KeptAuthor"
    assert row["description"] == "KeptDesc"
    assert row["source_manager"] is True


def test_update_node_failure_appends_to_errors(monkeypatchpatch_httpx, fresh_db, monkeypatch):
    """Mock update_node_from_manager to raise on call #2 → errors list, continue."""
    # Pre-seed two nodes
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description) "
                "VALUES ('ii', 'jj', 'n1', 'a1', 'd1'), ('kk', 'll', 'n2', 'a2', 'd2')",
            )
            conn.commit()
    fake_json = {
        "node-e": {"reference": "https://github.com/ii/jj", "title": "T1", "description": "D1"},
        "node-f": {"reference": "https://github.com/kk/ll", "title": "T2", "description": "D2"},
    }
    monkeypatch_httpx(fake_json)

    call_count = {"n": 0}

    def flaky_update(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated DB blip")
        from scanner.db import update_node_from_manager
        return update_node_from_manager(*args, **kwargs)

    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.update_node_from_manager", flaky_update)

    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert len(result["errors"]) == 1
    assert "simulated DB blip" in result["errors"][0]["error"]
```

(Use the project's existing `monkeypatch_httpx` fixture name; check `scanner/tests/conftest.py` for the exact fixture.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_pending_submission_includes_name or test_pending_submission_null or test_existing_node_updated or test_existing_node_coalesce or test_update_node_failure"
```

Expected: 5 failures (existing sync task doesn't pass title/description, doesn't UPDATE source_manager, doesn't return updated_nodes counter).

- [ ] **Step 4: Extend `sync_manager_catalog.py`**

Three changes:

**Change 4a — Step 3 retention:** when parsing each entry, retain `entry['title']`, `entry['description']`, and `entry['author']` alongside the parsed `(entry_id, owner, repo)`. Switch the local `parsed_entries` tuple shape from `(entry_id, owner, repo)` to `(entry_id, owner, repo, title, description, author)` (with all four new fields defaulting to `None`).

**Change 4b — Step 6 INSERT (new entries):** change the INSERT call to pass the new fields:

```python
for entry_id, owner, repo, title, description, author in new_entries:
    url = f"https://github.com/{owner}/{repo}"
    try:
        insert_pending_submission(submitter_id, url, name=title, description=description)
        counts["added"] += 1
    except Exception as exc:
        logger.warning("insert failed for %s: %s", entry_id, exc)
        counts["errors"].append({"entry_id": entry_id, "error": str(exc)})
```

**Change 4c — Step 6 UPDATE (skipped_existing):** add a new loop over the previously-skipped_existing entries (i.e., the ones counted as `skipped_existing`):

```python
# Walk the entries again to update existing nodes
for entry_id, owner, repo, title, description, author in parsed_entries:
    if (owner, repo) in node_pairs:  # i.e., skipped_existing, not skipped_pending
        try:
            update_node_from_manager(owner, repo, name=title, description=description, author=author)
            counts["updated_nodes"] += 1
        except Exception as exc:
            logger.warning("update failed for %s: %s", entry_id, exc)
            counts["errors"].append({"entry_id": entry_id, "error": str(exc)})
```

**Change 4d — Counts dict:** add `"updated_nodes": 0` to the initial `counts` dict at the top.

- [ ] **Step 5: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_pending_submission_includes_name or test_pending_submission_null or test_existing_node_updated or test_existing_node_coalesce or test_update_node_failure"
```

Expected: 5 passes.

- [ ] **Step 6: Run full pytest to confirm no regression**

```bash
cd scanner && pytest
```

Expected: 64 existing + 5 db_helpers + 5 sync_manager_catalog = 74/74 pass. (Count may vary; exact numbers tracked in final whole-branch review.)

- [ ] **Step 7: Commit**

```bash
git add scanner/tasks/sync_manager_catalog.py scanner/tests/test_sync_manager_catalog.py
git commit -m "feat(sync): name/description backfill + update existing nodes (Plan 5.1.3)"
```

---

### Task 4: Register Celery beat schedule entry `sync-manager-catalog-daily`

**Files:**
- Modify: `scanner/celery_app.py` (add 1 beat_schedule entry)
- Modify: `scanner/tests/test_sync_manager_catalog.py` (+1 test case for beat schedule)

**Interfaces:**
- Consumes: existing `celery_app.conf.beat_schedule`
- Produces: `beat_schedule["sync-manager-catalog-daily"]` entry pointing at `scanner.tasks.sync_manager_catalog` with `crontab(hour=5, minute=0)`

- [ ] **Step 1: Write failing test**

In `scanner/tests/test_sync_manager_catalog.py` (or new `scanner/tests/test_celery_beat.py`), add:

```python
from scanner.celery_app import celery_app


def test_beat_schedule_contains_sync_manager_catalog_daily():
    schedule = celery_app.conf.beat_schedule
    assert "sync-manager-catalog-daily" in schedule, \
        f"missing daily beat entry; existing keys: {list(schedule)}"
    entry = schedule["sync-manager-catalog-daily"]
    assert entry["task"] == "scanner.tasks.sync_manager_catalog"


def test_beat_schedule_daily_at_05_00_utc():
    from datetime import datetime, timezone
    from celery.schedules import crontab
    entry = celery_app.conf.beat_schedule["sync-manager-catalog-daily"]
    sched = entry["schedule"]
    assert isinstance(sched, crontab)
    # crontab._orig_minute / _orig_hour are the raw cron fields
    assert sched.hour == {5}, f"expected hour=5 UTC, got {sched.hour}"
    assert sched.minute == {0}, f"expected minute=0, got {sched.minute}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_beat_schedule"
```

Expected: 2 failures (KeyError on missing "sync-manager-catalog-daily").

- [ ] **Step 3: Add the beat_schedule entry**

In `scanner/celery_app.py`, modify the `beat_schedule` dict to add:

```python
celery_app.conf.beat_schedule = {
    "scan-every-week": {
        "task": "scanner.tasks.fetch_pending_nodes",
        "schedule": crontab(hour=3, minute=0, day_of_week="monday"),
    },
    "prune-expired-resolutions": {
        "task": "scanner.tasks.prune_expired_resolutions",
        "schedule": crontab(hour=4, minute=0),
    },
+   "sync-manager-catalog-daily": {
+       "task": "scanner.tasks.sync_manager_catalog",
+       "schedule": crontab(hour=5, minute=0),
+   },
}
```

(`crontab` is already imported at top of file.)

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_beat_schedule"
```

Expected: 2 passes.

- [ ] **Step 5: Run full pytest to confirm no regression**

```bash
cd scanner && pytest
```

Expected: 76/76 pass (64 baseline + 5 db_helpers + 5 sync + 2 beat).

- [ ] **Step 6: Commit**

```bash
git add scanner/celery_app.py scanner/tests/test_sync_manager_catalog.py
git commit -m "feat(beat): daily 05:00 UTC sync_manager_catalog schedule (Plan 5.1.3)"
```

---

### Task 5: `approveSubmission` flips `source_manager=true` and propagates `name`/`description` from Manager-sourced submissions

**Files:**
- Modify: `web/lib/submissions.ts` (extend `approveSubmission` to read submitter + propagate fields)
- Modify: `web/tests/api/admin-submissions-approve.test.ts` (+2 test cases per spec §Testing Layer 5)

**Interfaces:**
- Consumes: existing `approveSubmission` shape; `submitter.username` field on `node_submissions` rows
- Produces: same function signature; behavior extended so the `tx.node.create` call sets `source_manager=true` and propagates `name`/`description` from the submission row when (a) submitter is `comfyui-manager` (for source_manager) and (b) submission row has non-null `name`/`description`

- [ ] **Step 1: Read current `approveSubmission` to confirm shape**

```bash
cat web/lib/submissions.ts
```

Note the `findUnique` call (currently doesn't include `submitter` relation) and the `tx.node.create` data payload.

- [ ] **Step 2: Write failing tests**

In `web/tests/api/admin-submissions-approve.test.ts`, find an existing test that creates a pending submission via Prisma and approves it. Add two new tests:

```typescript
import { PrismaClient, SubmissionStatus, NodeStatus } from '@prisma/client';

const prisma = new PrismaClient();

describe('approveSubmission - Manager source', () => {
  beforeEach(async () => {
    // Clean tables (use the project's existing test setup pattern)
  });

  it('approving a Manager-sourced submission sets source_manager=true on the new node', async () => {
    // Create the comfyui-manager system user
    const manager = await prisma.user.upsert({
      where: { username: 'comfyui-manager' },
      update: {},
      create: { username: 'comfyui-manager', role: 'user' },
    });

    // Create a pending submission from that user
    const sub = await prisma.nodeSubmission.create({
      data: {
        submitter_id: manager.id,
        github_url: 'https://github.com/mgrtest/repo1',
        name: 'Mgr Title',
        description: 'Mgr description',
        status: SubmissionStatus.pending,
      },
    });

    // Create an admin user (use existing fixture)
    const admin = await prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: { username: 'admin', role: 'admin' },
    });

    // Call approveSubmission directly
    const result = await approveSubmission({
      submissionId: Number(sub.id),
      reviewerId: admin.id,
    });
    expect(result.ok).toBe(true);

    // Verify the new node row
    const node = await prisma.node.findUnique({
      where: { github_owner_github_repo: { github_owner: 'mgrtest', github_repo: 'repo1' } },
    });
    expect(node).not.toBeNull();
    expect(node!.source_manager).toBe(true);
    expect(node!.name).toBe('Mgr Title');
    expect(node!.description).toBe('Mgr description');
  });

  it('approving a user-sourced submission does NOT set source_manager', async () => {
    const regular = await prisma.user.upsert({
      where: { username: 'regular-user-test' },
      update: {},
      create: { username: 'regular-user-test', role: 'user' },
    });
    const sub = await prisma.nodeSubmission.create({
      data: {
        submitter_id: regular.id,
        github_url: 'https://github.com/usertest/repo2',
        status: SubmissionStatus.pending,
      },
    });
    const admin = await prisma.user.upsert({
      where: { username: 'admin' },
      update: {},
      create: { username: 'admin', role: 'admin' },
    });
    const result = await approveSubmission({
      submissionId: Number(sub.id),
      reviewerId: admin.id,
    });
    expect(result.ok).toBe(true);
    const node = await prisma.node.findUnique({
      where: { github_owner_github_repo: { github_owner: 'usertest', github_repo: 'repo2' } },
    });
    expect(node!.source_manager).toBe(false);
  });
});
```

(Adjust fixture names to match the project's existing test setup — check `web/tests/fixtures.ts` and existing `admin-submissions-approve.test.ts`.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd web && pnpm test tests/api/admin-submissions-approve.test.ts
```

Expected: 2 failures (existing `approveSubmission` doesn't include submitter in findUnique; `tx.node.create` doesn't pass `source_manager` or propagated name/description).

- [ ] **Step 4: Extend `findUnique` in `approveSubmission` to include submitter**

In `web/lib/submissions.ts`, modify the `findUnique` call inside the transaction (around line 15):

```typescript
const sub = await tx.nodeSubmission.findUnique({
  where: { id: BigInt(input.submissionId) },
  include: { submitter: { select: { username: true } } },
});
```

- [ ] **Step 5: Modify `tx.node.create` to set `source_manager` and propagate fields**

Replace the existing `tx.node.create` block (around lines 27-37) with:

```typescript
const isManagerSourced = sub.submitter?.username === 'comfyui-manager';
const created = await tx.node.create({
  data: {
    github_owner: parsed.owner,
    github_repo: parsed.repo,
    name: sub.name ?? parsed.repo,
    author: sub.submitter?.username ?? '',
    description: sub.description ?? '',
    status: NodeStatus.active,
    source_manager: isManagerSourced,
  },
});
```

Note: `sub.submitter?.username` is the literal `comfyui-manager` string at creation time when the row was submitted by that user; using it as the author is a reasonable default (matches what existing data has).

- [ ] **Step 6: Re-run tests to verify they pass**

```bash
cd web && pnpm test tests/api/admin-submissions-approve.test.ts
```

Expected: 2 new tests pass; existing tests in this file still pass.

- [ ] **Step 7: Run full vitest to confirm no regression**

```bash
cd web && pnpm test
```

Expected: all existing + 2 new pass.

- [ ] **Step 8: Commit**

```bash
git add web/lib/submissions.ts web/tests/api/admin-submissions-approve.test.ts
git commit -m "feat(approve): source_manager flip + propagate name/description from Manager submissions (Plan 5.1.3)"
```

---

### Task 6: Admin UI badge — `Badge` "manager" kind + `page.tsx` `submitterSource` + `SubmissionsClient` badge render

**Files:**
- Modify: `web/app/_components/Badge.tsx` (+1 kind)
- Modify: `web/tests/_components/Badge.test.tsx` (+1 test case)
- Modify: `web/app/admin/submissions/page.tsx` (pass `submitterSource` per row)
- Modify: `web/app/admin/submissions/SubmissionsClient.tsx` (+1 column + conditional badge render)
- Modify: `web/tests/api/admin-submissions-pending.test.ts` (extend data shape assertion if needed)

**Interfaces:**
- Consumes: existing `Badge` component kinds; existing `page.tsx` server component; existing `SubmissionsClient` props
- Produces:
  - `Badge` gains `'manager'` kind with neutral muted styling
  - `SubmissionsClient`'s `Item` type gains `submitterSource: 'manager' | 'user'`
  - `SubmissionsClient` renders an "来源" cell with `<Badge kind="manager">Manager</Badge>` when `submitterSource === 'manager'`

- [ ] **Step 1: Add `'manager'` kind to `Badge.tsx`**

In `web/app/_components/Badge.tsx`, modify the `Kind` union and `kindClasses` map:

```typescript
type Kind = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'mono' | 'manager';

const kindClasses: Record<Kind, string> = {
  default: 'bg-subtle text-fg-secondary',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-green-50 text-success',
  warning: 'bg-amber-50 text-warning',
  danger: 'bg-red-50 text-danger',
  info: 'bg-cyan-50 text-accent-cyan',
  mono: 'bg-transparent border border-border-default text-fg-secondary font-mono',
+ manager: 'bg-slate-100 text-slate-600',
};
```

(If the project has a different muted color palette token — e.g., `bg-neutral-100 text-neutral-700` — adjust to match. Verify with the existing design tokens before committing.)

- [ ] **Step 2: Write failing Badge test**

In `web/tests/_components/Badge.test.tsx`, add:

```tsx
it('manager uses bg-slate-100', () => {
  const { container } = render(<Badge kind="manager">via Manager</Badge>);
  expect((container.firstChild as HTMLElement).className).toContain('bg-slate-100');
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd web && pnpm test tests/_components/Badge.test.tsx
```

Expected: 1 failure (`kind="manager"` not assignable to current Kind union).

- [ ] **Step 4: Re-run test to verify it passes**

After Step 1's edit, run again:

```bash
cd web && pnpm test tests/_components/Badge.test.tsx
```

Expected: 4 passes (3 existing + 1 new).

- [ ] **Step 5: Update `page.tsx` to pass `submitterSource`**

In `web/app/admin/submissions/page.tsx`, modify the `items` mapping:

```typescript
const items = rows.map((s) => ({
  id: Number(s.id),
  submitterUsername: s.submitter.username,
  submitterSource: (s.submitter.username === 'comfyui-manager' ? 'manager' : 'user') as 'manager' | 'user',
  githubUrl: s.github_url,
  createdAt: s.created_at.toISOString(),
}));
```

- [ ] **Step 6: Update `SubmissionsClient.tsx` to render the badge**

In `web/app/admin/submissions/SubmissionsClient.tsx`:

**Change 6a** — extend the `Item` type:
```typescript
type Item = {
  id: number;
  submitterUsername: string;
  submitterSource: 'manager' | 'user';
  githubUrl: string;
  createdAt: string;
};
```

**Change 6b** — add a new column header in `<thead>` after "提交者":
```tsx
<th className="px-2 py-1">来源</th>
```

**Change 6c** — add a new cell after the submitter cell:
```tsx
<td className="px-2 py-1">
  {it.submitterSource === 'manager' ? (
    <Badge kind="manager">Manager</Badge>
  ) : (
    <span className="text-xs text-gray-400">—</span>
  )}
</td>
```

Add `import { Badge } from '@/app/_components/Badge';` at the top.

- [ ] **Step 7: Run vitest to verify no regression**

```bash
cd web && pnpm test
```

Expected: all existing + new Badge test pass.

- [ ] **Step 8: Write SubmissionsClient test (optional but recommended)**

In `web/tests/_components/SubmissionsClient.test.tsx` (new file), add:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SubmissionsClient } from '@/app/admin/submissions/SubmissionsClient';

describe('SubmissionsClient - Manager source badge', () => {
  it('renders Manager badge for manager-sourced row', () => {
    const items = [
      {
        id: 1,
        submitterUsername: 'comfyui-manager',
        submitterSource: 'manager' as const,
        githubUrl: 'https://github.com/a/b',
        createdAt: '2026-08-07T00:00:00Z',
      },
    ];
    const { container } = render(<SubmissionsClient items={items} />);
    expect(container.textContent).toContain('Manager');
    // The "Manager" word appears in both the badge and the system user's username; assert badge presence via class
    expect(container.querySelector('.bg-slate-100')).not.toBeNull();
  });

  it('does NOT render Manager badge for user-sourced row', () => {
    const items = [
      {
        id: 2,
        submitterUsername: 'alice',
        submitterSource: 'user' as const,
        githubUrl: 'https://github.com/c/d',
        createdAt: '2026-08-07T00:00:00Z',
      },
    ];
    const { container } = render(<SubmissionsClient items={items} />);
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });
});
```

- [ ] **Step 9: Run new tests**

```bash
cd web && pnpm test tests/_components/SubmissionsClient.test.tsx
```

Expected: 2 passes.

- [ ] **Step 10: Full vitest**

```bash
cd web && pnpm test
```

Expected: all existing + 1 Badge + 2 SubmissionsClient pass.

- [ ] **Step 11: Commit**

```bash
git add web/app/_components/Badge.tsx web/tests/_components/Badge.test.tsx \
        web/app/admin/submissions/page.tsx web/app/admin/submissions/SubmissionsClient.tsx \
        web/tests/_components/SubmissionsClient.test.tsx
git commit -m "feat(ui): Manager badge in admin submissions list (Plan 5.1.3)"
```

---

### Task 7: Public UI badge — `NodeCard` `sourceManager` prop + `nodes/page.tsx` select

**Files:**
- Modify: `web/app/(public)/_components/NodeCard.tsx` (+1 prop + conditional render)
- Create: `web/tests/_components/NodeCard.test.tsx` (+3 test cases)

**Interfaces:**
- Consumes: existing `NodeCard` props; existing `nodes/page.tsx` Prisma select
- Produces:
  - `NodeCard` gains `sourceManager?: boolean` prop
  - When `sourceManager === true`, renders `<Badge kind="manager">via Manager</Badge>` after `CardTitle`
  - `nodes/page.tsx` Prisma select includes `source_manager: true`; passes to `NodeCard`

- [ ] **Step 1: Write failing tests**

Create `web/tests/_components/NodeCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NodeCard } from '@/app/(public)/_components/NodeCard';

const baseProps = {
  owner: 'foo',
  repo: 'bar',
  name: 'Foo',
  author: 'alice',
  description: 'Test description',
  updatedAt: '2026-08-07T00:00:00Z',
};

describe('NodeCard - sourceManager prop', () => {
  it('renders "via Manager" badge when sourceManager=true', () => {
    const { container } = render(<NodeCard {...baseProps} sourceManager={true} />);
    expect(container.textContent).toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).not.toBeNull();
  });

  it('omits badge when sourceManager=false', () => {
    const { container } = render(<NodeCard {...baseProps} sourceManager={false} />);
    expect(container.textContent).not.toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });

  it('omits badge when sourceManager undefined', () => {
    const { container } = render(<NodeCard {...baseProps} />);
    expect(container.textContent).not.toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/_components/NodeCard.test.tsx
```

Expected: 3 failures (TypeError on `sourceManager` not assignable; "via Manager" not in DOM).

- [ ] **Step 3: Update `NodeCard.tsx`**

In `web/app/(public)/_components/NodeCard.tsx`, modify the `Props` type and JSX:

```tsx
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { Card, CardTitle, CardMeta } from '@/app/_components/Card';
import { Badge } from '@/app/_components/Badge';

type Props = {
  owner: string;
  repo: string;
  name: string;
  author: string;
  description: string | null;
  updatedAt: string | Date;
  sourceManager?: boolean;
};

export function NodeCard({ owner, repo, name, author, description, updatedAt, sourceManager }: Props) {
  return (
    <Link href={`/nodes/${owner}/${repo}`} className="block">
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <CardTitle>{name}</CardTitle>
            {sourceManager && <Badge kind="manager">via Manager</Badge>}
          </div>
          <CardMeta>{formatDate(updatedAt)}</CardMeta>
        </div>
        <div className="mt-1 text-sm text-fg-tertiary">by {author}</div>
        {description && <p className="mt-2 text-sm text-fg-secondary">{description}</p>}
      </Card>
    </Link>
  );
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
cd web && pnpm test tests/_components/NodeCard.test.tsx
```

Expected: 3 passes.

- [ ] **Step 5: Update `nodes/page.tsx` to select + pass `source_manager`**

In `web/app/(public)/nodes/page.tsx`, modify the `findMany` select clause (around line 64):

```typescript
prisma.node.findMany({
  where,
  orderBy,
  skip,
  take: PAGE_SIZE,
  select: {
    github_owner: true,
    github_repo: true,
    name: true,
    author: true,
    description: true,
    updated_at: true,
+   source_manager: true,
  },
}),
```

And the `<NodeCard>` JSX (around line 142):

```tsx
{rows.map((n) => (
  <NodeCard
    key={`${n.github_owner}/${n.github_repo}`}
    owner={n.github_owner}
    repo={n.github_repo}
    name={n.name}
    author={n.author}
    description={n.description}
    updatedAt={n.updated_at}
+   sourceManager={n.source_manager}
  />
))}
```

- [ ] **Step 6: Run full vitest to confirm no regression**

```bash
cd web && pnpm test
```

Expected: all existing + 1 Badge + 2 SubmissionsClient + 3 NodeCard pass.

- [ ] **Step 7: Run `tsc` and `lint` to confirm no type/lint regression**

```bash
cd web && pnpm exec tsc --noEmit && pnpm lint
```

Expected: 0 new errors (pre-existing 13 lint warnings are acceptable per Plan 5.1.2 baseline).

- [ ] **Step 8: Commit**

```bash
git add "web/app/(public)/_components/NodeCard.tsx" "web/app/(public)/nodes/page.tsx" web/tests/_components/NodeCard.test.tsx
git commit -m "feat(ui): via Manager badge in public NodeCard (Plan 5.1.3)"
```

---

## Final Verification (post-Task 7)

- [ ] **Full test suites**

```bash
cd scanner && pytest          # expect ~76/76 pass
cd web && pnpm test           # expect ~172+/172+ pass
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint           # 13 pre-existing warnings acceptable
```

- [ ] **Manual smoke**

- Click admin "同步 Manager 目录" button on `/admin` → verify pending submissions page shows "Manager" badge on new rows
- Approve a Manager-sourced submission → verify public NodeCard on `/nodes` shows "via Manager" badge
- Trigger beat manually: `cd scanner && celery -A scanner.celery_app call scanner.tasks.sync_manager_catalog` → verify counts dict includes `updated_nodes` for existing matched nodes
- Verify dev DB: `npx prisma studio` → confirm `nodes.source_manager` column visible with default false; existing rows unchanged; recently-synced nodes flipped to true

- [ ] **Final whole-branch review** dispatched by orchestrator before push.

---

## Out of Scope (NOT in this plan)

- Manager `models-list.json` / `extension-node-map.json` integration (separate spec when needed)
- Auto-approve well-known Manager entries (policy decision)
- Sync history / audit table (v2)
- Beat schedule frequency configurable via env var (hardcoded 05:00 UTC; env override deferred)
- Background polling or SSE for admin button
- Filtering / searching `/admin/submissions` by source (`user` vs `manager`)
- "Last synced at" indicator on `/admin` next to ManagerSyncButton
- Resolution of Manager-vs-weekly-scan metadata conflict (currently last-writer-wins; no version column)
- Backfill of `nodes.source_manager = true` for nodes already imported from Manager before this spec

---

## Self-Review Notes

### Spec coverage

| Spec section / requirement | Covered by task |
|---|---|
| §Global Constraints — Beat schedule 05:00 UTC | Task 4 |
| §Global Constraints — Manual button preserved | Tasks 3, 4 (no removal) |
| §Global Constraints — Sync new entries: name/description | Task 3 (Step 4b) |
| §Global Constraints — Sync skipped_existing: source_manager + COALESCE fields | Tasks 2, 3 (Step 4c) |
| §Global Constraints — `nodes.source_manager` column | Task 1 |
| §Global Constraints — Approve path sets source_manager | Task 5 |
| §Global Constraints — Admin UI badge | Task 6 |
| §Global Constraints — Public UI badge | Task 7 |
| §Testing Layer 1 — pytest cases | Tasks 2, 3, 4 |
| §Testing Layer 3 — NodeCard badge tests | Task 7 |
| §Testing Layer 4 — SubmissionsClient badge tests | Task 6 |
| §Acceptance Criteria — all 11 items | Tasks 1-7 |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later" markers. All concrete file paths and code.

### Type consistency

- `Badge` `Kind` union uses `'manager'` consistently in Tasks 6 and 7.
- `NodeCard` `sourceManager?: boolean` matches between Task 7 prop definition and `nodes/page.tsx` usage.
- `SubmissionsClient` `submitterSource: 'manager' | 'user'` matches between page.tsx mapping and component prop type.
- `update_node_from_manager(owner, repo, name=None, description=None, author=None)` signature is identical across Tasks 2 and 3 usage.
- `insert_pending_submission(submitter_id, github_url, name=None, description=None)` signature is identical across Tasks 2 and 3 usage.

### Risks surfaced during planning

- **Pre-existing `ThemeToggle.test.tsx` TS error** (from Plan 2 hardening parked minors) — Task 7's `tsc --noEmit` may surface it. Acceptable; same baseline as Plan 5.1.2.
- **Existing 13 lint warnings on origin/main** — Task 7's `pnpm lint` may show them; acceptable per Plan 5.1.2 baseline.
- **COALESCE LOWER() index usage** — Task 2's `update_node_from_manager` uses `LOWER(col) = LOWER(%s)` which is non-sargable. With current `nodes` table size (~hundreds), this is acceptable. If `nodes` grows past ~100k rows, consider a functional index on `LOWER(github_owner), LOWER(github_repo)`. Deferred to followups.
- **Manual button / beat overlap** — both paths call the same task. Per spec invariant 8, concurrent runs are safe (per-row autocommit). No coordination lock added.
- **`web/tests/_components/SubmissionsClient.test.tsx`** does not exist yet — Task 6 creates it. The component is a client component using `useRouter`; the test mock for `next/navigation` may be needed. If `@testing-library/react` + `vi.mock('next/navigation')` proves insufficient, the test can be skipped and the badge covered via Task 5's approve-path tests + manual verification.