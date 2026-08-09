// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NodeCard } from '@/app/(public)/_components/NodeCard';

const baseProps = {
  owner: 'foo',
  repo: 'bar',
  name: 'Foo',
  author: 'alice',
  description: 'Test description',
  updatedAt: '2026-08-07T00:00:00Z',
};

describe('NodeCard - sourceManager prop', () => {
  it('renders "via Manager" badge when sourceManager=true', () => {
    const { container } = render(<NodeCard {...baseProps} sourceManager={true} />);
    expect(container.textContent).toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).not.toBeNull();
  });

  it('omits badge when sourceManager=false', () => {
    const { container } = render(<NodeCard {...baseProps} sourceManager={false} />);
    expect(container.textContent).not.toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });

  it('omits badge when sourceManager undefined', () => {
    const { container } = render(<NodeCard {...baseProps} />);
    expect(container.textContent).not.toContain('via Manager');
    expect(container.querySelector('.bg-slate-100')).toBeNull();
  });
});
