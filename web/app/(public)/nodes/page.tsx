import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NodeCard } from '../_components/NodeCard';
import { Pagination } from '../_components/Pagination';
import { Input } from '@/app/_components/Input';

const PAGE_SIZE = 12;

type Sort = 'updated' | 'name' | 'author';
type StatusFilter = 'all' | 'active' | 'deprecated';

type Props = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    author?: string;
    sort?: string;
  }>;
};

export default async function NodesPage({ searchParams }: Props) {
  const {
    page: p,
    q,
    status: statusParam,
    author: authorParam,
    sort: sortParam,
  } = await searchParams;
  const page = Math.max(1, Number(p) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const statusFilter: StatusFilter =
    statusParam === 'active' || statusParam === 'deprecated' ? statusParam : 'all';
  const sort: Sort = sortParam === 'name' || sortParam === 'author' ? sortParam : 'updated';

  const where = {
    ...(statusFilter === 'all'
      ? { status: { in: [NodeStatus.active, NodeStatus.deprecated] } }
      : { status: statusFilter === 'active' ? NodeStatus.active : NodeStatus.deprecated }),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { github_repo: { contains: q } },
            { author: { contains: q } },
          ],
        }
      : {}),
    ...(authorParam ? { author: { contains: authorParam } } : {}),
  };

  const orderBy =
    sort === 'name' ? { name: 'asc' as const } : sort === 'author' ? { author: 'asc' as const } : { updated_at: 'desc' as const };

  const [total, rows, distinctAuthors] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy,
      skip,
      take: PAGE_SIZE,
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        author: true,
        description: true,
        updated_at: true,
        source_manager: true,
      },
    }),
    prisma.node
      .findMany({
        where: { status: { in: [NodeStatus.active, NodeStatus.deprecated] } },
        distinct: ['author'],
        select: { author: true },
        orderBy: { author: 'asc' },
      })
      .then((r) => r.map((x) => x.author).filter(Boolean)),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queryBase: Record<string, string> = {};
  if (q) queryBase.q = q;
  if (statusFilter !== 'all') queryBase.status = statusFilter;
  if (authorParam) queryBase.author = authorParam;
  if (sort !== 'updated') queryBase.sort = sort;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-display-lg text-fg-primary">All nodes</h1>
        <p className="mt-1 text-sm text-fg-tertiary">{total} nodes indexed</p>
      </header>
      <form className="sticky top-16 z-30 mb-6 flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-surface/95 p-3 shadow-sm backdrop-blur">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="搜索名称 / 仓库 / 作者"
          className="min-w-[180px] flex-1"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-sm border border-border-default bg-surface px-3 py-2.5 text-sm text-fg-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="all">全部状态</option>
          <option value="active">活跃</option>
          <option value="deprecated">已弃用</option>
        </select>
        <select
          name="author"
          defaultValue={authorParam ?? ''}
          className="rounded-sm border border-border-default bg-surface px-3 py-2.5 text-sm text-fg-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="">全部作者</option>
          {distinctAuthors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-sm border border-border-default bg-surface px-3 py-2.5 text-sm text-fg-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="updated">最近更新</option>
          <option value="name">名称</option>
          <option value="author">作者</option>
        </select>
        <button className="rounded-sm bg-gradient-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow-md">
          搜索
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="rounded-md border border-border-default bg-surface p-8 text-center text-sm text-fg-tertiary">
          没有匹配的节点,试试调整筛选条件?
        </p>
      ) : (
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
              sourceManager={n.source_manager}
            />
          ))}
        </div>
      )}
      <Pagination basePath="/nodes" page={page} totalPages={totalPages} query={queryBase} />
    </main>
  );
}