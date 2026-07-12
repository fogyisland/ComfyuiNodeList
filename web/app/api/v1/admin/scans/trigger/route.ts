import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

const TRIGGER_API_URL = process.env.SCANNER_TRIGGER_API_URL ?? 'http://127.0.0.1:8081';
const TRIGGER_TIMEOUT_MS = 5000;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const res = await fetch(`${TRIGGER_API_URL}/trigger-scan`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return error(502, 'trigger-api error', detail.slice(0, 500));
    }
    const body = (await res.json()) as { status: string; task_id?: string };
    return json({ status: 'queued', task_id: body.task_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(502, 'trigger-api unreachable', msg);
  } finally {
    clearTimeout(timer);
  }
}
