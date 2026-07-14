# Plan 5.1.2 — Add `scan_failures` Prisma migration

**Date:** 2026-07-14
**Status:** Approved (brainstormed with user 2026-07-14, scope confirmed: `migrate resolve --applied` + remove workarounds)
**Parent plan:** Plan 5 (Production Deployment), pre-existing schema drift surfaced during Plan 5.1.1 review

## Problem

`web/prisma/schema.prisma:145-157` declares the `ScanFailure` model:

```prisma
model ScanFailure {
  id            BigInt   @id @default(autoincrement())
  node_id       BigInt
  task_name     String   @db.VarChar(128)
  error_message String   @db.Text
  occurred_at   DateTime @default(now())
  will_retry    Boolean  @default(false)

  node Node @relation(fields: [node_id], references: [id], onDelete: Cascade)

  @@index([node_id, occurred_at])
  @@map("scan_failures")
}
```

But `web/prisma/migrations/` contains **no migration file that creates this table** — confirmed via `grep -r scan_failures web/prisma/migrations/` returning zero matches. The `20260712_gitsha_resolutions` migration is the most recent, and `20260626_wiki_revisions_no_action` is the most recent CREATE TABLE of any kind.

**Current workarounds:**

1. **`web/tests/setup.ts:14-66`** — defines an inline `SCAN_FAILURES_DDL` constant and runs it via `mysql` CLI after every `prisma migrate deploy` in the vitest setup hook.
2. **`scanner/_db_fixtures.py:44-77`** — defines a matching `_ensure_scan_failures(database_url)` helper that runs after every `prisma migrate deploy` in `_reset_database()`.

Both DDLs are byte-equivalent to what Prisma's default mapping would emit (`DATETIME(3)` precision for `occurred_at`, `TINYINT(1)` for `Boolean will_retry`, FK with `ON DELETE CASCADE`). They exist solely because no migration file declares the table.

**Why this matters:**

- **Production deploy would break.** `npm run prisma:migrate:deploy` in `deploy/scripts/build-prod.sh` re-applies the migrations directory from scratch. The dev DB currently has `scan_failures` because someone once ran `prisma db push` directly (per `SHOW CREATE TABLE` evidence). Production never gets any version of this table — and every ScanFailure code path (`scanner/db.py:record_scan_failure`, the `errorMessage` columns in vitest/api tests, and the whole submission/review pipeline) would crash on first call.
- **Double source of truth.** Two hand-maintained DDLs (4 locations: `web/tests/setup.ts:14-26` block, the `execSync('mysql ... ${SCAN_FAILURES_DDL}')` call, `scanner/_db_fixtures.py:44-77` helper, plus the call site at `scanner/_db_fixtures.py:123`). Any future schema change to `ScanFailure` requires updating 4 places; missing one means one suite flakes.
- **Hidden coupling.** The pre-existing scan_failures drift was caught during Plan 5.1.1 Task 1's `prisma migrate diff` smoke (the diff emits a CREATE TABLE statement that Prisma would normally have generated at some prior `db push`). The drift is currently a "this is not yet a Plan-5 problem" footnote — left alone it grows into a Plan 6 / Plan 7 surprise.

## Solution

Add one Prisma migration file that creates `scan_failures` (matching what Prisma would have generated if the table were managed), then remove the two workarounds so the migration becomes the single source of truth.

## Scope

**In scope:**

- 1 new migration: `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` — Prisma-equivalent CREATE TABLE + FK
- `prisma migrate resolve --applied 20260714_add_scan_failures_table` against `comfyui_nodes` (dev DB) since the table already exists there from earlier `db push`
- `prisma migrate deploy` against `comfyui_nodes_test` — will actually create the table (test DB has zero rows after a `_reset_database()` run)
- Remove `scanner/_db_fixtures.py:44-77` `_ensure_scan_failures` helper and its call at line 123
- Remove `web/tests/setup.ts:14-26` `SCAN_FAILURES_DDL` constant and its `execSync` call at lines 63-66
- Verification: schema ↔ migration diff is empty; fresh DB (`comfyui_nodes_fresh`) reaches "Database schema is up to date!" via the new migration; smoke 64 + 167 tests pass

**Out of scope (deferred):**

- Any schema change to `ScanFailure` itself (column types, indexes, etc.) — `occurred_at` is already at `DATETIME(3)` per `SHOW CREATE TABLE`; no precision fix needed
- Adding a CI smoke step that runs `prisma db push --force-reset` — the workarounds' removal eliminates the underlying need; CI smoke remains a Plan 5.1.2 follow-up if desired
- Plan 5.2 (Co-Authored-By for 7 historical commits)
- Any production deployment work — the new migration applies automatically via `npm run prisma:migrate:deploy`

## Design

### Component 1: Migration file

Path: `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql`.

Content (matches Prisma 5 default mapping for the schema model — same charset/collation as `20260712_gitsha_resolutions`):

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

**Why this exact content:**

- `DATETIME(3)` matches the column already in `comfyui_nodes.scan_failures` per `SHOW CREATE TABLE`. No `MODIFY COLUMN` is needed because the column was created with the right precision via the original `prisma db push`.
- `BOOLEAN NOT NULL DEFAULT false` is Prisma's default mapping for `Boolean @default(false)` on MySQL — the live table renders this as `TINYINT(1)`.
- `INDEX scan_failures_node_id_occurred_at_idx(node_id, occurred_at)` matches `@@index([node_id, occurred_at])` from the schema and the live table's `KEY scan_failures_node_id_occurred_at_idx`.
- FK name `scan_failures_node_id_fkey` matches Prisma's standard naming convention and the live table's FK constraint name.

**Generation note:** The Plan 5.1 environment's Git Bash sandbox rejects `prisma migrate dev --create-only` (proven in Plan 5.1 Task 1's report). Use `prisma migrate diff --from-schema-datasource <DEV_URL> --to-schema-datamodel schema.prisma --script --shadow-database-url <SHADOW_URL>` to extract the exact SQL Prisma would emit, then hand-write the migration folder + file (same pattern as Plan 5.1 Task 1). The resulting file MUST be byte-equivalent to the SQL above.

### Component 2: Dev DB resolution

```bash
cd web && DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes \
    pnpm exec prisma migrate resolve --applied 20260714_add_scan_failures_table
```

The dev DB's `scan_failures` table was created by an earlier `prisma db push` (Predates Plan 5.1; we don't have a record of which commit introduced it). The current schema-vs-table state is in sync per `SHOW CREATE TABLE`. Marking the new migration as `--applied` (NOT `--rolled-back`) tells Prisma "this migration is in the history but I'm not running the SQL because the schema is already there."

After this command:
- `prisma migrate status` on dev DB → "Database schema is up to date!"
- The `_prisma_migrations` table records `20260714_add_scan_failures_table` as applied.

### Component 3: Test DB migration deploy

```bash
cd web && DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test \
    pnpm exec prisma migrate deploy
```

The test DB does NOT have `scan_failures` after a `_drop_all_tables()` run (the current `_reset_database` drops everything, then `migrate deploy` runs, which never created scan_failures since no migration contained it). When we run the new migration, Prisma will execute the `CREATE TABLE` + FK. Expected output:

```
1 migration(s) have been applied successfully:
  20260714_add_scan_failures_table
```

(The exact wording may be `All migrations have been successfully applied.` — both forms are equivalent in this codebase per Plan 5.1.1 Task 1's experience.)

After this step, `comfyui_nodes_test.scan_failures` exists with the same schema as `comfyui_nodes.scan_failures`. The next time `scanner/conftest.py`'s `db` fixture runs `_reset_database`, the workflow is:
1. `_drop_all_tables` — wipes everything including `_prisma_migrations`
2. `prisma migrate deploy` — re-applies all 5 migrations from scratch, INCLUDING the new scan_failures creation

This means scan_failures is now in the migration history for the test DB too. Future schema changes work uniformly.

### Component 4: Remove `_ensure_scan_failures` from `scanner/_db_fixtures.py`

Delete lines 44-77 (the helper definition) and line 123 (the call site). The remaining `_reset_database` shrinks by ~35 lines:

**After:**

```python
def _reset_database(database_url: str, web_dir: str) -> None:
    """Reset the test DB to a clean, fully-migrated state.

    Sequence:
      1. `_drop_all_tables` — wipe everything (including `_prisma_migrations`)
         so each test starts from a clean slate.
      2. `prisma migrate deploy` — re-apply all migrations from scratch.

    Locates `pnpm` via `shutil.which` first, then falls back to the Windows
    npm install path. (The Plan 5.1-era `_ensure_scan_failures` workaround
    was removed by Plan 5.1.2 once scan_failures had its own migration.)
    """
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        candidate = os.path.join(os.environ.get("APPDATA", ""), "npm", "pnpm.cmd")
        if os.path.isfile(candidate):
            pnpm = candidate
    assert pnpm is not None, "pnpm executable not found in PATH"
    env = {**os.environ, "DATABASE_URL": database_url}
    _drop_all_tables(database_url)
    subprocess.run(
        [pnpm, "exec", "prisma", "migrate", "deploy"],
        cwd=web_dir,
        check=True,
        capture_output=True,
        env=env,
    )
```

(`pymysql` import at line 13 is no longer needed by `_drop_all_tables` — keep the import since `_drop_all_tables` still uses pymysql directly.)

### Component 5: Remove `SCAN_FAILURES_DDL` from `web/tests/setup.ts`

Delete lines 14-26 (the constant) and lines 63-66 (the `execSync` call). The `setup()` function's `if (!pushed)` block shrinks from a 35-line dance to a 4-line `drop + migrate deploy`:

**After (full file):**

```ts
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Force the test DB URL. Vitest auto-loads .env (which points at the dev DB)
// before this file runs, and the Prisma CLI's own .env loader does not
// override an already-set DATABASE_URL, so we have to win this race here.
process.env.DATABASE_URL = 'mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test';

let pushed = false;

export async function setup(): Promise<void> {
  if (!pushed) {
    // Drop all tables, then apply all migrations from scratch. The Plan 5.1
    // workaround that ran `mysql` to create `scan_failures` after deploy was
    // removed in Plan 5.1.2 once scan_failures had its own migration.
    const dbUrl = process.env.DATABASE_URL!;
    const m = dbUrl.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/(.+)$/);
    if (!m) {
      throw new Error(`Cannot parse DATABASE_URL: ${dbUrl}`);
    }
    const [, user, pass, host, port, db] = m;
    const mysqlCreds = `-h ${host}${port ? ` -P ${port}` : ''} -u ${user} -p${pass}`;
    const tablesRaw = execSync(
      `mysql ${mysqlCreds} -N -e "SHOW TABLES" ${db}`,
      { stdio: ['ignore', 'pipe', 'inherit'] }
    ).toString().trim();
    const tables = tablesRaw ? tablesRaw.split('\n').filter(Boolean) : [];
    const drops = tables
      .map((t) => `DROP TABLE IF EXISTS \`${t}\`;`)
      .join(' ');
    execSync(
      `mysql ${mysqlCreds} -e "SET FOREIGN_KEY_CHECKS=0; ${drops} SET FOREIGN_KEY_CHECKS=1;" ${db}`,
      { stdio: 'inherit' }
    );
    execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit' });
    pushed = true;
  }
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.wikiRevision.deleteMany(),
      prisma.nodeRawRequirement.deleteMany(),
      prisma.nodeVersion.deleteMany(),
      prisma.node.deleteMany(),
      prisma.nodeSubmission.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}
```

Note: the `if (!dbUrl) throw` block collapses to a non-null assertion (`process.env.DATABASE_URL!`). The `env: { ...process.env, DATABASE_URL: ... }` line on the `prisma migrate deploy` call also goes away (vitest's process.env already has it set).

## Data flow (no change)

The data path through `scanner/db.py:record_scan_failure` is unaffected — same SQL, same semantics, same downstream callers. The only thing that changes is **how the table comes into existence** at deploy / test setup time: Prisma migration history vs. hand-rolled `mysql` CLI invocations.

## Error handling

| Scenario | Behavior |
|---|---|
| Dev DB `migrate resolve --applied` fails | Diagnose: was the migration folder created correctly? Is `DATABASE_URL` pointing at the right DB? Is `_prisma_migrations` corrupted? |
| Test DB `migrate deploy` fails because of pre-existing `scan_failures` | Means a prior test run created the table without `_ensure_scan_failures` being called (e.g., a recent test run before Plan 5.1.2). Drop it manually: `mysql -e "DROP TABLE IF EXISTS scan_failures"` then re-run `migrate deploy` |
| Test passes locally but fails in CI | Check that the test DB is reset between runs (no leftover tables); confirm `pushed` flag in `web/tests/setup.ts` is process-scoped (it is — top-level `let pushed = false`) |
| `pnpm` not found in subprocess | Same fallback as Plan 5.1: `shutil.which('pnpm')` then Windows AppData path |
| Existing dev DB rows in `scan_failures` (from local manual testing) | Unaffected — `resolve --applied` does not touch the table data; only marks the migration as applied. Plan 5.1.2 doesn't migrate any data |

## Testing

No new tests required (no scanner or web code behavior changes). Verification steps:

- [ ] `pnpm exec prisma migrate status` on dev DB shows "Database schema is up to date!"
- [ ] `pnpm exec prisma migrate status` on test DB shows "Database schema is up to date!"
- [ ] Fresh DB on `comfyui_nodes_fresh`: drop all tables + run `migrate deploy` reaches "Database schema is up to date!" with `scan_failures` created correctly
- [ ] `SHOW CREATE TABLE scan_failures\G` on test + dev + fresh DBs returns matching DDL
- [ ] `prisma migrate diff --from-migrations vs --to-schema-datamodel` returns empty SQL (no drift)
- [ ] `grep -r "_ensure_scan_failures" scanner/` returns empty
- [ ] `grep -r "SCAN_FAILURES_DDL" web/` returns empty
- [ ] Scanner pytest 64/64 pass
- [ ] Web vitest 167/167 pass
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 with no new warnings

## Acceptance criteria

- [ ] `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` exists with the exact CREATE TABLE + FK content above
- [ ] Dev DB `prisma migrate status` reports "Database schema is up to date!"
- [ ] Test DB `prisma migrate status` reports "Database schema is up to date!"
- [ ] Test DB `SHOW CREATE TABLE scan_failures` returns the expected DDL (`occurred_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`, `will_retry tinyint(1)` not null default 0, FK `scan_failures_node_id_fkey` with `ON DELETE CASCADE ON UPDATE CASCADE`)
- [ ] `prisma migrate diff` between migrations directory and schema is empty
- [ ] `scanner/_db_fixtures.py` no longer contains `_ensure_scan_failures` or its call site
- [ ] `web/tests/setup.ts` no longer contains `SCAN_FAILURES_DDL` or its `execSync` invocation
- [ ] All 64 + 167 tests continue to pass
- [ ] Plan 5.1.1 spec §Followups entry "Plan 5.1.2 candidate: add a CI smoke step ..." remains valid (we are NOT adding the CI smoke in this plan; the workaround removal accomplished the same goal)

## Migration plan

1. Generate the migration SQL via `prisma migrate diff --from-schema-datasource <DEV_URL> --to-schema-datamodel web/prisma/schema.prisma --script --shadow-database-url <SHADOW_URL>` (Plan 5.1 / 5.1.1 sandbox pattern)
2. Hand-write `web/prisma/migrations/20260714_add_scan_failures_table/migration.sql` to match the SQL above verbatim (verify byte-equivalence against the diff output before saving)
3. Run `prisma migrate resolve --applied 20260714_add_scan_failures_table` against dev DB
4. Run `prisma migrate deploy` against test DB; verify the migration applies cleanly
5. Run a fresh DB install: drop all tables in `comfyui_nodes_fresh`, then run `prisma migrate deploy`; verify `scan_failures` exists with the right schema
6. Remove `_ensure_scan_failures` helper from `scanner/_db_fixtures.py` + simplify `_reset_database`
7. Remove `SCAN_FAILURES_DDL` + its execSync call from `web/tests/setup.ts`
8. Run full smoke (pytest + vitest + tsc + lint)
9. Commit each logical step (recommendation: 1 commit for migration, 1 for dev DB resolve (which can be combined into the migration commit if no data command), 1 for test DB verify, 1 for both workaround removals — total ~3 commits)
10. Push to `origin/main`

## Followups (not in Plan 5.1.2)

- Plan 5.1.2 followup candidate: tighten the `Boolean @default(false)` ↔ `TINYINT(1) DEFAULT 0` mapping — Prisma emits `BOOLEAN NOT NULL DEFAULT false` in the migration but stores as `TINYINT(1) DEFAULT 0`; same semantic, slightly different DDL. Document as a known and acceptable drift, or pin in a `@db.TinyInt` annotation if explicit byte-equivalence matters.
- Plan 5.2 candidate: 7 historical commits missing `Co-Authored-By` line
- Long-term: refactor `prisma/schema.prisma`'s Boolean columns to use explicit `@db.TinyInt` annotations across the board for DDL predictability
