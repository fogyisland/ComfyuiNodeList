import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  const r = await prisma.wikiRevision.findUnique({
    where: { id: BigInt(idNum) },
    include: {
      author: { select: { username: true, avatar_url: true } },
      reviewer: { select: { username: true, avatar_url: true } },
    },
  });
  if (!r) return error(404, 'revision not found');
  return json({
    id: Number(r.id),
    versionId: Number(r.version_id),
    author: { username: r.author.username, avatarUrl: r.author.avatar_url },
    pythonMin: r.python_min,
    pythonMax: r.python_max,
    dependencies: r.dependencies,
    nodeClassMappings: r.node_class_mappings,
    incompatibilities: r.incompatibilities,
    notesMd: r.notes_md,
    editSummary: r.edit_summary,
    status: r.status,
    reviewer: r.reviewer ? { username: r.reviewer.username, avatarUrl: r.reviewer.avatar_url } : null,
    reviewNote: r.review_note,
    reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  });
}
