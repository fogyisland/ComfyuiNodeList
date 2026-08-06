import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './db';

const bootstrapAdminId = BigInt(process.env.BOOTSTRAP_ADMIN_GITHUB_ID ?? '0');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // GitHub OAuth — kept for future production use; local dev does not need it.
    // Credentials is the primary path for now.
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const username = typeof credentials?.username === 'string' ? credentials.username : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!username || !password) return null;
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user?.password_hash) return null;
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;
        return {
          id: user.id.toString(),
          name: user.username,
          email: user.email ?? undefined,
        };
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ profile, credentials }) {
      // Credentials path — no DB upsert here; authorize() already returned
      // the user. Just allow the sign-in.
      if (credentials) return true;

      // GitHub OAuth path — upsert user by github_id.
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
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        const sub = BigInt(token.sub);
        // Try by Prisma id first (Credentials path), then by github_id (GitHub path).
        let user = await prisma.user.findUnique({ where: { id: sub } });
        if (!user) {
          user = await prisma.user.findUnique({ where: { github_id: sub } });
        }
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