import { prisma } from '@/lib/db';
import { SubmissionStatus } from '@prisma/client';
import { SubmissionsClient } from './SubmissionsClient';

type Source = 'all' | 'manager' | 'user';

function normalizeSource(raw: string | undefined): Source {
  if (raw === 'manager' || raw === 'user') return raw;
  return 'all';
}

function buildWhere(source: Source) {
  const base = { status: SubmissionStatus.pending };
  if (source === 'manager') {
    return { ...base, submitter: { username: 'comfyui-manager' } };
  }
  if (source === 'user') {
    return { ...base, submitter: { is: { username: { not: 'comfyui-manager' } } } };
  }
  return base;
}

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: { source?: string };
}) {
  const source = normalizeSource(searchParams.source);
  const rows = await prisma.nodeSubmission.findMany({
    where: buildWhere(source),
    orderBy: { created_at: 'desc' },
    include: { submitter: { select: { username: true } } },
  });
  const items = rows.map((s) => ({
    id: Number(s.id),
    submitterUsername: s.submitter.username,
    submitterSource: (s.submitter.username === 'comfyui-manager' ? 'manager' : 'user') as 'manager' | 'user',
    githubUrl: s.github_url,
    createdAt: s.created_at.toISOString(),
  }));
  return <SubmissionsClient items={items} source={source} />;
}
