import Link from 'next/link';

type Props = {
  basePath: string;
  page: number;
  totalPages: number;
  query?: Record<string, string>;
};

function buildHref(basePath: string, page: number, query: Record<string, string>) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({ basePath, page, totalPages, query = {} }: Props) {
  if (totalPages <= 1) return null;
  const href = (p: number) => buildHref(basePath, p, query);
  return (
    <nav className="mt-8 flex items-center justify-center gap-2 text-sm">
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-fg-secondary hover:border-border-strong">
          ← 上一页
        </Link>
      )}
      <span className="px-3 py-1.5 text-fg-tertiary">第 {page} / {totalPages} 页</span>
      {page < totalPages && (
        <Link href={href(page + 1)} className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-fg-secondary hover:border-border-strong">
          下一页 →
        </Link>
      )}
    </nav>
  );
}