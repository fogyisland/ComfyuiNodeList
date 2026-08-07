import Link from 'next/link';
import { requireAdmin } from '@/lib/session';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/revisions', label: '待审修订' },
  { href: '/admin/submissions', label: '待审节点' },
  { href: '/admin/users', label: '用户' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin(); // throws if not logged in or not admin (caught by Next redirect)
  return (
    <div className="mx-auto flex max-w-6xl gap-6 p-4 md:p-8">
      <aside className="sticky top-20 hidden h-fit w-56 shrink-0 md:block">
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-sm border-l-2 border-transparent px-3 py-2 text-sm text-fg-secondary hover:bg-subtle hover:text-fg-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}