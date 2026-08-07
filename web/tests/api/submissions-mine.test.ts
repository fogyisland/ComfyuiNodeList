import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { GET } from '@/app/api/v1/submissions/mine/route';

const prisma = new PrismaClient();

async function makeUser(id: bigint) {
  return prisma.user.create({ data: { github_id: id, username: `u${id}`, avatar_url: '', role: 'user' } });
}

describe('GET /api/v1/submissions/mine', () => {
  beforeEach(async () => { authMock.mockReset(); await setup(); });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns only the current user\'s submissions', async () => {
    const me = await makeUser(1n);
    const other = await makeUser(2n);
    await prisma.nodeSubmission.create({ data: { submitter_id: me.id, github_url: 'https://github.com/me/one', name: 'one', description: '' } });
    await prisma.nodeSubmission.create({ data: { submitter_id: other.id, github_url: 'https://github.com/other/one', name: 'one', description: '' } });
    authMock.mockResolvedValue({ user: { id: me.id.toString(), role: 'user' } });
    const res = await GET(new NextRequest('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].github_url).toBe('https://github.com/me/one');
  });
});