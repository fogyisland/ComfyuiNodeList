import Link from 'next/link';
import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NodeCard } from '../_components/NodeCard';
import { Pagination } from '../_components/Pagination';

export const revalidate = 60;

type SearchParams = { page?: string; page_size?: string; q?: string };

export default async function NodesListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.page_size ?? 20) || 20));
  const q = (sp.q ?? '').trim();

  const where = {
    status: { in: [NodeStatus.active, NodeStatus.deprecated] },
    ...(q
      ? { OR: [{ name: { contains: q } }, { author: { contains: q } }] }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        author: true,
        description: true,
        updated_at: true,
      },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">节点</h1>

      <form className="mt-4 flex gap-2" action="/nodes" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="按名称或作者搜索…"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-4 py-2 text-sm text-white">搜索</button>
      </form>

      <div className="mt-6 grid gap-3">
        {items.map((n) => (
          <NodeCard
            key={`${n.github_owner}/${n.github_repo}`}
            owner={n.github_owner}
            repo={n.github_repo}
            name={n.name}
            author={n.author}
            description={n.description}
            updatedAt={n.updated_at}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          没有匹配的节点。<Link href="/nodes" className="text-accent hover:underline">清除筛选</Link>
        </p>
      )}

      <div className="mt-6">
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/nodes" />
      </div>
    </main>
  );
}
