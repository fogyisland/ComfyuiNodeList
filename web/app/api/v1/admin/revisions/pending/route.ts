import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { json, error, parsePagination } from '@/lib/api-helpers';
import { RevisionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }
  const url = new URL(req.url);
  const { page, pageSize } = parsePagination(url);
  const where: Prisma.WikiRevisionWhereInput = { status: RevisionStatus.pending };
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
      versionId: Number(r.version_id),
      author: { username: r.author.username, avatarUrl: r.author.avatar_url },
      editSummary: r.edit_summary,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
    total,
    page,
    pageSize,
  });
}
