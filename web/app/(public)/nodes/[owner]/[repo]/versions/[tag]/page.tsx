import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { getPublishedRequirements } from '@/lib/published';
import { DependencyTable } from '../../../../../_components/DependencyTable';

export const revalidate = 300;

type Params = { owner: string; repo: string; tag: string };

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo, tag } = await params;
  const version = await prisma.nodeVersion.findFirst({
    where: { version_tag: tag, node: { github_owner: owner, github_repo: repo } },
  });
  if (!version) notFound();

  const [pub, node, latestApproved] = await Promise.all([
    getPublishedRequirements(Number(version.id)),
    prisma.node.findUniqueOrThrow({
      where: { id: version.node_id },
      select: { name: true },
    }),
    prisma.wikiRevision.findFirst({
      where: { version_id: version.id, status: 'approved' },
      orderBy: { reviewed_at: 'desc' },
      select: { notes_md: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href={`/nodes/${owner}/${repo}`} className="text-sm text-accent hover:underline">
        ← 返回 {node.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold font-mono">{tag}</h1>
      <div className="mt-1 text-sm text-gray-500">{formatDate(pub.release_date)} 发布</div>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Python 版本</h2>
        <p className="mt-2 font-mono text-sm">
          {pub.python_min ?? '—'} ≤ Python &lt; {pub.python_max ?? '（无上限）'}
        </p>
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">依赖</h2>
        <div className="mt-2">
          <DependencyTable deps={pub.dependencies} />
        </div>
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">节点类映射</h2>
        {pub.node_class_mappings.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm font-mono">
            {pub.node_class_mappings.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">互斥节点</h2>
        {pub.incompatibilities.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {pub.incompatibilities.map((i) => <li key={i} className="font-mono">{i}</li>)}
          </ul>
        )}
      </section>

      {latestApproved?.notes_md && (
        <section className="mt-6 rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">备注</h2>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700 font-mono">
            {latestApproved.notes_md}
          </pre>
        </section>
      )}

      {pub.dependencies.length === 0 && pub.node_class_mappings.length === 0 && (
        <p className="mt-6 text-xs text-gray-400">
          该版本尚未被扫描器处理，<Link href="/nodes" className="text-accent hover:underline">查看其他节点</Link>。
        </p>
      )}
    </main>
  );
}
