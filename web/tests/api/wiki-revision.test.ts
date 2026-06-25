import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
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
    const res = await GET(new NextRequest('http://x'), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });

  it('returns the full revision with fields object and reviewer info', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: author.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: {
        python_min: '3.10',
        dependencies: [{ name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false }],
        node_class_mappings: ['Foo/Bar'],
        incompatibilities: [],
        notes_md: 'hello',
        edit_summary: 'first',
      },
    });
    await approveRevision({ revisionId, reviewerId: admin.id, reviewNote: 'ok' });
    const res = await GET(new NextRequest('http://x'), { params: Promise.resolve({ id: String(revisionId) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(revisionId);
    expect(body.status).toBe('approved');
    expect(body.fields.python_min).toBe('3.10');
    expect(body.fields.dependencies[0].name).toBe('torch');
    expect(body.reviewer.username).toBe('u2');
  });

  it('returns 404 for unknown id', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'), { params: Promise.resolve({ id: '9999999' }) });
    expect(res.status).toBe(404);
  });
});
