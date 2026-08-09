import { prisma } from '@/lib/db';
import { RevisionStatus, SubmissionStatus } from '@prisma/client';
import { AdminHomeClient } from './AdminHomeClient';
import { getLatestScanRun } from '@/lib/scan-runs';

const MANAGER_SYSTEM_USERNAME = 'comfyui-manager';

export default async function AdminDashboardPage() {
  const [pendingRevisions, pendingSubmissions, recentRevisions, recentSubmissions, managerUser, latestRun] =
    await Promise.all([
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
      prisma.user.findUnique({
        where: { username: MANAGER_SYSTEM_USERNAME },
        select: { id: true },
      }),
      getLatestScanRun('sync_manager_catalog'),
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
    <AdminHomeClient
      pendingRevisions={pendingRevisions}
      pendingSubmissions={pendingSubmissions}
      recent={recent}
      managerSystemUserId={managerUser ? Number(managerUser.id) : null}
      latestRun={latestRun}
    />
  );
}
