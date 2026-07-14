# Plan 5.1.1 — `gitsha_resolutions.resolved_at` Precision Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `web/prisma/schema.prisma`'s `GitShaResolution.resolved_at` column from `DATETIME` (precision 0, second-level) to `DATETIME(3)` (millisecond precision) so it matches Prisma's default mapping used by every other `@default(now())` column in the project.

**Architecture:** One schema annotation change → one generated `ALTER TABLE` migration → verification via `prisma migrate deploy` + `SHOW CREATE TABLE`. No Python code, scanner code, or deployment-artifact changes. The new migration applies cleanly to the existing test DB (column is empty in production) and to a fresh DB (metadata-only `ALGORITHM=INSTANT` change).

**Tech Stack:** Prisma 5 (already wired), MySQL 5.7/8 (test/prod). No new dependencies.

## Global Constraints

These apply to every task. Conflicts with a task's spec are governed by these unless the task explicitly overrides.

1. **Trailing newline on every committed file** — Every `.py`, `.sql`, `.prisma`, `.md`, `.sh` file MUST end with `\n`. (Same rule Plan 5.1 §Global Constraints #1.)
2. **Spec is the source of truth** — `docs/superpowers/specs/2026-07-14-plan-5-1-1-schema-precision-design.md` (commit `9f1ca83`). When in doubt, follow the spec's exact code snippets and field names.
3. **No scanner/Python code changes** — Plan 5.1.1 is schema + migration only. Do not touch `scanner/db.py`, `scanner/github.py`, `scanner/tasks/*.py`, `scanner/celery_app.py`, or any test fixture. The Plan 5.1 (commit `7eebadb`) state of these files is the contract.
4. **Plan 5 deployment pipeline preserved** — Do NOT touch `deploy/scripts/build-prod.sh`, `deploy/systemd/*.service`, `deploy/nginx/*.conf`, `deploy/web.env.example`, `deploy/scanner.env.example`. The new migration is applied automatically by `npm run prisma:migrate:deploy` on the next build-prod run.
5. **Prisma workflow runs from `web/`** — `cd web && pnpm exec prisma …`. Migrations go in `web/prisma/migrations/YYYYMMDD_name/migration.sql`. Migration folder name format matches Plan 5.1 (`20260712_gitsha_resolutions`).
6. **Test DB config** — `DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test`. Default `DATABASE_URL` in `web/.env` points at the dev DB `comfyui_nodes`; the migrate-deploy verification uses the test DB via `--schema` or by overriding `DATABASE_URL` in the same shell invocation.
7. **Generated migration name** — folder name `20260714_gitsha_resolutions_resolved_at_precision` (today's date in YYYYMMDD format).

---

## File Structure

Files created or modified by this plan:

| File | Created/Modified | Responsibility |
|---|---|---|
| `web/prisma/schema.prisma` | Modified | Line 165: `@db.DateTime` → `@db.DateTime(3)` on `resolved_at` |
| `web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/migration.sql` | Created | `ALTER TABLE gitsha_resolutions MODIFY resolved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` |
| `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` | Modified | §Followups "Plan 5.1.1 candidate" → "Resolved by Plan 5.1.1" with date stamp |

No scanner/Python/deploy artifacts touched.

---

## Task 1: Schema annotation + ALTER migration applied to test DB

**Files:**
- Modify: `web/prisma/schema.prisma` line 165
- Create: `web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/migration.sql`

**Interfaces:**
- Consumes: existing `gitsha_resolutions` table created by migration `20260712_gitsha_resolutions`. The `resolved_at` column currently exists with type `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` (precision 0).
- Produces: `gitsha_resolutions.resolved_at` column of type `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`. No row data loss (table is empty in production; test DB has zero rows after Plan 5.1 fixture consolidation commits).

### Step 1: Edit `web/prisma/schema.prisma` line 165

Open `web/prisma/schema.prisma` and find this line (the `resolved_at` declaration on the `GitShaResolution` model):

```prisma
  resolved_at DateTime @default(now()) @db.DateTime
```

Change it to:

```prisma
  resolved_at DateTime @default(now()) @db.DateTime(3)
```

The rest of the `GitShaResolution` model is unchanged. Verify the model still reads:

```prisma
model GitShaResolution {
  id          Int      @id @default(autoincrement())
  owner       String   @db.VarChar(255)
  repo        String   @db.VarChar(255)
  ref         String   @db.VarChar(255)
  sha         String   @db.Char(40)
  resolved_at DateTime @default(now()) @db.DateTime(3)

  @@unique([owner, repo, ref])
  @@index([resolved_at])
  @@map("gitsha_resolutions")
}
```

### Step 2: Format the schema to confirm it parses

Run from `web/`:

```bash
cd web && pnpm exec prisma format
```

Expected: exits 0, no diff in `web/prisma/schema.prisma` (the one-character change `(3)` adds is not a formatting issue).

### Step 3: Generate the ALTER migration in create-only mode

Run from `web/`:

```bash
cd web && pnpm exec prisma migrate dev --name gitsha_resolutions_resolved_at_precision --create-only
```

Expected: Prisma detects a drift between schema (precision 3) and the existing migration (precision 0) and emits a single new migration in `web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/migration.sql`.

### Step 4: Verify the generated migration content

Open `web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/migration.sql` and confirm it contains exactly:

```sql
-- AlterTable
ALTER TABLE `gitsha_resolutions` MODIFY COLUMN `resolved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
```

If Prisma emitted any extra statements (e.g., redundant index rebuild, charset change), hand-edit the file to keep ONLY the ALTER line above — Prisma occasionally adds `-- This is an empty migration.` followed by an `ALTER` that we want to keep; the danger is duplicate `MODIFY` lines or other side effects. The migration file MUST contain exactly one `ALTER TABLE gitsha_resolutions MODIFY COLUMN resolved_at ...` statement.

Verify the file ends with a single trailing `\n` (Global Constraint #1).

### Step 5: Commit the schema + migration

```bash
git add web/prisma/schema.prisma web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/
git commit -m "feat(schema): promote gitsha_resolutions.resolved_at to DATETIME(3) for ms precision"
```

### Step 6: Deploy the migration to the test DB and verify

Run from `web/`, overriding `DATABASE_URL` to the test DB:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test" pnpm exec prisma migrate deploy
```

Expected output (last 3 lines):

```
1 migration(s) have been applied successfully:
  20260714_gitsha_resolutions_resolved_at_precision
```

If you see errors, the most likely cause is that the test DB is out of sync with another migration — run `pnpm exec prisma migrate status` with the same `DATABASE_URL` to diagnose.

### Step 7: Confirm migration is fully applied

Run from `web/`:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test" pnpm exec prisma migrate status
```

Expected last line: `Database schema is up to date!`

### Step 8: Verify the column type via SHOW CREATE TABLE

Run from bash:

```bash
mysql -h 127.0.0.1 -u root -pAdmin909217 -e "SHOW CREATE TABLE comfyui_nodes_test.gitsha_resolutions\G" 2>/dev/null | grep resolved_at
```

Expected output:

```
  `resolved_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
```

If the output still shows `datetime(0)`, STOP — the migration did not apply cleanly. Diagnose with `prisma migrate status` and `prisma migrate resolve` (do NOT reset the DB).

### Step 9: Verify schema and migrations are in sync (no drift)

Run from `web/` with the test DB URL:

```bash
cd web && DATABASE_URL="mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test" pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_shadow"
```

Expected: no SQL output, exits 0. If the diff command emits any SQL lines, the schema is out of sync with the migrations directory — STOP and diagnose (most common cause: a stray `db push --force-reset` modified the test DB outside the migration history).

(Note: a shadow DB is required; if `comfyui_nodes_shadow` does not exist, create it once via `mysql -e "CREATE DATABASE comfyui_nodes_shadow"`.)

---

## Task 2: Full smoke + Plan 5.1 spec followup update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` §Followups entry

**Interfaces:**
- Consumes: green schema state from Task 1 (`gitsha_resolutions.resolved_at` is `DATETIME(3)`).
- Produces: green smoke test result documented in the spec followup. No production code changes.

### Step 1: Run scanner pytest from `scanner/`

```bash
cd scanner && DATABASE_URL=mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test python -m pytest -q
```

Expected last line: `64 passed in …s`. (Pre-Plan-5.1.1 baseline was also 64/64; same count expected.)

### Step 2: Run web vitest from `web/`

```bash
cd web && pnpm test
```

Expected output: `Test Files 28 passed (28)` and `Tests 167 passed (167)`.

### Step 3: Run TypeScript type check from `web/`

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: exits 0, no error output.

### Step 4: Run lint from `web/`

```bash
cd web && pnpm lint
```

Expected: exits 0. Lint warning count may remain at 10 (all pre-existing per Plan 5.1 smoke results); the schema change does not introduce any new ESLint warnings.

### Step 5: Update the Plan 5.1 spec followup to mark the entry resolved

Open `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` and find the last bullet in §Followups (it currently reads):

```markdown
- **Plan 5.1.1 candidate: schema precision fix.** `resolved_at DateTime @default(now()) @db.DateTime` produces `DATETIME DEFAULT CURRENT_TIMESTAMP` which Prisma's `db push --force-reset` rejects in MySQL 5.7 strict mode (this is the root cause of the 4 Plan 5.1 fixup commits that migrated test fixtures from `db push --force-reset` to `migrate deploy`). The clean fix is `@db.DateTime(3)` (matches implicit precision of other `DateTime @default(now())` columns). Doing it now prevents the same 4-commit cascade when anyone adds another `@default(now())` column.
```

Replace it with:

```markdown
- ✅ **Plan 5.1.1 resolved (2026-07-14, commit TBD):** `resolved_at` annotation changed from `@db.DateTime` to `@db.DateTime(3)`, with ALTER migration `20260714_gitsha_resolutions_resolved_at_precision`. Column now uses millisecond precision matching the rest of the schema. See `docs/superpowers/specs/2026-07-14-plan-5-1-1-schema-precision-design.md` and `docs/superpowers/plans/2026-07-14-plan-5-1-1-schema-precision.md` for the full spec and plan.
```

Keep all other §Followups entries unchanged.

Verify the file ends with a single trailing `\n` (Global Constraint #1).

### Step 6: Commit the spec update

```bash
git add docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md
git commit -m "docs(spec): mark Plan 5.1.1 candidate as resolved (spec at 2026-07-14-plan-5-1-1-)"
```

### Step 7: Push to origin

```bash
git push origin main
```

Expected: 2 new commits on `main` (Task 1 schema + migration commit, Task 2 spec followup commit). The local branch was already in lock-step with `origin/main` from the Plan 5.1 push, so no merge required.

---

## Acceptance criteria (whole plan)

- [x] `web/prisma/schema.prisma:165` uses `@db.DateTime(3)` (not `@db.DateTime`)
- [x] `web/prisma/migrations/20260714_gitsha_resolutions_resolved_at_precision/migration.sql` exists with exactly the `ALTER TABLE gitsha_resolutions MODIFY COLUMN resolved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)` content
- [x] On the test DB, `prisma migrate deploy` applied the new migration and `prisma migrate status` returns "Database schema is up to date!"
- [x] `mysql SHOW CREATE TABLE gitsha_resolutions` shows `resolved_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`
- [x] `prisma migrate diff --from-migrations --to-schema-datamodel` exits 0 with no SQL output (schema and migrations in sync)
- [x] `pytest` runs 64/64 pass
- [x] `pnpm test` runs 167/167 pass
- [x] `pnpm exec tsc --noEmit` exits 0
- [x] `pnpm lint` exits 0 (no new warnings)
- [x] `docs/superpowers/specs/2026-07-12-plan-5-1-target-commitish-resolution-design.md` §Followups entry is now marked as resolved with a date stamp

## Followups (not in Plan 5.1.1)

- Plan 5.1.2 candidate: add a CI smoke step that runs `prisma db push --force-reset` against an ephemeral test DB to catch precision regressions earlier
- Plan 5.2 candidate: 7 historical commits missing `Co-Authored-By` line
