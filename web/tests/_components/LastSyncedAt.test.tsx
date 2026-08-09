// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LastSyncedAt } from '@/app/_components/LastSyncedAt';

describe('LastSyncedAt', () => {
  it("renders 'never ran' when run is null", () => {
    const { container } = render(<LastSyncedAt run={null} />);
    expect(container.textContent).toContain('Manager sync never ran');
  });

  it("renders '刚刚' when finishedAt is now", () => {
    const now = new Date();
    const { container } = render(<LastSyncedAt run={{ finishedAt: now }} />);
    expect(container.textContent).toContain('刚刚');
  });

  it("renders 'X 小时前' with absolute UTC tooltip when finishedAt is 5 hours ago", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const { container } = render(<LastSyncedAt run={{ finishedAt: fiveHoursAgo }} />);
    expect(container.textContent).toContain('5 小时前');
    // The absolute UTC timestamp is rendered as a separate span with title attr
    const spans = container.querySelectorAll('span[title]');
    expect(spans.length).toBeGreaterThan(0);
    const tooltipText = spans[0].getAttribute('title') ?? '';
    expect(tooltipText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });
});
