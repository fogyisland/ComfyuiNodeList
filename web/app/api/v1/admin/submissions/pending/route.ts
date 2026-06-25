import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { SubmissionStatus } from '@prisma/client';

export async function GET(_req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }
  const rows = await prisma.nodeSubmission.findMany({
    where: { status: SubmissionStatus.pending },
    orderBy: { created_at: 'desc' },
    include: { submitter: { select: { username: true, avatar_url: true } } },
  });
  return json({
    items: rows.map((s) => ({
      id: Number(s.id),
      submitter: { username: s.submitter.username, avatarUrl: s.submitter.avatar_url },
      githubUrl: s.github_url,
      createdAt: s.created_at.toISOString(),
    })),
  });
}