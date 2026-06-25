import { prisma } from '@/lib/db';
import { RevisionStatus, SubmissionStatus } from '@prisma/client';
import { AdminDashboard } from '@/app/(admin)/_components/AdminDashboard';

export default async function AdminDashboardPage() {
  const [pendingRevisions, pendingSubmissions, recentRevisions, recentSubmissions] = await Promise.all([
    prisma.wikiRevision.count({ where: { status: RevisionStatus.pending } }),
    prisma.nodeSubmission.count({ where: { status: SubmissionStatus.pending } }),
    prisma.wikiRevision.findMany({
      orderBy: { created_at: 'desc' },
      take: 5,
      include: { author: { select: { username: true } } },
    }),
    prisma.nodeSubmission.findMany({
      orderBy: { created_at: 'desc' },
      take: 5,
      include: { submitter: { select: { username: true } } },
    }),
  ]);

  const recent = [
    ...recentRevisions.map((r) => ({
      id: Number(r.id),
      kind: 'revision' as const,
      at: r.created_at.toISOString(),
      summary: `${r.author.username}: ${r.edit_summary} (${r.status})`,
    })),
    ...recentSubmissions.map((s) => ({
      id: Number(s.id),
      kind: 'submission' as const,
      at: s.created_at.toISOString(),
      summary: `${s.submitter.username}: ${s.github_url} (${s.status})`,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 10);

  return (
    <AdminDashboard
      pendingRevisions={pendingRevisions}
      pendingSubmissions={pendingSubmissions}
      recent={recent}
    />
  );
}