import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/diff/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

describe('GET /api/v1/wiki/diff', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://x?from=1&to=2'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when from or to is missing', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x?from=1'));
    expect(res.status).toBe(400);
  });

  it('returns a field diff for two revisions', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const a = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: 'a',
        edit_summary: 'a',
      },
    });
    const b = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        python_min: '3.11',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: 'b',
        edit_summary: 'b',
      },
    });
    const res = await GET(new NextRequest(`http://x?from=${a.revisionId}&to=${b.revisionId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const fields = body.diff.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['python_min', 'notes_md']));
  });

  it('returns 404 if either revision does not exist', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x?from=9999998&to=9999999'));
    expect(res.status).toBe(404);
  });
});
