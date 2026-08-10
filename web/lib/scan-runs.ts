import { prisma } from './db';

export type ScanRunSummary = {
  id: number;
  taskName: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  counts: Record<string, number> | null;
  error: string | null;
};

export async function getLatestScanRun(taskName: string): Promise<ScanRunSummary | null> {
  const row = await prisma.scanRun.findFirst({
    where: { task_name: taskName, status: 'ok' },
    orderBy: { finished_at: 'desc' },
  });
  if (!row) return null;
  return {
    id: Number(row.id),
    taskName: row.task_name,
    startedAt: row.started_at,
    // status: 'ok' filter guarantees finished_at IS NOT NULL (application invariant
    // defined in the spec: running ↔ finished_at IS NULL, ok|failed ↔ NOT NULL).
    finishedAt: row.finished_at!,
    status: row.status,
    counts: (row.counts as Record<string, number> | null) ?? null,
    error: row.error,
  };
}

/**
 * Latest run for a task regardless of status — including in-flight `running`
 * rows, which have `finished_at = null`. Returns the Prisma row shape
 * (snake_case) rather than ScanRunSummary, since callers need the nullable
 * finished_at to tell "in progress" from "done".
 */
export async function getLatestScanRunAnyStatus(taskName: string) {
  return prisma.scanRun.findFirst({
    where: { task_name: taskName },
    orderBy: { started_at: 'desc' },
    select: {
      id: true,
      status: true,
      started_at: true,
      finished_at: true,
      error: true,
    },
  });
}
