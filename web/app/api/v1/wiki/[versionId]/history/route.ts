import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { json, error, parsePagination } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ versionId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
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

  const url = new URL(req.url);
  const { page, pageSize } = parsePagination(url);
  const where = { version_id: BigInt(versionIdNum) };
  const [total, rows] = await Promise.all([
    prisma.wikiRevision.count({ where }),
    prisma.wikiRevision.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
  ]);
  return json({
    items: rows.map((r) => ({
      id: Number(r.id),
      author: { username: r.author.username, avatarUrl: r.author.avatar_url },
      editSummary: r.edit_summary,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    })),
    total,
    page,
    pageSize,
  });
}
