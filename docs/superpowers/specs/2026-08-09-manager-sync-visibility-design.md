# Manager sync visibility — Design

> **For agentic workers:** This document is a design spec — implementation steps come in a separate plan.

**Goal:** Close two Plan 5.1.3 followups that block operational visibility of the daily ComfyUI-Manager catalog sync: (a) a one-shot backfill script that marks pre-existing nodes as `source_manager=true`, and (b) a "Last synced at" indicator on `/admin` showing when the most recent sync completed.

**Architecture:** Add a new MySQL `scan_runs` table (parallel to existing `scan_failures`) that records each Celery task's start/finish/status/counts. Extend `sync_manager_catalog` to write one row at the end of every run. Add a CLI script under `scanner/scripts/` that scans the live Manager catalog, identifies nodes already in `nodes` with `source_manager=false`, and updates them in batches (`--apply` flag, default dry-run). Build a small `<LastSyncedAt>` React component that fetches the latest successful run server-side and renders relative + absolute timestamp next to the existing `ManagerSyncButton`.

**Tech Stack:**
- Python 3.11+ / Celery 5 / Redis (existing scanner infra)
- `httpx`, `pymysql`, `urllib.parse` (existing)
- Prisma 5 / MySQL 8 (existing)
- Next.js 15 / React 19 (existing)
- Vitest 2 + jsdom 30 (existing test infra)
- pytest + pytest-httpx (existing test infra)
- No new dependencies

---

## Context

Plan 5.1.3 (Manager sync operational) shipped four followups deferred in its spec §Out of Scope:

1. **Backfill `nodes.source_manager = true` for nodes already imported from Manager before this spec** — one-shot migration helper
2. **"Last synced at" indicator on `/admin` next to `ManagerSyncButton`** — useful once beat schedule is active

This spec closes those two. The other 7 followups (env-var cron override, models-list.json integration, auto-approve well-known entries, sync history / audit table, sync error UI, Manager-vs-weekly-scan metadata conflict, filter / search by source) remain deferred.

### Why this matters

Without backfill, the `source_manager` column is "monotonic from 2026-08-09 onwards" — nodes imported from Manager before this date carry `source_manager=false`, which makes the UI badge (Plan 5.1.3 Task 7) underreport. Operators can't tell which existing nodes came from Manager.

Without the "Last synced at" indicator, `/admin` shows the `ManagerSyncButton` but no signal whether the beat schedule is healthy. Users have to `cd scanner && celery -A scanner.celery_app call scanner.tasks.sync_manager_catalog` manually to verify.

---

## Global Constraints

Verbatim binding requirements — every task's requirements implicitly include this section:

- **scan_runs table:** `id BIGINT PRIMARY KEY`, `task_name VARCHAR(64) NOT NULL`, `started_at DATETIME(3) NOT NULL`, `finished_at DATETIME(3) NOT NULL`, `status VARCHAR(16) NOT NULL` ('ok' | 'failed'), `counts JSON`, `error TEXT NULL`. Index `(task_name, finished_at DESC)`. No new tables other than `scan_runs`.
- **scan_runs writes are best-effort:** `insert_scan_run` failures inside `finally` log a warning and do NOT re-raise (a finally-block raise would mask the original exception). Tests assert `insert_scan_run` returns -1 on DB blip and the caller does not raise.
- **scan_runs `counts` only stores summary metrics:** `added`, `skipped_existing`, `skipped_pending`, `updated_nodes`, `errors_count`. NOT the full `errors: [...]` list (that lives in `scan_failures`).
- **scan_runs `error` field** stores the first error message truncated to 1024 chars when `status='failed'`, else NULL.
- **"Last synced at"** reads `prisma.scanRun.findFirst({ where: { task_name: 'sync_manager_catalog', status: 'ok' }, orderBy: { finished_at: 'desc' } })`. Returns null when no successful run exists.
- **"Last synced at" UI placement:** On `/admin` page, immediately adjacent to the existing `ManagerSyncButton` (left side or right side based on layout). Renders `<LastSyncedAt run={latestRun} />` component.
- **"Last synced at" display format:** Relative + absolute. Default text: "X 分钟前 (YYYY-MM-DD HH:MM UTC)". When `run === null`, render "Manager sync never ran" in muted styling. No SSE / no auto-refresh — page reload only.
- **"Last synced at" is server-side:** `app/admin/page.tsx` is a server component that fetches `latestRun` and passes it as prop. The `LastSyncedAt` component receives the run as a prop; client does not query the DB.
- **Sync task gating:** Existing `sync_manager_catalog` logic is unchanged. The only addition is a `try/finally` block that records `started_at` at the top and writes a `scan_runs` row at the end. No new branches / no new error handling. The existing `errors` list inside `counts` is reduced to `errors_count` integer for the scan_runs row.
- **Backfill script:** `scanner/scripts/backfill_source_manager.py`. Default mode is dry-run. `--apply` flag commits. `--limit N` caps the sample printed in dry-run (default 20). Both modes accept `--limit`. The script is idempotent (re-running yields 0 work). It uses the existing `httpx` + `urllib.parse` fetch logic — no new dependencies.
- **Backfill heuristic:** Pull the live Manager catalog (same URL as `sync_manager_catalog` uses), build a set of `(LOWER(github_owner), LOWER(github_repo))` pairs. Find nodes where the pair is in the set AND `source_manager=false`. UPDATE in batches of 100 with a connection-per-batch commit.
- **Backfill gate:** The script does NOT mark `source_manager=true` for nodes that match the catalog pair but already have `source_manager=true`. Idempotent.
- **Manual button preserved:** `POST /api/v1/admin/manager/sync` and the trigger_api endpoint remain unchanged. The script is independent.
- **No new dependencies.** Same `httpx`, `pymysql`, `urllib.parse`, Prisma client, Next.js, React as Plan 5.1.3.
- **No UI tests beyond** what this spec specifies (3 `LastSyncedAt` cases + 2 admin page cases + 1 `scan-runs` test = 6 vitest cases).
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
| `web/lib/scan-runs.ts` | Create | `get_latest_scan_run(task_name) -> ScanRun \| null` (Prisma client wrapper) |
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

## Components & Interfaces

### `scanner/db.py::insert_scan_run`

```python
def insert_scan_run(
    task_name: str,
    started_at: datetime,
    finished_at: datetime,
    status: str,
    counts: dict[str, int],
    error: str | None = None,
) -> int:
    """Insert a scan_runs row. Returns new id, or -1 if DB write fails.

    Safe to call from a finally block: failures are logged but not raised.
    """
```

- Truncates `error` to 1024 chars
- Serializes `counts` to JSON
- Returns `cur.lastrowid` on success, `-1` on `pymysql.Error`

### `scanner/tasks/sync_manager_catalog.py` change

```python
def sync_manager_catalog() -> dict:
    counts = {"added": 0, "skipped_existing": 0, "skipped_pending": 0, "updated_nodes": 0, "errors": []}
    started_at = datetime.utcnow()
    status = "ok"
    try:
        # ... existing fetch, parse, dedup, insert, update logic ...
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
    return counts  # preserved for backward compat with callers
```

### `scanner/scripts/backfill_source_manager.py`

```python
import argparse
import json
import sys
import time
import httpx
from scanner.db import get_connection


CATALOG_URL = "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"


def fetch_manager_catalog() -> dict:
    """Fetch live Manager catalog. Returns {key: {reference, title, ...}}."""
    resp = httpx.get(CATALOG_URL, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def parse_node_pairs(catalog: dict) -> set[tuple[str, str]]:
    """Return set of (LOWER(owner), LOWER(repo)) pairs."""
    pairs = set()
    for entry in catalog.values():
        ref = entry.get("reference") or entry.get("id") or ""
        if "github.com" in ref:
            parts = ref.split("github.com/")[-1].strip("/").split("/")
            if len(parts) >= 2:
                pairs.add((parts[0].lower(), parts[1].lower()))
    return pairs


def find_candidates() -> list[dict]:
    """Return nodes where (owner, repo) is in catalog but source_manager=false."""
    pairs = parse_node_pairs(fetch_manager_catalog())
    if not pairs:
        return []
    with get_connection() as conn:
        with conn.cursor() as cur:
            placeholders = ",".join(["(%s, %s)"] * len(pairs))
            flat = [v for pair in pairs for v in pair]
            cur.execute(
                f"SELECT id, github_owner, github_repo FROM nodes "
                f"WHERE source_manager = false AND (LOWER(github_owner), LOWER(github_repo)) IN ({placeholders})",
                flat,
            )
            return list(cur.fetchall())


def apply_update(node_ids: list[int]) -> int:
    """Batch UPDATE source_manager=true. Returns total affected rows."""
    affected = 0
    with get_connection() as conn:
        for i in range(0, len(node_ids), 100):
            batch = node_ids[i:i+100]
            placeholders = ",".join(["%s"] * len(batch))
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE nodes SET source_manager = true WHERE id IN ({placeholders})",
                    batch,
                )
                affected += cur.rowcount
            conn.commit()
    return affected


def main():
    parser = argparse.ArgumentParser(description="Backfill source_manager for nodes already imported from Manager before Plan 5.1.3.")
    parser.add_argument("--apply", action="store_true", help="Actually update the DB. Default is dry-run.")
    parser.add_argument("--limit", type=int, default=20, help="Sample size to print in dry-run (default 20).")
    args = parser.parse_args()

    print("Fetching live Manager catalog...")
    candidates = find_candidates()
    print(f"Found {len(candidates)} nodes matching the catalog with source_manager=false")

    if not candidates:
        print("0 nodes to backfill. Exiting.")
        return 0

    if not args.apply:
        sample = candidates[:args.limit]
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

### `web/lib/scan-runs.ts`

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

### `web/app/_components/LastSyncedAt.tsx`

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
      Last synced at: <span className="font-medium text-gray-700">{relativeTime(run.finishedAt)}</span>
      <span className="ml-1 text-gray-400" title={absoluteTime(run.finishedAt)}>
        ({absoluteTime(run.finishedAt)})
      </span>
    </span>
  );
}
```

### `web/app/admin/page.tsx` change

```tsx
import { ManagerSyncButton } from './ManagerSyncButton';
import { AdminHomeClient } from './AdminHomeClient';
import { getLatestScanRun } from '@/lib/scan-runs';

export default async function AdminPage() {
  const latestRun = await getLatestScanRun('sync_manager_catalog');
  return (
    <main>
      <h1>管理后台</h1>
      <AdminHomeClient latestRun={latestRun} />
    </main>
  );
}
```

(If `page.tsx` is currently a server component with inline JSX, the change is to wrap the existing JSX in `<AdminHomeClient>` and pass `latestRun` as a prop. The `ManagerSyncButton` stays inside `AdminHomeClient` so the new `<LastSyncedAt>` can sit adjacent to it.)

---

## Data Flow

### Sync task records run

```
sync_manager_catalog() called by beat @ 05:00 UTC
  ↓
started_at = utcnow()
  ↓
try: fetch catalog → parse → dedup → INSERT/UPDATE
  ↓
finally: insert_scan_run(...)
  ↓
return counts dict (backward compat)
```

### "Last synced at" reads

```
GET /admin (user hits refresh)
  ↓
app/admin/page.tsx (server component)
  ↓
getLatestScanRun('sync_manager_catalog') → Prisma query
  ↓
<AdminHomeClient latestRun={...} />
  ↓
<LastSyncedAt run={latestRun} />  ← renders "X 分钟前 (UTC)"
```

### Backfill script flow

```
$ python -m scanner.scripts.backfill_source_manager --limit 10
  ↓
fetch_manager_catalog() → live JSON
  ↓
parse_node_pairs() → set of (owner, repo) tuples
  ↓
SELECT id, github_owner, github_repo FROM nodes
  WHERE source_manager = false AND (LOWER(...), LOWER(...)) IN (...)
  ↓
print first 10 candidates + total count
  ↓
"Run with --apply to update these N nodes."

$ python -m scanner.scripts.backfill_source_manager --apply
  ↓
(same SELECT)
  ↓
apply_update() → batches of 100, commits per batch
  ↓
print "Done. N rows updated."
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `insert_scan_run` fails in `finally` | `logger.warning`, return `-1`; do NOT re-raise (avoid masking original exception) |
| `get_latest_scan_run` throws (DB blip) | `/admin` page renders LastSyncedAt with `latestRun = null`; existing content still renders |
| `LastSyncedAt` receives `run === null` | Renders "Manager sync never ran" (muted text) |
| `LastSyncedAt` receives stale `finishedAt` | `relativeTime` returns "X 天前" naturally; absolute tooltip still correct |
| Backfill script fetch fails (catalog 404 / network) | `httpx.HTTPError` propagates; script exits 1 with error message |
| Backfill script SELECT finds 0 candidates | Prints "0 nodes to backfill. Exiting." and exits 0 |
| Backfill `--apply` batch UPDATE fails | Per-batch transaction; earlier batches committed. Script exits 1. Re-run is idempotent (uncommitted batches will be re-attempted; committed batches are no-ops because `source_manager=true`) |
| Backfill run on already-fully-backfilled DB | `find_candidates()` returns 0; prints "0 nodes to backfill" |
| Concurrent sync + backfill race | Last writer wins. Acceptable per spec invariant (Manager column is monotonic, last-write wins). |
| Multiple AdminPage servers | Each fetches its own `latestRun`; no shared state besides Prisma |

---

## Testing

### Scanner

`scanner/tests/test_db.py` (+3 cases):
- `test_insert_scan_run_writes_row` — happy path; row contains expected fields.
- `test_insert_scan_run_with_error_field` — `error="something bad"`, status="failed"; row persists error.
- `test_insert_scan_run_does_not_raise_on_db_blip` — mock `pymysql.Error`; function returns -1 instead of raising.

`scanner/tests/test_sync_manager_catalog.py` (+3 cases):
- `test_sync_writes_ok_run_on_success` — counts={'added': 1, ...}; scan_runs row has status='ok', counts['added']=1.
- `test_sync_writes_failed_run_on_fetch_error` — monkeypatch httpx to raise; scan_runs row has status='failed', error non-null.
- `test_sync_writes_run_even_when_inner_step_raises` — INSERT raises mid-loop; scan_runs row STILL gets written (finally runs).

`scanner/tests/test_backfill_source_manager.py` (+5 cases):
- `test_dry_run_prints_sample_no_db_update` — default mode; assert no UPDATE happened.
- `test_apply_mode_updates_source_manager` — `source_manager` flips to true.
- `test_apply_is_idempotent` — second run finds 0 candidates.
- `test_unknown_node_not_touched` — pre-seed a node NOT in catalog; script run; node unchanged.
- `test_zero_candidates_exits_clean` — empty catalog; exit 0.

### Web

`web/tests/_components/LastSyncedAt.test.tsx` (+3 cases):
- `renders 'never ran' when run is null`
- `renders '刚刚' when finishedAt is now` (relative time floor)
- `renders 'X 小时前' with absolute UTC tooltip when finishedAt is 5 hours ago`

`web/tests/admin/page.test.tsx` (+2 cases):
- `page passes latestRun to AdminHomeClient` — mock `get_latest_scan_run` to return a run; assert prop forwarded.
- `page passes null when no successful run exists` — mock returns null; assert null prop.

`web/tests/lib/scan-runs.test.ts` (+1 case):
- `get_latest_scan_run filters by task_name and status, orders by finished_at desc` — assert Prisma query args.

### Acceptance criteria

- [ ] `pnpm prisma migrate status` → "Database schema is up to date!" after schema change
- [ ] `python -m scanner.scripts.backfill_source_manager --limit 10` prints ≤ 10 sample rows + total count
- [ ] `python -m scanner.scripts.backfill_source_manager --apply` updates `source_manager=true` for all matching nodes; idempotent on re-run
- [ ] Beat schedule runs once → `/admin` shows "Last synced at: X 分钟前 (UTC)"
- [ ] All pytest cases pass (existing + 8 new)
- [ ] All vitest cases pass (existing + 6 new)
- [ ] tsc --noEmit: 0 new errors (pre-existing ThemeToggle error acceptable, baseline)
- [ ] next lint: 0 new warnings (pre-existing 13 acceptable, baseline)

---

## Out of Scope (NOT in this spec)

- Sync history / audit table UI (history view shows last N runs)
- "Syncing..." state indicator while a run is active
- Counts summary badge ("Last synced: 5 added, 3 updated")
- Auto-refresh / SSE / polling for the indicator
- Env-var configurable cron for the beat schedule
- Manager `models-list.json` / `extension-node-map.json` integration
- Auto-approve well-known Manager entries
- Manager-vs-weekly-scan metadata conflict resolution
- Filter / search `/admin/submissions` by source
- Backfill of `source_manager` from sources other than the live catalog (e.g., historical sync logs)

---

## Self-Review Notes

### Spec coverage

| Spec section / requirement | Covered by |
|---|---|
| scan_runs table schema | Task 1 |
| `insert_scan_run` helper | Task 2 |
| sync task writes scan_runs | Task 2 |
| `get_latest_scan_run` Prisma wrapper | Task 3 |
| `AdminHomeClient` extraction | Task 3 |
| `LastSyncedAt` component | Task 4 |
| Indicator placement on /admin | Task 4 |
| Backfill CLI script | Task 5 |
| Idempotency | Task 5 + tests |
| Tests (pytest + vitest) | Tasks 1-5 |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later" markers. All concrete file paths and code.

### Type consistency

- `ScanRunSummary` matches between `web/lib/scan-runs.ts` shape and `LastSyncedAt` props (only `finishedAt` is consumed by the component).
- `counts` JSON shape (`Record<string, number>`) consistent across `scanner/db.py` insertion and `web/lib/scan-runs.ts` consumption.
- `insert_scan_run` signature `(task_name, started_at, finished_at, status, counts, error=None)` identical between spec definition and `sync_manager_catalog.py` finally block.

### Risks surfaced

- **Concurrent sync + backfill** — both can write `source_manager=true`. No coordination needed since both are idempotent at the row level.
- **Backfill fetches 30k+ entries from the catalog** — `httpx` GET with 30s timeout; acceptable for a one-shot script. If the catalog size grows past 100k entries, the `IN (...)` clause may exceed MySQL's max_allowed_packet. The 100-batch UPDATE is independent of this. Deferred: chunked SELECT.
- **Pre-existing P1014 race** — Plan 5.1.3 baseline. New tests should run on a fresh DB; no impact.
- **`scan_runs` write contention** — only one writer per Celery task; no concurrency issue.

---

## Why this is the right scope

1. **Backfill is a one-shot, never-needed-again operation.** A CLI script is the right shape — no UI, no schema-only migration, no permanent runner.
2. **"Last synced at" is a single-value query.** No need for a full history view; that's v2.
3. **No new dependencies.** Same `httpx`, `pymysql`, Prisma, Next.js stack.
4. **5 tasks, ~1 week.** Manageable scope; each task is independently testable.
5. **Closes 2 of 9 Plan 5.1.3 followups.** Leaves 7 followups untouched (sync history, filtering, auto-approve, etc.) for future plans.
