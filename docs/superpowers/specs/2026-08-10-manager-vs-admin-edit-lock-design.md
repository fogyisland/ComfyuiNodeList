# Manager-vs-admin-edit metadata lock

> Date: 2026-08-10
> Status: design approved (brainstorming 7 sections, user approved)
> Followup of: Plan 5.1.3 (Manager sync operational) — `spec/2026-08-07-manager-sync-operational-design.md` §Invariants 10 / §Out of Scope item "Versioning / last_writer_wins conflict resolution"; also deferred by `spec/2026-08-09-manager-sync-visibility-design.md` §Followups.

## Problem

Manager sync (`sync_manager_catalog`) and the weekly scan (`fetch_pending_nodes` chain) were both spec'd to write `nodes.name` / `description` / `author`. **In practice, only Manager sync does** — the weekly scan only writes `node_versions` and `node_raw_requirements`. So the actual conflict surface is narrower: **Manager sync vs any admin-edited value**.

Current Manager sync SQL:

```sql
UPDATE nodes SET source_manager = true,
  name        = COALESCE(%s, name),
  description = COALESCE(%s, description),
  author      = COALESCE(%s, author)
WHERE LOWER(github_owner) = LOWER(%s) AND LOWER(github_repo) = LOWER(%s)
```

`COALESCE` only protects against the Manager JSON having a NULL field. If Manager has a non-empty title for a node, it overwrites whatever value is in the DB — including values an admin manually fixed (most likely via direct SQL today, since no in-app admin edit path exists).

## Goal

When an admin edits `name` / `description` / `author` on a node, the next Manager sync must NOT overwrite that field. The lock is **per-field** and **permanent**.

Out of scope (deliberately deferred):
- Weekly scan writing metadata (no current writer → no conflict to resolve).
- Audit / revision history table.
- Unlock / re-allow-Manager-to-overwrite path.
- Any AI-vs-human content detection.

## Architecture

Three layers, one boolean per metadata field:

| Layer | Change |
|---|---|
| `web/prisma/schema.prisma` | `nodes` table: add `admin_locked_name`, `admin_locked_description`, `admin_locked_author` — all `Boolean @default(false)`. |
| `scanner/db.py` `update_node_from_manager` | SQL: each metadata field wrapped in `IF(admin_locked_* = 0, COALESCE(...), <unchanged>)`. Returns `int` (count of fields actually written, 0..3). |
| `web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts` | New PATCH endpoint (admin-only). Body: optional `name`, `description`, `author`. Atomic Prisma `update` that sets the matching `admin_locked_*` flag for any field present in the body, even if the value is unchanged. |
| `web/app/admin/nodes/[owner]/[repo]/page.tsx` (+ client) | New page: read existing node via `/api/v1/nodes/[owner]/[repo]`, render 3-field edit form, show `<Badge kind="warning">已锁定</Badge>` per locked field. |

```
admin PATCH name  ─┐
                   ├─→  sets admin_locked_name=true  (atomic, single Prisma update)
                   │
Manager sync       ▼
  IF admin_locked_name=0  → COALESCE(?, name)        (writes)
  IF admin_locked_name=1  → name (unchanged)         (skips)
  source_manager always set true (provenance flag preserved)
```

## Schema

`web/prisma/schema.prisma` `Node` model (currently lines 53-71). Insert after `source_manager`:

```prisma
admin_locked_name        Boolean @default(false)
admin_locked_description Boolean @default(false)
admin_locked_author      Boolean @default(false)
```

Migration `npx prisma migrate dev --name nodes_admin_locked_flags` — expected single statement (MySQL 8.0 in-place metadata-only DDL, no table rewrite):

```sql
ALTER TABLE `nodes`
  ADD COLUMN `admin_locked_name`        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `admin_locked_description` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `admin_locked_author`      BOOLEAN NOT NULL DEFAULT false;
```

If Prisma emits anything beyond a single `ALTER TABLE` (e.g., a follow-up index rebuild), review and replace with a hand-written `migration.sql` that contains only the single `ALTER TABLE` above.

No backfill needed: `@default(false)` makes every existing row start as "unlocked" — Manager sync continues to write them as before.

No new indexes: boolean selectivity is too low to be useful.

## Scanner side

`scanner/db.py` `update_node_from_manager` — current SQL at lines 313-340. New SQL:

```sql
UPDATE nodes SET source_manager = true,
  name        = IF(admin_locked_name        = 0, COALESCE(%s, name),        name),
  description = IF(admin_locked_description = 0, COALESCE(%s, description), description),
  author      = IF(admin_locked_author      = 0, COALESCE(%s, author),      author)
WHERE LOWER(github_owner) = LOWER(%s) AND LOWER(github_repo) = LOWER(%s)
```

Notes:
- `admin_locked_* = 0` rather than `= false` because MySQL `TINYINT(1)` 0/1 is the storage form for Prisma's `Boolean`; `= 0` is explicit and works identically to `= false` here.
- `IF(cond, then, else)` evaluates as expected: when flag is set, the field stays as its current DB value; when flag is unset, the COALESCE rule from before applies unchanged.
- `source_manager = true` is set unconditionally — provenance flag records "Manager sync has seen this node" even when no field was actually written. Useful for later audits and matches prior behavior.

Return type changes from `None` to `int` — number of fields (0..3) actually written. 0 means all three fields were locked and the row is a no-op as far as metadata goes.

`scanner/tasks/sync_manager_catalog.py` caller:

```python
fields_written = update_node_from_manager(owner, repo, name=…, description=…, author=…)
if fields_written == 0:
    summary["skipped_locked"] += 1
else:
    summary["updated_nodes"] += 1
```

`summary` JSON adds `skipped_locked: int` (default 0). `counts` is `Json?`, so adding a key is backward-compatible — `sync_manager_catalog` already initializes this dict explicitly.

## Admin PATCH endpoint

`web/app/api/v1/admin/nodes/[owner]/[repo]/route.ts` — new.

**Contract**:
- Method: `PATCH`
- Auth: admin-only, `requireAdmin()` from `@/lib/session`. Pattern mirrors `web/app/api/v1/admin/manager/sync/status/route.ts`: try/catch `UNAUTHENTICATED` → 401, `FORBIDDEN` → 403.
- Body: `{ name?: string, description?: string|null, author?: string }`. At least one field required (else 422).
- Validation:
  - `name`: 1..255 chars (matches column `@db.VarChar(255)` + `String` non-null).
  - `description`: ≤ 65535 chars (`@db.Text`).
  - `author`: 1..128 chars (matches `@db.VarChar(128)`).
- Response 200: full updated node (`name`, `description`, `author`, `admin_locked_name`, `admin_locked_description`, `admin_locked_author`, `status`, `updated_at`).
- 401 / 403 from auth.
- 404: no node with that owner/repo.
- 409: node `status === 'hidden'` (hidden nodes are not editable).
- 422: validation failure or empty body.

**Implementation**: single Prisma `update` with conditional spread:

```ts
const updated = await prisma.node.update({
  where: { github_owner_github_repo: { github_owner, github_repo } },
  data: {
    ...(name !== undefined        && { name,        admin_locked_name: true }),
    ...(description !== undefined && { description, admin_locked_description: true }),
    ...(author !== undefined      && { author,      admin_locked_author: true }),
  },
});
```

Each field present in the body sets both the value AND its lock flag in one statement. `updated_at` auto-bumps via `@updatedAt`.

`force-dynamic` + `revalidate = 0` to keep admin edit from being cached.

## Admin UI

New page `web/app/admin/nodes/[owner]/[repo]/page.tsx` (server component) plus `NodeEditClient.tsx` (client component).

**Page layout** (matches existing `SubmissionsClient` Card pattern):

```
┌─ Header ─────────────────────────────────┐
│ owner/repo  ·  status badge              │
│ Last synced at: 2026-08-10 05:00         │
└─────────────────────────────────────────┘
┌─ Edit form ─────────────────────────────┐
│  name        [input]  [已锁定]?          │
│  description [textarea]  [已锁定]?       │
│  author      [input]  [已锁定]?          │
│                              [保存]      │
└─────────────────────────────────────────┘
┌─ Manager sync history ──────────────────┐
│ latest sync result: ok @ …              │
│ skipped_locked: 3  updated_nodes: 0     │
└─────────────────────────────────────────┘
```

**Lock badge**: `<Badge kind="warning">已锁定</Badge>`. `Badge` component already supports `warning` (amber/yellow) — does not collide with `success` (green, used by `LastSyncedAt`) or `danger` (red). Only rendered when `admin_locked_*` is `true`.

**Edit form behavior**:
- Initial input values = current DB values.
- Submit builds body with only fields whose input differs from initial (so unchanged fields don't get re-locked by an unrelated save).
- "保存" disabled while in flight; label flips to "保存中…".
- On success: `router.refresh()` so badges re-render against fresh DB state.
- On failure: `window.alert(...)` (matches `SubmissionsClient`).

**Navigation**: add a small input + "前往" button card on `web/app/admin/page.tsx` (admin home) accepting `owner/repo`, calling `router.push(`/admin/nodes/${owner}/${repo}`)`. Lightweight entry — no full search/index.

## Tests

**1. Scanner SQL** — new file `scanner/tests/test_update_node_from_manager_locked.py`, 5 cases:

| Scenario | Expected |
|---|---|
| No flags set; Manager has non-null title/desc/author | 3 fields overwritten, returns 3 |
| `admin_locked_name=true`; Manager has non-null | name unchanged, desc/author overwritten, returns 2 |
| All 3 flags true; Manager has non-null | 3 fields unchanged, `source_manager=true`, returns 0 |
| All 3 flags true; Manager fields all NULL | 3 fields unchanged (COALESCE keeps DB), returns 0 |
| All 3 flags true; Manager fields all NULL; DB `name` already NULL | `description` may still be NULL → not a "write", returns 0 |

Use the existing `db` fixture (`scanner/tests/conftest.py`). Don't introduce `fresh_db`. If `db` does not auto-truncate `nodes`, add an autouse `DELETE FROM nodes` fixture in the file.

**2. Scanner task summary** — extend `scanner/tests/test_sync_manager_catalog.py`, 2 new cases:

- All-locked node → `summary["skipped_locked"]` increments, `updated_nodes` does not.
- Partially-locked node (e.g., only `name` locked) → `summary["updated_nodes"]` increments, `skipped_locked` does not.

**3. Admin PATCH API** — new file `web/tests/api/admin-nodes-patch.test.ts`, 5 cases:

| Scenario | Expected |
|---|---|
| Empty body | 422 |
| Body `{name: "X"}` | 200, response shows `admin_locked_name=true`, other flags unchanged |
| Body `{description: "X"}` | 200, only `admin_locked_description=true` |
| Body `{name, description, author}` | 200, all 3 flags `true` |
| Non-admin caller | 403 |

Mock `requireAdmin` (mirrors `web/tests/api/manager-sync-status.test.ts`). Use real Prisma against the test DB — no separate unit test split needed.

**4. UI Client** — new file `web/tests/_components/NodeEditClient.test.tsx`, 2 cases:

- Render with `admin_locked_name=true` → DOM contains a "已锁定" badge in the warning kind for the name field.
- Edit name input + click 保存 → fetch PATCH called with `{name: <new>}`; on 200, `router.refresh` called.

Mock `useRouter` and `global.fetch`.

**5. Cross-layer smoke** — manual, not automated:

1. `mysql -e "UPDATE nodes SET admin_locked_name=true WHERE github_owner='foo'"`
2. Trigger Manager sync via `curl -X POST /api/v1/admin/manager/sync` (or wait for cron).
3. Verify `nodes.name` unchanged; `scan_runs.counts.skipped_locked >= 1`.
4. Open `/admin/nodes/foo/bar` in admin UI, see amber "已锁定" badge.

## Risks / decisions log

- **3-statement vs 1-statement ALTER TABLE**: If Prisma generates extra statements beyond the `ALTER TABLE ADD COLUMN` (e.g., index rebuild), orchestrator decision: replace migration with hand-written single-statement version. Same precedent as Plan 5.1.3 followup #3 (`scan_runs.finished_at` migration).
- **Lock fires even on identical value**: PATCH with `{name: <same as DB>}` still sets `admin_locked_name=true`. Rationale: explicit PATCH = "admin touched this field", independent of value. Simpler semantics; aligns with "any PATCH call locks".
- **No backfill needed**: `@default(false)` covers all existing rows. Verified by checking no current admin path can set flags pre-migration (no `admin_locked_*` references exist anywhere in the codebase today).
- **`IF(... = 0, ...)` vs `IF(..., ...) = true`**: equivalent in MySQL but `= 0` is explicit about TINYINT storage; same readability either way.

## Spec coverage self-check

| Spec requirement | Section |
|---|---|
| 3 boolean columns, default false | Schema |
| Single Prisma migration | Schema |
| No backfill | Schema |
| Per-field lock granularity | Scanner side, Admin PATCH |
| Manager sync respects lock | Scanner side |
| Manager sync returns field count | Scanner side |
| `skipped_locked` summary key | Scanner side |
| Admin PATCH endpoint | Admin PATCH endpoint |
| Validation (lengths, hidden status) | Admin PATCH endpoint |
| Auth (admin-only, 401/403) | Admin PATCH endpoint |
| Edit UI + badges | Admin UI |
| Navigation entry on `/admin` | Admin UI |
| 14 automated tests across 4 files | Tests |
| Manual smoke covering cross-layer behavior | Tests |

No gaps. No placeholders.