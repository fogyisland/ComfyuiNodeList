import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

export async function GET(_req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') return error(401, 'unauthenticated');
    if (msg === 'FORBIDDEN') return error(403, 'admin only');
    throw e;
  }
  const rows = await prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  return json({
    items: rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      avatarUrl: u.avatar_url,
      role: u.role,
      createdAt: u.created_at.toISOString(),
    })),
  });
}
