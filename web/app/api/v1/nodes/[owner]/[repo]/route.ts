import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

type Params = { owner: string; repo: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { owner, repo } = await params;
  const node = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: owner, github_repo: repo } },
    include: {
      versions: { orderBy: { release_date: 'desc' }, select: { version_tag: true, release_date: true } },
    },
  });
  if (!node || node.status === 'hidden') {
    return error(404, 'node not found');
  }
  return json({
    owner: node.github_owner,
    repo: node.github_repo,
    name: node.name,
    author: node.author,
    description: node.description,
    versions: node.versions.map((v) => ({
      tag: v.version_tag,
      release_date: v.release_date.toISOString(),
    })),
  });
}
