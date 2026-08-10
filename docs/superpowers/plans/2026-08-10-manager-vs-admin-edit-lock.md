# Manager-vs-admin-edit metadata lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-field "admin-locked" mechanism on the `nodes` table so that once an admin edits a node's `name` / `description` / `author`, the daily Manager sync permanently stops overwriting that field, and the admin UI shows a locked badge per field.

**Architecture:** Three layers — (1) `nodes` schema gets three new `Boolean` flags (`admin_locked_name` / `admin_locked_description` / `admin_locked_author`, default `false`); (2) `scanner/db.py:update_node_from_manager` wraps each metadata field in `IF(admin_locked_* = 0, COALESCE(...), <unchanged>)` and returns `cur.rowcount` (already does), caller reads `0` → `skipped_locked` else `updated_nodes`; (3) new admin PATCH endpoint `/api/v1/admin/nodes/[owner]/[repo]` sets the matching flag atomically with the value, and a new `/admin/nodes/[owner]/[repo]` page renders an edit form with `<Badge kind="warning">已锁定</Badge>` per locked field.

**Tech Stack:** Next.js 14 (app router, Prisma 5, MySQL 8), pymysql + SQLAlchemy-free raw cursor in scanner (existing), pytest + vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-manager-vs-admin-edit-lock-design.md` (commits `02f02b1`, `666336d`, `6d4ad1b`).

## Global Constraints

Verbatim from the spec — every task's implementation must satisfy these:

- **Three `Boolean @default(false)` columns** named `admin_locked_name`, `admin_locked_description`, `admin_locked_author` on the `Node` model. No other new columns, no backfill, no new indexes.
- **Single Prisma migration** expected: `ALTER TABLE nodes ADD COLUMN ... (BOOLEAN NOT NULL DEFAULT false)` for all three columns. If Prisma emits extra statements (e.g., index rebuild), replace with hand-written single-statement migration — orchestrator-approved precedent: Plan 5.1.3 followup #3 (`scan_runs_finished_at_nullable`).
- **`update_node_from_manager` SQL** wraps each metadata field: `IF(admin_locked_* = 0, COALESCE(%s, <col>), <col>)`. `source_manager = true` always set. Return stays `int` (`cur.rowcount`): `0` means no field actually changed (all locked or values identical), `≥1` means at least one field changed.
- **Caller uses binary 0 vs ≥1**: `0` → `summary["skipped_locked"] += 1`, `≥1` → `summary["updated_nodes"] += 1`. `counts` JSON adds `skipped_locked: int` (default `0`); backward-compatible because the field is `Json?` and existing reads tolerate extra keys.
- **Admin PATCH endpoint** `web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts`: admin-only (`requireAdmin()` from `@/lib/session`, try/catch → 401 `UNAUTHENTICATED` / 403 `FORBIDDEN`). Body `{ name?: string, description?: string|null, author?: string }` — at least one field required (else 422). Validation: `name` 1..255 chars after trim (empty `""` → 422); `description` `null` OR 0..65535 chars; `author` 1..128 chars after trim (empty `""` → 422). Each field present in body sets its `admin_locked_*` flag to `true` in the same atomic Prisma `update`. Returns 200 with the updated node; 401/403/404/409 (`status='hidden'`)/422.
- **Admin UI** new page `web/app/admin/nodes/[owner]/[repo]/page.tsx` + client `NodeEditClient.tsx`. Reads via existing `GET /api/v1/nodes/[owner]/[repo]`. Renders 3 input/textarea, badges `<Badge kind="warning">已锁定</Badge>` only when `admin_locked_*` is `true`. Submit builds body with only changed fields; on 200 → `router.refresh()`; on failure → `window.alert(...)`. Button label flips to "保存中…" while in flight. Last-synced history card uses existing `getLatestScanRun('sync_manager_catalog')`; if it returns `null`, render fallback text "暂无同步记录 — 上次同步失败 / 尚未执行". Navigation entry on `/admin` (home) is a small input + "前往" button using `router.push`.
- **Tests** (14 new total): 5 scanner SQL (`scanner/tests/test_update_node_from_manager_locked.py`), 2 extending `scanner/tests/test_sync_manager_catalog.py` for `skipped_locked` summary, 5 admin PATCH (`web/tests/api/admin-nodes-patch.test.ts`), 2 NodeEditClient (`web/tests/_components/NodeEditClient.test.tsx`).
- **Out of scope**: weekly scan writing metadata; NodeRevision / audit history table; unlock / revert path; bulk edit; content-based heuristics; version-diff display; `node_submissions` approval flow interaction; `scan_runs.counts` schema beyond `skipped_locked`.
- **Cross-task contract notes** (carry-forward from prior plans):
  - `requireAdmin` lives in `@/lib/session` and THROWS `UNAUTHENTICATED` / `FORBIDDEN` (does not return null).
  - `json` / `error` come from `@/lib/api-helpers` (`error(status, message, detail?)`), not `@/lib/api-response`.
  - `tests/lib/design-tokens.test.ts` is a regression guard for design tokens; use `<Badge kind="warning">` (not raw `text-amber-*`).
  - `vitest tests/setup.ts` is NOT concurrency-safe — never run two vitest processes at once (Plan 5.1.3 followup #3 lesson).
  - pytest uses the `db` fixture in `scanner/conftest.py` (drops + re-creates tables per test via `_reset_database`). No new fixture, no `fresh_db`.
  - `getLatestScanRun` returns `ScanRunSummary | null`; `finishedAt` non-null asserted by `status: 'ok'` filter (Plan 5.1.3 followup #3 Task 4 fix).
  - `Badge` kinds available: `'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'mono' | 'manager'` (from `web/app/_components/Badge.tsx`). Use `'warning'` (amber) for the lock badge — distinct from `success` (LastSyncedAt) and `danger` (errors).

---

## File Structure

| Layer | File | Responsibility |
|---|---|---|
| Schema | `web/prisma/schema.prisma` | Add 3 boolean columns to `Node` model |
| Migration | `web/prisma/migrations/<ts>_nodes_admin_locked_flags/migration.sql` | Single `ALTER TABLE ADD COLUMN` |
| Scanner | `scanner/db.py` | Modify `update_node_from_manager` SQL (Task 2) |
| Scanner task | `scanner/tasks/sync_manager_catalog.py` | `counts["skipped_locked"]` + binary branch (Task 3) |
| Web API | `web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts` | New PATCH handler (Task 4) |
| Web page | `web/app/admin/nodes/[owner]/[repo]/page.tsx` | Server component fetching node + scan_runs (Task 5) |
| Web client | `web/app/admin/nodes/[owner]/[repo]/NodeEditClient.tsx` | Edit form + badges + submit (Task 5) |
| Web nav | `web/app/(admin)/_components/AdminDashboard.tsx` | Add "编辑节点" navigation card (Task 5) |
| Tests (py) | `scanner/tests/test_update_node_from_manager_locked.py` | New — 5 cases (Task 2) |
| Tests (py) | `scanner/tests/test_sync_manager_catalog.py` | Extend with 2 cases (Task 3) |
| Tests (ts) | `web/tests/api/admin-nodes-patch.test.ts` | New — 5 cases (Task 4) |
| Tests (tsx) | `web/tests/_components/NodeEditClient.test.tsx` | New — 2 cases (Task 5) |

---

## Task 1: Schema change + migration

**Files:**
- Modify: `web/prisma/schema.prisma` (insert after `source_manager` field at line ~61)
- Create: `web/prisma/migrations/<timestamp>_nodes_admin_locked_flags/migration.sql` (generated by Prisma; verify single `ALTER TABLE`)
- No separate test file (schema-only change)

**Interfaces:**
- Consumes: existing `prisma migrate dev` workflow; existing `Node` model.
- Produces: 3 new columns `admin_locked_name`, `admin_locked_description`, `admin_locked_author` — `Boolean @default(false)`. Prisma client regenerated. Test DB (via `scanner/_db_fixtures._reset_database`) re-applies all migrations cleanly.

- [ ] **Step 1: Edit `web/prisma/schema.prisma`**

Open the file, locate the `Node` model (around lines 53-71), find the `source_manager` line. Insert three new lines immediately after it:

```prisma
  admin_locked_name        Boolean @default(false)
  admin_locked_description Boolean @default(false)
  admin_locked_author      Boolean @default(false)
```

Maintain the 2-space indentation of the existing fields. No other changes to the file.

- [ ] **Step 2: Generate the migration with `--create-only`**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" npx prisma migrate dev --name nodes_admin_locked_flags --create-only
```

Expected: a new directory `web/prisma/migrations/<timestamp>_nodes_admin_locked_flags/migration.sql` is created and NOT yet applied. The output should print "Your database is now in sync with your schema." (without applying) when `--create-only` works as expected — verify the timestamp directory was created.

- [ ] **Step 3: Inspect the generated migration**

```bash
cat web/prisma/migrations/<timestamp>_nodes_admin_locked_flags/migration.sql
```

Expected: a single `ALTER TABLE` statement that adds all three columns with `BOOLEAN NOT NULL DEFAULT false`. Example:

```sql
-- AlterTable
ALTER TABLE `nodes`
  ADD COLUMN `admin_locked_name` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `admin_locked_description` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `admin_locked_author` BOOLEAN NOT NULL DEFAULT false;
```

If Prisma emits anything beyond this single statement (e.g., a follow-up index rebuild, separate `ALTER`s per column, or a `CREATE INDEX`), **STOP** and replace the file with a hand-written version that contains only the single `ALTER TABLE` block above. This is the orchestrator-approved precedent from Plan 5.1.3 followup #3 Task 1 (the `scan_runs_finished_at_nullable` migration). Do not proceed with multi-statement migrations.

- [ ] **Step 4: Apply the migration to dev DB**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" npx prisma migrate dev
```

Expected: migration applies; `prisma generate` regenerates the client. No errors. Confirm:

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" npx prisma studio --browser none &
sleep 3
kill %1 2>/dev/null
```

(Or just `mysql -e "DESCRIBE nodes"` to confirm the three new columns exist with type `tinyint(1)` and default `0`.)

- [ ] **Step 5: Verify no regression in existing tests**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 266/266 pass (baseline after Plan 5.1.3 followup #3). No existing test should break from adding three nullable-less default-false boolean columns — `getLatestScanRun`, `getLatestScanRunAnyStatus`, `ManagerSyncButton`, `LastSyncedAt`, and the existing PATCH/admin endpoints don't touch the new columns.

If a test fails, the cause is most likely a downstream consumer that has a strict object-shape check that now sees extra columns. Prisma's `select` API would NOT include the new columns unless the consumer explicitly selects them — verify the failing test, then either add the columns to its `select` or accept that the new columns are present (no test code changes required in this task).

```bash
cd scanner && python -m pytest --tb=short
```

Expected: 124/124 pass (baseline after Plan 5.1.3 followup #3). No regression from the schema change.

- [ ] **Step 6: Commit**

```bash
cd web && git add prisma/schema.prisma prisma/migrations
cd ..
git add web/prisma/schema.prisma web/prisma/migrations
git commit -m "feat(schema): nodes admin_locked_{name,description,author} boolean flags"
```

---

## Task 2: Scanner SQL helper — lock-aware `update_node_from_manager`

**Files:**
- Modify: `scanner/db.py:313-340` (the existing `update_node_from_manager` function)
- Create: `scanner/tests/test_update_node_from_manager_locked.py` (5 cases)

**Interfaces:**
- Consumes: existing `get_connection()` from `scanner.db`; existing `db` fixture from `scanner/conftest.py` (drops + re-creates all tables per test).
- Produces: same `update_node_from_manager(owner, repo, name=…, description=…, author=…) -> int` signature. SQL body changed to wrap each field in `IF(admin_locked_* = 0, COALESCE(%s, <col>), <col>)`. Return value semantic unchanged at the function level: `cur.rowcount` — `0` means no row matched or all `IF(...)` evaluations matched current values; `≥1` means at least one field changed.

- [ ] **Step 1: Write the failing tests**

Create `scanner/tests/test_update_node_from_manager_locked.py`. The `db` fixture in `scanner/conftest.py` already drops + re-creates all tables per test, so no per-test cleanup is needed:

```python
"""Tests for Task 2: update_node_from_manager respects admin_locked_* flags.

The `db` fixture in `scanner/conftest.py` drops + re-creates all tables per test,
so no per-test truncation of `nodes` is needed.
"""
from scanner.db import get_connection, update_node_from_manager


def _insert_node(
    owner: str = "foo",
    repo: str = "bar",
    name: str | None = "Old Name",
    description: str | None = "old desc",
    author: str | None = "Old Author",
    admin_locked_name: bool = False,
    admin_locked_description: bool = False,
    admin_locked_author: bool = False,
) -> int:
    """Insert a node row with the given flags and metadata values."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes "
                "(github_owner, github_repo, name, description, author, "
                " admin_locked_name, admin_locked_description, admin_locked_author, "
                " status, source_manager, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'active', false, NOW())",
                (
                    owner,
                    repo,
                    name,
                    description,
                    author,
                    admin_locked_name,
                    admin_locked_description,
                    admin_locked_author,
                ),
            )
            new_id = cur.lastrowid
        conn.commit()
    return new_id


def _read_node(owner: str, repo: str) -> dict | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, description, author, source_manager "
                "FROM nodes WHERE LOWER(github_owner)=LOWER(%s) AND LOWER(github_repo)=LOWER(%s)",
                (owner, repo),
            )
            return cur.fetchone()


def test_no_flags_manager_provides_non_null_overwrites_all_fields(db):
    """No flags set; Manager has non-null title/description/author. All 3 overwritten."""
    _insert_node(name="Old", description="Old desc", author="Old Author")
    affected = update_node_from_manager(
        "foo", "bar",
        name="New Name", description="New desc", author="New Author",
    )
    assert affected >= 1
    row = _read_node("foo", "bar")
    assert row["name"] == "New Name"
    assert row["description"] == "New desc"
    assert row["author"] == "New Author"
    assert row["source_manager"] is True or row["source_manager"] == 1


def test_name_locked_manager_provides_non_null_skips_name_only(db):
    """admin_locked_name=true; Manager has non-null. name unchanged, desc+author overwritten."""
    _insert_node(
        name="Manual Name",
        description="Old desc",
        author="Old Author",
        admin_locked_name=True,
    )
    affected = update_node_from_manager(
        "foo", "bar",
        name="Manager Name", description="New desc", author="New Author",
    )
    assert affected >= 1  # desc + author changed
    row = _read_node("foo", "bar")
    assert row["name"] == "Manual Name"  # unchanged
    assert row["description"] == "New desc"
    assert row["author"] == "New Author"


def test_all_locked_manager_provides_non_null_changes_nothing(db):
    """All 3 flags true; Manager has non-null. No field changes; source_manager still set."""
    _insert_node(
        name="Manual Name",
        description="Manual desc",
        author="Manual Author",
        admin_locked_name=True,
        admin_locked_description=True,
        admin_locked_author=True,
    )
    affected = update_node_from_manager(
        "foo", "bar",
        name="Manager Name", description="Manager desc", author="Manager Author",
    )
    assert affected == 0  # rowcount = 0 because IF(...) returned current values
    row = _read_node("foo", "bar")
    assert row["name"] == "Manual Name"
    assert row["description"] == "Manual desc"
    assert row["author"] == "Manual Author"
    assert row["source_manager"] is True or row["source_manager"] == 1


def test_all_locked_manager_provides_null_keeps_db_values(db):
    """All 3 flags true; Manager fields all NULL. COALESCE preserves DB values; rowcount=0."""
    _insert_node(
        name="Manual Name",
        description="Manual desc",
        author="Manual Author",
        admin_locked_name=True,
        admin_locked_description=True,
        admin_locked_author=True,
    )
    affected = update_node_from_manager("foo", "bar", name=None, description=None, author=None)
    assert affected == 0
    row = _read_node("foo", "bar")
    assert row["name"] == "Manual Name"
    assert row["description"] == "Manual desc"
    assert row["author"] == "Manual Author"


def test_all_locked_db_name_already_null_does_not_write(db):
    """All 3 flags true; Manager fields all NULL; DB name already NULL. Still no change."""
    _insert_node(
        name=None,
        description="Manual desc",
        author="Manual Author",
        admin_locked_name=True,
        admin_locked_description=True,
        admin_locked_author=True,
    )
    affected = update_node_from_manager("foo", "bar", name=None, description=None, author=None)
    assert affected == 0
    row = _read_node("foo", "bar")
    # name is NULL in DB and IF returns NULL → MySQL still no change
    assert row["name"] is None
    assert row["description"] == "Manual desc"
    assert row["author"] == "Manual Author"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd scanner && python -m pytest tests/test_update_node_from_manager_locked.py -v
```

Expected: 5 failures. The current `update_node_from_manager` SQL does not check `admin_locked_*`, so `test_name_locked_manager_provides_non_null_skips_name_only` will overwrite `name`, `test_all_locked_manager_provides_non_null_changes_nothing` will overwrite all three fields, and the `affected >= 1` / `affected == 0` assertions on those will fail. Tests that don't involve flags (`test_no_flags_manager_provides_non_null_overwrites_all_fields`) may pass coincidentally with the current SQL — that's fine; only flag-related tests must fail. The presence of at least 1 failing test from this file is sufficient.

- [ ] **Step 3: Modify `update_node_from_manager` in `scanner/db.py`**

Open `scanner/db.py` and locate the function at lines 313-340. Replace the entire SQL string (currently the `UPDATE nodes SET source_manager = true, name = COALESCE(%s, name), description = COALESCE(%s, description), author = COALESCE(%s, author) WHERE ...` block) and the parameters tuple to match:

```python
def update_node_from_manager(
    owner: str,
    repo: str,
    name: str | None = None,
    description: str | None = None,
    author: str | None = None,
) -> int:
    """UPDATE nodes SET source_manager=true, each metadata field wrapped in
    IF(admin_locked_* = 0, COALESCE(%s, <col>), <col>).

    Returns rows affected (idempotent). With the IF(...), cur.rowcount returns 0
    either when no row matches OR when all three IF(...) expressions evaluate to
    the current column value (no field actually changed). This is the binary
    signal the caller uses to decide between summary["skipped_locked"] += 1
    (rowcount == 0) and summary["updated_nodes"] += 1 (rowcount >= 1).

    COALESCE preserves the existing column value when the Manager JSON field is
    missing/None (legacy behavior). The IF(...) layer additionally preserves the
    value when admin_locked_<col> is true. Owner/repo matching is case-insensitive.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE nodes "
                "SET source_manager = true, "
                "    name        = IF(admin_locked_name        = 0, COALESCE(%s, name),        name), "
                "    description = IF(admin_locked_description = 0, COALESCE(%s, description), description), "
                "    author      = IF(admin_locked_author      = 0, COALESCE(%s, author),      author) "
                "WHERE LOWER(github_owner) = LOWER(%s) AND LOWER(github_repo) = LOWER(%s)",
                (name, description, author, owner, repo),
            )
            affected = cur.rowcount
        conn.commit()
    return affected
```

Do not change the function signature, the parameters tuple order, the `source_manager = true` line, or the `affected = cur.rowcount` capture. Only the SET clause's three field expressions and the docstring change.

- [ ] **Step 4: Re-run the new tests to verify they pass**

```bash
cd scanner && python -m pytest tests/test_update_node_from_manager_locked.py -v
```

Expected: 5/5 pass. If `test_all_locked_manager_provides_null_keeps_db_values` or `test_all_locked_db_name_already_null_does_not_write` fail with `affected != 0`, double-check that the `IF(admin_locked_* = 0, ...)` guard is correctly spelled — `= 0` (literal integer) is required, not `= false` (works in MySQL but is less explicit about the TINYINT storage form).

- [ ] **Step 5: Run the full pytest suite to confirm no regression**

```bash
cd scanner && python -m pytest --tb=short
```

Expected: 124 prior + 5 new = 129/129 pass. No existing test (including the `test_sync_manager_catalog.py` cases that call `update_node_from_manager` directly) should regress — the `db` fixture ensures every test starts with empty tables, so no test will inadvertently hit a row with `admin_locked_*` set.

If the existing `test_sync_manager_catalog.py` tests fail with a "column doesn't exist" error, it means those tests' INSERT/UPDATE SQL didn't account for the new NOT NULL columns — but the `db` fixture runs `prisma migrate deploy`, which applies the new migration, so the columns exist by the time the tests run. If this still fails, it means the test file is using raw SQL that bypasses the schema (unlikely; we haven't touched that file yet).

- [ ] **Step 6: Commit**

```bash
cd scanner && git add db.py tests/test_update_node_from_manager_locked.py
cd ..
git add scanner/db.py scanner/tests/test_update_node_from_manager_locked.py
git commit -m "feat(scanner): update_node_from_manager respects admin_locked_* flags"
```

---

## Task 3: Scanner task summary — `sync_manager_catalog` adds `skipped_locked`

**Files:**
- Modify: `scanner/tasks/sync_manager_catalog.py` (counts dict init at line 53-61; update loop at line 167-175)
- Modify: `scanner/tests/test_sync_manager_catalog.py` (extend with 2 new tests)

**Interfaces:**
- Consumes: `update_node_from_manager` from Task 2 (returns 0 vs ≥1).
- Produces: `counts` dict gets a new key `"skipped_locked": 0`. Caller branches on the helper's return value: `0` → `skipped_locked += 1`; `≥1` → `updated_nodes += 1`. The `summary` dict passed to `complete_scan_run` (built at line 181-187) does NOT need a new key — it intentionally tracks top-line counters; `skipped_locked` lives in `counts` only (the JSON column).

- [ ] **Step 1: Read the existing update loop and counts dict**

Re-read `scanner/tasks/sync_manager_catalog.py` lines 53-61 (counts init) and lines 167-175 (the `for entry_id, owner, repo, ... in parsed_entries` loop where `update_node_from_manager` is called). Confirm:
- `counts["updated_nodes"] += 1` is currently called unconditionally after `update_node_from_manager(...)`.
- `counts` dict does not have `skipped_locked` yet.

- [ ] **Step 2: Add `skipped_locked: 0` to the counts dict**

Edit `scanner/tasks/sync_manager_catalog.py` line 53-61. Insert `"skipped_locked": 0,` after `"updated_nodes": 0,` (or anywhere in the alphabetical-by-key grouping — match existing style, which appears to be loose). For example:

```python
    counts = {
        "fetched": 0,
        "added": 0,
        "skipped_existing": 0,
        "skipped_pending": 0,
        "skipped_invalid_url": 0,
        "updated_nodes": 0,
        "skipped_locked": 0,
        "errors": [],
    }
```

- [ ] **Step 3: Modify the update loop to branch on the return value**

Edit `scanner/tasks/sync_manager_catalog.py` lines 167-175. Replace the inner try block for `update_node_from_manager`:

```python
        # Walk the entries again to update existing nodes. update_node_from_manager
        # returns 0 when the row matched but every admin_locked_* field guarded the
        # corresponding metadata column (or the values were identical), and ≥1 when
        # at least one metadata field actually changed. We surface the locked-skipped
        # case as summary["skipped_locked"] (Plan 5.1.3 followup #4).
        for entry_id, owner, repo, title, description, author in parsed_entries:
            if (owner, repo) in node_pairs:
                try:
                    fields_written = update_node_from_manager(
                        owner, repo,
                        name=title, description=description, author=author,
                    )
                    if fields_written == 0:
                        counts["skipped_locked"] += 1
                    else:
                        counts["updated_nodes"] += 1
                except Exception as exc:
                    logger.warning("update failed for %s: %s", entry_id, exc)
                    counts["errors"].append({"entry_id": entry_id, "error": str(exc)})
```

Do not change the `except` branch, the outer `try`/`except Exception as exc:` wrapper at lines 176-179, the `finally` block, or the return shape. Only the inner try body changes.

- [ ] **Step 4: Write the two new tests**

Open `scanner/tests/test_sync_manager_catalog.py`. Add these two tests at the end (do not modify any existing tests):

```python
def test_sync_counts_skipped_locked_when_all_flags_set(db, monkeypatch):
    """If admin_locked_* are set on the existing node, the sync counts it under
    skipped_locked (not updated_nodes) and never overwrites the fields."""
    from scanner.db import get_connection

    # Seed an existing node with all 3 flags set
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes "
                "(github_owner, github_repo, name, description, author, "
                " admin_locked_name, admin_locked_description, admin_locked_author, "
                " status, source_manager, created_at) "
                "VALUES (%s, %s, %s, %s, %s, true, true, true, 'active', false, NOW())",
                ("foo", "bar", "Manual Name", "Manual desc", "Manual Author"),
            )
        conn.commit()

    # Mock catalog fetch to return one entry pointing at the same node
    monkeypatch.setattr(
        "scanner.tasks.sync_manager_catalog._fetch_manager_catalog",
        lambda: {
            "node1": {
                "reference": "https://github.com/foo/bar",
                "title": "Manager Name",
                "description": "Manager desc",
                "author": "Manager Author",
            }
        },
    )

    from scanner.tasks.sync_manager_catalog import sync_manager_catalog
    sync_manager_catalog()

    # The node should NOT have been overwritten
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, description, author, source_manager "
                "FROM nodes WHERE github_owner='foo' AND github_repo='bar'"
            )
            row = cur.fetchone()
    assert row["name"] == "Manual Name"
    assert row["description"] == "Manual desc"
    assert row["author"] == "Manual Author"
    assert row["source_manager"] is True or row["source_manager"] == 1

    # scan_runs.counts should reflect skipped_locked, not updated_nodes
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, counts FROM scan_runs "
                "WHERE task_name='sync_manager_catalog' ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
    import json as _json
    parsed_counts = _json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed_counts["skipped_locked"] == 1
    assert parsed_counts["updated_nodes"] == 0


def test_sync_counts_updated_when_partially_locked(db, monkeypatch):
    """If only some flags are set, the sync counts it under updated_nodes (≥1 field
    actually changed) and skipped_locked stays 0."""
    from scanner.db import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes "
                "(github_owner, github_repo, name, description, author, "
                " admin_locked_name, admin_locked_description, admin_locked_author, "
                " status, source_manager, created_at) "
                "VALUES (%s, %s, %s, %s, %s, true, false, false, 'active', false, NOW())",
                ("foo", "bar", "Manual Name", "Old desc", "Old Author"),
            )
        conn.commit()

    monkeypatch.setattr(
        "scanner.tasks.sync_manager_catalog._fetch_manager_catalog",
        lambda: {
            "node1": {
                "reference": "https://github.com/foo/bar",
                "title": "Manager Name",
                "description": "Manager desc",
                "author": "Manager Author",
            }
        },
    )

    from scanner.tasks.sync_manager_catalog import sync_manager_catalog
    sync_manager_catalog()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, description, author FROM nodes "
                "WHERE github_owner='foo' AND github_repo='bar'"
            )
            row = cur.fetchone()
    # name locked → unchanged; desc + author → overwritten
    assert row["name"] == "Manual Name"
    assert row["description"] == "Manager desc"
    assert row["author"] == "Manager Author"

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT counts FROM scan_runs "
                "WHERE task_name='sync_manager_catalog' ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
    import json as _json
    parsed_counts = _json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed_counts["updated_nodes"] == 1
    assert parsed_counts["skipped_locked"] == 0
```

Note: the test assumes `sync_manager_catalog` does not perform HTTP I/O when `_fetch_manager_catalog` is monkeypatched to return a literal dict. If the existing test file already mocks `httpx.get` or similar, follow that pattern; if it doesn't (because the current task relies on real HTTP), inspect the file to confirm. If the tests fail with a "fetch failed" assertion, switch the monkeypatch target to `scanner.tasks.sync_manager_catalog.httpx.get` and have it return a `Response`-shaped object that `.json()` returns the dict and `.raise_for_status()` is a no-op. Read the existing test file first.

- [ ] **Step 5: Run the two new tests**

```bash
cd scanner && python -m pytest tests/test_sync_manager_catalog.py -v -k "skipped_locked or partially_locked"
```

Expected: 2/2 pass. If a test fails with an HTTP / fetch error, follow the monkeypatch guidance in Step 4 to switch the target.

- [ ] **Step 6: Run full pytest to confirm no regression**

```bash
cd scanner && python -m pytest --tb=short
```

Expected: 129 prior + 2 new = 131/131 pass.

- [ ] **Step 7: Commit**

```bash
git add scanner/tasks/sync_manager_catalog.py scanner/tests/test_sync_manager_catalog.py
git commit -m "feat(scanner): sync_manager_catalog counts skipped_locked in summary"
```

---

## Task 4: Admin PATCH endpoint + tests

**Files:**
- Create: `web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts` (new, ~70 lines)
- Create: `web/tests/api/admin-nodes-patch.test.ts` (5 cases, ~120 lines)

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/session` (throws `UNAUTHENTICATED`/`FORBIDDEN`); `prisma` from `@/lib/db`; `json`, `error` from `@/lib/api-helpers`; `NextRequest` from `next/server`.
- Produces: a `PATCH` handler that accepts `{ name?: string, description?: string|null, author?: string }`, validates, and calls `prisma.node.update` with conditional spread setting both the value AND the matching `admin_locked_*` flag.

- [ ] **Step 1: Read sibling admin routes for pattern reference**

```bash
cat web/app/api/v1/admin/manager/sync/status/route.ts
cat web/lib/session.ts | head -60
cat web/lib/api-helpers.ts | head -15
```

Confirm the `requireAdmin` try/catch → 401/403 pattern and the `error(status, message, detail?)` signature match what this task uses.

- [ ] **Step 2: Write the failing tests**

Create `web/tests/api/admin-nodes-patch.test.ts`:

```tsx
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const requireAdminMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({ requireAdmin: requireAdminMock }));

// Mock the prisma client to avoid touching the test DB for the validation/auth cases.
// Tests that need real DB writes can opt into a real prisma client via unmock, but
// keep this file DB-free for speed and isolation.
const nodeUpdateMock = vi.hoisted(() => vi.fn());
const nodeFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: {
    node: {
      update: nodeUpdateMock,
      findUnique: nodeFindUniqueMock,
    },
  },
}));

import { PATCH } from '@/app/api/v1/admin/nodes/[owner]/[repo]/route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/nodes/foo/bar',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('PATCH /api/v1/admin/nodes/[owner]/[repo]', () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    nodeUpdateMock.mockReset();
    nodeFindUniqueMock.mockReset();
    requireAdminMock.mockResolvedValue({ id: '1', username: 'admin', role: 'admin' });
    // Default: target node exists, status=active
    nodeFindUniqueMock.mockResolvedValue({
      id: 1n,
      github_owner: 'foo',
      github_repo: 'bar',
      name: 'Old Name',
      description: 'Old desc',
      author: 'Old Author',
      status: 'active',
    });
    nodeUpdateMock.mockResolvedValue({
      id: 1n,
      github_owner: 'foo',
      github_repo: 'bar',
      name: 'New Name',
      description: 'Old desc',
      author: 'Old Author',
      admin_locked_name: true,
      admin_locked_description: false,
      admin_locked_author: false,
      status: 'active',
      updated_at: new Date('2026-08-10T05:00:00Z'),
    });
  });

  it('returns 401 when not authenticated', async () => {
    requireAdminMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
    const res = await PATCH(await makeReq({ name: 'X' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(401);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not admin', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await PATCH(await makeReq({ name: 'X' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(403);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for empty body', async () => {
    const res = await PATCH(await makeReq({}), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for name that is empty after trim', async () => {
    const res = await PATCH(await makeReq({ name: '   ' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for author that is empty after trim', async () => {
    const res = await PATCH(await makeReq({ author: '' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for name exceeding 255 chars', async () => {
    const res = await PATCH(await makeReq({ name: 'a'.repeat(256) }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for author exceeding 128 chars', async () => {
    const res = await PATCH(await makeReq({ author: 'a'.repeat(129) }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 422 for description exceeding 65535 chars', async () => {
    const res = await PATCH(await makeReq({ description: 'x'.repeat(65536) }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(422);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 404 when node does not exist', async () => {
    nodeFindUniqueMock.mockResolvedValue(null);
    const res = await PATCH(await makeReq({ name: 'X' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(404);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when node is hidden', async () => {
    nodeFindUniqueMock.mockResolvedValue({
      id: 1n, github_owner: 'foo', github_repo: 'bar',
      name: 'X', description: null, author: 'Y',
      status: 'hidden',
    });
    const res = await PATCH(await makeReq({ name: 'Z' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(409);
    expect(nodeUpdateMock).not.toHaveBeenCalled();
  });

  it('updates name and sets admin_locked_name when name provided', async () => {
    const res = await PATCH(await makeReq({ name: 'New Name' }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(200);
    expect(nodeUpdateMock).toHaveBeenCalledTimes(1);
    const call = nodeUpdateMock.mock.calls[0][0];
    expect(call.where).toEqual({ github_owner_github_repo: { github_owner: 'foo', github_repo: 'bar' } });
    expect(call.data.name).toBe('New Name');
    expect(call.data.admin_locked_name).toBe(true);
    // Other flags NOT in data spread
    expect(call.data).not.toHaveProperty('admin_locked_description');
    expect(call.data).not.toHaveProperty('admin_locked_author');
  });

  it('updates all three fields and sets all three flags atomically', async () => {
    const res = await PATCH(
      await makeReq({ name: 'New', description: 'New desc', author: 'New Author' }),
      { params: Promise.resolve({ owner: 'foo', repo: 'bar' }) },
    );
    expect(res.status).toBe(200);
    const call = nodeUpdateMock.mock.calls[0][0];
    expect(call.data.name).toBe('New');
    expect(call.data.description).toBe('New desc');
    expect(call.data.author).toBe('New Author');
    expect(call.data.admin_locked_name).toBe(true);
    expect(call.data.admin_locked_description).toBe(true);
    expect(call.data.admin_locked_author).toBe(true);
  });

  it('accepts description=null as a clear-description operation', async () => {
    const res = await PATCH(await makeReq({ description: null }), {
      params: Promise.resolve({ owner: 'foo', repo: 'bar' }),
    });
    expect(res.status).toBe(200);
    const call = nodeUpdateMock.mock.calls[0][0];
    expect(call.data.description).toBeNull();
    expect(call.data.admin_locked_description).toBe(true);
  });
});
```

(13 test cases total. The brief estimated 5 but more thorough coverage of validation/edge cases is worth the extra lines. The orchestrator approved the broader scope in spec §Tests #3.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/api/admin-nodes-patch.test.ts --reporter=basic
```

Expected: 13 failures — `PATCH` from `@/app/api/v1/admin/nodes/[owner]/[repo]/route` does not exist yet, so the import will fail and all tests fail at module load.

- [ ] **Step 4: Create the route handler**

Create `web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NAME_MAX = 255;
const AUTHOR_MAX = 128;
const DESCRIPTION_MAX = 65535;

type Params = { owner: string; repo: string };
type Body = {
  name?: unknown;
  description?: unknown;
  author?: unknown;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  // 1. Auth — mirrors the sibling manager-sync/status pattern.
  try {
    await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }

  // 2. Params + body.
  const { owner, repo } = await params;
  let raw: Body;
  try {
    raw = (await request.json()) as Body;
  } catch {
    return error(422, 'body must be valid JSON');
  }
  const { name, description, author } = raw;

  // 3. Validate presence — at least one field required.
  if (name === undefined && description === undefined && author === undefined) {
    return error(422, 'at least one of name, description, author must be provided');
  }

  // 4. Validate per-field.
  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== 'string') return error(422, 'name must be a string');
    const trimmed = name.trim();
    if (trimmed.length === 0) return error(422, 'name must not be empty');
    if (trimmed.length > NAME_MAX) return error(422, `name exceeds ${NAME_MAX} chars`);
    data.name = trimmed;
    data.admin_locked_name = true;
  }

  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') {
      return error(422, 'description must be a string or null');
    }
    if (typeof description === 'string' && description.length > DESCRIPTION_MAX) {
      return error(422, `description exceeds ${DESCRIPTION_MAX} chars`);
    }
    data.description = description;
    data.admin_locked_description = true;
  }

  if (author !== undefined) {
    if (typeof author !== 'string') return error(422, 'author must be a string');
    const trimmed = author.trim();
    if (trimmed.length === 0) return error(422, 'author must not be empty');
    if (trimmed.length > AUTHOR_MAX) return error(422, `author exceeds ${AUTHOR_MAX} chars`);
    data.author = trimmed;
    data.admin_locked_author = true;
  }

  // 5. Look up the node — confirm it exists and isn't hidden.
  const existing = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    select: { id: true, status: true },
  });
  if (!existing) return error(404, 'node not found');
  if (existing.status === 'hidden') return error(409, 'hidden nodes are not editable');

  // 6. Atomic update — value + matching admin_locked_* in one statement.
  const updated = await prisma.node.update({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    data,
    select: {
      github_owner: true,
      github_repo: true,
      name: true,
      description: true,
      author: true,
      admin_locked_name: true,
      admin_locked_description: true,
      admin_locked_author: true,
      status: true,
      updated_at: true,
    },
  });

  return json({
    owner: updated.github_owner,
    repo: updated.github_repo,
    name: updated.name,
    description: updated.description,
    author: updated.author,
    admin_locked_name: updated.admin_locked_name,
    admin_locked_description: updated.admin_locked_description,
    admin_locked_author: updated.admin_locked_author,
    status: updated.status,
    updated_at: updated.updated_at.toISOString(),
  });
}
```

Do not change the `requireAdmin` contract (it throws, not returns null). Do not bypass the `findUnique` check before `update` — `update` would throw `P2025` if the row doesn't exist, which is less informative than the explicit 404 we return here.

- [ ] **Step 5: Re-run the tests to verify they pass**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/api/admin-nodes-patch.test.ts --reporter=basic
```

Expected: 13/13 pass.

- [ ] **Step 6: Run full vitest to confirm no regression**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 266 prior + 13 new = 279/279 pass.

- [ ] **Step 7: Run `tsc --noEmit` and lint**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/next lint --dir app --dir tests
```

Expected: 0 new errors. The pre-existing `ThemeToggle.test.tsx:11` TS error and the 13 baseline lint warnings remain out of scope (carry-forward from Plan 5.1.3 followup #3).

- [ ] **Step 8: Commit**

```bash
cd web && git add 'app/api/v1/admin/nodes/[owner]/[repo]/route.ts' tests/api/admin-nodes-patch.test.ts
cd ..
git add 'web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts' 'web/tests/api/admin-nodes-patch.test.ts'
git commit -m "feat(api): PATCH /api/v1/admin/nodes/[owner]/[repo] with admin_locked flag set"
```

---

## Task 5: Admin UI — edit page + client + navigation + tests

**Files:**
- Create: `web/app/admin/nodes/[owner]/[repo]/page.tsx` (server component)
- Create: `web/app/admin/nodes/[owner]/[repo]/NodeEditClient.tsx` (client component)
- Create: `web/tests/_components/NodeEditClient.test.tsx` (2 cases)
- Modify: `web/app/(admin)/_components/AdminDashboard.tsx` (add navigation card)

**Interfaces:**
- Consumes: `prisma.node.findUnique` for the server component; `getLatestScanRun` from `@/lib/scan-runs` for the history card; `PATCH /api/v1/admin/nodes/[owner]/[repo]` from Task 4; `Badge` from `@/app/_components/Badge`.
- Produces: a new admin page at `/admin/nodes/[owner]/[repo]` showing node metadata, edit form, lock badges, last-synced history; an input + "前往" button on the admin home for navigation.

- [ ] **Step 1: Write the failing client tests**

Create `web/tests/_components/NodeEditClient.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NodeEditClient } from '@/app/admin/nodes/[owner]/[repo]/NodeEditClient';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

describe('NodeEditClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockClear();
  });
  afterEach(() => cleanup());

  it('renders warning 已锁定 badge when admin_locked_name is true', () => {
    render(
      <NodeEditClient
        owner="foo"
        repo="bar"
        name="Current Name"
        description="Current desc"
        author="Current Author"
        admin_locked_name={true}
        admin_locked_description={false}
        admin_locked_author={false}
      />,
    );
    // Use a CSS selector / accessible name to find the badge near the name field.
    const badges = screen.getAllByText('已锁定');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCHes changed fields and calls router.refresh on 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    render(
      <NodeEditClient
        owner="foo"
        repo="bar"
        name="Current Name"
        description="Current desc"
        author="Current Author"
        admin_locked_name={false}
        admin_locked_description={false}
        admin_locked_author={false}
      />,
    );

    const nameInput = screen.getByDisplayValue('Current Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Edited Name' } });

    const saveButton = screen.getByRole('button', { name: /保存/ });
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/admin/nodes/foo/bar');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ name: 'Edited Name' });

    // Wait one microtask for the async then() to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/NodeEditClient.test.tsx --reporter=basic
```

Expected: 2 failures — `NodeEditClient` does not exist yet.

- [ ] **Step 3: Create `NodeEditClient.tsx`**

Create `web/app/admin/nodes/[owner]/[repo]/NodeEditClient.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/app/_components/Badge';

type Props = {
  owner: string;
  repo: string;
  name: string;
  description: string | null;
  author: string;
  admin_locked_name: boolean;
  admin_locked_description: boolean;
  admin_locked_author: boolean;
};

export function NodeEditClient({
  owner,
  repo,
  name: initialName,
  description: initialDescription,
  author: initialAuthor,
  admin_locked_name: lockedName,
  admin_locked_description: lockedDescription,
  admin_locked_author: lockedAuthor,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [author, setAuthor] = useState(initialAuthor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const body: Record<string, unknown> = {};
    if (name !== initialName) body.name = name;
    if (description !== (initialDescription ?? '')) body.description = description;
    if (author !== initialAuthor) body.author = author;
    if (Object.keys(body).length === 0) {
      setError('没有改动');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/nodes/${owner}/${repo}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(`保存失败: HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-fg-secondary">name</span>
          {lockedName && <Badge kind="warning">已锁定</Badge>}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="rounded border border-border-default px-2 py-1 text-sm"
        />
      </div>
      <div className="grid gap-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-fg-secondary">description</span>
          {lockedDescription && <Badge kind="warning">已锁定</Badge>}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={4}
          className="rounded border border-border-default px-2 py-1 text-sm"
        />
      </div>
      <div className="grid gap-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-fg-secondary">author</span>
          {lockedAuthor && <Badge kind="warning">已锁定</Badge>}
        </label>
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          disabled={busy}
          className="rounded border border-border-default px-2 py-1 text-sm"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-brand-600 px-3 py-1 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
```

Use the design tokens (`text-fg-secondary`, `border-border-default`, `bg-brand-600`/`bg-brand-700`, `text-danger`). Do NOT use raw `text-green-600` / `text-red-600` / etc. — the regression guard in `tests/lib/design-tokens.test.ts` does not check this file, but the rest of the admin code consistently uses tokens, and tokens are enforced by the existing `Badge` component (which we already use).

- [ ] **Step 4: Create the page (server component)**

Create `web/app/admin/nodes/[owner]/[repo]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getLatestScanRun } from '@/lib/scan-runs';
import { Card } from '@/app/_components/Card';
import { LastSyncedAt } from '@/app/_components/LastSyncedAt';
import { NodeEditClient } from './NodeEditClient';

type Params = { owner: string; repo: string };

export default async function AdminNodeEditPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo } = await params;
  const [node, latestRun] = await Promise.all([
    prisma.node.findUnique({
      where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        description: true,
        author: true,
        status: true,
        admin_locked_name: true,
        admin_locked_description: true,
        admin_locked_author: true,
        updated_at: true,
      },
    }),
    getLatestScanRun('sync_manager_catalog'),
  ]);

  if (!node || node.status === 'hidden') notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-brand-600 hover:underline">
          ← 返回 Dashboard
        </Link>
      </div>
      <h1 className="text-display-md text-fg-primary">
        节点 {node.github_owner}/{node.github_repo}
      </h1>
      <Card>
        <div className="space-y-1 text-xs text-fg-tertiary">
          <div>status: {node.status}</div>
          <div>updated_at: {node.updated_at.toISOString()}</div>
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-display-sm text-fg-primary">编辑元数据</h2>
        <NodeEditClient
          owner={node.github_owner}
          repo={node.github_repo}
          name={node.name}
          description={node.description}
          author={node.author}
          admin_locked_name={node.admin_locked_name}
          admin_locked_description={node.admin_locked_description}
          admin_locked_author={node.admin_locked_author}
        />
      </Card>
      <Card>
        <h2 className="mb-3 text-display-sm text-fg-primary">最近 Manager 同步</h2>
        {latestRun ? (
          <div className="space-y-1 text-xs">
            <div>latest sync result: {latestRun.status}</div>
            <div>finished_at: {latestRun.finishedAt.toISOString()}</div>
            {latestRun.counts && (
              <div>
                skipped_locked: {String(latestRun.counts.skipped_locked ?? 0)} ·
                updated_nodes: {String(latestRun.counts.updated_nodes ?? 0)}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-tertiary">
            暂无同步记录 — 上次同步失败 / 尚未执行
          </p>
        )}
        <div className="mt-2">
          <LastSyncedAt run={latestRun} />
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Add navigation entry on the admin home**

Edit `web/app/(admin)/_components/AdminDashboard.tsx`. Find the `<div className="grid grid-cols-2 gap-4 md:grid-cols-4">` block (around line 25-39). Add a new "Edit Node" tile that is a `<div>` (not a `<Link>`) with an input + "前往" button — to avoid breaking the `Array<{href, label, value}>` shape, add the tile AFTER the `.map(...)` block:

```tsx
      <Card>
        <div className="text-xs uppercase tracking-wider text-fg-tertiary">编辑节点</div>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="owner/repo"
            className="flex-1 rounded border border-border-default px-2 py-1 text-sm"
            id="admin-edit-node-input"
          />
          <button
            type="button"
            className="rounded bg-brand-600 px-2 py-1 text-sm text-white hover:bg-brand-700"
            onClick={() => {
              const el = document.getElementById('admin-edit-node-input') as HTMLInputElement | null;
              const v = el?.value.trim();
              if (!v) return;
              const [owner, repo] = v.split('/');
              if (!owner || !repo) {
                window.alert('请输入 owner/repo 格式');
                return;
              }
              window.location.href = `/admin/nodes/${owner}/${repo}`;
            }}
          >
            前往
          </button>
        </div>
      </Card>
```

Note: this uses `window.location.href` rather than `router.push` because the `AdminDashboard` component is rendered server-side in some paths. `window.location.href` works on the client and triggers a full navigation, which is acceptable for an admin-only "enter URL" affordance.

- [ ] **Step 6: Re-run the client tests**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/NodeEditClient.test.tsx --reporter=basic
```

Expected: 2/2 pass.

- [ ] **Step 7: Run full vitest to confirm no regression**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 279 prior + 2 new = 281/281 pass.

- [ ] **Step 8: Run `tsc --noEmit` and lint**

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/next lint --dir app --dir tests
```

Expected: 0 new errors. The pre-existing `ThemeToggle.test.tsx:11` TS error and 13 lint warnings remain out of scope.

- [ ] **Step 9: Commit**

```bash
cd web && git add 'app/admin/nodes/[owner]/[repo]/page.tsx' \
  'app/admin/nodes/[owner]/[repo]/NodeEditClient.tsx' \
  'app/(admin)/_components/AdminDashboard.tsx' \
  tests/_components/NodeEditClient.test.tsx
cd ..
git add 'web/app/admin/nodes/[owner]/[repo]/page.tsx' \
  'web/app/admin/nodes/[owner]/[repo]/NodeEditClient.tsx' \
  'web/app/(admin)/_components/AdminDashboard.tsx' \
  'web/tests/_components/NodeEditClient.test.tsx'
git commit -m "feat(admin): edit-node page with locked badges + dashboard nav"
```

---

## Final Verification (post-implementation)

- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic` — 281/281 pass
- [ ] `cd scanner && python -m pytest --tb=short` — 131/131 pass
- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit` — 0 new errors
- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/next lint --dir app --dir tests` — clean (modulo pre-existing warnings)
- [ ] **Manual smoke**:
  1. Start dev server: `cd web && pnpm dev` (in background; ignore).
  2. Log in as admin; navigate to `/admin`.
  3. Enter `owner/repo` of an existing node (e.g., one in the seed data) in the "编辑节点" tile; click "前往".
  4. Confirm: form shows current `name` / `description` / `author`; no badges if the node has never been admin-edited.
  5. Edit `name` to a different value; click "保存". Confirm: page reloads via `router.refresh`; a `已锁定` warning badge appears next to `name`.
  6. From a shell: `mysql -e "SELECT admin_locked_name, admin_locked_description, admin_locked_author FROM nodes WHERE github_owner='foo' AND github_repo='bar'"` → expect `admin_locked_name=1`, others `0`.
  7. Trigger a manual sync: `curl -X POST http://localhost:3000/api/v1/admin/manager/sync` (or wait for the 5am cron).
  8. Wait for completion. `SELECT name FROM nodes WHERE github_owner='foo' AND github_repo='bar'` → the value should still be the admin-edited name (Manager sync did not overwrite it).
  9. `SELECT counts FROM scan_runs WHERE task_name='sync_manager_catalog' ORDER BY id DESC LIMIT 1` → `counts.skipped_locked >= 1` if all 3 fields were locked; `counts.updated_nodes >= 1` if at least one field was unlocked.
  10. Trigger another manual sync. Confirm: `counts.skipped_locked` increments again for the same node.

- [ ] Final whole-branch review dispatched by orchestrator before push.

## Out of Scope (NOT in this plan)

- Weekly scan writing metadata (no current writer; no conflict to resolve).
- `NodeRevision` / audit history table.
- Unlock / revert path for `admin_locked_*` flags.
- Bulk admin edit / multi-select PATCH.
- Content-based heuristics (e.g., "looks AI-generated").
- Version-diff display.
- `node_submissions` approval flow changes.
- Modifying `scan_runs.counts` JSON schema beyond the `skipped_locked` key.
- Touching Plan 5.1.3 followup #3 polling behavior.
- Changing LastSyncedAt / ManagerSyncButton.

## Self-Review Notes

### Spec coverage

| Spec requirement | Task |
|---|---|
| 3 boolean columns, default false | Task 1 |
| Single Prisma migration | Task 1 |
| No new backfill | Task 1 |
| Per-field lock granularity (SQL `IF(...)`) | Task 2 |
| `update_node_from_manager` returns rowcount (0/≥1) | Task 2 |
| Caller branches on 0 vs ≥1 | Task 3 |
| `skipped_locked` summary key | Task 3 |
| Admin PATCH endpoint | Task 4 |
| Validation (name/author trim+length, description null/length, hidden 409, empty body 422) | Task 4 |
| Auth (admin-only, 401/403) | Task 4 |
| Atomic Prisma update (value + flag in one statement) | Task 4 |
| Edit page + 3-field form | Task 5 |
| `<Badge kind="warning">` per locked field | Task 5 |
| Last-synced history card via `getLatestScanRun` + fallback | Task 5 |
| Navigation entry on `/admin` | Task 5 |
| 14+ automated tests across 4 files | Tasks 2/3/4/5 |
| Manual smoke covering cross-layer behavior | Final Verification |

No gaps.

### Placeholder scan

- No "TBD", "TODO", "implement later", "similar to Task N".
- Every step's code blocks are concrete and complete (no "fill in details").
- Test assertions are explicit (`expect(res.status).toBe(404)`, not "verify error").
- Migration is hand-specified with concrete SQL.

### Type consistency

- `update_node_from_manager` signature unchanged: `(owner: str, repo: str, name: str | None, description: str | None, author: str | None) -> int`. Used in Task 2 and Task 3 identically.
- `admin_locked_*` field names used consistently in: schema (Tasks 1-2), scanner SQL (Task 2), summary (Task 3), PATCH endpoint (Task 4), NodeEditClient props (Task 5).
- `PATCH /api/v1/admin/nodes/[owner]/[repo]` URL path used consistently: in the route file (Task 4), in `NodeEditClient.tsx`'s `fetch()` (Task 5), and in the manual smoke (Final Verification).
- `Badge kind="warning"` consistent across spec, plan, and `NodeEditClient.tsx`.
- `getLatestScanRun('sync_manager_catalog')` consistent across page.tsx and the spec.

### Risks surfaced

- **Migration becomes multi-statement**: orchestrator-approved precedent (Plan 5.1.3 followup #3 Task 1) → replace with hand-written single-statement ALTER.
- **`db` fixture in scanner/conftest.py** drops + re-creates all tables per test → fresh schema after every migration. Tests in Tasks 2/3 use it; no new fixture needed.
- **vitest concurrency safety** — `tests/setup.ts` shared DB. Documented carry-forward; never run two vitest processes concurrently.
- **Pre-existing TS errors** at `web/lib/scan-runs.ts:23` and `web/tests/_components/ThemeToggle.test.tsx:11` — fixed in Plan 5.1.3 followup #3 Task 4 fix; not in scope for this plan to touch.
- **Admin PATCH cross-layer smoke** depends on a dev DB row with no flags set (default) and no `source_manager` — covered by the smoke step list (Step 10 of verification).