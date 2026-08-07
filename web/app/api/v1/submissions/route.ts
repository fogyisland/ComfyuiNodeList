import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { json, error } from '@/lib/api-helpers';
import { CreateSubmissionBody } from '@/lib/wiki-schema';
import { createSubmission } from '@/lib/submissions-user';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return error(401, 'unauthenticated');

  let raw: unknown;
  try { raw = await req.json(); } catch { return error(400, 'invalid json'); }

  const parsed = CreateSubmissionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'missing-field', parsed.error.flatten());
  const data = parsed.data;

  const result = await createSubmission(BigInt(id), data);
  if (!result.ok) {
    const status = result.reason === 'already-exists' || result.reason === 'duplicate-pending' ? 409 : 400;
    return error(status, result.reason);
  }
  const row = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: BigInt(result.id) } });
  return json({ id: result.id, status: 'pending', created_at: row.created_at.toISOString() }, { status: 201 });
}