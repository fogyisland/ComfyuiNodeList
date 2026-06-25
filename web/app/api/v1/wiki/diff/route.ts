import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { diffRevisions } from '@/lib/diff';
import type { RevisionFields } from '@/lib/diff';

export async function GET(req: NextRequest) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!fromStr || !toStr) return error(400, 'from and to are required');
  const fromId = Number(fromStr);
  const toId = Number(toStr);
  if (!Number.isInteger(fromId) || !Number.isInteger(toId)) return error(400, 'invalid ids');
  const [from, to] = await Promise.all([
    prisma.wikiRevision.findUnique({
      where: { id: BigInt(fromId) },
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
    prisma.wikiRevision.findUnique({
      where: { id: BigInt(toId) },
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
  ]);
  if (!from || !to) return error(404, 'revision not found');

  const fromFields: RevisionFields = {
    python_min: from.python_min,
    python_max: from.python_max,
    dependencies: from.dependencies as RevisionFields['dependencies'],
    node_class_mappings: from.node_class_mappings as string[],
    incompatibilities: from.incompatibilities as string[],
    notes_md: from.notes_md,
  };
  const toFields: RevisionFields = {
    python_min: to.python_min,
    python_max: to.python_max,
    dependencies: to.dependencies as RevisionFields['dependencies'],
    node_class_mappings: to.node_class_mappings as string[],
    incompatibilities: to.incompatibilities as string[],
    notes_md: to.notes_md,
  };
  const diff = diffRevisions(fromFields, toFields);

  return json({
    from: {
      id: Number(from.id),
      status: from.status,
      fields: fromFields,
      author: { username: from.author.username, avatarUrl: from.author.avatar_url },
      createdAt: from.created_at.toISOString(),
    },
    to: {
      id: Number(to.id),
      status: to.status,
      fields: toFields,
      author: { username: to.author.username, avatarUrl: to.author.avatar_url },
      createdAt: to.created_at.toISOString(),
    },
    diff,
  });
}
