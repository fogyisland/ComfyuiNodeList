import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { HistoryClient } from './HistoryClient';

type Props = { params: Promise<{ versionId: string }> };

export default async function HistoryPage({ params }: Props) {
  const { versionId } = await params;
  try {
    await requireUser();
  } catch {
    redirect(`/login?callbackUrl=/wiki/${versionId}/history`);
  }
  const id = Number(versionId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const rows = await prisma.wikiRevision.findMany({
    where: { version_id: BigInt(id) },
    orderBy: { created_at: 'desc' },
    include: { author: { select: { username: true, avatar_url: true } } },
  });
  const items = rows.map((r) => ({
    id: Number(r.id),
    editSummary: r.edit_summary,
    status: r.status,
    authorUsername: r.author.username,
    createdAt: r.created_at.toISOString(),
  }));
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">修订历史 · version_id={id}</h1>
      <HistoryClient items={items} versionId={id} />
    </main>
  );
}
