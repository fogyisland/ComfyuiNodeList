import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { getPublishedRequirements } from '@/lib/published';

const prisma = new PrismaClient();

describe('getPublishedRequirements', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns raw requirements when no wiki revisions exist', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({
      where: { version_tag: 'v8.10' },
    });
    await prisma.nodeRawRequirement.update({
      where: { version_id: version.id },
      data: {
        python_min: '3.10',
        python_max: null,
        dependencies: [
          { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
        ],
        node_class_mappings: ['SAMLoader'],
        incompatibilities: [],
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.10');
    expect(r.dependencies).toHaveLength(1);
    expect(r.dependencies[0]?.name).toBe('torch');
    expect(r.node_class_mappings).toEqual(['SAMLoader']);
  });

  it('overlays approved wiki revisions on top of raw data', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.11',
        dependencies: [],
        node_class_mappings: ['SAMLoader', 'BarNode'],
        incompatibilities: ['comfyui-impact-pack'],
        notes_md: '',
        edit_summary: 'add BarNode',
        status: 'approved',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-01T00:00:00Z'),
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.11');
    expect(r.dependencies).toHaveLength(0);
    expect(r.node_class_mappings).toEqual(['SAMLoader', 'BarNode']);
    expect(r.incompatibilities).toEqual(['comfyui-impact-pack']);
  });

  it('ignores pending and rejected revisions', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const user = await prisma.user.create({ data: { github_id: 1n, username: 'editor', avatar_url: '' } });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.12',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'try python 3.12',
        status: 'pending',
      },
    });
    await prisma.wikiRevision.create({
      data: {
        version_id: version.id,
        author_id: user.id,
        python_min: '3.13',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'bad',
        status: 'rejected',
        reviewer_id: user.id,
        reviewed_at: new Date('2026-04-01T00:00:00Z'),
      },
    });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBe('3.10'); // raw default
  });

  it('returns safe defaults when neither raw nor approved exist', async () => {
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.9' } });
    // delete raw row to simulate un-scanned version
    await prisma.nodeRawRequirement.delete({ where: { version_id: version.id } });
    const r = await getPublishedRequirements(version.id);
    expect(r.python_min).toBeNull();
    expect(r.python_max).toBeNull();
    expect(r.dependencies).toEqual([]);
    expect(r.node_class_mappings).toEqual([]);
    expect(r.incompatibilities).toEqual([]);
  });
});
