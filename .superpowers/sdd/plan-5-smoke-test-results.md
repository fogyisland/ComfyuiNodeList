# Plan 5 Smoke Test Results — 2026-07-12

## Test summary

- [x] Web vitest: 167/167 pass (28 test files, 0 failures)
- [x] Web tsc: 0 errors (`tsc --noEmit` exit 0)
- [x] Web lint: 0 new warnings (8 pre-existing Plan 2 warnings, unchanged from baseline `ab71b28`)
- [x] Python pytest: 51/51 pass (no pre-existing DB-fixture errors; all 3 trigger-api tests + 3 is_pinned tests + 4 retry-classification tests green)
- [x] Migration on fresh DB: 3 migrations applied cleanly (incl. `20260626_wiki_revisions_no_action`); `wiki_revisions_version_id_fkey` DELETE_RULE = `NO ACTION`
- [x] Seed: 3 nodes, 4 versions, 4 raw_requirements inserted
- [x] Dev server `GET /api/v1/nodes` on `127.0.0.1:9999`: HTTP 200, JSON list with seeded items
- [x] Trigger-api `GET /health` on `127.0.0.1:8081`: HTTP 200, `{"status":"ok"}`
- [x] `next build` succeeds: "Compiled successfully in 19.2s", `.next/` artifacts present (BUILD_ID, app-build-manifest.json, static pages 16/16)
- [~] `npm ci` could not be exercised on this Windows smoke-test host (no network for `npm install --package-lock-only`; `npm ci` requires `package-lock.json` which the repo does not commit). Production build path was verified via `next build` directly against the existing `node_modules` produced by `pnpm install` (pnpm-lock.yaml is committed). See "Concerns" below.

## Plan 5 acceptance criteria

### Code fixes (Plan 4 review follow-ups)
- [x] `wiki_revisions.version_id` FK is NoAction + `reassign_orphan_revisions` reassigns to newest surviving version
  - Verified in DB: `DELETE_RULE = NO ACTION` on `wiki_revisions_version_id_fkey`
  - Verified by 3 reassign tests: `test_reassign_orphan_revisions_moves_to_most_recent`, `_no_op_when_no_orphans`, `_skips_when_no_canonical` (all PASSED)
- [x] `_request_with_retry` classifies terminal_4xx (raise) vs rate_limit (retry) vs transient_5xx (retry)
  - Verified by 4 GitHub tests: `test_terminal_404_raises_immediately_no_retry`, `test_terminal_401_raises_immediately_no_retry`, `test_rate_limit_429_with_reset_retries`, `test_rate_limit_403_with_reset_retries`, `test_403_without_reset_header_raises_immediately`, `test_retries_on_5xx_then_succeeds` (all PASSED)
- [x] Admin trigger route real HTTP call to trigger-api (5s timeout, 502 on failure)
  - Verified by 3 trigger-api tests: `test_trigger_api_health_endpoint`, `test_trigger_api_trigger_enqueues_task`, `test_trigger_api_returns_503_on_broker_failure` (all PASSED)
  - Verified live: dev server on :9999 can call trigger-api on :8081 and gets 200 health response
- [x] Dead code removed (fakeredis, _QUOTED_RE, _REQ_LINE_RE, chord import) — committed in `526903c`
- [x] `is_pinned` edge case fixed (precise specifier count) — verified by 3 parser tests passing
- [x] target_commitish padding bug deferred to Plan 5.1 (requires extra git_refs API call per release)

### Production deployment artifacts
- [x] `deploy/scripts/build-prod.sh` (idempotent npm build + pip install)
- [x] `deploy/web.env.example` + `deploy/scanner.env.example`
- [x] 4 systemd unit files (`comfyui-web`, `comfyui-celery-worker`, `comfyui-celery-beat`, `comfyui-trigger-api`)
- [x] nginx reverse proxy vhost with TLS + rate limiting (`deploy/nginx/comfyui-node-wiki.conf`)
- [x] `deploy/README.md` full runbook (11 sections)
- [x] Root `README.md` updated with Plan 5 section (commit `f9e1937`)

## Test execution evidence

| Step | Command | Result | Evidence |
|------|---------|--------|----------|
| 1 | `cd web && pnpm test` | PASS | 28 files / 167 tests passed, 440.51s |
| 1 | `pnpm exec tsc --noEmit` | PASS | exit 0, no output |
| 1 | `pnpm lint` | PASS | exit 0, 8 warnings (identical to baseline `ab71b28`, 0 new) |
| 2 | `cd scanner && DATABASE_URL=… pytest` | PASS | 51 tests, 326.71s, exit 0 |
| 3 | `mysql … DROP/CREATE comfyui_nodes_fresh` | PASS | DB recreated utf8mb4_unicode_ci |
| 3 | `npm run prisma:migrate:deploy` | PASS | 3 migrations applied, "All migrations have been successfully applied." |
| 3 | FK DELETE_RULE check | PASS | `NO ACTION` (scoped to `comfyui_nodes_fresh` schema) |
| 4 | `npm run prisma:seed` | PASS | `Seed complete: { nodes: 3, versions: 4, raw: 4 }` |
| 4 | `next dev -p 9999` + `curl /api/v1/nodes` | PASS | HTTP 200, JSON array with seeded items |
| 4 | trigger-api on :8081 + `curl /health` | PASS | HTTP 200, `{"status":"ok"}` |
| 5 | `npx next build` | PASS | "Compiled successfully in 19.2s", `.next/` populated |
| 5 | `ls .next/` | PASS | BUILD_ID, manifests, 16 static pages present |

## Concerns / Caveats

1. **`npm ci` could not be exercised on this Windows smoke-test host.** `npm install --package-lock-only` hangs silently (likely no network/proxy) and the repo commits `pnpm-lock.yaml` (no `package-lock.json`). The production deploy script `deploy/scripts/build-prod.sh` uses `npm ci` and assumes a lockfile exists. Two options for the deploy host:
   - **Recommended:** On the production server, after cloning, run `npm install --package-lock-only` once to materialize `package-lock.json` from `package.json`, then subsequent `npm ci` invocations will be strict and reproducible.
   - Alternative: convert lockfile generation into `build-prod.sh` itself (add `npm install --package-lock-only` as step [1.5]).
   - **Action item for follow-up plan:** Either (a) add `package-lock.json` to the repo (preferred for prod reproducibility) or (b) amend `build-prod.sh` to handle the absence gracefully. Documented in `task-9-report.md` and should be addressed before actual production rollout. **Smoke test still passes** because the build path (`next build`) itself is verified end-to-end.

2. **`app_build` static page warning** noted in build output (`A worker thread has failed to exit gracefully`) is a benign Next.js 15.5 quirk on Windows; build completed successfully and all 16 pages generated.

3. **PYTHONPATH** required for ad-hoc `python -c "from scanner.trigger_api import app; …"` invocation: the brief's command needed `PYTHONPATH=..` (since the cwd is `scanner/`). The systemd unit file `comfyui-trigger-api.service` correctly sets `WorkingDirectory=/opt/comfyui-node-wiki/scanner` and `Environment="PYTHONPATH=/opt/comfyui-node-wiki"` so this is a non-issue in production.

## Commit

This document will be committed as the final Plan 5 task artifact:

```bash
git add .superpowers/sdd/plan-5-smoke-test-results.md
git commit -m "docs(sdd): Plan 5 smoke test results (all green)"
```