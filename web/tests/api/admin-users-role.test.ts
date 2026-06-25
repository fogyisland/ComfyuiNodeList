import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/users/[id]/role/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/users/[id]/role', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for non-admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ role: 'admin' }) }),
      { params: Promise.resolve({ id: String(u.id) }) },
    );
    expect(res.status).toBe(403);
  });

  it('promotes a user to admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const target = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ role: 'admin' }) }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.role).toBe('admin');
  });

  it('refuses self-demotion with 409', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ role: 'user' }) }),
      { params: Promise.resolve({ id: String(admin.id) }) },
    );
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid role value', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const target = await makeUser(2n);
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ role: 'super' }) }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ role: 'user' }) }),
      { params: Promise.resolve({ id: '9999999' }) },
    );
    expect(res.status).toBe(404);
  });
});
