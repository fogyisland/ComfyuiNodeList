import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/revisions/[id]/reject/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/revisions/[id]/reject', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when review_note is missing', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a pending revision with a note', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ review_note: 'not enough detail' }) }),
      { params: Promise.resolve({ id: String(revisionId) }) },
    );
    expect(res.status).toBe(204);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.rejected);
  });
});
