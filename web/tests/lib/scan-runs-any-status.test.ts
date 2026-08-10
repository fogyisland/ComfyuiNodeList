import { describe, it, expect, beforeEach, vi } from 'vitest';

const findFirstMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({
  prisma: {
    scanRun: {
      findFirst: findFirstMock,
    },
  },
}));

import { getLatestScanRunAnyStatus } from '@/lib/scan-runs';

describe('getLatestScanRunAnyStatus', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
  });

  it('returns the most recent row regardless of status', async () => {
    findFirstMock.mockResolvedValue({
      id: 1n,
      status: 'running',
      started_at: new Date('2026-08-10T05:00:00Z'),
      finished_at: null,
      error: null,
    });
    const run = await getLatestScanRunAnyStatus('sync_manager_catalog');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { task_name: 'sync_manager_catalog' },
      orderBy: { started_at: 'desc' },
      select: {
        id: true,
        status: true,
        started_at: true,
        finished_at: true,
        error: true,
      },
    });
    expect(run?.status).toBe('running');
    expect(run?.finished_at).toBeNull();
  });

  it('returns null when no rows', async () => {
    findFirstMock.mockResolvedValue(null);
    const run = await getLatestScanRunAnyStatus('never_ran');
    expect(run).toBeNull();
  });
});
