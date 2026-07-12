import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Force the test DB URL. Vitest auto-loads .env (which points at the dev DB)
// before this file runs, and the Prisma CLI's own .env loader does not
// override an already-set DATABASE_URL, so we have to win this race here.
process.env.DATABASE_URL = 'mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test';

let pushed = false;

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

export async function setup(): Promise<void> {
  if (!pushed) {
    // Plan 5.1: MySQL 5.7 strict mode rejects `prisma db push --force-reset`
    // for the `gitsha_resolutions` table's `DATETIME DEFAULT CURRENT_TIMESTAMP`
    // column. Use `migrate deploy` against a freshly-dropped schema instead.
    //
    // We shell out to the `mysql` CLI (mysql2/promise is not a web/ dep) to
    // drop tables, then ensure `scan_failures` exists (no migration file).
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL must be set before tests/setup.ts runs');
    }
    // mysql://user:pass@host:port/db
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
    execSync('pnpm exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    });
    execSync(
      `mysql ${mysqlCreds} -e "${SCAN_FAILURES_DDL}" ${db}`,
      { stdio: 'inherit' }
    );
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
