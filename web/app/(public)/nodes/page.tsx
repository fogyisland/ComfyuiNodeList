import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NodeCard } from '../_components/NodeCard';
import { Pagination } from '../_components/Pagination';
import { Input } from '@/app/_components/Input';

const PAGE_SIZE = 12;

type Props = { searchParams: Promise<{ page?: string; q?: string; status?: string }> };

export default async function NodesPage({ searchParams }: Props) {
  const { page: p, q, status } = await searchParams;
  const page = Math.max(1, Number(p) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const where = {
    status: { in: status === 'deprecated' ? [NodeStatus.deprecated] : [NodeStatus.active, NodeStatus.deprecated] },
    ...(q ? { OR: [{ name: { contains: q } }, { github_repo: { contains: q } }, { author: { contains: q } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: { github_owner: true, github_repo: true, name: true, author: true, description: true, updated_at: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-display-lg text-fg-primary">All nodes</h1>
        <p className="mt-1 text-sm text-fg-tertiary">{total} nodes indexed</p>
      </header>
      <form className="mb-6 flex gap-3 rounded-md border border-border-default bg-surface p-3">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="搜索名称 / 仓库 / 作者"
          className="flex-1"
        />
        <button className="rounded-sm bg-gradient-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow-md">
          搜索
        </button>
      </form>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((n) => (
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
      <Pagination basePath="/nodes" page={page} totalPages={totalPages} />
    </main>
  );
}