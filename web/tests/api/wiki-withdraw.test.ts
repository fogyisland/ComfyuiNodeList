import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/wiki/revisions/[id]/withdraw/route';
import { createRevision, approveRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/wiki/revisions/[id]/withdraw', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });

  it('lets the author withdraw a pending revision', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(204);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.withdrawn);
  });

  it('returns 403 when a different non-admin user tries to withdraw', async () => {
    const author = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: other.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin withdraw someone else pending revision', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(204);
  });

  it('returns 409 when revision is not pending', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: author.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    await approveRevision({ revisionId, reviewerId: admin.id });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown revision', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
