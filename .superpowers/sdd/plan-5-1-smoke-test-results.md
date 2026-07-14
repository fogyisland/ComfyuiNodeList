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

## Implementation commits (13 total on local `main`, not yet pushed — features + 5 review fixes)

```
3404f21 docs(spec): correct Component 3 record_scan_failure call + add Plan 5.1.1 followup     [review-fix-5]
0ce2fe1 refactor(scanner): resolve_branch_sha classifies via _classify_response                 [review-fix-4]
53e75f6 refactor(scanner): use keyword args for record_scan_failure consistency                 [review-fix-3]
2e8a1d2 refactor(tests): consolidate db_eager fixtures via _reset_database helper               [review-fix-2]
b6b522c docs(sdd): Plan 5.1 smoke test results (all green)                                      [task-6-smoke]
60ebac4 fix(tests): migrate test_integration.py db_eager + web tests/setup.ts to migrate deploy [fix-2]
7635162 feat(scanner): daily prune_expired_resolutions Celery task + beat schedule              [task-5]
84da47c fix(scanner): detect target_commitish branch names and resolve via git_refs API         [task-4]
855cdee feat(scanner): GitHubClient.resolve_branch_sha() with 7-day cache                       [task-3]
49c48dc fix(tests): trailing newlines on conftest.py and _db_fixtures.py (Global Constraint #1)  [fix-1]
7110438 fix(tests): migrate db_eager fixture to use migrate deploy (MySQL 5.7 fix)              [fix-2]
a6cf1ce feat(scanner): DB helpers for gitsha_resolutions cache (lookup, upsert, prune)          [task-2]
146e15d feat(schema): add gitsha_resolutions cache table for target_commitish branches          [task-1]
```

Plus spec commit `ffa4157` (not in feature range).

## Whole-branch review (final, 2026-07-14)

Dispatched on the opus model with branch range `ffa4157..b6b522c` (= the entire Plan 5.1 implementation). Verdict: **Ready to merge, with one recommended followup.**

5 findings — 4 fixed in-review (commits `2e8a1d2`, `53e75f6`, `0ce2fe1`, `3404f21`), 1 deferred as Plan 5.1.1 followup.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Important | Fixture consolidation: 4 files duplicated `_reset_database` body (conftest, test_tasks, test_integration, _db_fixtures helper). | Fixed in `2e8a1d2` — extracted `_reset_database(database_url, web_dir)` helper in `_db_fixtures.py`; 3 fixtures reduced to a single delegation line. |
| 2 | Minor | `record_scan_failure` call site used positional args that diverge from keyword form used elsewhere. | Fixed in `53e75f6` — switched both call sites in `fetch_releases.py` to keyword form. |
| 3 | Important | `resolve_branch_sha` inlined `status_code in (404, 403)` check, duplicating `_request_with_retry`'s `_classify_response`. | Fixed in `0ce2fe1` — delegate to `_classify_response(exc.response) == "terminal_4xx"` so the two classification paths stay in lockstep. Also updated docstring. |
| 4 | Minor | Spec Component 3 example used positional 4-arg call missing `will_retry`. | Fixed in `3404f21` — switched spec example to keyword form matching actual signature; documented the divergence history. |
| 5 | Recommended followup | `@db.DateTime` (precision 0) on `resolved_at` column is the root cause of the 4 MySQL 5.7 fixture-migration commits. Should be `@db.DateTime(3)` to match implicit precision of existing `DateTime @default(now())` columns. | Deferred to Plan 5.1.1 — added as followup entry in spec §Followups and as Plan 5.1.1 candidate in the spec. Not blocking: production uses `migrate deploy`, which accepts the current schema. |

### Post-fix verification

After all 5 review-fix commits, re-ran the smoke tests:

- [x] Web vitest: 167/167 pass (28 test files, 0 failures; 484s runtime)
- [x] Python pytest: 64/64 pass — re-run 44/44 on Plan-5.1-covered subset (9m32s runtime)
- [x] No new lint warnings introduced
- [x] Migration still applies cleanly; schema unchanged
- [x] All 4 review-fix commits + smoke doc update test-run clean

## Concerns / Caveats (resolved + remaining)

1. **(Resolved) Spec verbatim code needed runtime correction:** Both the spec and the call sites now use keyword form (`node_id=`, `task_name=`, `error_message=`, `will_retry=False`). See commit `3404f21` + `53e75f6`.

2. **(Resolved, followup tracked) Task 1's MySQL 5.7 incompatibility** — root cause `@db.DateTime` precision mismatch documented as the Plan 5.1.1 followup. Production pipeline is unaffected (`migrate deploy` accepts the schema). Fixture migration to `migrate deploy` was committed across 4 fixtures in commits `7110438` + `60ebac4`.

3. **`lint` count differs from Plan 5 smoke test (10 vs 8):** Verified via `git log ffa4157..HEAD -- <each warning file>` that no warning file was modified by Plan 5.1. The 2 "extra" warnings (`SubmitHandler` in `NodeRequirementTable.tsx`, `_versionId` in `HistoryClient.tsx`) predate Plan 5.1 and were simply not captured in Plan 5's smoke-test warning count. Not blocking.

## Status

Plan 5.1 implementation complete; all review fixes applied; ready to push.

The next step is `git push` to `origin/main` (currently 13 commits ahead), then `superpowers:finishing-a-development-branch`.
