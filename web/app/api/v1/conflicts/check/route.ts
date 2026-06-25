import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ConflictCheckBody } from '@/lib/wiki-schema';
import { checkConflicts } from '@/lib/conflict-engine';

export async function POST(req: NextRequest) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = ConflictCheckBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const conflicts = await checkConflicts(parsed.data);
  return json({ conflicts });
}
