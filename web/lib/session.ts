import { auth } from './auth';
import { prisma } from './db';

export type CurrentUser = {
  id: string;
  githubId: string;
  username: string;
  role: 'user' | 'admin';
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const sub = (session?.user as { id?: string } | undefined)?.id;
  if (!sub) return null;
  const user = await prisma.user.findUnique({ where: { id: BigInt(sub) } });
  if (!user) return null;
  return {
    id: user.id.toString(),
    githubId: user.github_id.toString(),
    username: user.username,
    role: user.role,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error('UNAUTHENTICATED');
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new Error('FORBIDDEN');
  return u;
}
