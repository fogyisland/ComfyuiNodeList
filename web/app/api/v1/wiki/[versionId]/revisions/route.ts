import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { CreateRevisionBody } from '@/lib/wiki-schema';
import { createRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ versionId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  const { versionId } = await ctx.params;
  const versionIdNum = Number(versionId);
  if (!Number.isInteger(versionIdNum) || versionIdNum < 1) return error(400, 'invalid versionId');
  const v = await prisma.nodeVersion.findUnique({ where: { id: BigInt(versionIdNum) } });
  if (!v) return error(404, 'version not found');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = CreateRevisionBody.safeParse(raw);
  if (!parsed.success) {
    return error(400, 'validation failed', parsed.error.flatten());
  }
  try {
    const r = await createRevision({
      versionId: versionIdNum,
      authorId: BigInt(user.id),
      body: parsed.data,
    });
    return json({ revisionId: r.revisionId, status: 'pending' }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === 'VERSION_NOT_FOUND') return error(404, 'version not found');
    throw e;
  }
}
