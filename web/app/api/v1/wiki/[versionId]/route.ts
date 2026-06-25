import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { getPublishedRequirements } from '@/lib/published';
import { json, error } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  const { versionId: versionIdStr } = await ctx.params;
  const versionId = Number(versionIdStr);
  if (!Number.isInteger(versionId) || versionId < 1) return error(400, 'invalid versionId');
  const version = await prisma.nodeVersion.findUnique({ where: { id: BigInt(versionId) } });
  if (!version) return error(404, 'version not found');

  const published = await getPublishedRequirements(versionId);
  const latestPending = await prisma.wikiRevision.findFirst({
    where: { version_id: BigInt(versionId), author_id: BigInt(user.id), status: 'pending' },
    orderBy: { created_at: 'desc' },
  });
  return json({
    versionId,
    published: {
      ...published,
      version_id: published.version_id,
      release_date: published.release_date.toISOString(),
    },
    latestPending: latestPending
      ? {
          id: Number(latestPending.id),
          status: latestPending.status,
          editSummary: latestPending.edit_summary,
          createdAt: latestPending.created_at.toISOString(),
        }
      : null,
  });
}
