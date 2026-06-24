import Link from 'next/link';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  extraQuery?: Record<string, string | undefined>;
};

export function Pagination({ page, pageSize, total, basePath, extraQuery = {} }: Props) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;
  const link = (p: number) => {
    const params = new URLSearchParams({ page: String(p), page_size: String(pageSize) });
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v) params.set(k, v);
    }
    return `${basePath}?${params.toString()}`;
  };
  return (
    <nav className="flex items-center justify-between border-t border-gray-200 pt-4 text-sm">
      <span className="text-gray-500">第 {page} / {lastPage} 页 · 共 {total} 条</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={link(page - 1)} className="text-accent hover:underline">上一页</Link>}
        {page < lastPage && <Link href={link(page + 1)} className="text-accent hover:underline">下一页</Link>}
      </div>
    </nav>
  );
}
