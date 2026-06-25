import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { UsersClient } from './UsersClient';

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const rows = await prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  const items = rows.map((u) => ({
    id: Number(u.id),
    username: u.username,
    avatarUrl: u.avatar_url,
    role: u.role as 'user' | 'admin',
  }));
  return <UsersClient items={items} currentUserId={Number(me.id)} />;
}
