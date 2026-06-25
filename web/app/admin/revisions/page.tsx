import { prisma } from '@/lib/db';
import { RevisionStatus } from '@prisma/client';
import { RevisionsClient } from './RevisionsClient';

export default async function AdminRevisionsPage() {
  const rows = await prisma.wikiRevision.findMany({
    where: { status: RevisionStatus.pending },
    orderBy: { created_at: 'desc' },
    include: { author: { select: { username: true } } },
  });
  const items = rows.map((r) => ({
    id: Number(r.id),
    versionId: Number(r.version_id),
    authorUsername: r.author.username,
    editSummary: r.edit_summary,
    createdAt: r.created_at.toISOString(),
  }));
  return <RevisionsClient items={items} />;
}
