import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { POST } from '@/app/api/v1/submissions/route';

const prisma = new PrismaClient();

async function makeUser(id = 1n, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: id, username: `u${id}`, avatar_url: '', role },
  });
}

async function postJson(body: unknown, user: { id: bigint; role: string } | null) {
  authMock.mockResolvedValue(user ? { user: { id: user.id.toString(), role: user.role } } : null);
  return POST(new NextRequest('http://x', { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/v1/submissions', () => {
  beforeEach(async () => { authMock.mockReset(); await setup(); });

  it('returns 401 when unauthenticated', async () => {
    const res = await postJson({ github_url: 'https://github.com/a/b', name: 'B', description: 'd' }, null);
    expect(res.status).toBe(401);
  });

  it('returns 201 on happy path and persists row', async () => {
    const u = await makeUser();
    const res = await postJson(
      { github_url: 'https://github.com/foo/bar', name: 'Foo Bar', description: 'desc' },
      u,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    const row = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: BigInt(body.id) } });
    expect(row.name).toBe('Foo Bar');
    expect(row.description).toBe('desc');
    expect(row.submitter_id).toBe(u.id);
  });

  it('returns 400 on invalid-url', async () => {
    const u = await makeUser();
    const res = await postJson({ github_url: 'not-a-url', name: 'x', description: 'y' }, u);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('invalid-url');
  });

  it('returns 400 on missing-field', async () => {
    const u = await makeUser();
    const res = await postJson({ github_url: 'https://github.com/a/b', name: '', description: 'd' }, u);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('missing-field');
  });

  it('returns 400 on description-too-long (>500)', async () => {
    const u = await makeUser();
    const res = await postJson({ github_url: 'https://github.com/a/b', name: 'x', description: 'd'.repeat(501) }, u);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('description-too-long');
  });

  it('returns 409 already-exists when node already indexed', async () => {
    const u = await makeUser();
    await prisma.node.create({ data: { github_owner: 'a', github_repo: 'b', name: 'B', author: '', description: '' } });
    const res = await postJson({ github_url: 'https://github.com/a/b', name: 'B', description: 'd' }, u);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe('already-exists');
  });

  it('returns 409 duplicate-pending when same URL pending (any user)', async () => {
    const u = await makeUser();
    const other = await makeUser(2n);
    await prisma.nodeSubmission.create({
      data: { submitter_id: other.id, github_url: 'https://github.com/x/y', name: 'Y', description: 'd', status: 'pending' },
    });
    const res = await postJson({ github_url: 'https://github.com/x/y', name: 'Y', description: 'd' }, u);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe('duplicate-pending');
  });
});