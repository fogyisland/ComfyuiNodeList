import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, SubmissionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/submissions/[id]/reject/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/submissions/[id]/reject', () => {
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
    const submitter = await makeUser(2n);
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/x/y', status: 'pending' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a pending submission', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/x/y', status: 'pending' },
    });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ review_note: 'not a node' }) }),
      { params: Promise.resolve({ id: String(sub.id) }) },
    );
    expect(res.status).toBe(204);
    const row = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe(SubmissionStatus.rejected);
  });
});