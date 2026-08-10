// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { ManagerSyncButton } from '@/app/(admin)/_components/ManagerSyncButton';

// Mock next/navigation
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response;
  }) as never;
}

describe('ManagerSyncButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders initial idle state with the sync label', () => {
    render(<ManagerSyncButton managerSystemUserId={1} />);
    expect(screen.getByRole('button', { name: /同步 Manager 目录/ })).toBeTruthy();
  });

  it('transitions through submitting -> polling -> done ok and calls router.refresh', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued', task_id: 'abc' } },                                  // POST
      { status: 200, body: { run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } } }, // poll 1
      { status: 200, body: { run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } } }, // poll 2
      { status: 200, body: { run: { id: 1, status: 'ok', startedAt: 't', finishedAt: 't', error: null } } },       // poll 3
    ]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    // Advance 1s, 1s, 5s - three ticks (use Async to drain microtasks)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('transitions to done failed with the error message', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued' } },
      { status: 200, body: { run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } } },
      { status: 200, body: { run: { id: 1, status: 'failed', error: 'boom', startedAt: 't', finishedAt: 't' } } },
    ]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    // After the first advance, the second tick ran and got 'failed'.
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();
  }, 10000);

  it('times out at 180s and shows the "still running" message', async () => {
    // Always-running response
    mockFetchSequence([{ status: 200, body: { run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } } }]);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    // Advance slightly past 180s to give the timeout check a chance to fire
    await act(async () => { await vi.advanceTimersByTimeAsync(185_000); });
    expect(screen.getByText(/仍在后台运行/)).toBeTruthy();
  }, 60000);

  it('handles fetch errors on the status endpoint without crashing', async () => {
    // POST succeeds, then status fetch rejects once, then resolves with running
    mockFetchSequence([
      { status: 202, body: { status: 'queued' } },
    ]);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('network'));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } }),
    } as Response);
    render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    // Should not throw; the component continues polling - no error banner shown
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('clears the polling timer on unmount', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'queued' } },
      { status: 200, body: { run: { id: 1, status: 'running', startedAt: 't', finishedAt: null, error: null } } },
    ]);
    const { unmount } = render(<ManagerSyncButton managerSystemUserId={1} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    unmount();
    // Advance timers; if the timer wasn't cleared, vitest will warn about setState on unmounted.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  });
});