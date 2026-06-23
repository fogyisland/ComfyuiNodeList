import { prisma } from './db';

export type PublishedDependency = {
  name: string;
  spec: string;
  min_version: string | null;
  max_version: string | null;
  is_pinned: boolean;
};

export type PublishedRequirements = {
  version_id: number;
  version_tag: string;
  release_date: Date;
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export async function getPublishedRequirements(
  versionId: number,
): Promise<PublishedRequirements> {
  const version = await prisma.nodeVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      raw_requirements: true,
      wiki_revisions: {
        where: { status: 'approved' },
        orderBy: { reviewed_at: 'desc' },
        take: 1,
      },
    },
  });

  const raw = version.raw_requirements;
  const approved = version.wiki_revisions[0];

  return {
    version_id: version.id,
    version_tag: version.version_tag,
    release_date: version.release_date,
    python_min: approved?.python_min ?? raw?.python_min ?? null,
    python_max: approved?.python_max ?? raw?.python_max ?? null,
    dependencies:
      (approved?.dependencies as PublishedDependency[] | null) ??
      (raw?.dependencies as PublishedDependency[] | null) ??
      [],
    node_class_mappings:
      (approved?.node_class_mappings as string[] | null) ??
      (raw?.node_class_mappings as string[] | null) ??
      [],
    incompatibilities:
      (approved?.incompatibilities as string[] | null) ??
      (raw?.incompatibilities as string[] | null) ??
      [],
  };
}
