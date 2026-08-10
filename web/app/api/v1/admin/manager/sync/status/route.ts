import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { getLatestScanRunAnyStatus } from '@/lib/scan-runs';
import { json, error } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }

  const run = await getLatestScanRunAnyStatus('sync_manager_catalog');
  if (!run) return json({ run: null });

  return json({
    run: {
      id: Number(run.id),
      status: run.status,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null,
      error: run.error ?? null,
    },
  });
}
