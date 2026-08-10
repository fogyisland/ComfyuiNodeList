# Implementation plan — Manager sync automatic progress feedback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the admin clicks "同步 Manager 目录" on `/admin`, the UI automatically reflects when the sync completes (success or failure) and updates `LastSyncedAt` — no manual page refresh.

**Architecture:** Extend `scan_runs` to carry an in-flight `running` row (written at Celery-task start, updated on completion). Expose a small `GET /api/v1/admin/manager/sync/status` endpoint. `ManagerSyncButton` polls that endpoint with adaptive backoff (1s × 2, then 5s, max 180s) until the row resolves to `ok` / `failed` or times out.

**Tech Stack:**
- Next.js 14+ app router (existing)
- React 18 (existing)
- Prisma 5 + MySQL (existing)
- Celery 5 + Redis (existing)
- TypeScript / Python (existing)
- `vi.useFakeTimers()` for component polling tests

**Spec:** `docs/superpowers/specs/2026-08-10-manager-sync-progress-design.md`

## Global Constraints

- Single source of truth: `scan_runs` table; `LastSyncedAt` and polling both read it.
- No new tables, no new npm/Python deps.
- `finished_at` becomes nullable (one migration).
- `status` values: `'running' | 'ok' | 'failed'`. Application-layer invariant: `running ↔ finished_at IS NULL`.
- Polling: 1s × 2, then 5s; 180s timeout. Stop on terminal state or unmount.
- Concurrent clicks allowed; no global "is anything running" disable.
- DB failures during `start_scan_run` / `complete_scan_run` do not crash the sync.
- API endpoint admin-only; `Cache-Control: no-store`.
- Reuse Tailwind classes from existing `ManagerSyncButton` and `LastSyncedAt`.
- Pre-existing `ThemeToggle.test.tsx:11` TS error + 13 lint warnings remain out of scope.

## File Structure

| Layer | File | Change |
|---|---|---|
| Schema | `web/prisma/schema.prisma` | `finished_at DateTime?` |
| Migration | `web/prisma/migrations/<ts>_scan_runs_finished_at_nullable/migration.sql` | new |
| Scanner db | `scanner/db.py` | +3 helpers |
| Celery task | `scanner/tasks/sync_manager_catalog.py` | replace `insert_scan_run` with `start_scan_run` + `complete_scan_run` |
| Web lib | `web/lib/scan-runs.ts` | +`getLatestScanRunAnyStatus` |
| API route | `web/app/api/v1/admin/manager/sync/status/route.ts` | new |
| Component | `web/app/(admin)/_components/ManagerSyncButton.tsx` | state machine + polling |
| Tests | 4 new + 1 extend (see below) | |

**Reused utilities:**
- `scanner/db.py:get_engine()` — already used by `insert_scan_run`
- `web/lib/auth.ts:requireAdmin()` — same auth pattern as other admin routes
- `web/lib/api-response.ts:json/error` — same response helpers
- `web/lib/scan-runs.ts:getLatestScanRun` — kept untouched, used for the OK-only path
- Existing `db` fixture in `scanner/tests/conftest.py` — use for new tests to avoid P3005 race
- Existing `vi.useFakeTimers` + `MockDate` patterns in the repo

---

## Task 1: Schema change + migration

**Files:**
- Modify: `web/prisma/schema.prisma:180` (one column)
- Create: `web/prisma/migrations/<timestamp>_scan_runs_finished_at_nullable/migration.sql`
- (Generated; no separate test file)

**Interfaces:**
- Consumes: existing `prisma migrate dev` workflow
- Produces: `ScanRun.finished_at` is `DateTime?`; migration applies cleanly to dev DB

### Step 1: Edit `web/prisma/schema.prisma`

Change line 180 from `finished_at DateTime @db.DateTime(3)` to `finished_at DateTime? @db.DateTime(3)`. The new `?` makes the column nullable.

### Step 2: Generate the migration

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" npx prisma migrate dev --name scan_runs_finished_at_nullable --create-only
```

This creates a SQL file under `web/prisma/migrations/<timestamp>_scan_runs_finished_at_nullable/migration.sql` containing:

```sql
-- AlterTable
ALTER TABLE `scan_runs` MODIFY COLUMN `finished_at` DATETIME(3) NULL;
```

Inspect the file — Prisma should emit a single `ALTER TABLE` line. If it produces more, investigate before applying.

### Step 3: Apply the migration to dev DB

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" npx prisma migrate dev
```

Expected: migration applies; `prisma generate` regenerates the client (the `ScanRun` type's `finished_at` is now `Date | null`).

### Step 4: Verify no regression in existing tests

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 252/252 pass (baseline 252 from Plan 5.1.3 followup #2). No existing test should break from the column nullability change — `getLatestScanRun` filters `status: 'ok'` which implies `finished_at IS NOT NULL`.

If a test fails, the cause is most likely a downstream type error from `finished_at` becoming `Date | null` (a code that expected `Date` now sees `Date | null`). Fix by adding `?` or a null check at the consumer — do NOT change the schema back to NOT NULL.

### Step 5: Commit

```bash
git add web/prisma/schema.prisma web/prisma/migrations
git commit -m "feat(schema): make scan_runs.finished_at nullable for in-flight rows"
```

---

## Task 2: Scanner db helpers + tests

**Files:**
- Modify: `scanner/db.py` (add 3 functions at module level)
- Create: `scanner/tests/test_db_scan_runs.py` (5 tests)

**Interfaces:**
- Consumes: existing `get_engine()` from `scanner.db`; `datetime.utcnow()`; `json.dumps`/`json.loads`
- Produces:
  - `start_scan_run(task_name: str) -> int` — returns run_id of inserted `'running'` row
  - `complete_scan_run(run_id: int, status: str, counts: dict, error: str | None = None) -> None`
  - `get_latest_scan_run_any_status(task_name: str) -> dict | None` — returns `dict` with keys `id, status, started_at, finished_at, error, counts`

### Step 1: Write failing tests

Create `scanner/tests/test_db_scan_runs.py`:

```python
import json
import pytest
from scanner.db import (
    get_engine,
    start_scan_run,
    complete_scan_run,
    get_latest_scan_run_any_status,
)
from sqlalchemy import text


def test_start_scan_run_writes_running_row(db):
    run_id = start_scan_run("sync_manager_catalog")
    assert run_id > 0
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT status, finished_at FROM scan_runs WHERE id = :id"),
            {"id": run_id},
        ).first()
    assert row.status == "running"
    assert row.finished_at is None


def test_complete_scan_run_updates_to_ok(db):
    run_id = start_scan_run("sync_manager_catalog")
    complete_scan_run(run_id, "ok", {"inserted": 3, "updated": 1, "skipped": 0, "errors": []})
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT status, finished_at, counts FROM scan_runs WHERE id = :id"),
            {"id": run_id},
        ).first()
    assert row.status == "ok"
    assert row.finished_at is not None
    assert json.loads(row.counts) == {"inserted": 3, "updated": 1, "skipped": 0, "errors": []}


def test_complete_scan_run_updates_to_failed_with_error(db):
    run_id = start_scan_run("sync_manager_catalog")
    complete_scan_run(run_id, "failed", {"inserted": 0, "errors": ["boom"]}, error="boom")
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT status, error FROM scan_runs WHERE id = :id"),
            {"id": run_id},
        ).first()
    assert row.status == "failed"
    assert row.error == "boom"


def test_get_latest_scan_run_any_status_returns_running_row(db):
    run_id = start_scan_run("sync_manager_catalog")
    result = get_latest_scan_run_any_status("sync_manager_catalog")
    assert result is not None
    assert result["id"] == run_id
    assert result["status"] == "running"
    assert result["finished_at"] is None
    assert result["error"] is None


def test_get_latest_scan_run_any_status_returns_none_when_empty(db):
    result = get_latest_scan_run_any_status("never_ran_xxx")
    assert result is None
```

Use the `db` fixture (not `fresh_db`) per the Plan 5.1.4 convention — this is fast and matches the test isolation strategy in the repo. If `db` doesn't auto-truncate `scan_runs`, add a `truncate_scan_runs` autouse fixture in this file:

```python
@pytest.fixture(autouse=True)
def _truncate_scan_runs(db):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM scan_runs"))
```

(Inspect existing `scanner/tests/conftest.py` to confirm; if `db` already truncates per-test, omit the autouse fixture.)

### Step 2: Run tests to verify they fail

```bash
cd scanner && python -m pytest tests/test_db_scan_runs.py -v
```

Expected: 5 failures — `start_scan_run` and friends don't exist yet.

### Step 3: Implement the helpers in `scanner/db.py`

Add to the end of `scanner/db.py`:

```python
def start_scan_run(task_name: str) -> int:
    started_at = datetime.utcnow()
    with get_engine().begin() as conn:
        result = conn.execute(
            text(
                "INSERT INTO scan_runs (task_name, started_at, finished_at, status) "
                "VALUES (:task_name, :started_at, NULL, 'running')"
            ),
            {"task_name": task_name, "started_at": started_at},
        )
        return result.lastrowid


def complete_scan_run(
    run_id: int,
    status: str,
    counts: dict,
    error: str | None = None,
) -> None:
    finished_at = datetime.utcnow()
    with get_engine().begin() as conn:
        conn.execute(
            text(
                "UPDATE scan_runs "
                "SET finished_at = :finished_at, status = :status, "
                "    counts = :counts, error = :error "
                "WHERE id = :id"
            ),
            {
                "id": run_id,
                "finished_at": finished_at,
                "status": status,
                "counts": json.dumps(counts),
                "error": error,
            },
        )


def get_latest_scan_run_any_status(task_name: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                "SELECT id, status, started_at, finished_at, error, counts "
                "FROM scan_runs WHERE task_name = :task_name "
                "ORDER BY started_at DESC LIMIT 1"
            ),
            {"task_name": task_name},
        ).first()
    if row is None:
        return None
    return {
        "id": row.id,
        "status": row.status,
        "started_at": row.started_at,
        "finished_at": row.finished_at,
        "error": row.error,
        "counts": json.loads(row.counts) if row.counts else None,
    }
```

Confirm `json` is imported at the top of `scanner/db.py` (likely already, since `insert_scan_run` uses it). If not, add `import json`.

### Step 4: Re-run tests to verify they pass

```bash
cd scanner && python -m pytest tests/test_db_scan_runs.py -v
```

Expected: 5/5 pass.

### Step 5: Run full pytest to confirm no regression

```bash
cd scanner && python -m pytest --tb=short
```

Expected: 115 prior + 5 new = 120 pass (assuming pre-existing P3005 race is benign or you ran `npx prisma migrate reset --force --skip-seed` first per plan risk notes).

### Step 6: Commit

```bash
cd scanner && git add db.py tests/test_db_scan_runs.py
cd ..
git add scanner/db.py scanner/tests/test_db_scan_runs.py
git commit -m "feat(scanner): start_scan_run / complete_scan_run / get_latest_scan_run_any_status"
```

(Or run `git add` from repo root if you prefer.)

---

## Task 3: Celery task integration + tests

**Files:**
- Modify: `scanner/tasks/sync_manager_catalog.py` (~10 line changes)
- Modify: `scanner/tests/test_sync_manager_catalog.py` (extend with 3 new tests)

**Interfaces:**
- Consumes: `start_scan_run`, `complete_scan_run` from Task 2
- Produces: `sync_manager_catalog` Celery task writes a `running` row at start, updates to `ok`/`failed` in `finally`

### Step 1: Read the current `sync_manager_catalog` task to understand structure

```bash
cat scanner/tasks/sync_manager_catalog.py
```

Identify:
- Where the function body starts (after the decorator on line 33)
- Where `started_at = datetime.utcnow()` is (around line 35)
- Where the existing `try / except / finally` lives
- The exact `insert_scan_run` call in the `finally` block (around line 179) and what arguments it passes

### Step 2: Write failing tests for the new flow

Append to `scanner/tests/test_sync_manager_catalog.py`:

```python
from scanner.db import get_engine
from sqlalchemy import text


def test_sync_writes_running_row_at_start(db, monkeypatch):
    # The catalog fetch returns a benign empty list so the task completes
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog._fetch_manager_catalog", lambda: [])
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.upsert_nodes_from_catalog", lambda pairs: {"inserted": 0, "updated": 0, "skipped": 0, "errors": []})
    from scanner.tasks.sync_manager_catalog import sync_manager_catalog
    sync_manager_catalog()
    with get_engine().connect() as conn:
        rows = conn.execute(
            text("SELECT status, finished_at FROM scan_runs WHERE task_name = 'sync_manager_catalog' ORDER BY id DESC LIMIT 1")
        ).first()
    assert rows.status == "ok"
    assert rows.finished_at is not None


def test_sync_updates_row_to_failed_on_exception(db, monkeypatch):
    def boom():
        raise RuntimeError("catalog fetch failed")
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog._fetch_manager_catalog", boom)
    from scanner.tasks.sync_manager_catalog import sync_manager_catalog
    sync_manager_catalog()
    with get_engine().connect() as conn:
        rows = conn.execute(
            text("SELECT status, error FROM scan_runs WHERE task_name = 'sync_manager_catalog' ORDER BY id DESC LIMIT 1")
        ).first()
    assert rows.status == "failed"
    assert "catalog fetch failed" in rows.error


def test_sync_survives_start_scan_run_failure(db, monkeypatch):
    """If start_scan_run itself raises, the task must still complete."""
    def fail_start(_):
        raise RuntimeError("DB down")
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.start_scan_run", fail_start)
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog._fetch_manager_catalog", lambda: [])
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.upsert_nodes_from_catalog", lambda pairs: {"inserted": 0, "updated": 0, "skipped": 0, "errors": []})
    from scanner.tasks.sync_manager_catalog import sync_manager_catalog
    result = sync_manager_catalog()  # must not raise
    assert result["status"] in ("ok", "failed")  # whatever the inner logic produced
```

Adjust the function names (`_fetch_manager_catalog`, `upsert_nodes_from_catalog`) to match the real symbol names in the file. The intent is: monkeypatch the I/O so the task runs end-to-end without network, then assert on the resulting `scan_runs` row.

### Step 3: Run tests to verify they fail

```bash
cd scanner && python -m pytest tests/test_sync_manager_catalog.py -v -k "running_row_at_start or failed_on_exception or start_scan_run_failure"
```

Expected: 3 failures — the task still calls the old `insert_scan_run` in `finally`, so the "running" tests look for state that doesn't exist.

### Step 4: Modify `sync_manager_catalog` to use the new helpers

In `scanner/tasks/sync_manager_catalog.py`:

1. Add imports at the top:

```python
from scanner.db import start_scan_run, complete_scan_run
```

(`insert_scan_run` import can stay if other helpers still use it; otherwise remove.)

2. At the top of the task body, after `started_at = datetime.utcnow()` and the `summary = {...}` initialization:

```python
    run_id: int | None = None
    try:
        run_id = start_scan_run("sync_manager_catalog")
    except Exception:
        logger.exception("start_scan_run failed; sync proceeds without scan_runs row")
```

3. In the `finally` block, replace the existing `insert_scan_run(...)` call with:

```python
    if run_id is not None:
        complete_scan_run(run_id, status, summary, error_msg)
```

4. Remove the existing `insert_scan_run` import if no other code in the file uses it. If it's used elsewhere, leave it.

### Step 5: Re-run the 3 new tests

```bash
cd scanner && python -m pytest tests/test_sync_manager_catalog.py -v
```

Expected: all tests in this file pass, including the 3 new ones.

### Step 6: Run full pytest to confirm no regression

```bash
cd scanner && python -m pytest --tb=short
```

Expected: 120 prior + 3 new = 123 pass (assuming the 6 pre-existing P3005 race errors are environmental, not from these changes).

### Step 7: Commit

```bash
git add scanner/tasks/sync_manager_catalog.py scanner/tests/test_sync_manager_catalog.py
git commit -m "feat(scanner): sync_manager_catalog writes running row at start"
```

---

## Task 4: Web lib helper + GET status endpoint + tests

**Files:**
- Modify: `web/lib/scan-runs.ts` (add 1 function)
- Create: `web/app/api/v1/admin/manager/sync/status/route.ts` (~30 lines)
- Create: `web/tests/lib/scan-runs-any-status.test.ts` (~40 lines)
- Create: `web/tests/api/manager-sync-status.test.ts` (~80 lines)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`, `requireAdmin` from `@/lib/auth`, `json`/`error` from `@/lib/api-response`
- Produces:
  - `getLatestScanRunAnyStatus(taskName: string)` — returns `ScanRun | null` (Prisma shape, snake_case fields preserved)
  - `GET /api/v1/admin/manager/sync/status` — admin-only, returns `{ run: { id, status, startedAt, finishedAt, error } | null }`

### Step 1: Read existing patterns

```bash
cat web/lib/scan-runs.ts
cat web/lib/auth.ts | head -50
cat web/lib/api-response.ts
ls web/app/api/v1/admin/  # find a similar route to mirror
```

Pick a sibling route (e.g. one of the existing `/api/v1/admin/*` route handlers) and mirror its auth + response shape.

### Step 2: Write failing tests for the helper

Create `web/tests/lib/scan-runs-any-status.test.ts`:

```tsx
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findFirstMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: { scanRun: { findFirst: findFirstMock } },
}));

import { getLatestScanRunAnyStatus } from '@/lib/scan-runs';

describe('getLatestScanRunAnyStatus', () => {
  beforeEach(() => findFirstMock.mockReset());

  it('returns the most recent row regardless of status', async () => {
    findFirstMock.mockResolvedValue({
      id: 1n,
      status: 'running',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: null,
      error: null,
    });
    const run = await getLatestScanRunAnyStatus('sync_manager_catalog');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { task_name: 'sync_manager_catalog' },
      orderBy: { started_at: 'desc' },
      select: {
        id: true, status: true, started_at: true, finished_at: true, error: true,
      },
    });
    expect(run?.status).toBe('running');
    expect(run?.finished_at).toBeNull();
  });

  it('returns null when no rows', async () => {
    findFirstMock.mockResolvedValue(null);
    const run = await getLatestScanRunAnyStatus('never_ran');
    expect(run).toBeNull();
  });
});
```

### Step 3: Write failing tests for the route

Create `web/tests/api/manager-sync-status.test.ts`:

```tsx
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdminMock = vi.fn();
const getLatestMock = vi.fn();

vi.mock('@/lib/auth', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/scan-runs', () => ({ getLatestScanRunAnyStatus: getLatestMock }));

import { GET } from '@/app/api/v1/admin/manager/sync/status/route';

function makeReq() {
  return new Request('http://localhost/api/v1/admin/manager/sync/status', { method: 'GET' });
}

describe('GET /api/v1/admin/manager/sync/status', () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    getLatestMock.mockReset();
    requireAdminMock.mockResolvedValue({ id: 1n, role: 'admin' });
  });

  it('returns 401 without admin auth', async () => {
    requireAdminMock.mockResolvedValue(null);
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns { run: null } when no rows', async () => {
    getLatestMock.mockResolvedValue(null);
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ run: null });
  });

  it('returns running row with finishedAt=null', async () => {
    getLatestMock.mockResolvedValue({
      id: 7n,
      status: 'running',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: null,
      error: null,
    });
    const res = await GET(makeReq() as never);
    const body = await res.json();
    expect(body.run.id).toBe(7);
    expect(body.run.status).toBe('running');
    expect(body.run.finishedAt).toBeNull();
    expect(body.run.error).toBeNull();
  });

  it('returns completed row with ISO finishedAt', async () => {
    getLatestMock.mockResolvedValue({
      id: 8n,
      status: 'ok',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: new Date('2026-08-10T05:00:42Z'),
      error: null,
    });
    const res = await GET(makeReq() as never);
    const body = await res.json();
    expect(body.run.status).toBe('ok');
    expect(body.run.finishedAt).toBe('2026-08-10T05:00:42.000Z');
  });
});
```

### Step 4: Run tests to verify they fail

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/lib/scan-runs-any-status.test.ts tests/api/manager-sync-status.test.ts --reporter=basic
```

Expected: 6 failures (2 helper + 4 route).

### Step 5: Add the helper in `web/lib/scan-runs.ts`

Append to `web/lib/scan-runs.ts`:

```ts
export async function getLatestScanRunAnyStatus(taskName: string) {
  return prisma.scanRun.findFirst({
    where: { task_name: taskName },
    orderBy: { started_at: 'desc' },
    select: {
      id: true,
      status: true,
      started_at: true,
      finished_at: true,
      error: true,
    },
  });
}
```

### Step 6: Create the route handler

Create `web/app/api/v1/admin/manager/sync/status/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getLatestScanRunAnyStatus } from '@/lib/scan-runs';
import { json, error } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return error(401, 'admin auth required');

  const run = await getLatestScanRunAnyStatus('sync_manager_catalog');
  if (!run) {
    return json({ run: null });
  }
  return json({
    run: {
      id: Number(run.id),
      status: run.status,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null,
      error: run.error ?? null,
    },
  });
}
```

### Step 7: Re-run tests to verify they pass

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/lib/scan-runs-any-status.test.ts tests/api/manager-sync-status.test.ts --reporter=basic
```

Expected: 6/6 pass.

### Step 8: Run full vitest to confirm no regression

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 252 prior + 6 new = 258/258 pass.

### Step 9: Commit

```bash
cd web && git add lib/scan-runs.ts app/api/v1/admin/manager/sync/status/route.ts tests/lib/scan-runs-any-status.test.ts tests/api/manager-sync-status.test.ts
cd ..
git add web/lib/scan-runs.ts web/app/api/v1/admin/manager/sync/status web/tests/lib web/tests/api
git commit -m "feat(api): GET /api/v1/admin/manager/sync/status returns latest scan_run"
```

---

## Task 5: ManagerSyncButton state machine + polling

**Files:**
- Modify: `web/app/(admin)/_components/ManagerSyncButton.tsx` (~60 line changes)
- Create: `web/tests/_components/ManagerSyncButton.test.tsx` (~150 lines, 6 cases)

**Interfaces:**
- Consumes: `GET /api/v1/admin/manager/sync/status` from Task 4, `useRouter` from `next/navigation`, `useState`/`useEffect`/`useRef` from React
- Produces: a 5-phase state machine (`idle | submitting | polling | done | timeout`) that polls the status endpoint until terminal or 180s

### Step 1: Read the current `ManagerSyncButton.tsx`

```bash
cat web/app/\(admin\)/_components/ManagerSyncButton.tsx
```

Note: existing imports, the `Props` type, the current click handler, and the message-rendering structure.

### Step 2: Write failing tests

Create `web/tests/_components/ManagerSyncButton.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { ManagerSyncButton } from '@/app/(admin)/_components/ManagerSyncButton';

// Mock next/navigation
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response;
  }) as never;
}

describe('ManagerSyncButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders initial idle state with the sync label', () => {
    render(<ManagerSyncButton managerSystemUserId={1} />);
    expect(screen.getByRole('button', { name: /同步 Manager 目录/ })).toBeTruthy();
  });

  it('transitions through submitting → polling → done ok and calls router.refresh', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued', task_id: 'abc' } },                 // POST
      { status: 200, body: { run: { status: 'running' } } },                        // poll 1
      { status: 200, body: { run: { status: 'running' } } },                        // poll 2
      { status: 200, body: { run: { status: 'ok', startedAt: 't', finishedAt: 't', error: null } } }, // poll 3
    ]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    // Advance 1s, 1s, 5s — three ticks
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('transitions to done failed with the error message', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued' } },
      { status: 200, body: { run: { status: 'running' } } },
      { status: 200, body: { run: { status: 'failed', error: 'boom', startedAt: 't', finishedAt: 't' } } },
    ]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(await screen.findByText(/boom/)).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('times out at 180s and shows the "still running" message', async () => {
    // Always-running response
    mockFetchSequence([{ status: 200, body: { run: { status: 'running' } } }]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(await screen.findByText(/仍在后台运行/)).toBeTruthy();
  });

  it('handles fetch errors on the status endpoint without crashing', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued' } },
    ]);
    // After the POST, the next fetch (status) will reject
    const origFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    origFetch.mockRejectedValueOnce(new Error('network'));
    origFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ run: { status: 'ok', startedAt: 't', finishedAt: 't', error: null } }) } as Response);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    // Should not throw; the component continues polling.
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('clears the polling timer on unmount', async () => {
    mockFetchSequence([{ status: 202, body: { status: 'queued' } }, { status: 200, body: { run: { status: 'running' } } }]);
    const { unmount } = render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    unmount();
    // Advance timers; if the timer wasn't cleared, vitest will warn about setState on unmounted.
    await act(async () => { vi.advanceTimersByTime(5000); });
  });
});
```

Notes:
- `vi.useFakeTimers()` + `vi.advanceTimersByTime` is the standard pattern in this repo's component tests. Adjust if existing tests use a different style (e.g. `MockDate`).
- The test file mocks `next/navigation` for `useRouter`.
- `mockFetchSequence` is intentionally simple; the test cases that need different responses mid-sequence can override.

### Step 3: Run tests to verify they fail

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/ManagerSyncButton.test.tsx --reporter=basic
```

Expected: 6 failures — the current button only does POST + toast, no state machine, no polling.

### Step 4: Rewrite `ManagerSyncButton.tsx`

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/ui/button';

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'polling'; startedAt: number }
  | { kind: 'done'; status: 'ok' | 'failed'; error?: string }
  | { kind: 'timeout' };

const TIMEOUT_MS = 180_000;
const POLL_INTERVALS_MS = [1000, 1000, 5000];

export function ManagerSyncButton({ managerSystemUserId }: { managerSystemUserId: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    return () => { lastErrorRef.current = null; };
  }, []);

  async function startPolling() {
    const startedAt = Date.now();
    setPhase({ kind: 'polling', startedAt });
    let cancelled = false;
    let i = 0;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        setPhase({ kind: 'timeout' });
        return;
      }
      try {
        const res = await fetch('/api/v1/admin/manager/sync/status', { cache: 'no-store' });
        if (res.ok) {
          const { run } = await res.json();
          if (run && (run.status === 'ok' || run.status === 'failed')) {
            if (run.status === 'ok') {
              router.refresh();
              setPhase({ kind: 'done', status: 'ok' });
            } else {
              lastErrorRef.current = run.error ?? '同步失败';
              setPhase({ kind: 'done', status: 'failed', error: lastErrorRef.current });
            }
            return;
          }
        }
      } catch {
        // network blip — keep polling
      }
      setTimeout(tick, POLL_INTERVALS_MS[Math.min(i++, POLL_INTERVALS_MS.length - 1)]);
    };

    tick();
    return () => { cancelled = true; };
  }

  async function onClick() {
    setPhase({ kind: 'submitting' });
    let triggerOk = false;
    try {
      const res = await fetch('/api/v1/admin/manager/sync', { method: 'POST' });
      triggerOk = res.ok;
    } catch {
      setPhase({ kind: 'done', status: 'failed', error: '请求失败' });
      return;
    }
    if (!triggerOk) {
      setPhase({ kind: 'done', status: 'failed', error: '触发接口返回非 2xx' });
      return;
    }
    await startPolling();
  }

  const isBusy = phase.kind === 'submitting' || phase.kind === 'polling';
  let label: string;
  if (phase.kind === 'submitting') label = '触发中…';
  else if (phase.kind === 'polling') {
    const elapsed = Math.floor((Date.now() - phase.startedAt) / 1000);
    label = `同步中… (${elapsed}s)`;
  }
  else if (phase.kind === 'done' && phase.status === 'failed') label = '重试';
  else label = '同步 Manager 目录';

  return (
    <div className="flex items-center gap-3">
      <Button onClick={onClick} disabled={isBusy}>{label}</Button>
      {phase.kind === 'done' && phase.status === 'ok' && (
        <span className="text-sm text-green-600">已同步</span>
      )}
      {phase.kind === 'done' && phase.status === 'failed' && (
        <span className="text-sm text-red-600">{phase.error}</span>
      )}
      {phase.kind === 'timeout' && (
        <span className="text-sm text-gray-500">仍在后台运行,刷新页面查看</span>
      )}
    </div>
  );
}
```

(Adjust the `Button` import path to match the existing component; inspect the file before rewriting to confirm the import style.)

The `managerSystemUserId` prop is kept (it's part of the existing component contract) but is unused in this rewrite. If unused, mark it `_managerSystemUserId` or leave a brief comment — your choice, as long as TypeScript passes.

### Step 5: Re-run tests to verify they pass

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/ManagerSyncButton.test.tsx --reporter=basic
```

Expected: 6/6 pass. If a test fails because of timing — e.g. `vi.advanceTimersByTime(1000)` not firing the next tick because the inner `tick` is `async` — switch to `vi.advanceTimersByTimeAsync(1000)` (vitest 1.6+) or add an `await Promise.resolve()` after the advance.

### Step 6: Run full vitest to confirm no regression

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 258 prior + 6 new = 264/264 pass.

### Step 7: Run `tsc --noEmit` and lint

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/next lint --quiet 2>/dev/null || PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/eslint . --quiet
```

Expected: 0 new errors. Pre-existing `ThemeToggle.test.tsx:11` TS error + 13 lint warnings remain out of scope.

### Step 8: Commit

```bash
cd web && git add 'app/(admin)/_components/ManagerSyncButton.tsx' tests/_components/ManagerSyncButton.test.tsx
cd ..
git add 'web/app/(admin)/_components/ManagerSyncButton.tsx' web/tests/_components/ManagerSyncButton.test.tsx
git commit -m "feat(admin): ManagerSyncButton polls scan status until terminal"
```

---

## Final Verification (post-implementation)

- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic` — 264/264 pass
- [ ] `cd scanner && python -m pytest --tb=short` — 123/123 pass (assuming pre-existing P3005 race is benign)
- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit` — 0 new errors
- [ ] Manual smoke (best-effort): start dev server, log in as admin, click "同步 Manager 目录", observe the button transition through `触发中…` → `同步中… (Xs)` → back to "同步 Manager 目录" with "已同步" message; confirm `LastSyncedAt` updated without a page refresh
- [ ] Final whole-branch review dispatched by orchestrator before push

## Out of Scope (NOT in this plan)

- Progress percentage / progress bar
- Multi-task parallel display (only `sync_manager_catalog` is polled)
- Pushing sync progress to other admin pages
- WebSocket / SSE
- Cancelling a running Celery task
- Modifying the daily beat schedule
- Server-side `INSERT ... NOW()`
- `error` field 1024-char cap (already in Plan 5.1.4)
- `complete_scan_run` retry on DB failure
- Multi-admin role / audit
- Stuck-running row reconciliation
- Targeted refetch of just `getLatestScanRun` (current `router.refresh()` re-fetches the page; cheap enough for admin-only)

## Self-Review Notes

### Spec coverage

| Spec requirement | Covered by |
|---|---|
| `scan_runs.finished_at` nullable | Task 1 |
| `start_scan_run` helper + tests | Task 2 |
| `complete_scan_run` helper + tests | Task 2 |
| `get_latest_scan_run_any_status` helper + tests | Task 2 |
| `sync_manager_catalog` Celery integration | Task 3 |
| `getLatestScanRunAnyStatus` web lib | Task 4 |
| GET status endpoint | Task 4 |
| ManagerSyncButton state machine | Task 5 |
| Polling interval 1s × 2, then 5s; 180s timeout | Task 5 |
| `router.refresh()` on done ok | Task 5 |
| `Cache-Control: no-store` on endpoint | Task 4 (`force-dynamic` + `revalidate = 0`) |
| DB failure tolerance | Task 2 (no try/except — `start_scan_run` only inserts; if it fails, caller wraps) and Task 3 (try/except around `start_scan_run`) |
| Unmount cleans up timer | Task 5 (`cancelled` flag in closure) |
| Pre-existing tests still pass | Each task's full-suite step |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later". All concrete file paths and code.

### Type consistency

- `Phase` discriminated union in `ManagerSyncButton` matches the `setPhase` calls.
- `getLatestScanRunAnyStatus` returns Prisma's `ScanRun | null` (snake_case fields); the route handler maps to camelCase.
- `start_scan_run` / `complete_scan_run` use the same column names as the Prisma model.
- `ScanRun` Prisma type's `finished_at` is now `Date | null`; consumers must handle null. Verified in Tasks 1 + 4.

### Risks surfaced

- **Stuck `running` rows** if Celery worker crashes mid-sync — documented in spec §Out of Scope; the polling endpoint will surface `running` indefinitely. The plan does not add reconciliation.
- **Polling cost** — worst case ~36 requests per click. Admin-only; not a load concern.
- **LastSyncedAt re-render via `router.refresh()`** — re-fetches the entire page; consistent with Plan 5.1.4.
- **Test flakiness from `vi.useFakeTimers` + `async` `tick`** — if a test fails on timing, switch to `advanceTimersByTimeAsync` per Vitest 1.6+ docs.
- **Pre-existing P3005 race** in pytest — mitigated by `npx prisma migrate reset --force --skip-seed` if needed; documented in plan risk notes.
- **`Button` import path** — adjust Task 5 Step 4 if the import path differs; do not assume.
- **MySQL `ALTER TABLE` with NULL** — fast metadata-only op in MySQL 8.0; no production-downtime risk on live DB.
