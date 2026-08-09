import { describe, it, expect, vi } from 'vitest';

const findFirstMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({
  prisma: {
    scanRun: {
      findFirst: findFirstMock,
    },
  },
}));

import { getLatestScanRun } from '@/lib/scan-runs';

describe('getLatestScanRun', () => {
  it('queries with task_name + status filter and orders by finished_at desc', async () => {
    findFirstMock.mockResolvedValue(null);
    await getLatestScanRun('sync_manager_catalog');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { task_name: 'sync_manager_catalog', status: 'ok' },
      orderBy: { finished_at: 'desc' },
    });
  });
});
