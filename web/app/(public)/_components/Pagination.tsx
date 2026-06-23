import Link from 'next/link';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
};

export function Pagination({ page, pageSize, total, basePath }: Props) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage <= 1) return null;
  const link = (p: number) => `${basePath}?page=${p}&page_size=${pageSize}`;
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
