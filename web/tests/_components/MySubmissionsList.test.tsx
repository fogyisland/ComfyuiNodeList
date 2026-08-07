// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.search,
}));

import { MySubmissionsList } from '@/app/(public)/my-submissions/MySubmissionsList';

const ROWS = [
  {
    id: 7,
    github_url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
    name: 'Impact Pack',
    description: 'detailers',
    status: 'pending' as const,
    review_note: null,
    created_at: '2026-08-01T10:00:00.000Z',
    reviewed_at: null,
    reviewer_username: null,
  },
  {
    id: 8,
    github_url: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus',
    name: 'IPAdapter Plus',
    description: 'ipadapter',
    status: 'approved' as const,
    review_note: null,
    created_at: '2026-08-02T10:00:00.000Z',
    reviewed_at: '2026-08-03T10:00:00.000Z',
    reviewer_username: 'admin',
  },
  {
    id: 9,
    github_url: 'https://github.com/someone/not-a-node',
    name: 'Not A Node',
    description: 'nope',
    status: 'rejected' as const,
    review_note: '这个仓库不是 ComfyUI 节点',
    created_at: '2026-08-04T10:00:00.000Z',
    reviewed_at: '2026-08-05T10:00:00.000Z',
    reviewer_username: null,
  },
];

function mockFetch(rows: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => rows,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MySubmissionsList', () => {
  it('fetches /api/v1/submissions/mine on mount and shows a loading state first', async () => {
    const fetchMock = mockFetch(ROWS);
    render(<MySubmissionsList />);
    expect(screen.getByText('加载中…')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/submissions/mine');
    await screen.findByText('Impact Pack');
  });

  it('renders every submission with its id and status badge', async () => {
    mockFetch(ROWS);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByText('#9')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(screen.getByText('rejected')).toBeTruthy();
  });

  it('shows the github url and submit time for a pending row', async () => {
    mockFetch([ROWS[0]]);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    expect(screen.getByText('https://github.com/ltdrdata/ComfyUI-Impact-Pack')).toBeTruthy();
    expect(screen.getByText(/提交于/)).toBeTruthy();
  });

  it('links an approved row to /nodes/owner/repo', async () => {
    mockFetch([ROWS[1]]);
    render(<MySubmissionsList />);
    const link = (await screen.findByText(/查看/)).closest('a');
    expect(link?.getAttribute('href')).toBe('/nodes/cubiq/ComfyUI_IPAdapter_plus');
  });

  it('shows the reviewer username on an approved row', async () => {
    mockFetch([ROWS[1]]);
    render(<MySubmissionsList />);
    await screen.findByText('IPAdapter Plus');
    expect(screen.getByText(/审核人 admin/)).toBeTruthy();
  });

  it('hides the reviewer line when an approved row has no reviewer_username', async () => {
    const orphan = { ...ROWS[1], reviewer_username: null };
    mockFetch([orphan]);
    render(<MySubmissionsList />);
    await screen.findByText('IPAdapter Plus');
    expect(screen.queryByText(/审核人/)).toBeNull();
  });

  it('does not render a 查看 link for pending or rejected rows', async () => {
    mockFetch([ROWS[0], ROWS[2]]);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    expect(screen.queryByText(/查看/)).toBeNull();
  });

  it('renders the review note for a rejected row inside a collapsible', async () => {
    mockFetch([ROWS[2]]);
    render(<MySubmissionsList />);
    await screen.findByText('Not A Node');
    const summary = screen.getByText('审核备注');
    expect(summary.closest('details')).toBeTruthy();
    expect(screen.getByText('这个仓库不是 ComfyUI 节点')).toBeTruthy();
  });

  it('filters to a single status when a tab is clicked', async () => {
    mockFetch(ROWS);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    fireEvent.click(screen.getByRole('button', { name: '已拒绝' }));
    expect(screen.getByText('Not A Node')).toBeTruthy();
    expect(screen.queryByText('Impact Pack')).toBeNull();
    expect(screen.queryByText('IPAdapter Plus')).toBeNull();
  });

  it('syncs the selected tab into the ?status= query', async () => {
    mockFetch(ROWS);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    fireEvent.click(screen.getByRole('button', { name: '已通过' }));
    expect(nav.replace).toHaveBeenCalledWith('/my-submissions?status=approved', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(nav.replace).toHaveBeenCalledWith('/my-submissions', { scroll: false });
  });

  it('honours ?status= from the URL on first render', async () => {
    nav.search = new URLSearchParams('status=rejected');
    mockFetch(ROWS);
    render(<MySubmissionsList />);
    await screen.findByText('Not A Node');
    expect(screen.queryByText('Impact Pack')).toBeNull();
  });

  it('ignores an unknown ?status= value and shows everything', async () => {
    nav.search = new URLSearchParams('status=bogus');
    mockFetch(ROWS);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    expect(screen.getByText('IPAdapter Plus')).toBeTruthy();
    expect(screen.getByText('Not A Node')).toBeTruthy();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    mockFetch([ROWS[0]]);
    render(<MySubmissionsList />);
    await screen.findByText('Impact Pack');
    fireEvent.click(screen.getByRole('button', { name: '已通过' }));
    expect(screen.getByText('（暂无提交）')).toBeTruthy();
  });

  it('shows the empty state when the API returns an error', async () => {
    mockFetch({ error: 'unauthenticated' }, false, 401);
    render(<MySubmissionsList />);
    await waitFor(() => expect(screen.getByText('（暂无提交）')).toBeTruthy());
  });
});
