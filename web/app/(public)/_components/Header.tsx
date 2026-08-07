import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { signOut } from '@/lib/auth';
import { Logo } from '@/app/_components/Logo';
import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { LinkButton } from '@/app/_components/Button';

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={28} />
          <span className="bg-gradient-brand bg-clip-text text-lg font-bold tracking-tight text-transparent">
            ComfyUI Wiki
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/nodes" className="px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
            节点
          </Link>
          {user ? (
            <>
              <Link href="/my-submissions" className="px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
                我的提交
              </Link>
              <LinkButton href="/submit" variant="primary" size="sm">
                提交节点
              </LinkButton>
              {user.role === 'admin' && (
                <Link href="/admin" className="px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
                  管理
                </Link>
              )}
              <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
                <button className="ml-1 px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
                  退出
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
                登录
              </Link>
              <Link href="/register" className="px-3 py-1.5 text-fg-secondary hover:text-fg-primary">
                注册
              </Link>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}