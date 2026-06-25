import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/users/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/users', () => {
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

  it('returns 403 for non-admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(403);
  });

  it('lists all users for admin', async () => {
    const admin = await makeUser(1n, 'admin');
    await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });
});
