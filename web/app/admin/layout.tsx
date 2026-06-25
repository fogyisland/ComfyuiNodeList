import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireAdmin();
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'UNAUTHENTICATED') redirect('/login?callbackUrl=/admin');
    // FORBIDDEN: render 403 page inline (defense in depth)
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold text-red-700">403 禁止访问</h1>
        <p className="mt-2 text-sm text-gray-600">该页面仅管理员可访问。</p>
      </main>
    );
  }
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 border-r border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">管理后台</h2>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/admin" className="rounded px-2 py-1 hover:bg-gray-100">Dashboard</Link>
          <Link href="/admin/revisions" className="rounded px-2 py-1 hover:bg-gray-100">修订审核</Link>
          <Link href="/admin/submissions" className="rounded px-2 py-1 hover:bg-gray-100">节点收录</Link>
          <Link href="/admin/users" className="rounded px-2 py-1 hover:bg-gray-100">用户角色</Link>
        </nav>
        <div className="mt-4 border-t border-gray-200 pt-3 text-xs text-gray-500">
          {user.username} (admin)
        </div>
      </aside>
      <section className="flex-1">{children}</section>
    </div>
  );
}