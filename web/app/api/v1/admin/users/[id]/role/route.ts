import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ChangeRoleBody } from '@/lib/wiki-schema';

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
  const parsed = ChangeRoleBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const target = await prisma.user.findUnique({ where: { id: BigInt(idNum) } });
  if (!target) return error(404, 'user not found');
  if (target.id === BigInt(user.id) && parsed.data.role !== 'admin') {
    return error(409, 'cannot demote yourself');
  }
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role: parsed.data.role },
  });
  return json({ userId: Number(updated.id), role: updated.role });
}
