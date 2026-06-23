import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/nodes/[owner]/[repo]/route';

const prisma = new PrismaClient();

describe('GET /api/v1/nodes/[owner]/[repo]', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('returns node with version list (newest first)', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner).toBe('ltdrdata');
    expect(body.repo).toBe('ComfyUI-Impact-Pack');
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].tag).toBe('v8.10');
  });

  it('returns 404 for missing node', async () => {
    const res = await GET(new Request('http://x/api/v1/nodes/no/where'), {
      params: Promise.resolve({ owner: 'no', repo: 'where' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe('node not found');
  });

  it('returns 404 for hidden node', async () => {
    await prisma.node.update({
      where: { github_owner_github_repo: { github_owner: 'ltdrdata', github_repo: 'ComfyUI-Impact-Pack' } },
      data: { status: 'hidden' },
    });
    const res = await GET(new Request('http://x/api/v1/nodes/ltdrdata/ComfyUI-Impact-Pack'), {
      params: Promise.resolve({ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack' }),
    });
    expect(res.status).toBe(404);
  });
});
