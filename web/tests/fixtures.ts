import { PrismaClient } from '@prisma/client';

export async function seedFixture(prisma: PrismaClient): Promise<void> {
  const nodes = [
    {
      github_owner: 'ltdrdata',
      github_repo: 'ComfyUI-Impact-Pack',
      name: 'ComfyUI Impact Pack',
      author: 'ltdrdata',
      versions: [
        { tag: 'v8.10', sha: 'a'.repeat(40), release: new Date('2026-01-15T00:00:00Z') },
        { tag: 'v8.9', sha: 'b'.repeat(40), release: new Date('2025-11-02T00:00:00Z') },
      ],
    },
    {
      github_owner: 'Fannovel16',
      github_repo: 'comfyui_controlnet_aux',
      name: 'ComfyUI ControlNet Aux',
      author: 'Fannovel16',
      versions: [{ tag: 'v1.2.0', sha: 'c'.repeat(40), release: new Date('2026-02-20T00:00:00Z') }],
    },
    {
      github_owner: 'rgthree',
      github_repo: 'rgthree-comfy',
      name: 'rgthree-comfy',
      author: 'rgthree',
      versions: [{ tag: 'v1.0.3', sha: 'd'.repeat(40), release: new Date('2026-03-05T00:00:00Z') }],
    },
  ];

  for (const n of nodes) {
    const node = await prisma.node.create({
      data: {
        github_owner: n.github_owner,
        github_repo: n.github_repo,
        name: n.name,
        author: n.author,
      },
    });
    for (const v of n.versions) {
      const version = await prisma.nodeVersion.create({
        data: { node_id: node.id, version_tag: v.tag, git_sha: v.sha, release_date: v.release },
      });
      await prisma.nodeRawRequirement.create({
        data: {
          version_id: version.id,
          python_min: '3.10',
          python_max: null,
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          scan_warnings: [],
          raw_files: {},
        },
      });
    }
  }
}
