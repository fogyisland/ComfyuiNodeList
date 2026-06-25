import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/[versionId]/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/wiki/[versionId]', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(
      new NextRequest(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(401);
  });

  it('returns published + null latestPending for a clean version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(
      new NextRequest(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versionId).toBe(Number(version.id));
    expect(body.published.version_tag).toBe('v8.10');
    expect(body.latestPending).toBeNull();
  });

  it("returns the current user's latest pending revision", async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'first',
      },
    });
    const res = await GET(
      new NextRequest(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latestPending).toMatchObject({ id: revisionId, status: 'pending' });
  });

  it('does not return another user pending revision as latestPending', async () => {
    const me = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: me.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await createRevision({
      versionId: Number(version.id),
      authorId: other.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'other',
      },
    });
    const res = await GET(
      new NextRequest(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    const body = await res.json();
    expect(body.latestPending).toBeNull();
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(
      new NextRequest('http://x/api/v1/wiki/9999999'),
      { params: Promise.resolve({ versionId: '9999999' }) },
    );
    expect(res.status).toBe(404);
  });
});
