import { auth } from '@/lib/auth';
import { json, error } from '@/lib/api-helpers';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return error(401, 'unauthenticated');

  const rows = await prisma.nodeSubmission.findMany({
    where: { submitter_id: BigInt(id) },
    orderBy: { created_at: 'desc' },
  });
  return json(
    rows.map((r) => ({
      id: Number(r.id),
      github_url: r.github_url,
      name: r.name,
      description: r.description,
      status: r.status,
      review_note: r.review_note,
      created_at: r.created_at.toISOString(),
      reviewed_at: r.reviewed_at?.toISOString() ?? null,
    })),
  );
}