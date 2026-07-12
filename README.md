# ComfyUI Node Wiki

公开的 ComfyUI 节点元数据 Wiki 服务。本仓库目前包含 **Plan 1 + Plan 2 + Plan 3 + Plan 4 + Plan 5** 的实现。

完整设计规格：[`docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md`](docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md)。

## 先决条件

- Node.js 20 LTS
- pnpm 9
- 一个可连接的 MySQL 5.7+ / 8.0+ 实例（本地安装或远程均可，需具备 `CREATE DATABASE` 权限）
- `mysql` 命令行客户端（仅用于一次性创建数据库，可选用 Workbench / DBeaver 等 GUI 替代）

## 首次启动

```bash
# 1. 安装依赖
cd web && pnpm install

# 2. 复制环境变量并填入你的 MySQL 连接信息
cp web/.env.example web/.env
# 编辑 web/.env，把 DATABASE_URL 改为 mysql://USER:PASSWORD@HOST:3306/comfyui_nodes

# 3. 创建数据库（仅首次需要）
mysql -h HOST -u USER -pPASSWORD -e \
  "CREATE DATABASE IF NOT EXISTS comfyui_nodes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE IF NOT EXISTS comfyui_nodes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. 应用数据库迁移（开发库）
cd web && pnpm prisma migrate dev

# 5. 灌入示例数据（3 个节点 / 4 个版本）
pnpm prisma:seed

# 6. 启动开发服务器
pnpm dev
```

打开 http://localhost:9999 应能看到首页（含 3 个种子节点）。

## 测试

```bash
cd web
pnpm test          # 单次运行所有 Vitest 套件
pnpm test:watch    # 开发期间监听模式
```

集成测试使用独立数据库 `comfyui_nodes_test`（配置在 `web/.env.test`）。`tests/setup.ts` 在每个测试运行前会自动 `prisma db push` 并清空表。

## 项目结构

```
.
├── .env.example                # 环境变量样例（DATABASE_URL、GitHub OAuth）→ 实际位于 web/.env.example
├── docs/superpowers/
│   ├── specs/                  # 设计规格
│   └── plans/                  # 实现计划（本文件所在目录）
└── web/                        # Next.js 15 应用
    ├── prisma/                 # schema + seed
    ├── app/                    # App Router 页面 + API 路由
    ├── lib/                    # 业务逻辑（db、auth、published 等）
    └── tests/                  # Vitest 单测 + 集成测试
```

## 下一步


## Wiki editing & admin review (Plan 2)

Logged-in users can propose edits to any node version, and admins can review them.

### Routes

- `GET /wiki/<versionId>` — edit a single version (form pre-filled from published view). Requires login.
- `GET /wiki/<versionId>/submit` — confirm a pending draft. Requires login.
- `GET /wiki/<versionId>/history` — list of all revisions + a side-by-side diff viewer. Requires login.
- `GET /admin` — admin dashboard with pending counts (admin only).
- `GET /admin/revisions` — review pending wiki revisions (admin only).
- `GET /admin/submissions` — review pending node submission requests (admin only).
- `GET /admin/users` — change user roles (admin only; you cannot demote yourself).

### API (machine-readable)

All endpoints return JSON. Wiki endpoints require a session; admin endpoints additionally require `role=admin`.

- `GET  /api/v1/wiki/{versionId}` — load published + your latest pending
- `GET  /api/v1/wiki/{versionId}/history?page=&page_size=` — paginated history
- `GET  /api/v1/wiki/revisions/{id}` — single revision detail
- `POST /api/v1/wiki/{versionId}/revisions` — create a pending revision (zod-validated)
- `POST /api/v1/wiki/revisions/{id}/withdraw` — author or admin only
- `GET  /api/v1/wiki/diff?from={id}&to={id}` — field-level diff
- `POST /api/v1/conflicts/check` — real PEP 440 conflict detection (4 conflict types; accepts optional `draft` field for wiki edit preview)
- `GET  /api/v1/admin/revisions/pending?page=&page_size=`
- `POST /api/v1/admin/revisions/{id}/approve` — body `{ review_note?: string }`
- `POST /api/v1/admin/revisions/{id}/reject`  — body `{ review_note: string }`
- `GET  /api/v1/admin/submissions/pending`
- `POST /api/v1/admin/submissions/{id}/approve` — body `{ review_note?: string }`. Creates a Node row from the submission's GitHub URL.
- `POST /api/v1/admin/submissions/{id}/reject`  — body `{ review_note: string }`
- `GET  /api/v1/admin/users`
- `POST /api/v1/admin/users/{id}/role` — body `{ role: 'admin' | 'user' }`. Self-demote returns 409.

## Testing

```bash
cd web
pnpm test                  # Vitest, runs against comfyui_nodes_test DB
pnpm exec tsc --noEmit     # TypeScript
pnpm lint                  # Next/ESLint
```

Tests cover:
- `web/tests/lib/` — unit tests for `wiki-schema`, `diff`, `wiki` (helpers), `conflict-engine`, `revision-status` enum.
- `web/tests/api/` — integration tests for the 15 new endpoints under `/api/v1/wiki`, `/api/v1/conflicts/check`, and `/api/v1/admin`.

The test DB (`comfyui_nodes_test`) is reset between files via `prisma db push --force-reset` in `web/tests/setup.ts`. Vitest uses `fileParallelism: false` (configured in `vitest.config.ts`) so the shared `prisma client` does not race.

For UI smoke tests see the **Manual smoke test** steps in `docs/superpowers/plans/2026-06-25-plan-02-wiki-editing.md` Task 24.

## Known limits (Plan 2)

- **No automated submissions.** New node submissions are created by users through the wiki edit form and reviewed manually; there is no scanner-driven queue in Plan 2.
- **No email notifications.** When an admin approves or rejects a revision, the author is not notified. The author's `/wiki/<versionId>` view will reflect the new status on next visit.
- **Approved revisions cannot be edited or re-submitted.** They are immutable. A new pending revision must be created from scratch.
- **Self-demotion is blocked.** An admin can promote other users to admin but cannot demote themselves; an out-of-band DB update is required to recover (the bootstrap admin via `BOOTSTRAP_ADMIN_GITHUB_ID` is one such recovery path).
- **Out of scope (deferred plans):** Python Celery scanner (Plan 4), production deployment / CI / monitoring / Docker (Plan 5).

## Conflict detection engine (Plan 3)

`POST /api/v1/conflicts/check` now runs a real PEP 440-based conflict detection algorithm in `web/lib/conflict-engine.ts`. The endpoint takes:

```json
{
  "installed": [{"owner": "...", "repo": "...", "version_tag": "..."}],
  "draft": {                       // OPTIONAL — wiki edit form uses this
    "python_min": "...", "python_max": "...",
    "dependencies": [...],
    "node_class_mappings": [...],
    "incompatibilities": [...]
  }
}
```

It returns 4 categories of conflicts:

- `python_version` (error) — node pairs with non-overlapping `python_min`/`python_max`
- `package_version` (error if pinned+incompatible, warning if ranges disjoint) — packages with the same name but incompatible specs
- `node_class` (error) — class names declared by 2+ nodes
- `incompatibility` (warning) — node pairs that declare each other as incompatible

### Wiki edit page integration

The `<ConflictPreview>` component on `/wiki/[versionId]` debounces the form state by 500ms and shows real-time conflicts against all other published nodes.

### API + algorithm

- The `@renovatebot/pep440` npm package parses spec strings (`>=1.0.0,<2.0.0`, `==1.5.0`, etc.) into `(min, max, is_pinned)` tuples.
- Pure-function detectors live in `web/lib/conflict-engine.ts`; each is unit-tested in `web/tests/lib/conflict-engine.test.ts`.
- The `checkConflicts()` orchestrator loads each installed version's published data via `getPublishedRequirements()` and applies the `draft` as a virtual node.

## Testing (Plan 3 additions)

Plan 3 adds:
- `web/tests/lib/pep440-utils.test.ts` — 18 tests for spec parsing + range intersection
- `web/tests/lib/conflict-engine.test.ts` — 12 detector tests + 3 integration tests (real DB)
- `web/tests/api/conflicts-check.test.ts` — extended with `draft` field tests

## Known limits (Plan 3)

- **`node_class_mappings` is not editable in the wiki form.** The Plan 2 form has a placeholder ("暂不支持多个映射数组 — Plan 3 改进") and Plan 3 does not fix it. The conflict engine fully supports `node_class` detection, but only against the `installed` list, not the `draft`. To fix: add a `NodeClassMappingEditor` component (deferred).
- **No caching.** Every form keystroke (after debounce) triggers a fresh DB load. Acceptable for now (the query is small) but a future plan can add Redis-backed caching.
- **No background conflict scan.** The check is on-demand only; the wiki edit page does not pre-warm conflicts.
- **Pinned-version check uses simple intersection.** A pinned `==X.Y.Z` is treated as `[X.Y.Z, X.Y.Z]`. Exotic cases like `===X.Y.Z` or `~=X.Y.Z` may not be fully handled — verify against real-world spec strings in Plan 4 integration.
- **Out of scope (deferred plans):** Python Celery scanner (Plan 4), production deployment (Plan 5), resolving Plan 2's 2 Important non-blocking findings (TOCTOU in reject/withdraw; submit page missing page-level gate).

## Python scanner (Plan 4)

A Python Celery worker (`scanner/`) automatically fetches GitHub releases for every active node, parses 5 file types from each version's source tarball, and writes to `node_raw_requirements`. Runs on a weekly Celery beat schedule (every Monday 03:00 UTC) + on-demand via `POST /api/v1/admin/scans/trigger`.

### Task flow

```
fetch_pending_nodes → (chord of fetch_releases per node)
                   → (chord of parse_version per version)
                   → cleanup_old_versions (keep latest 5)
```

### Parsers

- `pyproject.toml` — `dependencies` + `requires-python` (stdlib `tomllib`)
- `requirements.txt` — `packaging.Requirement` per line
- `install.py` — AST scan for `os.system` / `subprocess.*` calls containing `pip install`
- `__init__.py` / `nodes.py` — regex for `NODE_CLASS_MAPPINGS = {...}` keys
- `README.md` — keyword scan for "incompatible with", "conflicts with", etc.

### Tech stack

- Python 3.11+ (uses stdlib `tomllib`)
- Celery 5 + Redis broker
- `httpx` (GitHub API), `pymysql` (raw SQL), `packaging` (PEP 440 specs)

### Testing (Plan 4 additions)

- `scanner/tests/test_github.py` — httpx mock + retry behavior
- `scanner/tests/test_db.py` — pymysql upsert + delete-old-versions
- `scanner/tests/test_parsers.py` — 5 parsers + pipeline (14 tests)
- `scanner/tests/test_tasks.py` — Celery tasks in `task_always_eager=True` mode
- `scanner/tests/test_integration.py` — full chain end-to-end
- `web/tests/api/admin-scans-trigger.test.ts` — manual-trigger endpoint

Run the Python suite: `cd scanner && pip install -r requirements-dev.txt && pytest`.
Run the web suite: `cd web && pnpm test`.

## Known limits (Plan 4)

- **`install.py` parser is regex/AST-light.** It handles `os.system` and `subprocess.check_call/run/call` with simple `pip install` payloads, but complex multi-line constructions or `runpy`/`importlib` indirection are not extracted. Sufficient for the ~95% of ComfyUI nodes that use the standard `install.py` pattern. A full AST visitor is a follow-up.
- **No `scan_failures` admin UI.** The table is populated, but there's no web page to view / retry. A follow-up plan adds a `/admin/scans` page.
- **Exotic PEP 440 specifiers (`~=`, `===`, `!=`) in `requirements.txt` are parsed but not visualized in conflict detection.** Plan 3's `pep440-utils.intersectRanges` does not handle these. Real-world ComfyUI node data may need this — track in Plan 4 follow-up.
- **Out of scope (deferred plans):** webhook-based real-time triggering (spec §14), Plan 2's 2 deferred Important findings.

## Production deployment (Plan 5)

Production deployment uses **direct Node.js + Python processes** supervised by systemd — no Docker. See [`deploy/README.md`](deploy/README.md) for the full runbook.

### Architecture

- 4 systemd services: `comfyui-web` (Next.js), `comfyui-celery-worker` (prefork, 4 procs), `comfyui-celery-beat` (weekly Mon 03:00 UTC), `comfyui-trigger-api` (Flask, localhost:8081)
- nginx reverse-proxies HTTPS traffic to Next.js on localhost:3000
- MySQL 8 + Redis 7 bound to localhost only
- `npm ci` + `npm run build` for production builds (dev still uses `pnpm`)

### Key files

- `deploy/scripts/build-prod.sh` — idempotent production build
- `deploy/web.env.example` / `deploy/scanner.env.example` — production env templates
- `deploy/systemd/*.service` — 4 systemd units (not auto-installed)
- `deploy/nginx/comfyui-node-wiki.conf` — nginx reverse proxy + TLS
- `scanner/trigger_api.py` — Flask HTTP bridge between Next.js and Celery
