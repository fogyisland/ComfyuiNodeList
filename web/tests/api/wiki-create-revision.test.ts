import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/wiki/[versionId]/revisions/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

function validBody() {
  return {
    python_min: '3.10',
    python_max: null,
    dependencies: [
      { name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false },
    ],
    node_class_mappings: ['Foo/Bar'],
    incompatibilities: [],
    notes_md: '',
    edit_summary: 'initial',
  };
}

describe('POST /api/v1/wiki/[versionId]/revisions', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify(validBody()) }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when body fails zod', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ ...validBody(), edit_summary: '' }) }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when client supplies author_id (strict schema rejects unknown keys)', async () => {
    const me = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: me.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({ ...validBody(), author_id: other.id.toString() }),
      }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it('creates a pending revision bound to the session user', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify(validBody()) }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(typeof body.revisionId).toBe('number');
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(body.revisionId) } });
    expect(row.author_id).toBe(user.id);
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify(validBody()) }),
      { params: Promise.resolve({ versionId: '9999999' }) },
    );
    expect(res.status).toBe(404);
  });
});
