import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, SubmissionStatus, NodeStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/submissions/[id]/approve/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/submissions/[id]/approve', () => {
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

  it('approves a pending submission and creates a Node row', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/newowner/newrepo', status: 'pending' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submissionId).toBe(Number(sub.id));
    const node = await prisma.node.findUniqueOrThrow({
      where: { github_owner_github_repo: { github_owner: 'newowner', github_repo: 'newrepo' } },
    });
    expect(node.name).toBe('newrepo');
    expect(node.status).toBe(NodeStatus.active);
    const refreshedSub = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(refreshedSub.status).toBe(SubmissionStatus.approved);
  });

  it('is idempotent when a node with the same owner/repo already exists', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const existing = await prisma.node.create({
      data: { github_owner: 'existing', github_repo: 'repo', name: 'existing/repo', author: 'existing' },
    });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/existing/repo', status: 'pending' },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeId).toBe(Number(existing.id));
    const all = await prisma.node.count({ where: { github_owner: 'existing', github_repo: 'repo' } });
    expect(all).toBe(1);
  });

  it('returns 409 if submission is not pending', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: {
        submitter_id: submitter.id,
        github_url: 'https://github.com/x/y',
        status: 'rejected',
        reviewer_id: admin.id,
        reviewed_at: new Date(),
      },
    });
    const res = await POST(new NextRequest('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(409);
  });
});