// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const findManyMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    nodeSubmission: {
      findMany: findManyMock,
    },
  },
}));
vi.mock('@/app/admin/submissions/SubmissionsClient', () => ({
  SubmissionsClient: ({ items, source }: { items: unknown; source: unknown }) => (
    <div data-testid="submissions-client" data-source={String(source)} data-count={String((items as unknown[]).length)} />
  ),
}));

describe('AdminSubmissionsPage', () => {
  it('queries manager submitters when ?source=manager', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 1n,
        github_url: 'https://github.com/a/b',
        created_at: new Date('2026-08-10T05:00:00Z'),
        submitter: { username: 'comfyui-manager' },
      },
    ]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: { source: 'manager' } });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          submitter: { username: 'comfyui-manager' },
        }),
      }),
    );
    expect(el.props.source).toBe('manager');
  });

  it('queries non-manager submitters when ?source=user', async () => {
    findManyMock.mockResolvedValue([]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: { source: 'user' } });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          submitter: { is: { username: { not: 'comfyui-manager' } } },
        }),
      }),
    );
    expect(el.props.source).toBe('user');
  });

  it('shows all pending submissions when ?source is absent or invalid', async () => {
    findManyMock.mockResolvedValue([]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: {} });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
      }),
    );
    expect(el.props.source).toBe('all');
  });
});
