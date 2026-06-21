import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { prisma } from './db';

const bootstrapAdminId = BigInt(process.env.BOOTSTRAP_ADMIN_GITHUB_ID ?? '0');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.id || !profile.login) return false;
      const githubId = BigInt(profile.id as string);
      await prisma.user.upsert({
        where: { github_id: githubId },
        update: {
          username: profile.login as string,
          avatar_url: (profile.avatar_url as string) ?? '',
          ...(githubId === bootstrapAdminId ? { role: 'admin' } : {}),
        },
        create: {
          github_id: githubId,
          username: profile.login as string,
          avatar_url: (profile.avatar_url as string) ?? '',
          email: (profile.email as string) ?? null,
          role: githubId === bootstrapAdminId ? 'admin' : 'user',
        },
      });
      return true;
    },
    async session({ session, token }) {
      if (token.sub) {
        const user = await prisma.user.findUnique({
          where: { github_id: BigInt(token.sub) },
        });
        if (user) {
          (session.user as { id?: string }).id = user.id.toString();
          (session.user as { role?: string }).role = user.role;
        }
      }
      return session;
    },
  },
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
});