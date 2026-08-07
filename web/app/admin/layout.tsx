import { requireAdmin } from '@/lib/session';
import { AdminSidebar } from '../(admin)/_components/AdminSidebar';

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
      <AdminSidebar items={NAV} />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}