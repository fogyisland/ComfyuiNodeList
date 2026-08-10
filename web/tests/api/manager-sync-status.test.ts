import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const requireAdminMock = vi.hoisted(() => vi.fn());
const getLatestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/scan-runs', () => ({ getLatestScanRunAnyStatus: getLatestMock }));

import { GET } from '@/app/api/v1/admin/manager/sync/status/route';

function makeReq() {
  return new NextRequest('http://localhost/api/v1/admin/manager/sync/status', { method: 'GET' });
}

describe('GET /api/v1/admin/manager/sync/status', () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    getLatestMock.mockReset();
    requireAdminMock.mockResolvedValue({ id: '1', githubId: null, username: 'admin', role: 'admin' });
  });

  it('returns 401 when not authenticated', async () => {
    requireAdminMock.mockRejectedValue(new Error('UNAUTHENTICATED'));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(getLatestMock).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not admin', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(getLatestMock).not.toHaveBeenCalled();
  });

  it('returns { run: null } when no rows', async () => {
    getLatestMock.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ run: null });
    expect(getLatestMock).toHaveBeenCalledWith('sync_manager_catalog');
  });

  it('returns running row with finishedAt=null', async () => {
    getLatestMock.mockResolvedValue({
      id: 7n,
      status: 'running',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: null,
      error: null,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe(7);
    expect(body.run.status).toBe('running');
    expect(body.run.startedAt).toBe('2026-08-10T05:00:00.000Z');
    expect(body.run.finishedAt).toBeNull();
    expect(body.run.error).toBeNull();
  });

  it('returns completed row with ISO finishedAt', async () => {
    getLatestMock.mockResolvedValue({
      id: 8n,
      status: 'ok',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: new Date('2026-08-10T05:00:42Z'),
      error: null,
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.run.status).toBe('ok');
    expect(body.run.finishedAt).toBe('2026-08-10T05:00:42.000Z');
  });

  it('passes through the error message for a failed run', async () => {
    getLatestMock.mockResolvedValue({
      id: 9n,
      status: 'failed',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: new Date('2026-08-10T05:00:10Z'),
      error: 'boom',
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.run.status).toBe('failed');
    expect(body.run.error).toBe('boom');
  });
});
