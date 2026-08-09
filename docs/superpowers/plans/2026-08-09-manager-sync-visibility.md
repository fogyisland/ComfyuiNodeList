# Manager sync visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two Plan 5.1.3 followups that block operational visibility of the daily ComfyUI-Manager catalog sync: a one-shot backfill script that flips `nodes.source_manager=true` for nodes already imported from Manager before Plan 5.1.3, and a "Last synced at" indicator on `/admin` showing when the most recent sync completed.

**Architecture:** Add a new MySQL `scan_runs` table (parallel to existing `scan_failures`) that records each Celery task's start/finish/status/summary counts. Extend `sync_manager_catalog` with a `try/finally` wrap that captures `started_at` at the top and writes a `scan_runs` row at the end. Add a CLI script under `scanner/scripts/` that fetches the live Manager catalog, identifies nodes already in `nodes` with `source_manager=false` matching the catalog, and updates them in batches (`--apply` flag, default dry-run). Build a small `<LastSyncedAt>` React component that the new `AdminHomeClient` renders next to the existing `ManagerSyncButton`. Page reads `latestRun` server-side via `web/lib/scan-runs.ts::getLatestScanRun`; no auto-refresh, no SSE.

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

- **scan_runs table:** `id BIGINT PRIMARY KEY`, `task_name VARCHAR(64) NOT NULL`, `started_at DATETIME(3) NOT NULL`, `finished_at DATETIME(3) NOT NULL`, `status VARCHAR(16) NOT NULL` ('ok' | 'failed'), `counts JSON`, `error TEXT NULL`. Index `(task_name, finished_at DESC)`. No new tables other than `scan_runs`.
- **scan_runs writes are best-effort:** `insert_scan_run` failures inside `finally` log a warning and do NOT re-raise (a finally-block raise would mask the original exception). Tests assert `insert_scan_run` returns -1 on DB blip and the caller does not raise.
- **scan_runs `counts` only stores summary metrics:** `added`, `skipped_existing`, `skipped_pending`, `updated_nodes`, `errors_count`. NOT the full `errors: [...]` list (that lives in `scan_failures`).
- **scan_runs `error` field** stores the first error message truncated to 1024 chars when `status='failed'`, else NULL.
- **"Last synced at"** reads `prisma.scanRun.findFirst({ where: { task_name: 'sync_manager_catalog', status: 'ok' }, orderBy: { finished_at: 'desc' } })`. Returns null when no successful run exists.
- **"Last synced at" UI placement:** On `/admin` page, immediately adjacent to the existing `ManagerSyncButton` (renders inside the same logical block). Layout left/right is implementation detail; the visual proximity is the contract.
- **"Last synced at" display format:** Relative + absolute. Default text: "Last synced at: X 分钟前 (YYYY-MM-DD HH:MM UTC)". When `run === null`, render "Manager sync never ran" in muted styling. No SSE / no auto-refresh — page reload only.
- **"Last synced at" is server-side:** `app/admin/page.tsx` is a server component that fetches `latestRun` and passes it as a prop. The `LastSyncedAt` component receives the run as a prop; client does not query the DB.
- **Sync task gating:** Existing `sync_manager_catalog` logic is unchanged. The only addition is a `try/finally` block that records `started_at` at the top and writes a `scan_runs` row at the end. No new branches / no new error handling. The existing `errors` list inside `counts` is reduced to `errors_count` integer for the scan_runs row.
- **Backfill script:** `scanner/scripts/backfill_source_manager.py`. Default mode is dry-run. `--apply` flag commits. `--limit N` caps the sample printed in dry-run (default 20). Both modes accept `--limit`. The script is idempotent (re-running yields 0 work). It uses the existing `httpx` + `urllib.parse` fetch logic — no new dependencies.
- **Backfill heuristic:** Pull the live Manager catalog (same URL as `sync_manager_catalog` uses), build a set of `(LOWER(github_owner), LOWER(github_repo))` pairs. Find nodes where the pair is in the set AND `source_manager=false`. UPDATE in batches of 100 with a per-batch commit.
- **Backfill gate:** The script does NOT mark `source_manager=true` for nodes that match the catalog pair but already have `source_manager=true`. Idempotent.
- **Manual button preserved:** `POST /api/v1/admin/manager/sync` and the trigger_api endpoint remain unchanged. The script is independent.
- **No new dependencies.** Same `httpx`, `pymysql`, `urllib.parse`, Prisma client, Next.js, React as Plan 5.1.3.
- **No UI tests beyond** what this plan specifies (3 `LastSyncedAt` cases + 2 admin page cases + 1 `scan-runs` test = 6 vitest cases).
- **No `scan_runs` history UI** — only the "last successful run" query. The full history view is v2.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `web/prisma/schema.prisma` | Modify (+1 model) | Add `ScanRun` model with task_name, started_at, finished_at, status, counts, error |
| `web/prisma/migrations/20260809_add_scan_runs/migration.sql` | Create | `CREATE TABLE scan_runs ...` + index |
| `scanner/db.py` | Modify (+1 helper) | `insert_scan_run(task_name, started_at, finished_at, status, counts, error=None) -> int` |
| `scanner/tasks/sync_manager_catalog.py` | Modify (try/finally wrap) | Capture `started_at` at top; write `scan_runs` row in `finally` |
| `scanner/scripts/__init__.py` | Create | Empty marker so `scanner/scripts/` is a package |
| `scanner/scripts/backfill_source_manager.py` | Create | One-shot CLI script with `--apply` / `--limit` flags |
| `web/lib/scan-runs.ts` | Create | `get_latest_scan_run(task_name) -> ScanRunSummary \| null` (Prisma client wrapper) |
| `web/app/admin/page.tsx` | Modify | Fetch `latestRun` server-side; pass to `AdminHomeClient` |
| `web/app/admin/AdminHomeClient.tsx` | Create (or extract from page.tsx) | Client wrapper rendering `ManagerSyncButton` + `<LastSyncedAt>` |
| `web/app/_components/LastSyncedAt.tsx` | Create | Server-friendly presentational component (relative + absolute timestamps) |
| `scanner/tests/test_db.py` | Modify (+3 cases) | `insert_scan_run` happy path, error field, does-not-raise |
| `scanner/tests/test_sync_manager_catalog.py` | Modify (+3 cases) | sync writes ok run / failed run / writes even when inner raises |
| `scanner/tests/test_backfill_source_manager.py` | Create | dry-run / --apply / idempotent / unknown-node not touched |
| `web/tests/_components/LastSyncedAt.test.tsx` | Create (+3 cases) | null / recent / hours ago |
| `web/tests/admin/page.test.tsx` | Create (+2 cases) | latestRun passed / null fallback |
| `web/tests/lib/scan-runs.test.ts` | Create (+1 case) | `get_latest_scan_run` filter + order |

---

## Task Decomposition

5 reviewable tasks. Each ends with an independently testable deliverable.

---

### Task 1: Add `scan_runs` table + Prisma migration

**Files:**
- Modify: `web/prisma/schema.prisma` (add `ScanRun` model)
- Create: `web/prisma/migrations/20260809_add_scan_runs/migration.sql`

**Interfaces:**
- Consumes: existing Prisma schema (`web/prisma/schema.prisma`)
- Produces: `ScanRun` model with `id`, `task_name`, `started_at`, `finished_at`, `status`, `counts`, `error` fields; `scan_runs` table in MySQL with index `(task_name, finished_at DESC)`

- [ ] **Step 1: Add `ScanRun` model to `schema.prisma`**

In `web/prisma/schema.prisma`, append at the end of the file (after the last model):

```prisma
model ScanRun {
  id          BigInt   @id @default(autoincrement())
  task_name   String   @db.VarChar(64)
  started_at  DateTime @db.DateTime(3)
  finished_at DateTime @db.DateTime(3)
  status      String   @db.VarChar(16)
  counts      Json?
  error       String?  @db.Text

  @@index([task_name, finished_at(sort: Desc)])
  @@map("scan_runs")
}
```

Verify the project's MySQL provider supports `DateTime(3)` precision (it does — the existing `Node.updated_at` uses `@db.DateTime(3)` elsewhere; if not, use plain `DateTime`).

- [ ] **Step 2: Generate Prisma migration**

Run from `web/`:
```bash
cd web && npx prisma migrate dev --name add_scan_runs
```

Expected: `prisma/migrations/20260809_add_scan_runs/migration.sql` created with content matching:
```sql
-- CreateTable
CREATE TABLE `scan_runs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_name` VARCHAR(64) NOT NULL,
  `started_at` DATETIME(3) NOT NULL,
  `finished_at` DATETIME(3) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `counts` JSON NULL,
  `error` TEXT NULL,
  INDEX `scan_runs_task_name_finished_at_idx`(`task_name`, `finished_at` DESC),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

If Prisma generates additional statements (e.g., foreign keys), **stop and ask** — the expected migration is exactly one CREATE TABLE. Same UTC timestamp-prefix convention as Plan 5.1.3 Task 1 (Prisma may rename the directory to `20260809134330_add_scan_runs`).

- [ ] **Step 3: Apply migration to dev DB and verify**

```bash
cd web && npx prisma migrate status
```

Expected: `"Database schema is up to date!"`

- [ ] **Step 4: Verify Prisma client exposes the new model**

```bash
cd web && node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.\$disconnect().then(() => console.log('scanRun' in p ? 'OK' : 'MISSING'));"
```

Expected: `OK`

- [ ] **Step 5: Run existing test suites to confirm no regression**

```bash
cd web && pnpm test
```

Expected: all existing vitest cases pass (237 baseline).

- [ ] **Step 6: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/20260809_add_scan_runs/migration.sql
git commit -m "feat(schema): add scan_runs table for Celery task history (Plan 5.1.4)"
```

---

### Task 2: Extend `scanner/db.py` — `insert_scan_run` helper + sync task writes run

**Files:**
- Modify: `scanner/db.py` (append `insert_scan_run`)
- Modify: `scanner/tasks/sync_manager_catalog.py` (wrap body in try/finally, write scan_runs row)
- Modify: `scanner/tests/test_db.py` (+3 cases)
- Modify: `scanner/tests/test_sync_manager_catalog.py` (+3 cases)

**Interfaces:**
- Consumes: existing `get_connection()` context manager; existing `sync_manager_catalog` body
- Produces:
  - `insert_scan_run(task_name: str, started_at: datetime, finished_at: datetime, status: str, counts: dict[str, int], error: str | None = None) -> int`
  - `sync_manager_catalog` continues to return `counts` dict (backward compat); now also writes one `scan_runs` row per call

- [ ] **Step 1: Write failing tests for `insert_scan_run`**

In `scanner/tests/test_db.py`, append:

```python
from datetime import datetime, timezone
from scanner.db import insert_scan_run


def test_insert_scan_run_writes_row(fresh_db):
    """Happy path: row contains all expected fields."""
    started = datetime(2026, 8, 9, 5, 0, 0)
    finished = datetime(2026, 8, 9, 5, 1, 30)
    new_id = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=started,
        finished_at=finished,
        status="ok",
        counts={"added": 3, "updated_nodes": 1, "errors_count": 0},
    )
    assert isinstance(new_id, int) and new_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_name, started_at, finished_at, status, counts, error "
                "FROM scan_runs WHERE id = %s",
                (new_id,),
            )
            row = cur.fetchone()
    assert row["task_name"] == "sync_manager_catalog"
    assert row["status"] == "ok"
    assert row["error"] is None
    # counts is JSON; column comes back as str on PyMySQL
    import json
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed["added"] == 3
    assert parsed["updated_nodes"] == 1


def test_insert_scan_run_with_error_field(fresh_db):
    """Failed status persists error truncated to 1024 chars."""
    long_err = "x" * 2000
    new_id = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=datetime(2026, 8, 9, 5, 0, 0),
        finished_at=datetime(2026, 8, 9, 5, 0, 5),
        status="failed",
        counts={"errors_count": 1},
        error=long_err,
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status, error FROM scan_runs WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["status"] == "failed"
    assert row["error"] is not None
    assert len(row["error"]) == 1024  # truncated


def test_insert_scan_run_does_not_raise_on_db_blip(fresh_db, monkeypatch):
    """DB blip returns -1 and does NOT raise (safe for finally blocks)."""
    from scanner import db as db_module

    def broken_execute(*args, **kwargs):
        import pymysql
        raise pymysql.OperationalError("simulated DB blip")

    monkeypatch.setattr(db_module, "get_connection", broken_execute)
    result = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=datetime(2026, 8, 9, 5, 0, 0),
        finished_at=datetime(2026, 8, 9, 5, 0, 5),
        status="ok",
        counts={},
    )
    assert result == -1
```

(If `test_db.py` doesn't already import `fresh_db` fixture, check `scanner/conftest.py` for the right fixture name and adjust.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd scanner && pytest tests/test_db.py -v -k "test_insert_scan_run"
```

Expected: 3 failures (`ImportError` on `insert_scan_run`).

- [ ] **Step 3: Implement `insert_scan_run` in `scanner/db.py`**

Append to `scanner/db.py`:

```python
import json
import logging
from datetime import datetime


logger = logging.getLogger(__name__)


def insert_scan_run(
    task_name: str,
    started_at: datetime,
    finished_at: datetime,
    status: str,
    counts: dict,
    error: str | None = None,
) -> int:
    """Insert a scan_runs row. Returns new id, or -1 on DB write failure.

    Safe to call from a finally block: failures are logged but not raised.
    The `error` field is truncated to 1024 chars. `counts` is JSON-serialized.
    """
    try:
        truncated_error = error[:1024] if error else None
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO scan_runs (task_name, started_at, finished_at, status, counts, error) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        task_name,
                        started_at,
                        finished_at,
                        status,
                        json.dumps(counts) if counts else None,
                        truncated_error,
                    ),
                )
                new_id = cur.lastrowid
            conn.commit()
        return new_id
    except Exception as exc:
        logger.warning("insert_scan_run failed for %s: %s", task_name, exc)
        return -1
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_db.py -v -k "test_insert_scan_run"
```

Expected: 3 passes.

- [ ] **Step 5: Write failing tests for sync task writes run**

In `scanner/tests/test_sync_manager_catalog.py`, append:

```python
def test_sync_writes_ok_run_on_success(monkeypatch_httpx, fresh_db):
    """Sync writes a scan_runs row with status='ok' on success."""
    from datetime import datetime, timedelta
    fake_json = {
        "node-a": {"reference": "https://github.com/aa/bb", "title": "A"},
    }
    monkeypatch_httpx(fake_json)
    before = datetime.utcnow()
    sync_manager_catalog()
    after = datetime.utcnow()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_name, status, counts, error FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row is not None
    assert row["task_name"] == "sync_manager_catalog"
    assert row["status"] == "ok"
    assert row["error"] is None
    import json
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert "added" in parsed
    assert "updated_nodes" in parsed


def test_sync_writes_failed_run_on_fetch_error(monkeypatch_httpx, fresh_db, monkeypatch):
    """Sync writes a scan_runs row with status='failed' when fetch raises."""
    import httpx
    def boom(*args, **kwargs):
        raise httpx.HTTPError("simulated network error")
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.httpx.get", boom)
    with pytest.raises(httpx.HTTPError):
        sync_manager_catalog()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, error FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row["status"] == "failed"
    assert row["error"] is not None
    assert "simulated network error" in row["error"]


def test_sync_writes_run_even_when_inner_step_raises(monkeypatch_httpx, fresh_db, monkeypatch):
    """If an INSERT step raises mid-loop, the scan_runs row still gets written."""
    from scanner.db import insert_pending_submission
    call_count = {"n": 0}

    def flaky_insert(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated INSERT blip")
        return insert_pending_submission(*args, **kwargs)

    monkeypatch.setattr(
        "scanner.tasks.sync_manager_catalog.insert_pending_submission", flaky_insert
    )
    fake_json = {
        "node-a": {"reference": "https://github.com/aa/bb", "title": "A"},
    }
    monkeypatch_httpx(fake_json)
    # Should NOT raise; the error is appended to counts.errors and the run still gets recorded
    sync_manager_catalog()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, counts FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row["status"] == "ok"  # the function doesn't re-raise (errors are accumulated)
    import json
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed["errors_count"] >= 1
```

`monkeypatch_httpx` is the existing fixture from `scanner/conftest.py`. If `pytest` isn't imported in this file, add `import pytest` at the top.

- [ ] **Step 6: Run tests to verify behavior before implementing**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_sync_writes"
```

Expected: 3 failures (sync task doesn't write scan_runs yet).

- [ ] **Step 7: Wrap `sync_manager_catalog` body in try/finally**

Read `scanner/tasks/sync_manager_catalog.py` first:
```bash
grep -n "def sync_manager_catalog" scanner/tasks/sync_manager_catalog.py
```

Then at the top of the file, add `from datetime import datetime` if not already present. Wrap the entire body of `sync_manager_catalog` (after the `counts = {...}` declaration) so it looks like:

```python
def sync_manager_catalog() -> dict:
    counts = {
        "added": 0,
        "skipped_existing": 0,
        "skipped_pending": 0,
        "updated_nodes": 0,
        "errors": [],
    }
    started_at = datetime.utcnow()
    status = "ok"
    try:
        # ... existing fetch, parse, dedup, insert, update logic ...
        # (do NOT change the indentation of the existing body other than
        #  this single indent; everything inside is unchanged)
        return counts
    except Exception as exc:
        status = "failed"
        counts["errors"].append({"entry_id": "*", "error": str(exc)})
        raise
    finally:
        finished_at = datetime.utcnow()
        summary = {
            "added": counts["added"],
            "skipped_existing": counts["skipped_existing"],
            "skipped_pending": counts["skipped_pending"],
            "updated_nodes": counts["updated_nodes"],
            "errors_count": len(counts["errors"]),
        }
        error_msg = None
        if status == "failed" and counts["errors"]:
            err = counts["errors"][0].get("error", "unknown")
            error_msg = err[:1024] if err else "unknown"
        run_id = insert_scan_run(
            task_name="sync_manager_catalog",
            started_at=started_at,
            finished_at=finished_at,
            status=status,
            counts=summary,
            error=error_msg,
        )
        if run_id == -1:
            logger.warning("scan_runs insert failed for sync_manager_catalog")
    return counts  # preserved for backward compat
```

The `return counts` at the end is reached when the original `try` block falls through (no explicit return). If the existing code already had a `return counts` inside the try block, the `finally` still runs first.

Move the `from scanner.db import insert_scan_run` to the existing imports at the top of the file (add it next to the other `from scanner.db import ...`).

- [ ] **Step 8: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_sync_manager_catalog.py -v -k "test_sync_writes"
```

Expected: 3 passes.

- [ ] **Step 9: Run full pytest to confirm no regression**

```bash
cd scanner && pytest
```

Expected: 102 prior + 3 db_helpers + 3 sync_writes = 108/108 pass.

- [ ] **Step 10: Commit**

```bash
git add scanner/db.py scanner/tasks/sync_manager_catalog.py \
        scanner/tests/test_db.py scanner/tests/test_sync_manager_catalog.py
git commit -m "feat(scanner): insert_scan_run helper + sync task records run (Plan 5.1.4)"
```

---

### Task 3: `web/lib/scan-runs.ts` Prisma wrapper + `AdminHomeClient` extract from `page.tsx`

**Files:**
- Create: `web/lib/scan-runs.ts`
- Create: `web/app/admin/AdminHomeClient.tsx`
- Modify: `web/app/admin/page.tsx` (fetch latestRun, pass to AdminHomeClient)
- Create: `web/tests/lib/scan-runs.test.ts` (+1 case)

**Interfaces:**
- Consumes: existing `prisma` from `web/lib/db.ts`; existing `ManagerSyncButton` component
- Produces:
  - `getLatestScanRun(taskName: string): Promise<ScanRunSummary | null>` from `web/lib/scan-runs.ts`
  - `AdminHomeClient` accepts `latestRun` prop and renders `ManagerSyncButton` (and `<LastSyncedAt>` in Task 4)

- [ ] **Step 1: Read existing `page.tsx` to understand its current shape**

```bash
cat web/app/admin/page.tsx
```

Note the current JSX and where `ManagerSyncButton` is rendered. Task 4 will add `<LastSyncedAt>` next to it.

- [ ] **Step 2: Write failing test for `get_latest_scan_run`**

Create `web/tests/lib/scan-runs.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const findFirstMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    scanRun: {
      findFirst: findFirstMock,
    },
  },
}));

import { getLatestScanRun } from '@/lib/scan-runs';

describe('getLatestScanRun', () => {
  it('queries with task_name + status filter and orders by finished_at desc', async () => {
    findFirstMock.mockResolvedValue(null);
    await getLatestScanRun('sync_manager_catalog');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { task_name: 'sync_manager_catalog', status: 'ok' },
      orderBy: { finished_at: 'desc' },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd web && pnpm test tests/lib/scan-runs.test.ts
```

Expected: 1 failure (`@/lib/scan-runs` not found).

- [ ] **Step 4: Implement `web/lib/scan-runs.ts`**

Create `web/lib/scan-runs.ts`:

```typescript
import { prisma } from './db';

export type ScanRunSummary = {
  id: number;
  taskName: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  counts: Record<string, number> | null;
  error: string | null;
};

export async function getLatestScanRun(taskName: string): Promise<ScanRunSummary | null> {
  const row = await prisma.scanRun.findFirst({
    where: { task_name: taskName, status: 'ok' },
    orderBy: { finished_at: 'desc' },
  });
  if (!row) return null;
  return {
    id: Number(row.id),
    taskName: row.task_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    counts: (row.counts as Record<string, number> | null) ?? null,
    error: row.error,
  };
}
```

- [ ] **Step 5: Re-run test to verify it passes**

```bash
cd web && pnpm test tests/lib/scan-runs.test.ts
```

Expected: 1 pass.

- [ ] **Step 6: Extract `AdminHomeClient` from `page.tsx`**

In `web/app/admin/page.tsx`, replace the existing JSX with:

```tsx
import { prisma } from '@/lib/db';
import { AdminHomeClient } from './AdminHomeClient';
import { getLatestScanRun } from '@/lib/scan-runs';

export default async function AdminPage() {
  const latestRun = await getLatestScanRun('sync_manager_catalog');
  return <AdminHomeClient latestRun={latestRun} />;
}
```

Create `web/app/admin/AdminHomeClient.tsx` (move the existing JSX from `page.tsx` into it):

```tsx
'use client';

import { ManagerSyncButton } from './ManagerSyncButton';
import type { ScanRunSummary } from '@/lib/scan-runs';

type Props = {
  latestRun: ScanRunSummary | null;
};

export function AdminHomeClient({ latestRun }: Props) {
  // Move the existing JSX from page.tsx into here. The exact JSX depends on
  // what's currently in the file — preserve the existing layout (likely a
  // section containing the ManagerSyncButton and possibly other admin widgets).
  // The `latestRun` prop is currently unused; Task 4 will wire it into <LastSyncedAt>
  // next to <ManagerSyncButton>.
  return (
    <main className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">管理后台</h1>
      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <ManagerSyncButton />
          {/* Task 4 will add <LastSyncedAt run={latestRun} /> here */}
        </div>
      </section>
    </main>
  );
}
```

If the existing `page.tsx` already had more complex JSX (e.g., a list of admin links, multiple sections), preserve ALL of it inside `AdminHomeClient` — only the `<ManagerSyncButton>` line and its surrounding flex/div container are what Task 4 will modify. The `latestRun` prop is preserved for Task 4 even though unused right now.

- [ ] **Step 7: Run full vitest to confirm no regression**

```bash
cd web && pnpm test
```

Expected: 237 prior + 1 scan-runs = 238/238 pass.

- [ ] **Step 8: Commit**

```bash
git add web/lib/scan-runs.ts web/app/admin/page.tsx web/app/admin/AdminHomeClient.tsx web/tests/lib/scan-runs.test.ts
git commit -m "refactor(admin): extract AdminHomeClient + getLatestScanRun wrapper (Plan 5.1.4)"
```

---

### Task 4: `LastSyncedAt` component + admin page test

**Files:**
- Create: `web/app/_components/LastSyncedAt.tsx`
- Modify: `web/app/admin/AdminHomeClient.tsx` (render `<LastSyncedAt>` next to `<ManagerSyncButton>`)
- Create: `web/tests/_components/LastSyncedAt.test.tsx` (+3 cases)
- Create: `web/tests/admin/page.test.tsx` (+2 cases)

**Interfaces:**
- Consumes: `ScanRunSummary` from `web/lib/scan-runs.ts` (Task 3)
- Produces:
  - `<LastSyncedAt run={latestRun} />` component rendering relative + absolute timestamps
  - Component shows "Manager sync never ran" when `run === null`

- [ ] **Step 1: Write failing tests for `LastSyncedAt`**

Create `web/tests/_components/LastSyncedAt.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LastSyncedAt } from '@/app/_components/LastSyncedAt';

describe('LastSyncedAt', () => {
  it("renders 'never ran' when run is null", () => {
    const { container } = render(<LastSyncedAt run={null} />);
    expect(container.textContent).toContain('Manager sync never ran');
  });

  it("renders '刚刚' when finishedAt is now", () => {
    const now = new Date();
    const { container } = render(<LastSyncedAt run={{ finishedAt: now }} />);
    expect(container.textContent).toContain('刚刚');
  });

  it("renders 'X 小时前' with absolute UTC tooltip when finishedAt is 5 hours ago", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const { container } = render(<LastSyncedAt run={{ finishedAt: fiveHoursAgo }} />);
    expect(container.textContent).toContain('5 小时前');
    // The absolute UTC timestamp is rendered as a separate span with title attr
    const spans = container.querySelectorAll('span[title]');
    expect(spans.length).toBeGreaterThan(0);
    const tooltipText = spans[0].getAttribute('title') ?? '';
    expect(tooltipText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/_components/LastSyncedAt.test.tsx
```

Expected: 3 failures (LastSyncedAt not found).

- [ ] **Step 3: Implement `LastSyncedAt.tsx`**

Create `web/app/_components/LastSyncedAt.tsx`:

```tsx
type Props = {
  run: {
    finishedAt: Date | string;
  } | null;
};

function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 天前`;
}

function absoluteTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

export function LastSyncedAt({ run }: Props) {
  if (!run) {
    return (
      <span className="text-xs text-gray-400" data-testid="last-synced-at">
        Manager sync never ran
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-500" data-testid="last-synced-at">
      Last synced at:{' '}
      <span className="font-medium text-gray-700">{relativeTime(run.finishedAt)}</span>
      <span className="ml-1 text-gray-400" title={absoluteTime(run.finishedAt)}>
        ({absoluteTime(run.finishedAt)})
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
cd web && pnpm test tests/_components/LastSyncedAt.test.tsx
```

Expected: 3 passes.

- [ ] **Step 5: Wire `<LastSyncedAt>` into `AdminHomeClient`**

In `web/app/admin/AdminHomeClient.tsx`, add the import at the top:

```tsx
import { LastSyncedAt } from '@/app/_components/LastSyncedAt';
```

Then in the JSX, immediately adjacent to `<ManagerSyncButton />` (left or right of it; visual proximity is the contract), add:

```tsx
<LastSyncedAt run={latestRun} />
```

The final structure should look like:

```tsx
<div className="flex items-center gap-4">
  <ManagerSyncButton />
  <LastSyncedAt run={latestRun} />
</div>
```

(If the existing layout in `page.tsx` already had a different container around `ManagerSyncButton`, put `<LastSyncedAt>` inside that same container so it inherits the same flex/grid layout.)

- [ ] **Step 6: Write failing tests for admin page**

Create `web/tests/admin/page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const getLatestScanRunMock = vi.fn();
const adminPageMock = vi.fn();

vi.mock('@/lib/scan-runs', () => ({
  getLatestScanRun: getLatestScanRunMock,
}));
vi.mock('@/app/admin/AdminHomeClient', () => ({
  AdminHomeClient: (props: { latestRun: unknown }) => {
    adminPageMock(props);
    return <div data-testid="admin-home-client" />;
  },
}));
vi.mock('@/lib/db', () => ({ prisma: {} }));

describe('AdminPage', () => {
  it('passes latestRun to AdminHomeClient when scan exists', async () => {
    const fakeRun = {
      id: 1,
      taskName: 'sync_manager_catalog',
      startedAt: new Date('2026-08-09T05:00:00Z'),
      finishedAt: new Date('2026-08-09T05:01:30Z'),
      status: 'ok',
      counts: { added: 5 },
      error: null,
    };
    getLatestScanRunMock.mockResolvedValue(fakeRun);
    adminPageMock.mockClear();
    const { default: AdminPage } = await import('@/app/admin/page');
    render(await AdminPage());
    expect(adminPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ latestRun: expect.objectContaining({ id: 1, taskName: 'sync_manager_catalog' }) }),
    );
  });

  it('passes null when no successful run exists', async () => {
    getLatestScanRunMock.mockResolvedValue(null);
    adminPageMock.mockClear();
    const { default: AdminPage } = await import('@/app/admin/page');
    render(await AdminPage());
    expect(adminPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ latestRun: null }),
    );
  });
});
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd web && pnpm test tests/admin/page.test.tsx
```

Expected: 2 passes.

(Note: the page component is an async server component; the test awaits `AdminPage()` then renders the result. If the project's existing test infrastructure doesn't already support this pattern, check `web/tests/admin/` for prior examples or look at how `web/app/(public)/nodes/page.tsx` is tested.)

- [ ] **Step 8: Run full vitest to confirm no regression**

```bash
cd web && pnpm test
```

Expected: 238 prior + 3 LastSyncedAt + 2 admin page = 243/243 pass.

- [ ] **Step 9: Run `tsc` and `lint`**

```bash
cd web && pnpm exec tsc --noEmit && pnpm lint
```

Expected: 0 new errors (pre-existing ThemeToggle TS2322 + 13 lint warnings acceptable per Plan 5.1.3 baseline).

- [ ] **Step 10: Commit**

```bash
git add web/app/_components/LastSyncedAt.tsx web/app/admin/AdminHomeClient.tsx \
        web/tests/_components/LastSyncedAt.test.tsx web/tests/admin/page.test.tsx
git commit -m "feat(ui): LastSyncedAt indicator next to ManagerSyncButton (Plan 5.1.4)"
```

---

### Task 5: Backfill CLI script (`scanner/scripts/backfill_source_manager.py`)

**Files:**
- Create: `scanner/scripts/__init__.py`
- Create: `scanner/scripts/backfill_source_manager.py`
- Create: `scanner/tests/test_backfill_source_manager.py` (+5 cases)

**Interfaces:**
- Consumes: `httpx` (existing), `scanner.db.get_connection` (existing)
- Produces:
  - `python -m scanner.scripts.backfill_source_manager [--apply] [--limit N]` CLI
  - Default mode: dry-run (prints sample + count, no DB write)
  - `--apply` mode: runs the UPDATE in batches of 100

- [ ] **Step 1: Create `scanner/scripts/__init__.py`**

```bash
touch scanner/scripts/__init__.py
```

Empty file. Makes `scanner/scripts/` a Python package so `python -m scanner.scripts.backfill_source_manager` works.

- [ ] **Step 2: Write failing tests for backfill script**

Create `scanner/tests/test_backfill_source_manager.py`:

```python
import json
import pytest
from unittest.mock import MagicMock, patch

from scanner.db import get_connection
from scanner.scripts import backfill_source_manager as bsm


SAMPLE_CATALOG = {
    "node-a": {"reference": "https://github.com/OwnerA/RepoA"},
    "node-b": {"reference": "https://github.com/ownerb/repob"},
    "node-c": {"reference": "https://github.com/OwnerC/RepoC"},
}


def _seed_node(owner: str, repo: str, source_manager: bool = False) -> int:
    """Insert a node and return its id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (owner, repo, f"Name-{repo}", "alice", "desc", source_manager),
            )
            new_id = cur.lastrowid
        conn.commit()
    return new_id


@pytest.fixture
def fake_catalog():
    with patch.object(bsm, "fetch_manager_catalog", return_value=SAMPLE_CATALOG) as m:
        yield m


def test_dry_run_prints_sample_no_db_update(fresh_db, fake_catalog, capsys):
    """Default mode: print sample + count, no UPDATE."""
    _seed_node("OwnerA", "RepoA")  # in catalog, source_manager=false → candidate
    _seed_node("OwnerB", "RepoB")  # in catalog, source_manager=false → candidate
    _seed_node("Unrelated", "RepoX")  # NOT in catalog → not touched

    rc = bsm.main(argv=["--limit", "10"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "Found 2 nodes" in captured.out
    assert "Dry-run" in captured.out
    assert "Run with --apply" in captured.out

    # Verify no UPDATE happened
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM nodes WHERE source_manager = true")
            row = cur.fetchone()
    assert row["cnt"] == 0


def test_apply_mode_updates_source_manager(fresh_db, fake_catalog, capsys):
    """--apply flips source_manager=true for catalog matches."""
    a = _seed_node("OwnerA", "RepoA")
    b = _seed_node("OwnerB", "RepoB")
    x = _seed_node("Unrelated", "RepoX")

    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "Done." in captured.out
    assert "2 rows updated" in captured.out

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, source_manager FROM nodes WHERE id IN (%s, %s, %s)", (a, b, x))
            rows = {r["id"]: r["source_manager"] for r in cur.fetchall()}
    assert rows[a] == 1
    assert rows[b] == 1
    assert rows[x] == 0  # unrelated node untouched


def test_apply_is_idempotent(fresh_db, fake_catalog, capsys):
    """Second run after --apply finds 0 candidates."""
    _seed_node("OwnerA", "RepoA")

    bsm.main(argv=["--apply"])
    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "0 nodes to backfill" in captured.out


def test_unknown_node_not_touched(fresh_db, fake_catalog, capsys):
    """Node whose (owner, repo) is NOT in the catalog is not affected."""
    x = _seed_node("UnrelatedX", "RepoY")

    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT source_manager FROM nodes WHERE id = %s", (x,))
            row = cur.fetchone()
    assert row["source_manager"] == 0


def test_zero_candidates_exits_clean(fresh_db, fake_catalog, capsys):
    """Empty catalog of matches → exit 0 with friendly message."""
    _seed_node("Unrelated", "RepoX")

    rc = bsm.main(argv=["--limit", "5"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "0 nodes to backfill" in captured.out
    assert "Run with --apply" not in captured.out
```

`fresh_db` is the existing test fixture from `scanner/conftest.py`. If the fixture is named differently (e.g., `db_reset`), adjust accordingly.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd scanner && pytest tests/test_backfill_source_manager.py -v
```

Expected: 5 failures (`ImportError` on `scanner.scripts.backfill_source_manager`).

- [ ] **Step 4: Implement `scanner/scripts/backfill_source_manager.py`**

Create `scanner/scripts/backfill_source_manager.py`:

```python
"""One-shot backfill: flip source_manager=true for nodes already imported from
ComfyUI-Manager before Plan 5.1.3 added the source_manager column.

Usage:
  # Dry-run (default): print sample + count, no DB write
  python -m scanner.scripts.backfill_source_manager --limit 10

  # Apply: actually UPDATE the DB
  python -m scanner.scripts.backfill_source_manager --apply

Idempotent: re-running yields 0 candidates after the first apply.
"""

import argparse
import sys
import httpx

from scanner.db import get_connection


CATALOG_URL = (
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
)


def fetch_manager_catalog() -> dict:
    """Fetch live Manager catalog. Returns {key: {reference, title, ...}}."""
    resp = httpx.get(CATALOG_URL, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def parse_node_pairs(catalog: dict) -> set[tuple[str, str]]:
    """Return set of (LOWER(owner), LOWER(repo)) pairs from the catalog."""
    pairs: set[tuple[str, str]] = set()
    for entry in catalog.values():
        ref = entry.get("reference") or entry.get("id") or ""
        if "github.com" not in ref:
            continue
        tail = ref.split("github.com/", 1)[-1].strip("/")
        parts = tail.split("/")
        if len(parts) >= 2:
            pairs.add((parts[0].lower(), parts[1].lower()))
    return pairs


def find_candidates() -> list[dict]:
    """Return rows where (LOWER(owner), LOWER(repo)) is in the catalog and source_manager=false."""
    catalog = fetch_manager_catalog()
    pairs = parse_node_pairs(catalog)
    if not pairs:
        return []

    placeholders = ",".join(["(%s, %s)"] * len(pairs))
    flat = [v for pair in pairs for v in pair]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, github_owner, github_repo "
                f"FROM nodes "
                f"WHERE source_manager = false "
                f"AND (LOWER(github_owner), LOWER(github_repo)) IN ({placeholders})",
                flat,
            )
            return list(cur.fetchall())


def apply_update(node_ids: list[int]) -> int:
    """Batch UPDATE source_manager=true. Returns total affected rows."""
    affected = 0
    with get_connection() as conn:
        for i in range(0, len(node_ids), 100):
            batch = node_ids[i : i + 100]
            placeholders = ",".join(["%s"] * len(batch))
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE nodes SET source_manager = true WHERE id IN ({placeholders})",
                    batch,
                )
                affected += cur.rowcount
            conn.commit()
    return affected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill source_manager=true for nodes already imported from Manager before Plan 5.1.3."
    )
    parser.add_argument("--apply", action="store_true", help="Actually update the DB. Default is dry-run.")
    parser.add_argument("--limit", type=int, default=20, help="Sample size to print in dry-run (default 20).")
    args = parser.parse_args(argv)

    print("Fetching live Manager catalog...")
    candidates = find_candidates()
    print(f"Found {len(candidates)} nodes matching the catalog with source_manager=false")

    if not candidates:
        print("0 nodes to backfill. Exiting.")
        return 0

    if not args.apply:
        sample = candidates[: args.limit]
        print(f"\nDry-run. First {len(sample)} of {len(candidates)} candidates:")
        for row in sample:
            print(f"  - {row['github_owner']}/{row['github_repo']} (id={row['id']})")
        print(f"\nRun with --apply to update these {len(candidates)} nodes.")
        return 0

    print(f"Applying UPDATE to {len(candidates)} nodes...")
    node_ids = [c["id"] for c in candidates]
    affected = apply_update(node_ids)
    print(f"Done. {affected} rows updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Note: `main` accepts `argv` for testability. The module-level `if __name__ == "__main__":` block calls `main()` with no args (which uses `sys.argv`).

- [ ] **Step 5: Re-run tests to verify they pass**

```bash
cd scanner && pytest tests/test_backfill_source_manager.py -v
```

Expected: 5 passes.

- [ ] **Step 6: Run full pytest to confirm no regression**

```bash
cd scanner && pytest
```

Expected: 108 prior + 5 backfill = 113/113 pass.

- [ ] **Step 7: Run full vitest to confirm no cross-suite regression**

```bash
cd web && pnpm test
```

Expected: 243/243 pass (no web changes in this task).

- [ ] **Step 8: Smoke test the CLI directly**

```bash
cd scanner && python -m scanner.scripts.backfill_source_manager --limit 5
```

Expected: prints "Found N nodes matching the catalog..." with N matching the current dev DB state. No DB write.

```bash
cd scanner && python -m scanner.scripts.backfill_source_manager --apply
```

Expected: prints "Done. M rows updated." Then re-run:

```bash
cd scanner && python -m scanner.scripts.backfill_source_manager --limit 5
```

Expected: prints "0 nodes to backfill. Exiting." (idempotent).

- [ ] **Step 9: Commit**

```bash
git add scanner/scripts/__init__.py scanner/scripts/backfill_source_manager.py \
        scanner/tests/test_backfill_source_manager.py
git commit -m "feat(backfill): one-shot CLI to mark pre-Plan-5.1.3 nodes source_manager=true (Plan 5.1.4)"
```

---

## Final Verification (post-Task 5)

- [ ] **Full test suites**

```bash
cd scanner && pytest           # expect 113/113 pass
cd web && pnpm test            # expect 243/243 pass
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint            # 13 pre-existing warnings acceptable
```

- [ ] **Manual smoke**

- Wait for next 05:00 UTC beat (or trigger manually: `cd scanner && celery -A scanner.celery_app call scanner.tasks.sync_manager_catalog`)
- Visit `/admin` → verify "Last synced at: X 分钟前 (2026-08-09 HH:MM UTC)" appears next to ManagerSyncButton
- Run `python -m scanner.scripts.backfill_source_manager --limit 10` → verify sample + count
- Run `python -m scanner.scripts.backfill_source_manager --apply` → verify affected rows
- Verify in dev DB: `npx prisma studio` → confirm `scan_runs` table populated; `nodes.source_manager=true` count increased

- [ ] **Final whole-branch review** dispatched by orchestrator before push.

---

## Out of Scope (NOT in this plan)

- Sync history / audit table UI (v2)
- "Syncing..." state indicator while a run is active
- Counts summary badge ("Last synced: 5 added, 3 updated")
- Auto-refresh / SSE / polling for the indicator
- Env-var configurable cron for the beat schedule
- Manager `models-list.json` / `extension-node-map.json` integration
- Auto-approve well-known Manager entries
- Manager-vs-weekly-scan metadata conflict resolution
- Filter / search `/admin/submissions` by source
- Backfill from sources other than the live catalog (e.g., historical sync logs)

---

## Self-Review Notes

### Spec coverage

| Spec section / requirement | Covered by task |
|---|---|
| scan_runs table schema | Task 1 |
| `insert_scan_run` helper | Task 2 |
| `insert_scan_run` does-not-raise test | Task 2 |
| scan_runs `counts` summary only | Task 2 (sync task writes only summary) |
| scan_runs `error` truncation | Task 2 (insert_scan_run truncates to 1024) |
| sync task writes scan_runs | Task 2 |
| `getLatestScanRun` Prisma wrapper | Task 3 |
| `AdminHomeClient` extraction | Task 3 |
| `LastSyncedAt` component | Task 4 |
| Indicator placement on /admin | Task 4 |
| Display format (relative + absolute) | Task 4 |
| "never ran" fallback | Task 4 |
| Backfill CLI script | Task 5 |
| Default dry-run + `--apply` | Task 5 |
| `--limit N` flag | Task 5 |
| Idempotency | Task 5 |
| Tests (pytest + vitest) | Tasks 1-5 |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later" markers. All concrete file paths and code.

### Type consistency

- `ScanRunSummary` matches between `web/lib/scan-runs.ts` shape and `LastSyncedAt` props (only `finishedAt` consumed).
- `counts` JSON shape (`Record<string, number>`) consistent across `scanner/db.py` insertion and `web/lib/scan-runs.ts` consumption.
- `insert_scan_run` signature `(task_name, started_at, finished_at, status, counts, error=None)` identical between spec definition and `sync_manager_catalog.py` finally block.
- `main(argv: list[str] | None = None)` shape consistent between script definition and test usage.

### Risks surfaced during planning

- **Pre-existing `ThemeToggle.test.tsx` TS error** — Task 4's `tsc --noEmit` may surface it. Acceptable; Plan 5.1.3 baseline.
- **Pre-existing 13 lint warnings** — Task 4's `pnpm lint` may show them. Acceptable; Plan 5.1.3 baseline.
- **Pre-existing Prisma 5.22.x + MySQL P1014 race** — affects Task 1 dev DB verification. Reset DB if needed; environmental flake.
- **Admin page test renders server component** — Task 4 Step 6 uses `await AdminPage()` then renders. If the project's existing test infrastructure doesn't support this pattern, fall back to a simpler test that just asserts the page exports a function (matches what Task 5 of Plan 5.1.3 did for `approveSubmission`).
- **Backfill SELECT with very large catalog** — `IN (..., ...)` placeholder count scales with catalog size. If catalog grows past ~10k entries, may exceed MySQL's `max_allowed_packet` for the prepared statement. The 100-batch UPDATE is independent of this. Deferred: chunked SELECT.
- **Concurrent sync + backfill** — both write `source_manager=true`. Last-writer-wins; idempotent at row level. No coordination needed.
- **`scan_runs` write contention** — only one writer per Celery task; no concurrency issue.
- **Backfill UI** — script only, no UI button. The script is a one-shot ops tool; not part of the admin surface.
