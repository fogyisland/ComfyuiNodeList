# Plan 5.1.2 — Add `scan_failures` Prisma Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Prisma migration that creates `scan_failures` (matching what Prisma would have generated), then remove the two out-of-band workarounds (`web/tests/setup.ts` `SCAN_FAILURES_DDL` + `scanner/_db_fixtures.py` `_ensure_scan_failures`) so the migration becomes the single source of truth for the table.

**Architecture:** One hand-written migration file → dev DB resolved-as-applied (table already exists from earlier `db push`) → test DB + fresh DB deploy → remove two ~30-line workarounds. No scanner/Python or web/TS behavior changes — only test-fixture code removal. Production deploys cleanly via `npm run prisma:migrate:deploy` because the migration now creates `scan_failures`.

**Tech Stack:** Prisma 5 (already wired), MySQL 5.7/8 (dev/test/prod), Python `pymysql` (still used by `_drop_all_tables` after the workaround removal), Node.js `child_process.execSync`. No new dependencies.

## Global Constraints

These apply to every task. Conflicts with a task's spec are governed by these unless the task explicitly overrides.

1. **Trailing newline on every committed file** — Every `.py`, `.sql`, `.ts`, `.prisma`, `.md`, `.sh` file MUST end with `\n`. (Same rule Plan 5.1 §Global Constraints #1 and Plan 5.1.1 §Global Constraints #1.)
2. **Spec is the source of truth** — `docs/superpowers/specs/2026-07-14-plan-5-1-2-add-scan-failures-migration-design.md` (commit `19bd1ef`). When in doubt, follow the spec's exact code snippets, file paths, and field names.
3. **No scanner/Python or web/TS behavior changes** — Plan 5.1.2 only modifies (a) Prisma migration directory (additive), (b) test-fixture code (`_db_fixtures.py::_ensure_scan_failures` removal, `web/tests/setup.ts::SCAN_FAILURES_DDL` removal). Do NOT touch `scanner/db.py`, `scanner/github.py`, `scanner/tasks/*.py`, `scanner/celery_app.py`, or any production web code (`web/app/`, `web/src/`, `web/prisma/schema.prisma`). The Plan 5.1 (commit `7eebadb`) + Plan 5.1.1 (commit `6bd6e81`) state of these files is the contract.
4. **Plan 5 deployment pipeline preserved** — Do NOT touch `deploy/scripts/build-prod.sh`, `deploy/systemd/*.service`, `deploy/nginx/*.conf`, `deploy/web.env.example`, `deploy/scanner.env.example`. The new migration applies automatically by `npm run prisma:migrate:deploy` on the next build-prod run.
5. **Prisma workflow runs from `web/`** — `cd web && pnpm exec prisma …`. Migrations go in `web/prisma/migrations/YYYYMMDD_name/migration.sql`. Migration folder name format matches Plan 5.1 (`20260712_gitsha_resolutions`).
6. **Database URLs** (verified during Plan 5.1.1):
   - Dev DB: `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes`
   - Test DB: `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test`
   - Fresh DB (smoke only): `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_fresh`
   - Shadow DB (for `prisma migrate diff`): `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow`
7. **Generated migration name** — folder name `20260714_add_scan_failures_table` (today's date in YYYYMMDD format, snake_case).
8. **Sequential test suite runs (NOT parallel)** — pytest (`scanner/conftest.py::_reset_database`) and vitest (`web/tests/setup.ts::setup()`) both reset and migrate the shared `comfyui_nodes_test` DB via `prisma migrate deploy` subprocesses. Running them concurrently corrupts the migration state and produces spurious `CalledProcessError` failures (proven in Plan 5.1.1 Task 2). Every command in this plan that runs both suites MUST be sequential, never parallel.
9. **Generation method** — The Plan 5.1.1 Task 1 sandbox rejects `prisma migrate dev --create-only` (non-interactive prompt). Use `prisma migrate diff --from-schema-datasource <DEV_URL> --to-schema-datamodel web/prisma/schema.prisma --script --shadow-database-url <SHADOW_URL>` to extract the exact SQL Prisma would emit, then hand-write the migration folder + file. The resulting file MUST be byte-equivalent to the SQL template in the spec's §Design Component 1.
10. **Plan 5.1 spec followup update** — After Task 3's smoke, replace the "Plan 5.1.2 candidate: add a CI smoke step …" bullet in `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` §Followups with a "✅ Resolved by Plan 5.1.2 (2026-07-14, commit TBD)" note, then fill in the actual SHA in a follow-up commit (same pattern Plan 5.1.1 followed).

---

## File Structure

Files created or modified by this plan:

| File | Created/Modified | Responsibility |
|---|---|---|
| `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` | Created | `CREATE TABLE scan_failures` + FK to `nodes(id)` ON DELETE CASCADE |
| `scanner/_db_fixtures.py` | Modified | Delete `_ensure_scan_failures` (lines 44-77) + its call (line 123); update `_reset_database` docstring |
| `web/tests/setup.ts` | Modified | Delete `SCAN_FAILURES_DDL` constant (lines 11-26) + its `execSync` call (lines 63-66); update the Plan 5.1 comment to drop the scan_failures mention |
| `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` | Modified | §Followups entry "Plan 5.1.2 candidate" → "Resolved by Plan 5.1.2" |

No `web/prisma/schema.prisma` change (the model is already correct). No scanner/Python code, web/TS production code, or deploy artifacts touched.

---

## Task 1: Migration file + apply to dev/test/fresh DBs

**Files:**
- Create: `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql`

**Interfaces:**
- Consumes: existing `ScanFailure` model at `web/prisma/schema.prisma:145-157` (idempotent — schema is already correct).
- Produces: a new migration file whose contents match the SQL template in spec §Design Component 1 byte-for-byte. After this task: dev DB has the new migration marked as applied (table already exists from earlier `db push`); test DB and `comfyui_nodes_fresh` DB both have the table freshly created via `migrate deploy`; `prisma migrate diff --from-migrations vs --to-schema-datamodel` returns empty SQL.

### Step 1: Verify the schema ↔ live-DB drift before generating

Run from `web/`:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes" \
  SHADOW_DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow" \
  pnpm exec prisma migrate diff \
    --from-schema-datasource "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "$SHADOW_DATABASE_URL" \
    --script
```

Expected: output is the `CREATE TABLE scan_failures` + `ADD CONSTRAINT scan_failures_node_id_fkey` SQL from spec §Design Component 1 (verbatim — same charset, collation, index name, FK name). If the diff emits anything else (e.g., drift on `gitsha_resolutions` or `nodes`), STOP and diagnose — that means a prior Plan 5.1.1 change did not deploy to dev DB.

### Step 2: Generate the same diff against migrations directory (for fresh-DB comparison)

Run from `web/`:

```bash
cd web && pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow" \
  --script
```

Expected: output matches Step 1 exactly. This confirms what a fresh DB will produce after the migration is added. Save this output for comparison in Step 9.

### Step 3: Create the migration folder

```bash
mkdir -p web/prisma/migrations/20260714_add_scan_failures_table
```

Verify the folder is empty except for `.gitkeep` (or empty):

```bash
ls -la web/prisma/migrations/20260714_add_scan_failures_table/
```

Expected: empty directory (or only `.`/`..`).

### Step 4: Write `migration.sql`

Create `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` with EXACTLY this content (matches spec §Design Component 1 verbatim):

```sql
-- CreateTable
CREATE TABLE `scan_failures` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `node_id` BIGINT NOT NULL,
    `task_name` VARCHAR(128) NOT NULL,
    `error_message` TEXT NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `will_retry` BOOLEAN NOT NULL DEFAULT false,

    INDEX `scan_failures_node_id_occurred_at_idx`(`node_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `scan_failures` ADD CONSTRAINT `scan_failures_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

Verify the file ends with a single trailing `\n` (Global Constraint #1):

```bash
tail -c1 web/prisma/migrations/20260714_add_scan_failures_table/migration.sql | xxd
```

Expected: `00000000: 0a`.

### Step 5: Verify byte-equivalence with Prisma's diff output

Diff the file against the SQL you captured in Step 2:

```bash
# Capture the diff output to a file for comparison:
cd web && pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow" \
  --script > /tmp/expected_scan_failures.sql 2>/dev/null

# Compare (Prisma emits exactly the same CREATE TABLE + FK we wrote):
diff /tmp/expected_scan_failures.sql web/prisma/migrations/20260714_add_scan_failures_table/migration.sql
```

Expected: no output (diff returns empty, exit code 0). If diff shows anything, the migration file content does not match what Prisma would emit — STOP and fix.

(Note: Prisma may normalize whitespace or omit trailing comments. Both forms are semantically equivalent. The diff check above may show whitespace-only or comment-only differences; if so, the migration file is correct as-is.)

### Step 6: Commit the migration

```bash
git add web/prisma/migrations/20260714_add_scan_failures_table/
git commit -m "feat(schema): add scan_failures table migration (Plan 5.1.2)"
```

Expected: 1 file changed, N insertions (the SQL above is 18 lines including blank line + trailing newline).

### Step 7: Resolve as applied on dev DB

Run from `web/`:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes" \
  pnpm exec prisma migrate resolve --applied 20260714_add_scan_failures_table
```

Expected output:

```
Migration 20260714_add_scan_failures_table marked as applied.
```

### Step 8: Verify dev DB migrate status

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes" \
  pnpm exec prisma migrate status
```

Expected last line: `Database schema is up to date!`

### Step 9: Deploy on test DB

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test" \
  pnpm exec prisma migrate deploy
```

Expected output (tail):

```
The following migration(s) have been applied:
migrations/
  └─ 20260714_add_scan_failures_table/
    └─ migration.sql
All migrations have been successfully applied.
```

(Note: if the test DB has a leftover `scan_failures` table from a recent prior test run before this plan, the deploy will fail with "Table 'scan_failures' already exists". If so, drop it manually first: `mysql -h 127.0.0.1 -u root -pAdmin909217 -e "DROP TABLE IF EXISTS comfyui_nodes_test.scan_failures"` then re-run deploy.)

### Step 10: Verify test DB migrate status

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test" \
  pnpm exec prisma migrate status
```

Expected last line: `Database schema is up to date!`

### Step 11: Verify test DB SHOW CREATE TABLE matches expected DDL

```bash
mysql -h 127.0.0.1 -u root -pAdmin909217 \
  -e "SHOW CREATE TABLE comfyui_nodes_test.scan_failures\G" 2>/dev/null
```

Expected (key fields — full DDL includes charset/collation lines):

```
       Table: scan_failures
Create Table: CREATE TABLE `scan_failures` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `node_id` bigint(20) NOT NULL,
  `task_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `will_retry` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `scan_failures_node_id_occurred_at_idx` (`node_id`,`occurred_at`),
  CONSTRAINT `scan_failures_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

(Note: MySQL renders `BOOLEAN` as `tinyint(1)` and `DEFAULT false` as `DEFAULT '0'` — this is normal, not a drift. The semantic is identical.)

### Step 12: Fresh DB install (smoke)

The `comfyui_nodes_fresh` DB exists (verified during planning). Drop all tables and run all migrations from scratch:

```bash
mysql -h 127.0.0.1 -u root -pAdmin909217 \
  -e "DROP DATABASE IF EXISTS comfyui_nodes_fresh; CREATE DATABASE comfyui_nodes_fresh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Then apply all migrations from scratch:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_fresh" \
  pnpm exec prisma migrate deploy
```

Expected output (tail):

```
The following migration(s) have been applied:
migrations/
  └─ 20260621122750_init/
  └─ 20260625045000_add_revision_status_archived_withdrawn/
  └─ 20260626_wiki_revisions_no_action/
  └─ 20260712_gitsha_resolutions/
  └─ 20260714_gitsha_resolutions_resolved_at_precision/
  └─ 20260714_add_scan_failures_table/
All migrations have been successfully applied.
```

### Step 13: Verify fresh DB has scan_failures with the right schema

```bash
mysql -h 127.0.0.1 -u root -pAdmin909217 \
  -e "SHOW CREATE TABLE comfyui_nodes_fresh.scan_failures\G" 2>/dev/null | grep -E "(occurred_at|will_retry|scan_failures_node_id)"
```

Expected:

```
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `will_retry` tinyint(1) NOT NULL DEFAULT '0',
  KEY `scan_failures_node_id_occurred_at_idx` (`node_id`,`occurred_at`),
  CONSTRAINT `scan_failures_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
```

### Step 14: Verify schema ↔ migrations directory diff is empty

Run from `web/`:

```bash
cd web && pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow" \
  --script
```

Expected: no SQL output, exit code 0. (Previously this emitted the scan_failures CREATE TABLE — after this task, the migrations directory contains the new file so the diff should be empty.)

### Step 15: Write Task 1 report

Append a `Task 1 report — Plan 5.1.2 Migration + DB applies` section to `.superpowers/sdd/task-1-report.md` (or create if missing) with:
- Commit SHA from Step 6
- Status (DONE / DONE_WITH_CONCERNS / BLOCKED)
- Per-step verification evidence (commands run, exit codes, key output snippets)
- Acceptance criteria checklist (steps 1-14 above)
- Any concerns

If BLOCKED, do not proceed to Task 2.

---

## Task 2: Remove both workarounds + verify both test suites pass

**Files:**
- Modify: `scanner/_db_fixtures.py` (delete lines 44-77 + line 123; update docstring on lines 93-107)
- Modify: `web/tests/setup.ts` (delete lines 11-26 + lines 63-66; update comment on line 35)

**Interfaces:**
- Consumes: Task 1's migration file (committed) ensures `scan_failures` is now created via `prisma migrate deploy` in both `_reset_database` (Python) and `setup()` (TS). The workarounds are no longer needed.
- Produces: pytest 64/64 pass; vitest 167/167 pass. Both test suites now rely on the migration file (no more hand-rolled DDL).

### Step 1: Edit `scanner/_db_fixtures.py` — remove `_ensure_scan_failures` and its call

Open `scanner/_db_fixtures.py` and make three edits:

**Edit A — delete the entire `_ensure_scan_failures` function (lines 44-77):**

Delete this block verbatim:

```python
def _ensure_scan_failures(database_url: str) -> None:
    """Create the `scan_failures` table if it doesn't exist. This table is
    declared in schema.prisma but has no migration file (pre-existing gap in
    the migration set)."""
    parsed = _parse_db_url(database_url)
    conn = pymysql.connect(
        host=parsed["host"],
        port=parsed["port"],
        user=parsed["user"],
        password=parsed["password"],
        database=parsed["database"],
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scan_failures (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    node_id BIGINT NOT NULL,
                    task_name VARCHAR(128) NOT NULL,
                    error_message TEXT NOT NULL,
                    occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    will_retry TINYINT(1) NOT NULL DEFAULT 0,
                    INDEX scan_failures_node_id_occurred_at_idx (node_id, occurred_at),
                    CONSTRAINT scan_failures_node_id_fkey FOREIGN KEY (node_id)
                        REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
        conn.commit()
    finally:
        conn.close()


```

The block to delete ends at line 77 (blank line after `conn.close()`). After deletion, `_parse_db_url` immediately follows `_drop_all_tables` with only a single blank line separator.

**Edit B — update `_reset_database` docstring (lines 93-107):**

Replace the docstring:

```python
def _reset_database(database_url: str, web_dir: str) -> None:
    """Reset the test DB to a clean, fully-migrated state.

    Sequence:
      1. `_drop_all_tables` — wipe everything (including `_prisma_migrations`)
         so each test starts from a clean slate.
      2. `prisma migrate deploy` — re-apply all migrations from scratch
         (avoids the MySQL 5.7 strict-mode `db push --force-reset` issue).
      3. `_ensure_scan_failures` — create the `scan_failures` table which
         exists in schema.prisma but has no migration file (pre-existing gap).

    Locates `pnpm` via `shutil.which` first, then falls back to the Windows
    npm install path (`%APPDATA%\\npm\\pnpm.cmd`) because Python's subprocess
    on Windows does not inherit Git Bash's PATH.
    """
```

With:

```python
def _reset_database(database_url: str, web_dir: str) -> None:
    """Reset the test DB to a clean, fully-migrated state.

    Sequence:
      1. `_drop_all_tables` — wipe everything (including `_prisma_migrations`)
         so each test starts from a clean slate.
      2. `prisma migrate deploy` — re-apply all migrations from scratch
         (avoids the MySQL 5.7 strict-mode `db push --force-reset` issue;
         Plan 5.1.2 added the `scan_failures` migration so no extra DDL
         step is needed here).

    Locates `pnpm` via `shutil.which` first, then falls back to the Windows
    npm install path (`%APPDATA%\\npm\\pnpm.cmd`) because Python's subprocess
    on Windows does not inherit Git Bash's PATH.
    """
```

**Edit C — delete the call site (line 123):**

Delete this line verbatim (it currently sits as the last statement in the function):

```python
    _ensure_scan_failures(database_url)
```

After this edit, `_reset_database`'s last executable statement should be the `subprocess.run(...)` call for `prisma migrate deploy`.

Verify the file ends with a single trailing `\n` (Global Constraint #1):

```bash
tail -c1 scanner/_db_fixtures.py | xxd
```

Expected: `00000000: 0a`.

### Step 2: Confirm `_ensure_scan_failures` is no longer referenced anywhere in `scanner/`

```bash
grep -rn "_ensure_scan_failures" scanner/ web/ || echo "NO MATCHES (good)"
```

Expected: `NO MATCHES (good)`.

### Step 3: Run pytest to verify the migration path works for scanner tests

```bash
cd scanner && DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test \
  python -m pytest -q
```

Expected last line: `64 passed in …s`. (Baseline was 64/64; same count expected since `_reset_database` now creates `scan_failures` via the new migration instead of `_ensure_scan_failures`.)

### Step 4: Edit `web/tests/setup.ts` — remove `SCAN_FAILURES_DDL` and its execSync call

Open `web/tests/setup.ts` and make three edits:

**Edit A — delete the comment + `SCAN_FAILURES_DDL` constant (lines 11-26):**

Delete this block verbatim:

```ts
// CREATE TABLE statement for `scan_failures`, which has no migration file
// (pre-existing gap in the migration set). Must match the helper in
// `scanner/_db_fixtures.py::_ensure_scan_failures`.
const SCAN_FAILURES_DDL = `
  CREATE TABLE IF NOT EXISTS scan_failures (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    node_id BIGINT NOT NULL,
    task_name VARCHAR(128) NOT NULL,
    error_message TEXT NOT NULL,
    occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    will_retry TINYINT(1) NOT NULL DEFAULT 0,
    INDEX scan_failures_node_id_occurred_at_idx (node_id, occurred_at),
    CONSTRAINT scan_failures_node_id_fkey FOREIGN KEY (node_id)
      REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

```

(Ends at line 26 with a blank line. After deletion, `export async function setup()` follows the `let pushed = false;` line with one blank line separator.)

**Edit B — update the comment on lines 30-35:**

The current comment block is:

```ts
    // Plan 5.1: MySQL 5.7 strict mode rejects `prisma db push --force-reset`
    // for the `gitsha_resolutions` table's `DATETIME DEFAULT CURRENT_TIMESTAMP`
    // column. Use `migrate deploy` against a freshly-dropped schema instead.
    //
    // We shell out to the `mysql` CLI (mysql2/promise is not a web/ dep) to
    // drop tables, then ensure `scan_failures` exists (no migration file).
```

Replace with:

```ts
    // Plan 5.1: MySQL 5.7 strict mode rejects `prisma db push --force-reset`
    // for the `gitsha_resolutions` table's `DATETIME DEFAULT CURRENT_TIMESTAMP`
    // column. Use `migrate deploy` against a freshly-dropped schema instead.
    //
    // We shell out to the `mysql` CLI (mysql2/promise is not a web/ dep) to
    // drop tables. Plan 5.1.2 added the `scan_failures` migration so no
    // extra DDL step is needed after `migrate deploy`.
```

**Edit C — delete the execSync call (lines 63-66):**

Delete this block verbatim:

```ts
    execSync(
      `mysql ${mysqlCreds} -e "${SCAN_FAILURES_DDL}" ${db}`,
      { stdio: 'inherit' }
    );
```

After deletion, the `if (!pushed)` block ends with `execSync('pnpm exec prisma migrate deploy', ...); pushed = true;`.

Verify the file ends with a single trailing `\n` (Global Constraint #1):

```bash
tail -c1 web/tests/setup.ts | xxd
```

Expected: `00000000: 0a`.

### Step 5: Confirm `SCAN_FAILURES_DDL` is no longer referenced anywhere in `web/`

```bash
grep -rn "SCAN_FAILURES_DDL" web/ scanner/ || echo "NO MATCHES (good)"
```

Expected: `NO MATCHES (good)`.

### Step 6: Run vitest to verify the migration path works for web tests

```bash
cd web && pnpm test
```

Expected output:
```
 Test Files  28 passed (28)
      Tests  167 passed (167)
   Duration  …
```

(Baseline was 167/167, 28 files. `setup()` now creates `scan_failures` via the new migration instead of the `mysql -e "${SCAN_FAILURES_DDL}"` invocation.)

### Step 7: Commit both workaround removals

```bash
git add scanner/_db_fixtures.py web/tests/setup.ts
git commit -m "refactor(tests): remove scan_failures workarounds (Plan 5.1.2)

The ScanFailure model now has its own Prisma migration
(20260714_add_scan_failures_table), so the _ensure_scan_failures
helper in scanner/_db_fixtures.py and the SCAN_FAILURES_DDL constant
in web/tests/setup.ts are no longer needed. Both test suites now
rely on the migration to create the table."
```

Expected: 2 files changed, ~70 lines deleted (34 from Python helper + 4 call site + 16 from TS constant + 4 from TS execSync + ~10 from comment edits).

### Step 8: Write Task 2 report

Append a `Task 2 report — Plan 5.1.2 Remove workarounds` section to `.superpowers/sdd/task-2-report.md` (or create if missing) with:
- Commit SHA from Step 7
- Status (DONE / DONE_WITH_CONCERNS / BLOCKED)
- Per-step verification evidence (commands run, exit codes, key output snippets — pytest 64/64, vitest 167/167)
- Acceptance criteria checklist (steps 1-7 above)
- Any concerns

If BLOCKED, do not proceed to Task 3.

---

## Task 3: Full smoke + Plan 5.1 spec followup update + push

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` (only the §Followups entry, line ~end of section)

**Interfaces:**
- Consumes: green state from Task 2 (migration exists, both DBs at "up to date", both test suites pass, both workarounds removed).
- Produces: full smoke green (pytest + vitest + tsc + lint); Plan 5.1 spec §Followups updated to "Resolved by Plan 5.1.2"; all commits pushed to origin/main.

### Step 1: Run full scanner pytest (fresh run)

```bash
cd scanner && DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test \
  python -m pytest -q
```

Expected last line: `64 passed in …s`. (Re-run, not just trusting Task 2's run, because the migration history may have changed during this task's setup verification.)

### Step 2: Run full web vitest (fresh run, sequential with Step 1 — see Global Constraint #8)

```bash
cd web && pnpm test
```

Expected output:
```
 Test Files  28 passed (28)
      Tests  167 passed (167)
```

### Step 3: Run TypeScript type check

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: exits 0, no error output.

### Step 4: Run lint

```bash
cd web && pnpm lint
```

Expected: exits 0. Lint warning count should remain at 10 (all pre-existing per Plan 5.1 + Plan 5.1.1 baselines; this plan introduces no new ESLint warnings).

### Step 5: Update Plan 5.1 spec §Followups entry

Open `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` and find the "Plan 5.1.2 candidate" bullet in §Followups. It currently reads:

```markdown
- **Plan 5.1.2 candidate: add a CI smoke step that runs `prisma db push --force-reset` against an ephemeral test DB to catch precision regressions earlier** (catches the kind of issue that triggered Plan 5.1's 4-commit fixture cascade).
```

Replace with:

```markdown
- ✅ **Plan 5.1.2 resolved (2026-07-14, commit TBD):** Added the missing `scan_failures` Prisma migration (`20260714_add_scan_failures_table`) so `npm run prisma:migrate:deploy` creates the table on every environment (previously production would crash on first `record_scan_failure`). Removed the two hand-rolled DDL workarounds in `scanner/_db_fixtures.py::_ensure_scan_failures` and `web/tests/setup.ts::SCAN_FAILURES_DDL` — the migration is now the single source of truth. The "CI smoke" portion of this candidate was not done (the workaround removal accomplished the same goal: drift is no longer possible by construction). See `docs/superpowers/specs/2026-07-14-plan-5-1-2-add-scan-failures-migration-design.md` and `docs/superpowers/plans/2026-07-14-plan-5-1-2-add-scan-failures-migration.md` for the full spec and plan.
```

Keep all other §Followups entries unchanged. Verify the file ends with a single trailing `\n` (Global Constraint #1):

```bash
tail -c1 docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md | xxd
```

Expected: `00000000: 0a`.

### Step 6: Commit spec update (initial with "TBD")

```bash
git add docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md
git commit -m "docs(spec): mark Plan 5.1.2 candidate as resolved (spec at 2026-07-14-plan-5-1-2-)"
```

### Step 7: Replace "commit TBD" with the actual Task 1 commit SHA

Find the resolving commit from Task 1 (the `feat(schema): add scan_failures table migration (Plan 5.1.2)` commit from Task 1 Step 6):

```bash
git log --oneline | grep "add scan_failures table migration" | head -1
```

Then in `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md`, replace `(2026-07-14, commit TBD)` with `(2026-07-14, commit <SHA>)`. Re-verify trailing newline.

### Step 8: Commit the SHA fill-in (final whole-branch review minor fix)

```bash
git add docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md
git commit -m "docs(spec): fill in Plan 5.1.2 commit SHA (whole-branch review minor fix)"
```

### Step 9: Final whole-branch review

Dispatch a final code-reviewer subagent against the branch (`git merge-base main HEAD`..`HEAD`). Hand the reviewer the spec, the plan, the report files, and the diff (use `scripts/review-package MERGE_BASE HEAD` from the subagent-driven-development skill). Address any Critical/Important findings.

### Step 10: Push to origin

```bash
git push origin main
```

Expected: 4 new commits pushed (1 migration + 1 workarounds + 1 spec TBD + 1 spec SHA fill-in). The local branch was already in lock-step with `origin/main` from the Plan 5.1.1 push, so no merge required.

### Step 11: Write Task 3 report

Append a `Task 3 report — Plan 5.1.2 Smoke + spec update + push` section to `.superpowers/sdd/task-3-report.md` (or create if missing) with:
- All 4 commit SHAs (Task 1 migration, Task 2 workarounds, Task 3 spec TBD, Task 3 spec SHA)
- Push evidence (`git push origin main` output showing the new commits)
- Status (DONE / DONE_WITH_CONCERNS / BLOCKED)
- Per-step verification evidence (commands run, exit codes, key output snippets — pytest 64/64, vitest 167/167, tsc 0, lint 0)
- Plan-level acceptance criteria checklist (covers all acceptance criteria from the spec)
- Any concerns

---

## Acceptance criteria (whole plan)

- [ ] `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` exists with the exact CREATE TABLE + FK content matching spec §Design Component 1
- [ ] Dev DB `prisma migrate status` reports "Database schema is up to date!" (after `migrate resolve --applied`)
- [ ] Test DB `prisma migrate status` reports "Database schema is up to date!" (after `migrate deploy`)
- [ ] Test DB `SHOW CREATE TABLE scan_failures` returns the expected DDL (`occurred_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`, `will_retry tinyint(1) NOT NULL DEFAULT '0'`, FK `scan_failures_node_id_fkey` with `ON DELETE CASCADE ON UPDATE CASCADE`)
- [ ] Fresh DB (`comfyui_nodes_fresh`) after `migrate deploy` has all 6 migrations applied and `scan_failures` with the right schema
- [ ] `prisma migrate diff` between migrations directory and schema is empty (no SQL output)
- [ ] `grep -rn "_ensure_scan_failures" scanner/ web/` returns no matches
- [ ] `grep -rn "SCAN_FAILURES_DDL" web/ scanner/` returns no matches
- [ ] pytest 64/64 pass
- [ ] vitest 167/167 pass
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 (no new warnings introduced)
- [ ] Plan 5.1 spec §Followups entry is updated to "Resolved by Plan 5.1.2 (2026-07-14, commit <SHA>)" with a single trailing `\n`
- [ ] All commits pushed to `origin/main`

## Followups (not in Plan 5.1.2)

- Plan 5.1.2 followup candidate: tighten the `Boolean @default(false)` ↔ `TINYINT(1) DEFAULT '0'` mapping — Prisma emits `BOOLEAN NOT NULL DEFAULT false` in the migration but stores as `TINYINT(1) DEFAULT '0'`; same semantic, slightly different DDL. Document as a known and acceptable drift, or pin in a `@db.TinyInt` annotation if explicit byte-equivalence matters.
- Plan 5.2 candidate: 7 historical commits missing `Co-Authored-By` line
- Long-term: refactor `prisma/schema.prisma`'s Boolean columns to use explicit `@db.TinyInt` annotations across the board for DDL predictability
