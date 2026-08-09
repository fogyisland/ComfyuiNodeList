// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { SubmissionsClient } from '@/app/admin/submissions/SubmissionsClient';

describe('SubmissionsClient - Manager source badge', () => {
  it('renders Manager badge for manager-sourced row', () => {
    const items = [
      {
        id: 1,
        submitterUsername: 'comfyui-manager',
        submitterSource: 'manager' as const,
        githubUrl: 'https://github.com/a/b',
        createdAt: '2026-08-07T00:00:00Z',
      },
    ];
    const { container } = render(<SubmissionsClient items={items} />);
    expect(container.textContent).toContain('Manager');
    expect(container.querySelector('.bg-slate-100')).not.toBeNull();
  });

  it('does NOT render Manager badge for user-sourced row', () => {
    const items = [
      {
        id: 2,
        submitterUsername: 'alice',
        submitterSource: 'user' as const,
        githubUrl: 'https://github.com/c/d',
        createdAt: '2026-08-07T00:00:00Z',
      },
    ];
    const { container } = render(<SubmissionsClient items={items} />);
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });
});
