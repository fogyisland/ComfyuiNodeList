import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

// requireUser() → getCurrentUser() → prisma.user.findUnique(...). The DB is
// not seeded in this file (the brief explicitly excludes setup()/seedFixture
// since the endpoint itself does not touch the DB), so stub the lookup to
// return a user whose id matches whatever authMock provides.
const findUniqueMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: findUniqueMock } } }));

import { POST } from '@/app/api/v1/conflicts/check/route';

describe('POST /api/v1/conflicts/check', () => {
  beforeEach(() => {
    authMock.mockReset();
    findUniqueMock.mockReset();
    // Default: every id resolves to a synthetic user. Individual tests can
    // override findUniqueMock to simulate missing / unauthenticated cases.
    findUniqueMock.mockImplementation(async ({ where: { id } }: { where: { id: bigint } }) => ({
      id,
      github_id: 1n,
      username: 'stub',
      avatar_url: '',
      role: 'user',
    }));
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ installed: [] }) }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty conflicts (Plan 2 stub)', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({ installed: [{ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' }] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ conflicts: [] });
  });

  it('returns 400 on invalid body', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ wrong: true }) }),
    );
    expect(res.status).toBe(400);
  });
});
