# ComfyUI Manager Catalog Sync — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual sync that pulls ComfyUI Manager's `custom-node-list.json` and writes each previously-unseen node as a pending `node_submissions` row, so admins can approve them through the existing review UI and the existing weekly scanner can pick up their versions.

**Architecture:** One new Celery task (`scanner.tasks.sync_manager_catalog`) fetches the JSON via `httpx`, parses each entry's `reference` URL to `(github_owner, github_repo)`, dedups against `nodes` (any status) + `node_submissions` (status='pending'), and inserts pending rows attributed to a dedicated system user `comfyui-manager`. Triggered by a new admin button on `/admin` that hits `POST /api/v1/admin/manager/sync` → trigger_api's new `POST /trigger-manager-sync` → enqueue the task. 0 schema migrations; 0 new dependencies.

**Tech Stack:**
- Python 3.11+ (existing `scanner/` infra)
- Celery 5 + Redis broker (existing)
- `httpx` (existing)
- `pymysql` (existing)
- `urllib.parse` (stdlib)
- Next.js 15 + existing `requireAdmin()` + `api-helpers.ts`

## Context

The existing scanner pipeline (`scanner/tasks/fetch_pending_nodes.py`) only scans nodes already present in `nodes` (status='active'). The spec's §14 explicitly defers "integrate with ComfyUI-Manager as the dependency source" to a follow-up. Today, new nodes enter the DB only via:
1. `web/prisma/seed.ts` (manual dev data)
2. `POST /api/v1/submissions` (user-submitted GitHub URL → admin approves)

This spec fills the gap: admins can one-click pull the Manager's full catalog; new entries become pending submissions alongside user-submitted ones, going through the same approval flow.

## Global Constraints

Verbatim binding requirements — every task's requirements implicitly include this section:

- **Data source:** `https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json` (the file ComfyUI Manager itself ships; the JSON is the upstream catalog)
- **JSON shape:** top-level is a dict keyed by node id; each entry has fields `author`, `title`, `reference` (repo URL), `description`, `stars`, `last_update`, `files`, `install_option` — but this spec only consumes `reference` (other fields are ignored, YAGNI)
- **Write target:** `node_submissions` table with `status='pending'` (existing schema, no migration)
- **Submitter identity:** dedicated system user `username='comfyui-manager'`, `role='user'`, `github_id=NULL`, `password_hash=NULL`, created idempotently in `web/prisma/seed.ts`
- **Trigger:** manual admin button on `/admin` only — no Celery beat schedule; no auto-trigger
- **Dedup rule:** skip if `(github_owner, github_repo)` exists in `nodes` (any status) OR in `node_submissions` where `status='pending'`. Skip if `reference` is missing or non-GitHub URL.
- **Approved/rejected submissions are NOT in the dedup set** — re-syncing a previously-approved-then-removed node creates a new pending row (intentional: lets admins re-import)
- **URL parsing:** `urlparse(reference)`; require `netloc == 'github.com'`; take first two non-empty `path` segments as `owner`/`repo`. Ignore fragments and query strings. Lowercase both.
- **Versions are NOT synced by this spec.** New pending submissions → admin approves → existing weekly scanner (or manual `/admin/scans/trigger`) picks up the now-active node and fetches its releases via `fetch_releases`. This reuses existing infrastructure.
- **No schema migrations.** The system user is created via `prisma db seed`; all new code reads existing tables.
- **No new dependencies.** `httpx`, `pymysql`, `urllib.parse` are already in the project.
- **Admin sees only the queue result.** After clicking sync, admin gets `202 + task_id`; the actual `{added, skipped_*}` counts are visible by counting new pending rows in `/admin/submissions`. Per spec scope: no sync history table.
- **No client-side polling.** Admin reloads `/admin/submissions` to see new rows.
- **No UI changes to the submissions review page.** Manager-sourced rows look identical to user-sourced rows — submitter shows as `comfyui-manager` username.
- **Testing:** pytest covers the Python task end-to-end (httpx mocked, real `comfyui_nodes_test` DB reset between tests via existing `conftest.py`); vitest covers the Next.js route (mocked fetch to trigger_api). No UI tests for the button (manual verification only).

---

## Architecture & Components

### 5 new code blocks, 3 modified files, 3 reuse points

| Block | Type | Responsibility |
|---|---|---|
| `scanner/tasks/sync_manager_catalog.py` | New Celery task | Fetch JSON → dedup → INSERT pending submissions |
| `scanner/db.py` | Modify (+2 helpers) | `fetch_existing_owner_repo_pairs()` (set), `fetch_system_submitter_id()` (int\|None), `insert_pending_submission()` (int id) |
| `scanner/trigger_api.py` | Modify (+1 endpoint) | `POST /trigger-manager-sync` enqueues `scanner.tasks.sync_manager_catalog` |
| `web/app/api/v1/admin/manager/sync/route.ts` | New Next route | `requireAdmin()` → 5s timeout fetch trigger_api → 202/502 |
| `web/app/admin/_components/AdminDashboard.tsx` | Modify | Add `<ManagerSyncButton managerSystemUserId={...} />` client island |
| `web/app/admin/page.tsx` | Modify | Look up system user id (or null), pass to AdminDashboard |
| `web/prisma/seed.ts` | Modify | Idempotent upsert `username='comfyui-manager'` |

**Reuse:**
- `scanner/celery_app.py` — `autodiscover_tasks(["scanner.tasks"])` picks up the new task; no registration needed
- `scanner/db.py: get_connection()` context manager (existing)
- `web/lib/api-helpers.ts` — `json()`, `error()` response wrappers
- `web/lib/session.ts` — `requireAdmin()`

**No new dependencies.**

### Directory diff

```
web/prisma/seed.ts                                     (modify)
web/app/admin/page.tsx                                  (modify)
web/app/admin/_components/AdminDashboard.tsx            (modify)
web/app/api/v1/admin/manager/sync/route.ts              (create)
scanner/tasks/sync_manager_catalog.py                   (create)
scanner/trigger_api.py                                  (modify: +1 endpoint)
scanner/db.py                                           (modify: +3 helpers)
web/tests/api/admin-manager-sync.test.ts                (create)
scanner/tests/test_sync_manager_catalog.py              (create)
scanner/tests/fixtures/manager_catalog.json             (create)
```

---

## Data Flow

### End-to-end path

```
[admin clicks "同步 Manager 目录" on /admin]
   │
   │ POST /api/v1/admin/manager/sync
   ▼
[Next route handler] requireAdmin() ─fail→ 401/403
   │ ok
   │ fetch POST 127.0.0.1:8081/trigger-manager-sync (AbortController 5s)
   │
   ├─network/timeout fail → 502 "trigger-api unreachable"
   │
   │ res.ok
   ▼
[trigger_api.py] @app.post("/trigger-manager-sync")
   │ celery_app.send_task("scanner.tasks.sync_manager_catalog")
   │ fail → 503 "broker unavailable"
   │ ok
   ▼
[Celery broker] returns {"status":"queued","task_id":...}
   │
   ▼
[Next route] returns 202 {"status":"queued","task_id":...}
   │
   ▼
[ManagerSyncButton] 显示 "已加入队列，task_id=xxx"
```

### Celery worker (async)

```
[scanner.tasks.sync_manager_catalog]
   │
   ├─ step 1: GET https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json
   │           httpx.HTTPError → return {"status":"failed","stage":"fetch","error":"<msg>"}
   │
   ├─ step 2: json.loads → dict {id: {...}, ...}
   │           json.JSONDecodeError → return {"status":"failed","stage":"parse","error":"malformed JSON"}
   │
   ├─ step 3: for each entry: parse `reference` URL → (owner, repo)
   │           invalid/missing/non-github → skip, increment skipped_invalid_url
   │
   ├─ step 4: SELECT github_owner, github_repo FROM nodes
   │           SELECT github_url FROM node_submissions WHERE status='pending'
   │           (parse url → owner/repo, lowercase) → merged dedup set
   │
   ├─ step 5: for each new (owner, repo):
   │           submitter_id = fetch_system_submitter_id()
   │           None → return {"status":"failed","stage":"system_user","error":"system user missing; run pnpm prisma db seed"}
   │           insert_pending_submission(submitter_id, f"https://github.com/{owner}/{repo}")
   │           per-row IntegrityError → append to errors list, continue
   │
   └─ step 6: return {
                  "status": "ok",
                  "fetched": <int>,
                  "added": <int>,
                  "skipped_existing": <int>,
                  "skipped_pending": <int>,
                  "skipped_invalid_url": <int>,
                  "errors": [{"entry_id": "...", "error": "..."}]
              }
```

### Result delivery

The Celery result is **not** delivered back to the admin (matches existing `/trigger-scan` pattern). To see what happened, admin counts new pending rows in `/admin/submissions`. Per spec scope: no sync history table, no client polling, no Server-Sent Events.

---

## Error Handling

### A. Network layer (JSON fetch)
- `httpx.HTTPError` (timeout, connection refused, 5xx) → task returns `{"status":"failed","stage":"fetch","error":"<msg>"}`
- No auto-retry. Manager JSON occasionally 503s; admin retries by re-clicking the button.
- Task does **not** write `scan_failures` (that table is for per-node failures; this is a catalog-level failure of different kind).

### B. JSON parsing
- `json.JSONDecodeError` → `{"status":"failed","stage":"parse","error":"malformed JSON"}`
- Top-level not a dict → stage=parse fail
- Entry missing `reference` field → skip that entry, count as `skipped_invalid_url`, task continues
- Empty JSON `{}` → task returns ok with `fetched=0, added=0`

### C. URL parsing
- `urlparse` fails / `netloc != 'github.com'` / fewer than 2 path segments / owner or repo empty → skip, `skipped_invalid_url += 1`
- All entries invalid → task still returns `{"status":"ok","added":0}` (not a failure)

### D. Database
- System user missing → task fails with `"system user missing; run pnpm prisma db seed"`
- Single INSERT failure (FK violation, connection drop) → append to `errors`, continue with next entry
- `nodes` SELECT fail → task fails stage=dedup_nodes; partial prior inserts remain in DB (harmless — admin rejects them in `/admin/submissions`)
- **No transaction wrapping the whole batch.** Per-row commits; partial success is acceptable.

### E. Idempotency
- No `autoretry_for` on this Celery task. Manager JSON-wide failures should not auto-retry and burn broker.
- Admin clicks button multiple times: each click re-fetches JSON and re-runs dedup. Safe.
- Re-running after a successful sync: entries that became pending are now in `skipped_pending`; no duplicates.

### F. Trigger chain (web → trigger_api)
- Next route 5s timeout → 502 `"trigger-api unreachable"`
- trigger_api returns 503 → Next route returns 502 `"trigger-api error: broker unavailable"`
- These failures mean enqueue failed; DB untouched. Admin retries.

### G. Admin UI
- Success → button shows "已加入队列，task_id=xxx" for 5s, then reverts
- Failure → red banner with `stage` + truncated `error`
- Component-local state only (no persistence); reload of `/admin` clears
- If `managerSystemUserId` is null → button disabled with tooltip "系统用户未初始化，请运行 pnpm prisma db seed"

---

## Edge Cases & Invariants

### Invariants the implementation must guarantee

1. **Cross-table dedup invariant:** `(owner_lower, repo_lower)` is in the skip set iff it exists in `nodes` (any status) OR in `node_submissions` where `status='pending'`. `approved` and `rejected` submissions are NOT in the skip set (intentional — allows re-import after admin removes a node or changes their mind on a rejection).

2. **Case-insensitive URL parsing:** `https://github.com/Foo/Bar` and `https://github.com/foo/bar` are treated as the same node. Both lowercased before insert and before dedup lookup.

3. **`reference` is `None` or empty string** → `skipped_invalid_url += 1`.

4. **URL fragments/queries ignored:** `https://github.com/foo/bar?ref=manager#readme` parses to `foo/bar`.

5. **JSON top-level is a list** (rare upstream change) → `stage=parse` fail.

6. **Empty `{}` JSON** → returns `{"status":"ok","fetched":0,"added":0}` — not a failure.

7. **System user lookup is per-task-run.** No in-process caching; if seed was just run, next sync sees it. Tolerates seed/user table race.

8. **No transaction wrapping the batch.** Per-row autocommit. Partial insert failures leave the partial state visible to admin (they reject or approve).

### Out of scope (explicit non-goals for this spec)

- ❌ Manager `models-list.json` / `extension-node-map.json` (different semantics)
- ❌ Auto-approve for "well-known" Manager entries (no curated whitelist)
- ❌ Sync history / audit table (deliberately deferred)
- ❌ UI display of Manager metadata (title, stars, description) in `/admin/submissions`
- ❌ Celery beat scheduled sync
- ❌ Incremental update of `name`/`description` for nodes already in DB
- ❌ Background polling / Server-Sent Events for the admin button
- ❌ Schema migrations to `node_submissions` or any other table
- ❌ UI tests (button + flash message verified manually)

---

## Testing

### Layer 1 — Python (pytest, `scanner/tests/test_sync_manager_catalog.py`)

**Fixtures:**
- `comfyui_nodes_test` MySQL DB reset between tests (existing conftest)
- `pytest-httpx` mocking GitHub responses (existing)
- `CELERY_TEST_EAGER=1` + `task_always_eager=True` (existing)
- New fixture: `seed_comfyui_manager_user` in conftest — idempotent upsert of `comfyui-manager` system user

**Test cases:**

| Name | Input | Expected |
|---|---|---|
| `test_happy_path` | 3 fresh entries | `added=3, skipped_existing=0, skipped_pending=0, skipped_invalid_url=0, errors=[]` |
| `test_all_existing_in_nodes` | Pre-seed 2 nodes, feed 2 matching entries | `added=0, skipped_existing=2` |
| `test_all_pending_in_submissions` | Pre-seed 2 pending submissions, feed 2 matching entries | `added=0, skipped_pending=2` |
| `test_approved_not_in_dedup` | Pre-seed 1 approved submission + feed matching entry | `added=1, skipped_pending=0` (approved doesn't block) |
| `test_rejected_not_in_dedup` | Pre-seed 1 rejected submission + feed matching entry | `added=1` (rejected doesn't block) |
| `test_mixed_dedup` | 1 nodes + 1 pending + 1 fresh entry | `added=1, skipped_existing=1, skipped_pending=1` |
| `test_case_insensitive_dedup` | Seed nodes with `Foo/Bar`, feed entry with `foo/bar` | `skipped_existing=1` |
| `test_missing_reference_field` | 1 entry missing `reference` | `skipped_invalid_url=1, added=0`, task returns ok |
| `test_non_github_url` | `reference=https://gitlab.com/foo/bar` | `skipped_invalid_url=1` |
| `test_github_url_with_query_and_fragment` | `https://github.com/foo/bar?ref=x#y` | parses to `foo/bar`, `added=1` |
| `test_url_with_nested_path` | `https://github.com/foo/bar/tree/main` | parses to `foo/bar` (first 2 segments) |
| `test_malformed_json` | httpx returns `"not json {"` | task returns `stage=parse`, DB unchanged |
| `test_json_top_level_is_list` | httpx returns `[{"reference":"..."}]` | task returns `stage=parse`, DB unchanged |
| `test_empty_json` | httpx returns `{}` | `added=0, fetched=0`, status ok |
| `test_http_500` | httpx raises HTTPError | task returns `stage=fetch` |
| `test_system_user_missing` | Delete `comfyui-manager` user before run | task fails with `"system user missing"` |
| `test_idempotent_rerun` | Run twice with same input | second run: `added=0, skipped_pending=<first added>` |
| `test_partial_insert_failure` | Mock cursor so 3rd INSERT raises IntegrityError | `errors=[{entry_id:...}], added=2` |

**Test fixture file:** `scanner/tests/fixtures/manager_catalog.json` with 5 representative entries:
- 1 valid GitHub URL (happy path)
- 1 missing `reference` field
- 1 non-GitHub URL (`gitlab.com/...`)
- 1 GitHub URL with nested path
- 1 with `reference=null`

### Layer 2 — TypeScript (vitest, `web/tests/api/admin-manager-sync.test.ts`)

**Fixtures:** Reuse `web/tests/fixtures.ts` (existing admin user fixture).

| Name | Input | Expected |
|---|---|---|
| `test_unauthenticated` | No session | 401 |
| `test_non_admin` | Regular user session | 403 "admin only" |
| `test_happy_path` | Admin session + mock trigger_api returns 202 + task_id | Passes through `{status:"queued", task_id:"abc"}` |
| `test_trigger_api_5xx` | Mock trigger_api returns 503 | Returns 502 "trigger-api error" |
| `test_trigger_api_timeout` | Mock fetch hangs 6s (exceeds 5s AbortController) | Returns 502 "trigger-api unreachable" |
| `test_env_default` | `SCANNER_TRIGGER_API_URL` unset | Default `http://127.0.0.1:8081` |

### Coverage summary

- ✅ Sync logic all branches (dedup, URL parsing, error skipping)
- ✅ System user dependency (missing → fail fast)
- ✅ Idempotency (re-run safe)
- ✅ HTTP trigger chain (admin → trigger_api → enqueue)
- ✅ Auth/role guards
- ✅ Timeout / network errors
- ⚠️ UI behavior: manual verification only (button + flash)

---

## Interface Contracts (verbatim)

### `scanner/db.py` helpers

```python
def fetch_existing_owner_repo_pairs() -> set[tuple[str, str]]:
    """Return set of (owner_lower, repo_lower) pairs that exist in
    `nodes` (any status) or in `node_submissions` where status='pending'."""

def fetch_system_submitter_id(username: str = "comfyui-manager") -> int | None:
    """Return users.id for the system submitter user, or None if missing."""

def insert_pending_submission(submitter_id: int, github_url: str) -> int:
    """INSERT one row into node_submissions (status='pending'). Returns new id.
    Raises pymysql.IntegrityError on duplicate (shouldn't happen given dedup)."""
```

### `scanner/tasks/sync_manager_catalog.py` task

```python
@celery_app.task(name="scanner.tasks.sync_manager_catalog")
def sync_manager_catalog() -> dict:
    """Fetch ComfyUI Manager's custom-node-list.json, write new entries to
    node_submissions (pending) for admin review. Idempotent: re-runs are no-ops
    for already-known nodes.

    Returns dict with status, fetched, added, skipped_*, errors[].
    """
```

### `scanner/trigger_api.py` endpoint

```python
@app.post("/trigger-manager-sync")
def trigger_manager_sync():
    """Enqueue sync_manager_catalog. Returns 202 + task_id, or 503 on broker fail."""
```

### Next.js route

```
POST /api/v1/admin/manager/sync
Auth: admin session required
Response 202: { status: "queued", task_id: "..." }
Response 401: unauthenticated
Response 403: admin only
Response 502: trigger-api unreachable / error (含 stage 摘要)
```

### `seed.ts` addition

```typescript
async function seedSystemUsers() {
  await prisma.user.upsert({
    where: { username: 'comfyui-manager' },
    update: {},
    create: {
      username: 'comfyui-manager',
      role: 'user',
      avatar_url: '',
      // github_id: null, password_hash: null, email: null — all default-nullable
    },
  });
}
```
Called idempotently at the end of `main()`.

---

## Followups (deferred)

- Manager `models-list.json` / `extension-node-map.json` integration (separate spec when needed)
- Auto-approve well-known Manager entries (policy decision; not infra)
- Sync history / audit table (operational visibility; v2)
- UI badge/label for Manager-sourced submissions (cosmetic)
- Celery beat scheduled sync (operational)
- Incremental update of `name`/`description` for nodes already in DB (separate spec)
- Background polling or SSE for the admin button (UX improvement)