import Link from 'next/link';
import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NodeCard } from './(public)/_components/NodeCard';

export const revalidate = 60;

export default async function HomePage() {
  const [nodeCount, versionCount, recent] = await Promise.all([
    prisma.node.count({ where: { status: { in: [NodeStatus.active, NodeStatus.deprecated] } } }),
    prisma.nodeVersion.count(),
    prisma.node.findMany({
      where: { status: { in: [NodeStatus.active, NodeStatus.deprecated] } },
      orderBy: { updated_at: 'desc' },
      take: 5,
      select: { github_owner: true, github_repo: true, name: true, author: true, description: true, updated_at: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-bold">ComfyUI 节点元数据 Wiki</h1>
      <p className="mt-2 text-gray-600">
        社区维护的 ComfyUI 自定义节点依赖、Python 版本与互斥关系。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">收录节点</div>
          <div className="mt-1 text-2xl font-bold">{nodeCount}</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">已扫描版本</div>
          <div className="mt-1 text-2xl font-bold">{versionCount}</div>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">最近更新</h2>
          <Link href="/nodes" className="text-sm text-accent hover:underline">查看全部 →</Link>
        </div>
        <div className="mt-4 grid gap-3">
          {recent.map((n) => (
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
      </section>
    </main>
  );
}
