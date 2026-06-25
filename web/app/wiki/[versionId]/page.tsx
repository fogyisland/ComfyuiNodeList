import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { getPublishedRequirements } from '@/lib/published';
import { RevisionStatus } from '@prisma/client';
import { WikiEditForm } from '@/app/(wiki)/_components/WikiEditForm';

type Props = { params: Promise<{ versionId: string }> };

export default async function WikiEditPage({ params }: Props) {
  const { versionId } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/login?callbackUrl=/wiki/${versionId}`);
  }
  const id = Number(versionId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const v = await prisma.nodeVersion.findUnique({ where: { id: BigInt(id) } });
  if (!v) notFound();
  const published = await getPublishedRequirements(id);
  const latest = await prisma.wikiRevision.findFirst({
    where: {
      version_id: BigInt(id),
      author_id: BigInt(user.id),
      status: RevisionStatus.pending,
    },
    orderBy: { created_at: 'desc' },
  });
  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">编辑 Wiki · {published.version_tag}</h1>
        <p className="text-xs text-gray-500">version_id={id}</p>
      </header>
      <WikiEditForm
        versionId={id}
        initialPublished={published}
        initialPending={
          latest
            ? {
                id: Number(latest.id),
                editSummary: latest.edit_summary,
                createdAt: latest.created_at.toISOString(),
              }
            : null
        }
      />
    </main>
  );
}