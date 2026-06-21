import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { signIn, signOut } from '@/lib/auth';

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
        <Link href="/" className="text-lg font-bold text-accent">
          ComfyUI Node Wiki
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/nodes" className="text-gray-700 hover:text-accent">节点</Link>
          {user ? (
            <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
              <span className="text-gray-600">{user.username}</span>
              <button type="submit" className="ml-3 text-gray-700 hover:text-accent">退出</button>
            </form>
          ) : (
            <form action={async () => { 'use server'; await signIn('github', { redirectTo: '/' }); }}>
              <button type="submit" className="text-gray-700 hover:text-accent">用 GitHub 登录</button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}