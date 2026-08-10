// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    const { container } = render(<SubmissionsClient items={items} source="all" />);
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
    const { container } = render(<SubmissionsClient items={items} source="all" />);
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });
});

describe('SubmissionsClient tabs', () => {
  it('renders three tabs (全部 / Manager / 用户提交)', () => {
    render(<SubmissionsClient items={[]} source="all" />);
    expect(screen.getByRole('link', { name: /全部/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manager/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /用户提交/ })).toBeTruthy();
  });

  it('highlights the active tab when source matches', () => {
    render(<SubmissionsClient items={[]} source="manager" />);
    const managerTab = screen.getByRole('link', { name: /Manager/ });
    expect(managerTab.className).toMatch(/bg-blue-600/);
    const allTab = screen.getByRole('link', { name: /全部/ });
    expect(allTab.className).not.toMatch(/bg-blue-600/);
  });

  it('tab links have correct hrefs', () => {
    render(<SubmissionsClient items={[]} source="all" />);
    expect(screen.getByRole('link', { name: /全部/ }).getAttribute('href')).toBe('/admin/submissions');
    expect(screen.getByRole('link', { name: /Manager/ }).getAttribute('href')).toBe('/admin/submissions?source=manager');
    expect(screen.getByRole('link', { name: /用户提交/ }).getAttribute('href')).toBe('/admin/submissions?source=user');
  });
});
