import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/submissions/pending/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/submissions/pending', () => {
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

  it('lists pending submissions for an admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    await prisma.nodeSubmission.create({
      data: {
        submitter_id: submitter.id,
        github_url: 'https://github.com/some/repo',
        status: 'pending',
      },
    });
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].githubUrl).toBe('https://github.com/some/repo');
  });
});