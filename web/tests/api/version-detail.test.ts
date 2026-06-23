import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/[owner]/[repo]/versions/[tag]/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes/[owner]/[repo]/versions/[tag]', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns published view for a known version', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await prisma.nodeRawRequirement.update({
      where: { version_id: version.id },
      data: {
        python_min: '3.10',
        python_max: null,
        dependencies: [{ name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false }],
        node_class_mappings: ['SAMLoader'],
        incompatibilities: [],
      },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v8.10' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner).toBe('ltdrdata');
    expect(body.repo).toBe('ComfyUI-Impact-Pack');
    expect(body.version_tag).toBe('v8.10');
    expect(body.python_min).toBe('3.10');
    expect(body.dependencies).toHaveLength(1);
    expect(body.notes_md).toBe('');
  });

  it('returns 404 when version tag does not exist', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v999'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v999' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns notes_md from latest approved revision', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '# 注意\n需要 ≥16GB 显存。',
        edit_summary: 'add notes',
        status: 'approved',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-02T00:00:00Z'),
      },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack/versions/v8.10'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', tag: 'v8.10' }),
    });
    const body = await res.json();
    expect(body.notes_md).toContain('显存');
  });
});
