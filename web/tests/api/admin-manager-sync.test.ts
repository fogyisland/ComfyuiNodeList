import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.stubGlobal('fetch', fetchMock);

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { POST } from '@/app/api/v1/admin/manager/sync/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/manager/sync', () => {
  beforeEach(async () => {
    authMock.mockReset();
    fetchMock.mockReset();
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

  it('returns 202 with task_id when trigger-api succeeds', async () => {
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'queued', task_id: 'mgr-xyz' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.task_id).toBe('mgr-xyz');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/trigger-manager-sync'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns 502 when trigger-api is unreachable', async () => {
    const admin = await makeUser(3n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8081'));
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe('trigger-api unreachable');
  });

  it('returns 502 when trigger-api returns non-2xx', async () => {
    const admin = await makeUser(4n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(new Response('redis down', { status: 503 }));
    const res = await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe('trigger-api error');
  });

  it('uses default SCANNER_TRIGGER_API_URL when env unset', async () => {
    const prev = process.env.SCANNER_TRIGGER_API_URL;
    delete process.env.SCANNER_TRIGGER_API_URL;
    const admin = await makeUser(5n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'queued', task_id: 't' }), { status: 202 })
    );
    await POST(new NextRequest('http://x', { method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8081/trigger-manager-sync',
      expect.any(Object)
    );
    if (prev !== undefined) process.env.SCANNER_TRIGGER_API_URL = prev;
  });
});
