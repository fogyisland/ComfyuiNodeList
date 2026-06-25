import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { error } from '@/lib/api-helpers';
import { RejectSubmissionBody } from '@/lib/wiki-schema';
import { rejectSubmission } from '@/lib/submissions';

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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = RejectSubmissionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await rejectSubmission({
    submissionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return new Response(null, { status: 204 });
  if (r.reason === 'not-found') return error(404, 'submission not found');
  return error(409, `cannot reject submission in status`);
}