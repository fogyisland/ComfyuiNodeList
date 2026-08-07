# Manager sync — operational followup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote ComfyUI Manager catalog sync from manual-only to operational: daily Celery beat schedule, name/description backfill into pending submissions, and a "Manager" UI badge in both admin review and public node card.

**Architecture:** Extend the existing `scanner.tasks.sync_manager_catalog` to (a) write `title` / `description` from Manager JSON into new pending submissions, and (b) flip `nodes.source_manager = true` for already-existing nodes that appear in the catalog. Add a new beat_schedule entry in `scanner/celery_app.py` running daily at 05:00 UTC. Add a single Boolean column `nodes.source_manager` via a new Prisma migration. The admin review row gains a "Manager" badge derived from `submitter.username === 'comfyui-manager'`; the public NodeCard gains a "via Manager" badge driven by `nodes.source_manager`. Manual admin button and existing trigger_api endpoint remain unchanged — beat runs alongside manual.

**Tech Stack:**
- Python 3.11+ (existing `scanner/` infra)
- Celery 5 + Redis broker (existing `celery_app.py`)
- `httpx`, `pymysql`, `urllib.parse` (existing)
- Prisma 5 / MySQL (existing)
- Next.js 15 + React 19 (existing)
- No new dependencies

## Context

Plan `2026-08-06-comfyui-manager-sync` shipped a one-shot manual sync: an admin button on `/admin` hits `POST /api/v1/admin/manager/sync` → trigger_api's `POST /trigger-manager-sync` → Celery task `scanner.tasks.sync_manager_catalog` which dedupes and INSERTs pending submissions. Its `§Followups` lists three operational items this spec closes:

1. **Celery beat scheduled sync** — no manual click required
2. **Incremental update of name/description for nodes already in DB** — full backfill: Manager JSON's `title`/`description`/`author` are written to both new pending submissions AND existing `nodes` rows (with COALESCE preservation on missing fields). Source_manager flag is also flipped on existing rows. Powers both the admin review badge (via `submitter.username === 'comfyui-manager'`) and the public NodeCard badge (via `nodes.source_manager`).
3. **UI badge/label for Manager-sourced submissions** — visible in admin review AND public NodeCard (per brainstorming decision D)

The `scanner.celery_app` already runs two scheduled tasks (`scan-every-week` Mon 03:00 UTC + `prune-expired-resolutions` daily 04:00 UTC). Adding a third is a 4-line `beat_schedule` edit.

The schema change is the smallest possible: one Boolean column on `nodes`. No other tables touched. Migration is additive — existing rows default to `source_manager = false`, meaning "no evidence this node was in the Manager catalog at sync time". Future syncs will flip rows to true idempotently.

## Global Constraints

Verbatim binding requirements — every task's requirements implicitly include this section:

- **Beat schedule:** `sync-manager-catalog-daily` runs `scanner.tasks.sync_manager_catalog` at `crontab(hour=5, minute=0)` (05:00 UTC daily). Avoids the existing 03:00 weekly-scan and 04:00 prune slots.
- **Manual button preserved:** `POST /api/v1/admin/manager/sync` and the trigger_api endpoint remain. Admin can still trigger ad-hoc syncs. Beat does NOT disable the button.
- **Beat and manual share the same task.** No "scheduled_only" task variant. Same dedup, same error handling, same stage=fetch/parse/dedup/system_user reporting.
- **Sync task behavior change for new entries:** INSERT into `node_submissions` with `name = entry.title`, `description = entry.description` (both nullable). `github_url` stays as before. `submitter_id` stays as `fetch_system_submitter_id()`. Status stays `'pending'`.
- **Sync task behavior change for skipped_existing entries:** call `update_node_from_manager(owner, repo, name=None, description=None, author=None)` which performs `UPDATE nodes SET source_manager=true, name=COALESCE(%s, name), description=COALESCE(%s, description), author=COALESCE(%s, author) WHERE LOWER(github_owner) = %s AND LOWER(github_repo) = %s`. Idempotent. COALESCE means Manager JSON missing fields don't wipe existing DB values. **Note:** this is a deliberate reversal of the earlier brainstorming A-only decision — the user clarified that "节点刷新入库" means existing nodes should also get fresh `name`/`description`/`author` from Manager JSON.
- **skipped_pending entries:** nothing changes. The pending submission row already exists with the system user; re-flagging source_manager would be redundant since the eventual approval will set it.
- **`nodes.source_manager` column:** `Boolean @default(false)`. New Prisma migration `add_node_source_manager`. Migration is metadata-only (add column with default). Existing rows backfill to false. Subsequent syncs flip matching rows to true.
- **Approve path:** when admin approves a pending submission with `submitter.username = 'comfyui-manager'`, the create-node path must also flip `nodes.source_manager = true` for the newly-created node row. Implemented in the same DB transaction as the node INSERT.
- **Admin UI badge:** `SubmissionsClient` shows a "Manager" badge next to `submitterUsername` when `submitterSource === 'manager'`. Server-side determines the flag from `submitter.username === 'comfyui-manager'` — the client never reads system-user magic strings.
- **Public UI badge:** `NodeCard` shows a "via Manager" badge after the `name` when `sourceManager === true`. Server-side prop; client-side conditional render. Badge uses muted styling (neutral, not endorsement tone).
- **No JSON shape expansion.** Sync still only consumes `reference` (for dedup) and now `title`/`description` (for INSERT columns). `author`, `stars`, `last_update`, `files`, `install_option` remain ignored (YAGNI per original spec §Global Constraints).
- **No new dependencies.** `httpx`, `pymysql`, `urllib.parse`, Prisma client, Next.js, React — all already in the project.
- **Error handling:** existing sync task's `stage=fetch/parse/dedup/system_user` mapping preserved. New failure modes introduced by this spec:
  - `update_node_from_manager` UPDATE failure → append to `errors` list, continue with next entry (per-row autocommit, same as INSERT)
  - migration apply failure on deploy → manual intervention; not silently absorbed
- **No UI tests required** for the badge text/style — manual visual verification on dev environment is sufficient (consistent with original spec §Testing "UI behavior: manual verification only").
- **No background polling / SSE** for the admin button — unchanged from original spec.
- **No sync history / audit table** — unchanged from original spec.

---

## Architecture & Components

### 1 schema migration + 4 modified scanner files + 4 modified web files + 1 new badge component

| Block | Type | Responsibility |
|---|---|---|
| `web/prisma/migrations/<new>_add_node_source_manager/migration.sql` | New Prisma migration | `ALTER TABLE nodes ADD COLUMN source_manager BOOLEAN NOT NULL DEFAULT false` |
| `web/prisma/schema.prisma` | Modify (+1 field) | Add `source_manager Boolean @default(false)` on `Node` model |
| `scanner/celery_app.py` | Modify (+1 beat entry) | Register `sync-manager-catalog-daily` at 05:00 UTC |
| `scanner/db.py` | Modify (+1 helper, modify 1 helper signature) | New `update_node_from_manager(owner, repo, name=None, description=None, author=None) -> int`; `insert_pending_submission(..., name=None, description=None) -> int` gains optional kwargs |
| `scanner/tasks/sync_manager_catalog.py` | Modify (extend loop body) | Pass `name=title, description=description` on INSERT; call `update_node_from_manager(owner, repo, title, description, author)` on `skipped_existing` |
| `web/lib/submissions.ts` (or wherever approve logic lives) | Modify (+1 line) | When inserting into `nodes` after approve, also set `source_manager: true` if submission's submitter is `comfyui-manager` |
| `web/app/admin/submissions/page.tsx` | Modify | Pass `submitterSource: 'manager' \| 'user'` per row to `SubmissionsClient` |
| `web/app/admin/submissions/SubmissionsClient.tsx` | Modify (+1 column, +1 conditional render) | Add "来源" column showing `<Badge>Manager</Badge>` for manager-sourced rows |
| `web/app/(public)/_components/NodeCard.tsx` | Modify (+1 prop, +1 conditional render) | Add `sourceManager: boolean` prop; render `<Badge>via Manager</Badge>` after `CardTitle` when true |
| Caller of `NodeCard` (likely `web/app/(public)/nodes/page.tsx` or wherever nodes are listed) | Modify | Pass `sourceManager` from `node.source_manager` |
| `web/app/_components/Badge.tsx` (or extend existing badge primitive if present) | New / modify | A reusable Badge component with neutral "manager" variant. If existing component supports variants, add a new one; otherwise create a 12-line component colocated with `Card`. |

**Reuse:**
- `scanner/celery_app.py` `autodiscover_tasks` already picks up `sync_manager_catalog` — no registration changes needed beyond adding to `beat_schedule`
- `scanner/db.py::get_connection()` context manager (existing)
- `web/lib/api-helpers.ts` (existing)
- `web/lib/format.ts::formatDate` (existing)
- existing `Card` / `CardTitle` / `CardMeta` design-token components (existing)

**No new dependencies.**

### Directory diff

```
web/prisma/schema.prisma                                            (modify: +1 列)
web/prisma/migrations/20260807_add_node_source_manager/migration.sql  (create)
scanner/celery_app.py                                                (modify: +1 beat_schedule entry)
scanner/db.py                                                        (modify: insert_pending_submission signature + new helper)
scanner/tasks/sync_manager_catalog.py                                (modify: name/desc + source_manager update)
web/lib/submissions.ts [or equivalent]                               (modify: source_manager flip on approve)
web/app/admin/submissions/page.tsx                                   (modify: pass submitterSource flag)
web/app/admin/submissions/SubmissionsClient.tsx                      (modify: 来源 column + badge)
web/app/(public)/_components/NodeCard.tsx                            (modify: sourceManager prop + badge)
web/app/(public)/nodes/page.tsx [or NodeCard caller]                 (modify: pass sourceManager)
web/app/_components/Badge.tsx                                        (create OR modify if Badge primitive exists)
scanner/tests/test_sync_manager_catalog.py                           (modify: +3 test cases)
web/tests/_components/NodeCard.test.tsx [or new]                     (modify or create: badge rendering test)
```

---

## Data Flow

### End-to-end: scheduled daily sync

```
[Celery beat 05:00 UTC daily]
   │
   ▼
[scanner.tasks.sync_manager_catalog]   (signature unchanged; behavior extended)
   │
   ├─ Step 1: GET Manager JSON (unchanged)
   │
   ├─ Step 2: Parse JSON (unchanged)
   │
   ├─ Step 3: Parse each entry's reference URL (unchanged shape, but also retain
   │          entry['title'] and entry['description'] for later steps)
   │
   ├─ Step 4: Dedup (unchanged)
   │
   ├─ Step 5: Look up system user (unchanged)
   │
   ├─ Step 6: For each entry (CHANGED):
   │     - new (not in dedup set):
   │         INSERT INTO node_submissions (
   │           submitter_id, github_url, name=entry.title, description=entry.description
   │         )
   │     - skipped_existing (in `nodes`):
   │         UPDATE nodes SET source_manager=true, name=COALESCE(?, name), description=COALESCE(?, description), author=COALESCE(?, author)
   │           WHERE LOWER(github_owner)=? AND LOWER(github_repo)=?
   │     - skipped_pending (in `node_submissions` pending): nothing
   │     - skipped_invalid_url: nothing
   │
   └─ Return counts dict (add `updated_nodes` counter for skipped_existing updates)
```

### End-to-end: admin approve path

```
[admin clicks 批准 on /admin/submissions row with submitter=comfyui-manager]
   │
   ▼ POST /api/v1/admin/submissions/{id}/approve
[Next route handler] — existing approve logic
   │
   ├─ UPDATE node_submissions SET status='approved', reviewer_id, review_note, reviewed_at
   │
   ├─ INSERT INTO nodes (..., source_manager=true) — CHANGED
   │     (the new source_manager=true mirrors the sync task's flip for skipped_existing
   │      entries, applied at creation time for newly-approved Manager-sourced submissions)
   │
   └─ Return success
```

### End-to-end: public NodeCard render

```
[/nodes page (server component) renders NodeCard for each row]
   │
   ▼ SELECT id, github_owner, github_repo, name, author, description, updated_at, source_manager FROM nodes
   │
   ▼ Pass to NodeCard:
   <NodeCard owner repo name author description updatedAt sourceManager={node.source_manager} />
   │
   ▼ NodeCard renders:
   <Card>
     <CardTitle>{name}</CardTitle>
     {sourceManager && <Badge variant="manager">via Manager</Badge>}
     <CardMeta>{formatDate(updatedAt)}</CardMeta>
     ...
   </Card>
```

---

## Error Handling

### A. New entry INSERT failure (existing path, unchanged)
- `IntegrityError` or connection drop → append to `errors`, continue (per-row autocommit)

### B. update_node_from_manager UPDATE failure (NEW)
- pymysql error → append `{entry_id, error: str(exc)}` to errors list, log warning, continue
- Counts dict gains `"updated_nodes": <int>` field counting successful UPDATEs (vs errors)

### C. Migration apply failure (NEW)
- `prisma migrate deploy` on a fresh DB applies `ALTER TABLE` — should be metadata-only, ALGORITHM=INSTANT in MySQL. No data backfill needed (default false).
- If migration apply fails, deployment halts. No automatic recovery; manual investigation required.

### D. Approve path source_manager flip
- New node INSERT includes `source_manager: true` in the same Prisma call. If INSERT fails, no source_manager row exists; no partial state.
- Race condition: if approve and sync happen concurrently for the same `(owner, repo)`, both paths set `source_manager=true` — idempotent, safe.

### E. Beat schedule + manual button overlap
- Both fire the same task. Both run dedup. Both try to UPDATE source_manager on skipped_existing. Both INSERT into node_submissions for new entries. Per-row autocommit means concurrent runs may produce slight ordering differences in counts but never duplicate inserts (UNIQUE constraint on `(github_owner, github_repo)` in `nodes` and on submission dedup logic). Safe.

### F. Badge rendering (UI)
- `sourceManager === true` strictly → render badge. `false`/`undefined` → no badge. No conditional failures; React renders falsy values as nothing.
- `submitterSource === 'manager'` strictly → render "Manager" badge. Anything else → no badge. Same pattern.

---

## Edge Cases & Invariants

### Invariants the implementation must guarantee

1. **Idempotent re-sync:** Running sync twice with same Manager JSON leaves DB unchanged. `update_node_from_manager` is a no-op when values are already equal (UPDATE writes same value). `insert_pending_submission` for already-existing `(owner, repo)` is blocked by dedup before reaching INSERT.

2. **Pending submissions get name/description:** Every new INSERT into `node_submissions` by `sync_manager_catalog` populates `name` and `description` from Manager JSON when present in the entry. NULL preserved when entry missing the field.

3. **Existing nodes get fresh Manager fields:** `update_node_from_manager` sets `source_manager=true`, plus `name`/`description`/`author` from Manager JSON, using `COALESCE` so missing Manager fields preserve existing DB values.

4. **Approve path mirrors sync path:** A node created via approving a Manager-sourced submission has `source_manager=true` at creation time, and the approve-time `name`/`description`/`author` come from the pending submission row (which itself came from Manager JSON).

5. **Manual trigger still works:** Admin can click the button any time; beat schedule does not interfere. Both paths run the same task with same behavior.

6. **Beat failure does not cascade:** If 05:00 UTC sync fails (fetch / parse / dedup / system_user), Celery logs the failure. Next-day 05:00 UTC retry runs. No exponential backoff or autoretry_for (matching original spec's idempotency assumption).

7. **Schema migration is backwards-compatible:** `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT false` is metadata-only in MySQL 8 (ALGORITHM=INSTANT). Existing rows get default false; no row-level rewrite. Indexes unaffected.

8. **Concurrent sync + approve safe:** Sync updates existing nodes. Approve creates new nodes with `source_manager=true`. Both write paths use Prisma's row-level concurrency. No transaction wraps the batch.

9. **`source_manager` is monotonic (never resets):** Sync never writes `false`. Approve writes `true`. Manual SQL updates from ops should not reset (out of scope but mentioned for clarity).

10. **Two writers of nodes.name/description/author:** Manager sync and weekly `fetch_releases` both write these columns. Last-writer-wins; no version vector. This is acceptable because both writers read the same upstream (GitHub repo metadata) and Manager is a community-maintained mirror of it. Concretely: if Manager runs at 05:00 UTC and `fetch_releases` runs at 03:00 UTC Monday, the next weekly scan will overwrite any Manager-originated metadata. This is documented behavior, not a bug.

### Out of scope (explicit non-goals)

- ❌ Manager `models-list.json` / `extension-node-map.json` integration (separate spec)
- ❌ Auto-approve well-known Manager entries (policy decision)
- ❌ Sync history / audit table (already deferred by original spec)
- ❌ Beat schedule frequency configurable via env var (hardcoded 05:00 UTC; env override deferred)
- ❌ Background polling / SSE for admin button
- ❌ UI badge with icon / animation (text-only Badge component is enough)
- ❌ Filtering / searching submissions by source on `/admin/submissions` (could come later)
- ❌ Schema changes to `node_submissions` (no new columns needed; existing `name`/`description` nullable columns are sufficient)
- ❌ Versioning / last_writer_wins conflict resolution between Manager sync and `fetch_releases` (the Invariant 10 last-writer-wins rule is sufficient; no version column added)

---

## Testing

### Layer 1 — Python (pytest, `scanner/tests/test_sync_manager_catalog.py`)

**Existing tests preserved.** Add the following new cases:

| Name | Input | Expected |
|---|---|---|
| `test_pending_submission_includes_name_and_description` | 1 fresh entry with `title="Foo"` and `description="Bar baz"` | INSERT row has `name='Foo'`, `description='Bar baz'`; `added=1, updated_nodes=0` |
| `test_pending_submission_null_name_description_when_missing` | 1 entry without `title` / `description` fields | INSERT row has `name=NULL`, `description=NULL`; `added=1` |
| `test_existing_node_updated_from_manager` | Pre-seed 1 node with `source_manager=false, name='Old', description='Old', author='Old'`; feed matching entry with `title='New', description='New', author='New'` | Task returns `updated_nodes=1`, `added=0`, `skipped_existing=1`. Verify post-sync DB row: `source_manager=true, name='New', description='New', author='New'` |
| `test_existing_node_coalesce_preserves_existing_when_manager_missing` | Pre-seed 1 node with `name='Existing', description='Existing', author='Existing'`; feed matching entry with no `title`/`description`/`author` fields | Task returns `updated_nodes=1`. Verify post-sync DB row: `source_manager=true, name='Existing', description='Existing', author='Existing'` (COALESCE preserved existing values) |
| `test_existing_node_no_change_when_values_equal` | Pre-seed 1 node with `source_manager=true, name='Same', description='Same'`; feed matching entry with same `title`/`description` | Task returns `updated_nodes=1` (UPDATE ran; values were equal so row effectively unchanged); no errors |
| `test_update_node_failure_appends_to_errors` | Mock `update_node_from_manager` to raise on call #2 | Returns `errors=[{entry_id:...}]`, continues with remaining entries |
| `test_beat_schedule_contains_sync_manager_catalog_daily` | Import `celery_app.conf.beat_schedule` | `"sync-manager-catalog-daily"` key present; `task == "scanner.tasks.sync_manager_catalog"`; schedule evaluates to 05:00 UTC daily |

**Test fixture:** extend existing `scanner/tests/fixtures/manager_catalog.json` with one entry containing `title`, `description`, and `author` fields (currently absent per spec §Global Constraints).

### Layer 2 — Prisma (vitest or jest, optional but recommended)

| Name | Input | Expected |
|---|---|---|
| `test_source_manager_column_default_false` | Create a node directly via Prisma client | Row has `source_manager = false` |
| `test_source_manager_default_overridable` | Create a node with `source_manager: true` | Row has `source_manager = true` |

If the project doesn't currently have a vitest case for schema defaults, this layer can be skipped and verified manually via `npx prisma studio` after migration. Recommended but not required.

### Layer 3 — TypeScript (vitest, `web/tests/_components/NodeCard.test.tsx`)

| Name | Input | Expected |
|---|---|---|
| `test_renders_via_manager_badge_when_source_manager_true` | `<NodeCard sourceManager={true} ... />` | DOM contains "via Manager" |
| `test_omits_badge_when_source_manager_false` | `<NodeCard sourceManager={false} ... />` | DOM does NOT contain "via Manager" |
| `test_omits_badge_when_source_manager_undefined` | `<NodeCard ... />` (no prop) | DOM does NOT contain "via Manager" |

### Layer 4 — TypeScript (vitest, `web/tests/_components/SubmissionsClient.test.tsx`)

| Name | Input | Expected |
|---|---|---|
| `test_renders_manager_badge_for_manager_sourced_row` | Items with `submitterSource='manager'` | DOM contains "Manager" badge in that row only |
| `test_omits_badge_for_user_sourced_row` | Items with `submitterSource='user'` | DOM does NOT contain "Manager" badge |

### Layer 5 — Manual verification

After deploy:
- `pnpm prisma migrate deploy` on dev DB → "Database schema is up to date!"
- Click admin sync button → verify pending submissions now show "Manager" badge
- Approve a Manager-sourced submission → verify new node row in DB has `source_manager=true` → verify public NodeCard on `/nodes` shows "via Manager" badge
- Wait for next-day beat run (or manually invoke via `celery -A scanner.celery_app call scanner.tasks.sync_manager_catalog`) → verify same effect

### Coverage summary

- ✅ Sync task extended for name/description and source_manager update
- ✅ update_node_from_manager UPDATE failure handled (appended to errors, not fatal)
- ✅ Beat schedule entry registered at correct cron
- ✅ Badge rendering on NodeCard for both true/false/undefined
- ✅ Badge rendering on SubmissionsClient for both manager/user sources
- ✅ Schema migration backwards-compatible
- ✅ Approve path mirrors sync path for source_manager

---

## Interface Contracts (verbatim)

### Prisma schema addition

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

  versions       NodeVersion[]
  scan_failures  ScanFailure[]

  @@unique([github_owner, github_repo])
  @@index([status, updated_at])
  @@map("nodes")
}
```

### Migration

```sql
-- AlterTable
ALTER TABLE `nodes` ADD COLUMN `source_manager` BOOLEAN NOT NULL DEFAULT false;
```

(MySQL 8 / Prisma-generated; verify generated SQL matches this shape.)

### `scanner/db.py` helpers

```python
def insert_pending_submission(
    submitter_id: int,
    github_url: str,
    name: str | None = None,
    description: str | None = None,
) -> int:
    """INSERT one row into node_submissions. name/description optional.
    Returns new row id. Raises pymysql.IntegrityError on duplicate."""

def update_node_from_manager(
    owner: str,
    repo: str,
    name: str | None = None,
    description: str | None = None,
    author: str | None = None,
) -> int:
    """UPDATE nodes
       SET source_manager=true,
           name=COALESCE(%s, name),
           description=COALESCE(%s, description),
           author=COALESCE(%s, author)
       WHERE LOWER(github_owner) = %s AND LOWER(github_repo) = %s.
    Returns rows affected. Idempotent. COALESCE preserves existing column
    values when corresponding Manager JSON field is missing."""
```

### `scanner/tasks/sync_manager_catalog.py` task (signature unchanged; behavior extended)

```python
@celery_app.task(name="scanner.tasks.sync_manager_catalog")
def sync_manager_catalog() -> dict:
    """Fetch ComfyUI Manager's custom-node-list.json. For each entry:
       - new (not in dedup set): INSERT node_submissions with name/description
         from entry.title/entry.description
       - skipped_existing (in `nodes`): UPDATE nodes SET source_manager=true
         plus name/description/author from entry (COALESCE-preserved on null)
       - skipped_pending: nothing
       Returns dict with status, fetched, added, updated_nodes,
       skipped_existing, skipped_pending, skipped_invalid_url, errors[]."""
```

### `scanner/celery_app.py` beat schedule addition

```python
celery_app.conf.beat_schedule = {
    "scan-every-week": { ... },
    "prune-expired-resolutions": { ... },
+   "sync-manager-catalog-daily": {
+       "task": "scanner.tasks.sync_manager_catalog",
+       "schedule": crontab(hour=5, minute=0),
+   },
}
```

### `web/app/admin/submissions/page.tsx` data shape

```typescript
type Item = {
  id: number;
  submitterUsername: string;
  submitterSource: 'manager' | 'user';   // NEW: derived from submitter.username === 'comfyui-manager'
  githubUrl: string;
  createdAt: string;
};
```

### `NodeCard` props addition

```typescript
type Props = {
  owner: string;
  repo: string;
  name: string;
  author: string;
  description: string | null;
  updatedAt: string | Date;
  sourceManager?: boolean;   // NEW
};
```

---

## Acceptance Criteria

- [ ] `nodes.source_manager` column added via Prisma migration; existing rows backfilled to `false`
- [ ] `scanner.celery_app.conf.beat_schedule` contains `sync-manager-catalog-daily` entry pointing at `scanner.tasks.sync_manager_catalog` with `crontab(hour=5, minute=0)`
- [ ] `scanner.tasks.sync_manager_catalog` writes `name` and `description` (from Manager JSON `title`/`description`) into new pending submissions
- [ ] `scanner.tasks.sync_manager_catalog` UPDATEs `source_manager=true` AND `name`/`description`/`author` (COALESCE-preserved on null) on existing nodes that appear in the Manager catalog (idempotent)
- [ ] `/admin/submissions` row shows "Manager" badge next to submitter username when submission is from `comfyui-manager` system user
- [ ] Public `/nodes` listing shows "via Manager" badge on NodeCard when `node.source_manager === true`
- [ ] Approve path sets `source_manager=true` for newly-created node row when approving a Manager-sourced submission
- [ ] Existing pytest cases (64) + new cases (7) all pass → 71/71 green
- [ ] Existing vitest cases (167) + new NodeCard badge tests (3) + new SubmissionsClient badge tests (2) all pass → 172+/172+ green
- [ ] `pnpm prisma migrate status` on dev DB → "Database schema is up to date!"
- [ ] Manual verification: admin button still triggers sync; new pending submission shows badge; approve → node row has `source_manager=true` → public NodeCard shows badge

---

## Followups (deferred)

- Beat schedule frequency configurable via `CELERY_SYNC_MANAGER_CATALOG_CRON` env var (operational flexibility)
- Backfill `nodes.source_manager = true` for nodes already imported from Manager before this spec (one-shot migration helper)
- Filter / search `/admin/submissions` by source (`user` vs `manager`)
- "Last synced at" indicator on `/admin` next to ManagerSyncButton (useful once beat schedule is active)
- Manager `models-list.json` / `extension-node-map.json` integration (separate spec when needed)
- Auto-approve well-known Manager entries (policy decision)
- Sync history / audit table (v2)
- Background polling or SSE for admin button
- Resolution of Manager-vs-weekly-scan metadata conflict (currently last-writer-wins per Invariant 10)