import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns paginated active nodes', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?page=1&page_size=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(2);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      owner: expect.any(String),
      repo: expect.any(String),
      name: expect.any(String),
    });
  });

  it('filters by q (name match)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?q=impact'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toMatch(/Impact/);
  });

  it('filters by q (author match)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?q=rgthree'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].owner).toBe('rgthree');
  });

  it('hides nodes with status=hidden', async () => {
    await prisma.node.updateMany({ data: { status: 'hidden' } });
    const res = await GET(new Request('http://x/api/v1/nodes'));
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('returns empty page when page is past the end', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes?page=99'));
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toEqual([]);
  });
});
