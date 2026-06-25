import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/revisions/[id]/route';
import { createRevision, approveRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/wiki/revisions/[id]', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const user = await makeUser(1n);
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(401);
  });

  it('returns full revision with author info', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        python_max: '3.12',
        dependencies: [{ name: 'numpy', spec: '>=1.0', min_version: null, max_version: null, is_pinned: false }],
        node_class_mappings: ['foo/bar'],
        incompatibilities: [],
        notes_md: '## hello',
        edit_summary: 'init',
      },
    });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: revisionId,
      versionId: Number(v.id),
      status: 'pending',
      author: { username: 'u1', avatarUrl: '' },
      pythonMin: '3.10',
      pythonMax: '3.12',
      dependencies: [{ name: 'numpy', spec: '>=1.0', min_version: null, max_version: null, is_pinned: false }],
      nodeClassMappings: ['foo/bar'],
      incompatibilities: [],
      notesMd: '## hello',
      editSummary: 'init',
      reviewer: null,
      reviewNote: null,
    });
    expect(typeof body.createdAt).toBe('string');
    expect(body.reviewedAt).toBeNull();
  });

  it('returns 404 for an unknown revision', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ id: '9999999' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns reviewer + reviewedAt for an approved revision', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'init',
      },
    });
    await approveRevision({ revisionId, reviewerId: admin.id, reviewNote: 'LGTM' });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body.reviewer).toMatchObject({ username: 'u2' });
    expect(body.reviewNote).toBe('LGTM');
    expect(typeof body.reviewedAt).toBe('string');
  });
});
