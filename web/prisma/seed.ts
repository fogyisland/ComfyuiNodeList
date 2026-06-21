import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const nodes = [
    {
      github_owner: 'ltdrdata',
      github_repo: 'ComfyUI-Impact-Pack',
      name: 'ComfyUI Impact Pack',
      author: 'ltdrdata',
      description: 'Detector, detailer, sampler and other impact nodes for ComfyUI.',
      versions: [
        {
          tag: 'v8.10',
          sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
          release: '2026-01-15T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
              { name: 'ultralytics', spec: '>=8.0.0', min_version: '8.0.0', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['SAMLoader', 'SAMDetectorCombined', 'FaceDetailer', 'DetailerForEach'],
            incompatibilities: [],
          },
        },
        {
          tag: 'v8.9',
          sha: 'b2c3d4e5f6071829a3b4c5d6e7f8091234567890',
          release: '2025-11-02T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
            ],
            node_class_mappings: ['SAMLoader', 'FaceDetailer'],
            incompatibilities: [],
          },
        },
      ],
    },
    {
      github_owner: 'Fannovel16',
      github_repo: 'comfyui_controlnet_aux',
      name: 'ComfyUI ControlNet Aux',
      author: 'Fannovel16',
      description: 'Preprocessors for ControlNet (lineart, depth, canny, etc.).',
      versions: [
        {
          tag: 'v1.2.0',
          sha: 'c3d4e5f60718293a4b5c6d7e8f90123456789abc',
          release: '2026-02-20T00:00:00Z',
          raw: {
            python_min: '3.9',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=1.13', min_version: '1.13', max_version: null, is_pinned: false },
              { name: 'opencv-python', spec: '>=4.5', min_version: '4.5', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['CannyEdge', 'LineartPreprocessor', 'DepthMapPreprocessor'],
            incompatibilities: [],
          },
        },
      ],
    },
    {
      github_owner: 'rgthree',
      github_repo: 'rgthree-comfy',
      name: 'rgthree-comfy',
      author: 'rgthree',
      description: 'Quality-of-life nodes: context, fast groups, power LoRA loader.',
      versions: [
        {
          tag: 'v1.0.3',
          sha: 'd4e5f6071829a3b4c5d6e7f80912345678abcdef',
          release: '2026-03-05T00:00:00Z',
          raw: {
            python_min: '3.10',
            python_max: null,
            dependencies: [
              { name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false },
            ],
            node_class_mappings: ['FastGroup', 'Context', 'PowerLoraLoader'],
            incompatibilities: [],
          },
        },
      ],
    },
  ];

  for (const n of nodes) {
    const node = await prisma.node.upsert({
      where: { github_owner_github_repo: { github_owner: n.github_owner, github_repo: n.github_repo } },
      update: { name: n.name, description: n.description, author: n.author },
      create: {
        github_owner: n.github_owner,
        github_repo: n.github_repo,
        name: n.name,
        author: n.author,
        description: n.description,
      },
    });

    for (const v of n.versions) {
      const version = await prisma.nodeVersion.upsert({
        where: { node_id_version_tag: { node_id: node.id, version_tag: v.tag } },
        update: {},
        create: {
          node_id: node.id,
          version_tag: v.tag,
          git_sha: v.sha,
          release_date: new Date(v.release),
        },
      });

      await prisma.nodeRawRequirement.upsert({
        where: { version_id: version.id },
        update: {},
        create: {
          version_id: version.id,
          python_min: v.raw.python_min,
          python_max: v.raw.python_max,
          dependencies: v.raw.dependencies,
          node_class_mappings: v.raw.node_class_mappings,
          incompatibilities: v.raw.incompatibilities,
          scan_warnings: [],
          raw_files: {},
        },
      });
    }
  }

  const counts = {
    nodes: await prisma.node.count(),
    versions: await prisma.nodeVersion.count(),
    raw: await prisma.nodeRawRequirement.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());