import { prisma } from '@/lib/db';
import { SubmissionStatus } from '@prisma/client';
import { SubmissionsClient } from './SubmissionsClient';

export default async function AdminSubmissionsPage() {
  const rows = await prisma.nodeSubmission.findMany({
    where: { status: SubmissionStatus.pending },
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
  return <SubmissionsClient items={items} />;
}
