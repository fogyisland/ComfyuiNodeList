import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { getPublishedRequirements } from '@/lib/published';

type Params = { owner: string; repo: string; tag: string };

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { owner, repo, tag } = await params;
  const version = await prisma.nodeVersion.findFirst({
    where: { version_tag: tag, node: { github_owner: owner, github_repo: repo } },
  });
  if (!version) return error(404, 'version not found');

  const published = await getPublishedRequirements(Number(version.id));
  const latestApproved = await prisma.wikiRevision.findFirst({
    where: { version_id: version.id, status: 'approved' },
    orderBy: { reviewed_at: 'desc' },
    select: { notes_md: true },
  });

  return json({
    owner,
    repo,
    version_tag: published.version_tag,
    release_date: published.release_date.toISOString(),
    python_min: published.python_min,
    python_max: published.python_max,
    dependencies: published.dependencies,
    node_class_mappings: published.node_class_mappings,
    incompatibilities: published.incompatibilities,
    notes_md: latestApproved?.notes_md ?? '',
  });
}
