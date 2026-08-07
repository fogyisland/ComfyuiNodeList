import Link from 'next/link';
import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NodeCard } from './(public)/_components/NodeCard';
import { LinkButton } from '@/app/_components/Button';
import { Card, CardTitle } from '@/app/_components/Card';

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
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-brand p-8 md:p-16 shadow-lg">
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-display-2xl text-white">ComfyUI Node Wiki</h1>
          <p className="mt-3 text-lg text-white/85">Build with confidence.</p>
          <p className="mt-2 text-sm text-white/75">
            社区维护的 ComfyUI 自定义节点依赖、Python 版本与互斥关系。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/nodes" variant="secondary" size="md" className="bg-white text-brand-600 border-white hover:bg-white">
              浏览全部节点
            </LinkButton>
            <LinkButton href="/submit" variant="ghost" size="md" className="text-white hover:bg-white/10">
              提交你的节点 →
            </LinkButton>
          </div>
          <div className="mt-8 flex gap-6 text-sm text-white/85">
            <span><span className="font-bold text-white">{nodeCount}</span> nodes</span>
            <span className="text-white/50">·</span>
            <span><span className="font-bold text-white">{versionCount}</span> versions</span>
          </div>
        </div>
      </section>

      {/* Recent */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-display-md text-fg-primary">最近更新</h2>
          <Link href="/nodes" className="text-sm text-brand-500 hover:underline">查看全部 →</Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
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

      {/* Value props */}
      <section className="mt-16 grid gap-6 md:grid-cols-3">
        {[
          { icon: '📦', title: '完整收录', desc: '从 GitHub 自动同步依赖、Python 版本与节点类映射。' },
          { icon: '🔒', title: '审核驱动', desc: '所有收录来自用户提交 + 管理员审核,可追溯。' },
          { icon: '🤝', title: '社区协作', desc: '任何登录用户都可提议编辑,版本历史透明。' },
        ].map((v) => (
          <Card key={v.title} variant="flat">
            <div className="text-2xl">{v.icon}</div>
            <CardTitle className="mt-3">{v.title}</CardTitle>
            <p className="mt-2 text-sm text-fg-secondary">{v.desc}</p>
          </Card>
        ))}
      </section>

      {/* Footer */}
      <footer className="mt-16 border-t border-border-default pt-8 pb-4 text-sm text-fg-secondary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>© 2026 ComfyUI Node Wiki · Community data, MIT license</span>
          <a
            href="https://github.com/fogyisland/ComfyuiNodeList"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:underline"
          >
            GitHub →
          </a>
        </div>
      </footer>
    </main>
  );
}