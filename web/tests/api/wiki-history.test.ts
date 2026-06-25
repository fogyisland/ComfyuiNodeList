import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/[versionId]/history/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

describe('GET /api/v1/wiki/[versionId]/history', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(401);
  });

  it('returns paginated history sorted by created_at desc', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    for (let i = 0; i < 3; i++) {
      await createRevision({
        versionId: Number(v.id),
        authorId: user.id,
        body: {
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          notes_md: '',
          edit_summary: `r${i}`,
        },
      });
    }
    const res = await GET(new NextRequest('http://x?page=1&page_size=2'), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].author.username).toBe('u1');
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'), {
      params: Promise.resolve({ versionId: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
