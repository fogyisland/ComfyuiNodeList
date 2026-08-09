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
    finishedAt: row.finished_at,
    status: row.status,
    counts: (row.counts as Record<string, number> | null) ?? null,
    error: row.error,
  };
}
