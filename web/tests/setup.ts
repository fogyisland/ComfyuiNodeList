import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Force the test DB URL. Vitest auto-loads .env (which points at the dev DB)
// before this file runs, and the Prisma CLI's own .env loader does not
// override an already-set DATABASE_URL, so we have to win this race here.
process.env.DATABASE_URL = 'mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test';

let pushed = false;

export async function setup(): Promise<void> {
  if (!pushed) {
    // --force-reset drops and recreates all tables, sidestepping the
    // "Cannot drop index needed in a foreign key constraint" error
    // that --accept-data-loss cannot bypass on MySQL when an index's
    // sort order differs from what Prisma expects.
    execSync('pnpm exec prisma db push --skip-generate --force-reset', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
    });
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
