import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ApproveRevisionBody } from '@/lib/wiki-schema';
import { approveRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown = {};
  try {
    if (req.headers.get('content-length') !== '0') raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = ApproveRevisionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await approveRevision({
    revisionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return json({ approvedRevisionId: r.approvedRevisionId, archivedRevisionIds: r.archivedRevisionIds });
  if (r.reason === 'not-found') return error(404, 'revision not found');
  return error(409, `cannot approve revision in status: ${r.status}`);
}
