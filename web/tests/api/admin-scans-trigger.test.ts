import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { POST } from '@/app/api/v1/admin/scans/trigger/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/scans/trigger', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('returns 200 with queued status when admin', async () => {
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('queued');
  });
});