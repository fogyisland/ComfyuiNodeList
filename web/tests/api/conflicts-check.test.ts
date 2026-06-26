import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

// requireUser() → getCurrentUser() → prisma.user.findUnique(...). The DB is
// not seeded in this file (the brief explicitly excludes setup()/seedFixture
// since the endpoint itself does not touch the DB), so stub the lookup to
// return a user whose id matches whatever authMock provides.
// Task 4: checkConflicts now loads via prisma.nodeVersion.findFirst; stub
// it too so the mock remains DB-isolated.
const findUniqueMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: findUniqueMock },
    nodeVersion: { findFirst: findFirstMock },
  },
}));

import { POST } from '@/app/api/v1/conflicts/check/route';

describe('POST /api/v1/conflicts/check', () => {
  beforeEach(() => {
    authMock.mockReset();
    findUniqueMock.mockReset();
    findFirstMock.mockReset();
    // Default: every id resolves to a synthetic user. Individual tests can
    // override findUniqueMock to simulate missing / unauthenticated cases.
    findUniqueMock.mockImplementation(async ({ where: { id } }: { where: { id: bigint } }) => ({
      id,
      github_id: 1n,
      username: 'stub',
      avatar_url: '',
      role: 'user',
    }));
    // Default: no NodeVersion matches → checkConflicts returns [].
    findFirstMock.mockResolvedValue(null);
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

  it('accepts a valid draft field and forwards it', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    // findFirstMock returns null by default (set in beforeEach), so `installed`
    // resolves to no nodes. The draft is still added as a virtual node by
    // checkConflictsWithDraft, but a single node produces no pair-wise
    // conflicts → 200 with empty conflicts array. The point of this test is
    // to verify the schema accepts the field and the route forwards it
    // without 400-ing on the new field. The engine's draft application is
    // covered by conflict-engine.test.ts (integration tests).
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({
          installed: [],
          draft: {
            python_min: '3.10',
            python_max: '3.12',
            dependencies: [],
            node_class_mappings: [],
            incompatibilities: [],
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ conflicts: [] });
  });

  it('still works without a draft (backward compat)', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({ installed: [] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ conflicts: [] });
  });

  it('rejects unknown fields in body (strict schema)', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({ installed: [], extra: 'x' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields in draft (strict nested schema)', async () => {
    // ConflictDraftSchema is .strict(), so unknown keys inside `draft`
    // trigger 400 (same contract as the top-level body's .strict()).
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new NextRequest('http://x', {
        method: 'POST',
        body: JSON.stringify({
          installed: [],
          draft: {
            python_min: '3.10',
            python_max: '3.12',
            dependencies: [],
            node_class_mappings: [],
            incompatibilities: [],
            unknown: 'x',
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
