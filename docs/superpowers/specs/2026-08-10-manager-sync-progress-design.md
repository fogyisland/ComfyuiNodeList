# Manager sync — automatic progress feedback (button + status polling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this spec task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/admin`, after the admin clicks the "同步 Manager 目录" button, the UI automatically reflects when the sync completes (success or failure) and updates `LastSyncedAt` — without the admin manually refreshing the page.

**Architecture:** Extend `scan_runs` to carry an in-flight `running` row (write at Celery-task start, update on completion), expose a small GET status endpoint, and have `ManagerSyncButton` poll that endpoint with adaptive backoff until the row resolves to `ok` or `failed` (or hits a 180s timeout).

**Tech Stack:**
- Next.js 14+ app router (existing)
- React 18 (existing)
- Prisma 5 + MySQL (existing)
- TypeScript (existing)
- Celery 5 + Redis (existing)
- `vi.useFakeTimers()` for component polling tests

## Context

Plan 5.1.3 introduced a daily `sync_manager_catalog` Celery task (5:00 UTC, env-overridable via `CELERY_SYNC_MANAGER_CATALOG_CRON` since the Plan 5.1.3 followup commit `d80e53d`). Plan 5.1.4 added the `scan_runs` table and the `LastSyncedAt` UI that reads the most recent successful run. The admin "同步 Manager 目录" button on `/admin` exists but:

- The button POSTs to `/api/v1/admin/manager/sync` and immediately returns 202 with a `task_id`. There is no in-process signal that the task completed.
- `LastSyncedAt` is a server-rendered prop on initial page load only — `ManagerSyncButton` does not trigger `router.refresh()`.
- Result: an admin who clicks the button sees a transient "已加入队列" toast, then nothing. The page still shows the old "Last synced at: 5 hours ago" until the admin manually reloads.

This spec is the next followup listed in `docs/superpowers/specs/2026-08-09-manager-sync-visibility-design.md`'s `§Followups`:

> Background polling or SSE for admin button

We chose client polling (not SSE) and an in-DB `running` sentinel row (not a Celery-inspect endpoint) — see `§Design` below.

## Global Constraints

- **Single source of truth for sync state:** `scan_runs` table. `LastSyncedAt` and `ManagerSyncButton`'s polling both read from the same table.
- **No new external dependencies.** No new Python packages, no new npm packages, no Redis pub/sub, no WebSocket infrastructure.
- **No new tables.** Only an in-place column nullability change on `scan_runs.finished_at`.
- **Status values are free strings, not a Prisma enum** (matches the existing column `String @db.VarChar(16)`). Allowed: `'running'`, `'ok'`, `'failed'`. Application-layer invariant: `status='running' ↔ finished_at IS NULL` and `status ∈ {'ok','failed'} ↔ finished_at IS NOT NULL`. No DB CHECK constraint — keep migrations minimal.
- **Polling stops on terminal state.** When the polled row resolves to `ok` or `failed`, the component clears the timer. When the page unmounts, the timer is also cleared. No leaked `setTimeout`s.
- **Adaptive polling interval:** 1s × 2, then 5s. Max duration: 180s. On timeout, show "仍在后台运行" and let the user refresh manually.
- **Concurrent clicks are allowed.** Two admins (or two tabs) clicking simultaneously writes two `running` rows; both sync tasks proceed independently. We do not introduce a global "is anything running" disable — `ManagerSyncButton` remains per-tab responsive.
- **DB-write failures must not crash the sync.** If `start_scan_run` fails, the Celery task continues without recording a row. If `complete_scan_run` fails, the row is stuck in `running` until manually fixed — surfaced as a stuck state by the polling endpoint.
- **API endpoint is admin-only.** 401 on missing/non-admin session. `Cache-Control: no-store` on responses (polling must see fresh state).
- **Style:** Reuse existing Tailwind classes consistent with `web/app/(admin)/_components/ManagerSyncButton.tsx` and `web/app/_components/LastSyncedAt.tsx`.

## Design

### Data flow

```
Admin clicks "同步 Manager 目录"
  │
  ▼
ManagerSyncButton (client): POST /api/v1/admin/manager/sync
  │  (existing route, returns 202 + { status, task_id })
  ▼
Next.js route proxies to ${SCANNER_TRIGGER_API_URL}/trigger-manager-sync
  │  (existing, no change here)
  ▼
External scanner service dispatches Celery task sync_manager_catalog
  │
  ▼
Celery task: start_scan_run('sync_manager_catalog') → INSERT row (status='running', finished_at=NULL)
  │
  ▼ (running... typically 30–60s, occasionally longer)
  │
Celery task (finally): complete_scan_run(run_id, status, counts, error)
  → UPDATE same row → status='ok' or 'failed', finished_at=NOW(), counts, error
  │
  ▼
ManagerSyncButton polling (every 1s × 2, then 5s, max 180s):
  GET /api/v1/admin/manager/sync/status
  │  returns { run: { id, status, startedAt, finishedAt, error } } | { run: null }
  ▼
On status ∈ {ok, failed}:
  - if ok:   setPhase(done, status=ok);   router.refresh()  → LastSyncedAt re-renders with new row
  - if fail: setPhase(done, status=failed, error=run.error)
On 180s timeout:
  - setPhase(timeout) → "仍在后台运行,刷新页面查看"
```

### Schema change

`web/prisma/schema.prisma`:

```prisma
model ScanRun {
  id          BigInt    @id @default(autoincrement())
  task_name   String    @db.VarChar(64)
  started_at  DateTime  @db.DateTime(3)
  finished_at DateTime? @db.DateTime(3)   // was: DateTime (NOT NULL) — now nullable
  status      String    @db.VarChar(16)   // 'running' | 'ok' | 'failed'
  counts      Json?
  error       String?   @db.Text
  @@index([task_name, finished_at(sort: Desc)])
  @@map("scan_runs")
}
```

Generated migration:

```sql
ALTER TABLE scan_runs MODIFY COLUMN finished_at DATETIME(3) NULL;
```

**Affected queries (all continue to work):**

- `getLatestScanRun` filters `status: 'ok'` → `finished_at IS NOT NULL` is implied by the `status` filter, no change needed.
- `LastSyncedAt` reads via `getLatestScanRun` → no change.
- `AdminDashboard` reads via `getLatestScanRun` → no change.
- `backfill_source_manager` CLI (Plan 5.1.4 Task 5) only writes complete rows with `status='ok'` → no change.

### Scanner helpers (`scanner/db.py`)

Three new module-level functions. `insert_scan_run` is kept for backfill / one-shot scripts that write a complete row in one shot.

```python
from datetime import datetime
from sqlalchemy import text
from scanner.db import get_engine
import json


def start_scan_run(task_name: str) -> int:
    """Insert a 'running' sentinel row. Returns run_id.

    finished_at is NULL while the task is in flight; complete_scan_run
    will fill it in. Application-layer invariant:
        status='running' ↔ finished_at IS NULL
    """
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
    status: str,            # 'ok' or 'failed'
    counts: dict,
    error: str | None = None,
) -> None:
    """Update the 'running' row written by start_scan_run to its final state."""
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
    """Return the most recent run regardless of status. None if no rows.

    Polling endpoint uses this. finished_at is None when status='running'.
    """
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
        "finished_at": row.finished_at,  # None if running
        "error": row.error,
        "counts": json.loads(row.counts) if row.counts else None,
    }
```

### Celery task change (`scanner/tasks/sync_manager_catalog.py`)

Replace the `insert_scan_run` call in `finally` with `start_scan_run` at the top + `complete_scan_run` in `finally`. DB-write failures degrade gracefully.

```python
@celery_app.task(name="scanner.tasks.sync_manager_catalog")
def sync_manager_catalog() -> dict:
    started_at = datetime.utcnow()
    summary = {"inserted": 0, "updated": 0, "skipped": 0, "errors": []}
    error_msg: str | None = None
    status = "ok"

    # Write the 'running' sentinel row first. If the DB is unavailable,
    # proceed anyway — the sync itself is more important than the audit row.
    try:
        run_id = start_scan_run("sync_manager_catalog")
    except Exception:
        run_id = None
        logger.exception("start_scan_run failed; sync proceeds without scan_runs row")

    try:
        # ... existing fetch / dedupe / upsert logic, unchanged ...
        pass
    except Exception as exc:
        status = "failed"
        error_msg = (str(exc) + "\n" + traceback.format_exc())[:1024]
        summary["errors"].append(str(exc)[:200])
        logger.exception("sync_manager_catalog failed")
    finally:
        if run_id is not None:
            complete_scan_run(run_id, status, summary, error_msg)

    return summary
```

The existing `insert_scan_run` helper and its single test (Plan 5.1.4 Task 2) remain — backfill / one-shot scripts still call it. The new flow lives alongside.

### Web lib (`web/lib/scan-runs.ts`)

Add `getLatestScanRunAnyStatus` next to the existing `getLatestScanRun`. The existing function is unchanged; this is purely additive.

```ts
import { prisma } from '@/lib/db';

// existing: getLatestScanRun(taskName) — status='ok' filter, no change
// new:
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

### New API endpoint (`web/app/api/v1/admin/manager/sync/status/route.ts`)

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
      status: run.status,                           // 'running' | 'ok' | 'failed'
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null,  // null if running
      error: run.error ?? null,
    },
  });
}
```

Response shape:

- `200 { run: null }` — no sync has ever run.
- `200 { run: { id, status, startedAt, finishedAt, error } }` — most recent row.
- `401 { error: 'admin auth required' }` — no auth / non-admin.

`Cache-Control: no-store` is implied by `dynamic = 'force-dynamic'` + `revalidate = 0`. Polling must always see fresh state.

### `ManagerSyncButton` state machine

```ts
type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }                          // POST in flight
  | { kind: 'polling'; startedAt: number }          // GET status loop
  | { kind: 'done'; status: 'ok' | 'failed'; error?: string }
  | { kind: 'timeout' };
```

Click handler:

```ts
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

  const startedAt = Date.now();
  setPhase({ kind: 'polling', startedAt });
  poll(status => {
    if (status === 'ok') {
      router.refresh();  // re-fetch server data so LastSyncedAt shows new row
      setPhase({ kind: 'done', status: 'ok' });
    } else if (status === 'failed') {
      setPhase({ kind: 'done', status: 'failed', error: lastErrorRef.current ?? '同步失败' });
    }
  });
}
```

Polling loop:

```ts
function poll(onTerminal: (status: 'ok' | 'failed') => void) {
  const TIMEOUT_MS = 180_000;
  // Adaptive: 1s × 2, then 5s thereafter. Cap at 5s.
  const intervals = [1000, 1000, 5000];
  let i = 0;
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    if (Date.now() - start > TIMEOUT_MS) {
      setPhase({ kind: 'timeout' });
      return;
    }
    try {
      const res = await fetch('/api/v1/admin/manager/sync/status', { cache: 'no-store' });
      if (res.ok) {
        const { run } = await res.json();
        if (run && (run.status === 'ok' || run.status === 'failed')) {
          if (run.status === 'failed') lastErrorRef.current = run.error;
          onTerminal(run.status);
          return;
        }
        // run === null OR run.status === 'running' → keep polling
      }
    } catch {
      // Network blip: keep polling. Next tick may recover.
    }
    setTimeout(tick, intervals[Math.min(i++, intervals.length - 1)]);
  };

  tick();
  return () => { cancelled = true; };  // cleanup
}
```

UI per phase:

| Phase | Button label | Disabled | Message area |
|---|---|---|---|
| `idle` | "同步 Manager 目录" | no | — |
| `submitting` | "触发中…" | yes | — |
| `polling` | "同步中… (Xs)" | yes | (timer rendered inside button) |
| `done` ok | "同步 Manager 目录" | no | "已同步" (green) |
| `done` failed | "重试" | no | error text (red) |
| `timeout` | "同步 Manager 目录" | no | "仍在后台运行,刷新页面查看" (muted) |

`useEffect` cleanup: when the component unmounts, call the returned cancel function from `poll` so no `setState` runs on an unmounted component.

The component does not trigger a server re-render during `submitting` or `polling` — only on `done` ok (one `router.refresh()` call).

## File Structure

- **Modify:** `web/prisma/schema.prisma` (one column nullability change)
- **Create migration:** `web/prisma/migrations/<timestamp>_scan_runs_finished_at_nullable/migration.sql`
- **Modify:** `scanner/db.py` (~50 new lines: 3 helpers)
- **Modify:** `scanner/tasks/sync_manager_catalog.py` (~10 line changes: start_scan_run at top, complete_scan_run in finally)
- **Modify:** `web/lib/scan-runs.ts` (~10 new lines: getLatestScanRunAnyStatus)
- **Create:** `web/app/api/v1/admin/manager/sync/status/route.ts` (~25 lines: GET handler)
- **Modify:** `web/app/(admin)/_components/ManagerSyncButton.tsx` (~60 line changes: state machine + polling)
- **Create:** `scanner/tests/test_db_scan_runs.py` (~80 lines: 3 helpers)
- **Modify:** `scanner/tests/test_sync_manager_catalog.py` (~30 lines: start + complete integration)
- **Create:** `web/tests/lib/scan-runs-any-status.test.ts` (~40 lines: helper unit tests)
- **Create:** `web/tests/api/manager-sync-status.test.ts` (~80 lines: 4 endpoint cases)
- **Create:** `web/tests/_components/ManagerSyncButton.test.tsx` (~150 lines: 6+ cases)

## Test Plan

### `scanner/tests/test_db_scan_runs.py` (new)

1. `test_start_scan_run_writes_running_row` — call `start_scan_run('sync_manager_catalog')`; assert row exists with `status='running'`, `finished_at IS NULL`, `started_at` within last 5s.
2. `test_complete_scan_run_updates_to_ok` — start, then complete with `status='ok'`; assert `finished_at IS NOT NULL`, `status='ok'`, `counts` JSON round-trips.
3. `test_complete_scan_run_updates_to_failed_with_error` — start, then complete with `status='failed', error='boom'`; assert `error` persists.
4. `test_get_latest_scan_run_any_status_returns_running_row` — start; assert `get_latest_scan_run_any_status(...)['status'] == 'running'` and `finished_at is None`.
5. `test_get_latest_scan_run_any_status_returns_none_when_empty` — no rows; assert `None`.

### `scanner/tests/test_sync_manager_catalog.py` (extend)

6. `test_sync_writes_running_row_at_start` — mock the catalog fetch + DB writes; invoke task; assert `start_scan_run` called once with `'sync_manager_catalog'` and a `running` row is visible.
7. `test_sync_updates_row_to_ok_on_success` — full happy path; assert the `running` row transitions to `ok` with the expected counts.
8. `test_sync_updates_row_to_failed_on_exception` — make the catalog fetch raise; assert the row ends in `failed` with `error` populated and the existing `assert 1024-char truncation` invariant still holds.

### `web/tests/lib/scan-runs-any-status.test.ts` (new)

9. `test_getLatestScanRunAnyStatus_returns_latest_any_status` — seed one `ok` row + one `running` row (newer); assert the running row is returned (newer `started_at` wins regardless of status).
10. `test_getLatestScanRunAnyStatus_returns_null_when_no_rows` — assert `null`.

### `web/tests/api/manager-sync-status.test.ts` (new)

11. `test_returns_401_without_admin_auth` — mock `requireAdmin` to return null; assert 401.
12. `test_returns_run_null_when_no_runs` — admin authenticated, table empty; assert `{ run: null }`.
13. `test_returns_running_row_with_null_finishedAt` — seed a running row; assert `status='running'`, `finishedAt=null`.
14. `test_returns_completed_row_with_finishedAt` — seed an `ok` row; assert `status='ok'`, `finishedAt` is an ISO string.
15. `test_response_includes_no_store_cache_header` — assert `Cache-Control: no-store` (or equivalent) on the response.

### `web/tests/_components/ManagerSyncButton.test.tsx` (new)

16. `test_idle_state_renders_initial_button` — render; assert "同步 Manager 目录" present, no polling.
17. `test_click_transitions_through_polling_to_done_ok` — fake timers; click; fast-forward past two 1s + one 5s tick; mock status returns `ok` on third tick; assert `router.refresh` called once, button label reverts.
18. `test_click_transitions_to_done_failed_with_error` — same setup, mock returns `failed` with `error='boom'`; assert red error message.
19. `test_polling_times_out_at_180s` — fake timers; mock status always returns `running`; advance past 180s; assert `timeout` phase message rendered.
20. `test_polling_handles_fetch_error_gracefully` — mock `fetch` to reject on status endpoint; assert no crash, polling continues.
21. `test_unmount_clears_pending_timer` — start polling, unmount before terminal; assert no "setState on unmounted" warning (use vi.spyOn on console.error).

## Acceptance Criteria

- [ ] `scan_runs.finished_at` is nullable; one migration applies cleanly to the dev DB
- [ ] `start_scan_run` writes a row with `status='running'`, `finished_at=NULL`
- [ ] `complete_scan_run` updates that row to `ok` or `failed` with `finished_at=NOW()`
- [ ] `get_latest_scan_run_any_status` returns the newest row regardless of status, with `finished_at` as `None` for running rows
- [ ] `sync_manager_catalog` Celery task calls `start_scan_run` at the top, `complete_scan_run` in `finally`; existing 1024-char error truncation invariant preserved
- [ ] DB failures during `start_scan_run` or `complete_scan_run` do not crash the task
- [ ] `GET /api/v1/admin/manager/sync/status` returns 401 without admin auth, 200 with `{ run: null }` when no rows, 200 with the latest run otherwise
- [ ] Response includes `Cache-Control: no-store` (or the endpoint is `force-dynamic`)
- [ ] `ManagerSyncButton` transitions through `submitting → polling → done` on click; `router.refresh()` is called exactly once on `done ok`
- [ ] Polling interval is 1s × 2, then 5s; total budget is 180s; on timeout the button shows "仍在后台运行" and remains clickable
- [ ] Component unmount cancels the polling timer (no leaked setTimeouts)
- [ ] `LastSyncedAt` automatically reflects the new "last synced" timestamp after a successful click, without a manual page refresh
- [ ] Pre-existing tests still pass (vitest baseline 252 + ~16 new = ~268; pytest baseline 115 + ~8 new = ~123)
- [ ] Pre-existing `ThemeToggle.test.tsx:11` TS error + 13 lint warnings remain unchanged (not in scope)
- [ ] No new dependencies in `package.json` or `pyproject.toml`
- [ ] No new tables, no new npm packages, no new Python packages

## Out of Scope (NOT in this spec)

- Sync progress percentage / progress bar (we only know in-flight or done, not how much work is left)
- Multi-task parallel display (only `sync_manager_catalog` is polled; mirrors `LastSyncedAt`)
- Pushing sync progress to other admin pages (only `/admin` reflects progress)
- WebSocket / SSE (decision: polling)
- Cancelling a running Celery task
- Modifying the daily beat schedule (Plan 5.1.3 + followup `d80e53d` already cover this)
- Server-side `INSERT ... NOW()` for `started_at` (kept consistent with existing `datetime.utcnow()` calls)
- `error` field length cap (already 1024 chars per Plan 5.1.4; not redefined here)
- `complete_scan_run` retry on DB failure (just log + continue)
- Multi-admin role / operation audit
- Auto-refresh of `/admin` page during a sync running in another tab (admin still has to switch tabs to see it)
- Stuck-running detection / reconciliation (a `running` row with no corresponding Celery task is a known minor concern but not a blocker for this spec)

## Self-Review Notes

### Spec coverage

| Spec section / requirement | Covered by |
|---|---|
| scan_runs nullable finished_at | §Schema change; Test 1 |
| start_scan_run / complete_scan_run helpers | §Scanner helpers; Tests 1–3 |
| get_latest_scan_run_any_status | §Scanner helpers; Tests 4–5 |
| Celery task integration | §Celery task change; Tests 6–8 |
| Web lib wrapper | §Web lib; Tests 9–10 |
| GET status endpoint | §New API endpoint; Tests 11–15 |
| ManagerSyncButton state machine | §State machine; Tests 16–21 |
| Polling interval + timeout | §State machine (1s × 2, 5s, 180s) |
| Concurrent clicks allowed | §Global Constraints |
| DB failure tolerance | §Global Constraints; §Celery task change |
| router.refresh on done ok | §State machine |
| LastSyncedAt auto-update | §Data flow (after `router.refresh`) |
| No new dependencies | §Global Constraints; §Acceptance Criteria |
| No new tables | §Global Constraints; §Acceptance Criteria |
| Pre-existing test errors stay out of scope | §Acceptance Criteria |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later", or vague directives. All filenames and interfaces are concrete.

### Type consistency

- `Phase` discriminated union in `ManagerSyncButton` is consistent with the polling helper's return type.
- `getLatestScanRunAnyStatus` returns Prisma's `ScanRun | null`; the route handler maps to the API response shape (camelCase, ISO dates, `finished_at → finishedAt | null`).
- `start_scan_run` / `complete_scan_run` use the same column names as the Prisma model (`task_name`, `started_at`, `finished_at`, `status`, `counts`, `error`).
- `get_latest_scan_run_any_status` returns snake_case keys (Python convention) to match the existing `insert_scan_run` return shape.

### Risks surfaced

- **Stuck `running` rows:** If a Celery worker crashes mid-sync after `start_scan_run` but before `complete_scan_run`, the row stays at `status='running'` forever. Subsequent syncs will create new rows, so the `LastSyncedAt` display isn't blocked. The polling endpoint will keep returning `running` for that orphan row until the next sync starts. Documented in `§Out of Scope` (stuck-running reconciliation is deferred).
- **Polling cost:** Worst case 180s × 1 request per ~5s ≈ 36 requests per click. With admin-only auth, the surface is small. No rate-limiting concern.
- **Race: client unmount mid-poll.** Handled by the `cancelled` flag in the polling closure.
- **Migration on live DB:** Altering `finished_at` to nullable on a table that already has rows is a fast metadata-only operation in MySQL 8.0 (no table rewrite). No production-downtime risk.
- **LastSyncedAt re-render:** `router.refresh()` re-fetches the entire page server-side. This is heavier than ideal, but consistent with the existing pattern (Plan 5.1.4 already used `router.refresh()` in `ManagerSyncButton`'s earlier version before this spec). Optimizing to a targeted refetch of just `getLatestScanRun` is out of scope.
