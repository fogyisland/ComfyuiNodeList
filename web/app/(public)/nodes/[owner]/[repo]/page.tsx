import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const revalidate = 300;

type Params = { owner: string; repo: string };

export default async function NodeDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { owner, repo } = await params;
  const node = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    include: {
      versions: { orderBy: { release_date: 'desc' }, select: { version_tag: true, release_date: true } },
    },
  });
  if (!node || node.status === 'hidden') notFound();

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/nodes" className="text-sm text-brand-500 hover:underline">← 全部节点</Link>
      <h1 className="mt-2 text-3xl font-bold text-fg-primary">{node.name}</h1>
      <div className="mt-1 text-sm text-fg-tertiary">by {node.author}</div>
      <div className="mt-1 text-xs text-fg-tertiary font-mono">{node.github_owner}/{node.github_repo}</div>
      {node.description && <p className="mt-4 text-fg-secondary">{node.description}</p>}

      <h2 className="mt-8 text-xl font-semibold text-fg-primary">版本</h2>
      <table className="mt-4 w-full text-sm">
        <thead className="border-b border-border-default text-left text-fg-tertiary">
          <tr>
            <th className="py-2">标签</th>
            <th className="py-2">发布日期</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {node.versions.map((v) => (
            <tr key={v.version_tag} className="border-b border-border-default">
              <td className="py-2 font-mono">{v.version_tag}</td>
              <td className="py-2">{formatDate(v.release_date)}</td>
              <td className="py-2 text-right">
                <Link
                  href={`/nodes/${node.github_owner}/${node.github_repo}/versions/${v.version_tag}`}
                  className="text-brand-500 hover:underline"
                >
                  详情 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}