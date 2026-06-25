import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { withdrawRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  const r = await withdrawRevision({
    revisionId: idNum,
    currentUserId: BigInt(user.id),
    isAdmin: user.role === 'admin',
  });
  if (r.ok) return new Response(null, { status: 204 });
  if (r.reason === 'not-found') return error(404, 'revision not found');
  if (r.reason === 'forbidden') return error(403, 'only the author or an admin can withdraw');
  if (r.reason === 'not-pending') {
    return error(409, `cannot withdraw revision in status: ${r.status}`);
  }
  return error(500, 'unexpected');
}
