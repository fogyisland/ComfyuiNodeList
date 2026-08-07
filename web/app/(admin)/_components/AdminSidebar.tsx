'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: string };

function isActive(currentPath: string, href: string) {
  if (href === '/admin') {
    return currentPath === '/admin' || currentPath === '/admin/';
  }
  return currentPath === href || currentPath.startsWith(href + '/');
}

export function AdminSidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? '/admin';
  const current = pathname.replace(/\/+$/, '') || '/';
  return (
    <aside className="sticky top-20 hidden h-fit w-60 shrink-0 md:block">
      <nav className="space-y-1">
        {items.map((item) => {
          const active = isActive(current, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                'block rounded-sm border-l-2 px-3 py-2 text-sm transition ' +
                (active
                  ? 'border-brand-500 bg-subtle text-fg-primary font-semibold'
                  : 'border-transparent text-fg-secondary hover:bg-subtle hover:text-fg-primary')
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}