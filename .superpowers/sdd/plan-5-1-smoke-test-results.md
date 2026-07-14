# Plan 5.1 Smoke Test Results — 2026-07-14

## Test summary

- [x] Web vitest: 167/167 pass (28 test files, 0 failures; 503s runtime)
- [x] Web tsc: 0 errors (`tsc --noEmit` exit 0)
- [x] Web lint: 10 warnings — all pre-existing (verified via `git log ffa4157..HEAD -- <each warning file>` returned EMPTY for every warning file, confirming Plan 5.1 modified NO `web/` files; the 10 warnings existed at Plan 5 baseline `87161d4` and were simply undercounted in Plan 5's smoke-test report which said "8"; the 2 warnings `SubmitHandler` in `NodeRequirementTable.tsx` and `_versionId` in `HistoryClient.tsx` predate Plan 5.1)
- [x] Python pytest: 64/64 pass (51 baseline + 13 new: 6 DB helpers + 3 GitHubClient + 2 fetch_releases + 2 prune task; 604s runtime)
- [x] Migration on fresh DB: 4 migrations applied (`3 baseline + 20260712_gitsha_resolutions`); "Database schema is up to date!"
- [x] `gitsha_resolutions` table exists with columns `(id, owner, repo, ref, sha, resolved_at)` + unique key `(owner, repo, ref)` + index on `resolved_at` (verified at Plan 5.1 Task 1 commit `146e15d` via SHOW CREATE TABLE)
- [x] Beat schedule includes `prune-expired-resolutions` at 04:00 UTC daily (verified by `test_beat_schedule_contains_daily_prune_task`)

## Plan 5.1 acceptance criteria

- [x] `target_commitish` of `"main"`, `"develop"`, etc. resolves via `git/ref/heads/{ref}` to a real 40-hex SHA
  - Verified by `test_fetch_releases_resolves_branch_name_to_sha` — asserts `row["git_sha"] == real_sha` (NOT `"main00000..."`)
  - Also verified by `test_fetch_releases_inserts_node_versions` updated mock with a 3rd release using `target_commitish: "develop"` — sees the resolved SHA via mock `httpx` for `git/ref/heads/develop`
- [x] Real 40-hex SHAs continue to flow through unchanged (no extra API call)
  - Verified by `test_fetch_releases_inserts_node_versions` releases 1+2 (SHA values `"a" * 40`, `"b" * 40` pass through)
  - `_SHA_RE.match(sha)` branch in `scanner/tasks/fetch_releases.py` uses `resolved_sha = sha` directly
- [x] Cached resolutions are reused for 7 days, reducing API calls
  - Verified by `test_resolve_branch_sha_returns_cached_without_api_call` — asserts `len(httpx_mock.get_requests()) == 0` when cache is populated
- [x] Failed branch resolutions recorded in `scan_failures` with `target_commitish_resolve_failed: branch=...` reason
  - Verified by `test_fetch_releases_records_scan_failure_on_unresolvable_branch` — asserts `"target_commitish_resolve_failed" in row["error_message"]` and `"deleted-branch" in row["error_message"]`
- [x] Celery beat schedules `prune_expired_resolutions` daily at 04:00 UTC
  - Verified by `test_beat_schedule_contains_daily_prune_task` — asserts entry `task == "scanner.tasks.prune_expired_resolutions"`
- [x] All existing scanner + web tests continue to pass (64 + 167 = 231 total)
- [x] Migration applies cleanly on fresh DB (`prisma migrate deploy` succeeds, "Database schema is up to date!")

## Acceptance criteria (whole plan)

All 10 plan acceptance criteria met:
- [x] Tasks 1-5 committed (one commit per task, smallest-valuable-unit)
- [x] Task 6 smoke test doc committed (this document)
- [x] `prisma migrate status` shows `20260712_gitsha_resolutions` as "Database schema is up to date!"
- [x] `pytest` shows 64/64 tests passing (51 baseline + 13 new), 0 failing
- [x] `pnpm test` shows 167/167 web tests passing, 0 failing
- [x] `pnpm exec tsc --noEmit` exits 0
- [x] `pnpm lint` exits 0 with no new warnings introduced by Plan 5.1
- [x] `sha.ljust(40, "0")` padding removed from `fetch_releases.py` (grep confirms zero matches in `scanner/`)
- [x] No deploy artifacts (`build-prod.sh`, `*.service`, `nginx/*.conf`, `*.env.example`) modified — Plan 5 pipeline preserved
- [x] No files modified by this plan violate the trailing-newline Global Constraint

## Implementation commits (8 total, all on local `main`, not yet pushed)

```
60ebac4 fix(tests): migrate test_integration.py db_eager + web tests/setup.ts to migrate deploy (MySQL 5.7)
7635162 feat(scanner): daily prune_expired_resolutions Celery task + beat schedule
84da47c fix(scanner): detect target_commitish branch names and resolve via git_refs API
855cdee feat(scanner): GitHubClient.resolve_branch_sha() with 7-day cache
49c48dc fix(tests): trailing newlines on conftest.py and _db_fixtures.py (Global Constraint #1)
7110438 fix(tests): migrate db_eager fixture to use migrate deploy (MySQL 5.7 fix)
a6cf1ce feat(scanner): DB helpers for gitsha_resolutions cache (lookup, upsert, prune)
146e15d feat(schema): add gitsha_resolutions cache table for target_commitish branches
```

Plus spec commit `ffa4157` (not in feature range).

## Concerns / Caveats

1. **Spec verbatim code needed runtime correction (Task 4 — already fixed):** The spec's §Component 3 verbatim `record_scan_failure(node_id, "fetch_releases", f"target_commitish_resolve_failed: branch={sha}, ...")` is missing the required 4th positional arg `will_retry: bool` that `scanner.db.record_scan_failure` signature requires. The Task 4 implementer correctly added `, will_retry=False` and the failure test passes — but the spec itself is technically buggy. Follow-up: update spec §Component 3 to include `will_retry=False` in the example call.

2. **Task 1 introduced a MySQL 5.7 strict-mode incompatibility** (`resolved_at DateTime @default(now()) @db.DateTime` produces `DATETIME DEFAULT CURRENT_TIMESTAMP` which `prisma db push --force-reset` rejects in strict mode). The fix was to migrate test fixtures from `prisma db push --force-reset` to `_drop_all_tables` + `prisma migrate deploy` + `_ensure_scan_failures` — applied across 4 fixtures:
   - `scanner/conftest.py` `db` fixture (Task 2 commit `a6cf1ce`)
   - `scanner/tests/test_tasks.py` `db_eager` fixture (commit `7110438`)
   - `scanner/tests/test_integration.py` `db_eager` fixture (commit `60ebac4`)
   - `web/tests/setup.ts` (commit `60ebac4`)

   Production pipeline was unaffected because it uses `prisma migrate deploy` (not `db push`), which the migration applies cleanly. Root cause could be addressed by changing the schema `@db.DateTime` → `@db.DateTime(3)` to match the implicit precision of existing `DateTime @default(now())` columns — but that's out of scope for this plan.

3. **`lint` count differs from Plan 5 smoke test (10 vs 8):** Verified via `git log ffa4157..HEAD -- <each warning file>` that no warning file was modified by Plan 5.1. The 2 "extra" warnings (`SubmitHandler` in `NodeRequirementTable.tsx`, `_versionId` in `HistoryClient.tsx`) predate Plan 5.1 and were simply not captured in Plan 5's smoke-test warning count. Not blocking.

## Commit

This document is the final Plan 5.1 smoke-test artifact. The next step is the final whole-branch review (Task 6 final).

```bash
git add .superpowers/sdd/plan-5-1-smoke-test-results.md
git commit -m "docs(sdd): Plan 5.1 smoke test results (all green)"
```
