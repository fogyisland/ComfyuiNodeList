// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const getLatestScanRunMock = vi.fn();
const adminPageMock = vi.fn();

vi.mock('@/lib/scan-runs', () => ({
  getLatestScanRun: getLatestScanRunMock,
}));
vi.mock('@/app/admin/AdminHomeClient', () => ({
  AdminHomeClient: (props: { latestRun: unknown }) => {
    adminPageMock(props);
    return <div data-testid="admin-home-client" />;
  },
}));
// The page (app/admin/page.tsx) runs several prisma queries before
// calling getLatestScanRun. The brief's `prisma: {}` mock is too thin —
// the page would crash on `prisma.wikiRevision.count` etc. before
// reaching the assertion. Provide a stub prisma with the methods
// the page actually calls.
vi.mock('@/lib/db', () => ({
  prisma: {
    wikiRevision: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    nodeSubmission: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe('AdminPage', () => {
  it('passes latestRun to AdminHomeClient when scan exists', async () => {
    const fakeRun = {
      id: 1,
      taskName: 'sync_manager_catalog',
      startedAt: new Date('2026-08-09T05:00:00Z'),
      finishedAt: new Date('2026-08-09T05:01:30Z'),
      status: 'ok',
      counts: { added: 5 },
      error: null,
    };
    getLatestScanRunMock.mockResolvedValue(fakeRun);
    adminPageMock.mockClear();
    const { default: AdminPage } = await import('@/app/admin/page');
    render(await AdminPage());
    expect(adminPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ latestRun: expect.objectContaining({ id: 1, taskName: 'sync_manager_catalog' }) }),
    );
  });

  it('passes null when no successful run exists', async () => {
    getLatestScanRunMock.mockResolvedValue(null);
    adminPageMock.mockClear();
    const { default: AdminPage } = await import('@/app/admin/page');
    render(await AdminPage());
    expect(adminPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ latestRun: null }),
    );
  });
});
