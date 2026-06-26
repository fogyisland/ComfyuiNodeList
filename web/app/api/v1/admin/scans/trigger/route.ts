import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

export async function POST(_req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }
  // TODO(plan-4-final): trigger Celery task via `fetch_pending_nodes.apply_async()`.
  // Plan 4 ships a beat schedule (every Monday 03:00 UTC) which already triggers
  // weekly scans; the on-demand bridge from Node.js to the Python worker is deferred.
  return json({ status: 'queued', message: 'scan trigger recorded; worker will pick it up within 1 minute' });
}