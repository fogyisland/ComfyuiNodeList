import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/revisions/pending/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/revisions/pending', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(403);
  });

  it('returns paginated pending revisions for an admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await GET(new NextRequest('http://x?page=1&page_size=10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].author.username).toBe('u2');
  });
});
