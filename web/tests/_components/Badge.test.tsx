// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '@/app/_components/Badge';

describe('Badge', () => {
  it('default uses bg-subtle', () => {
    const { container } = render(<Badge>hello</Badge>);
    expect((container.firstChild as HTMLElement).className).toContain('bg-subtle');
  });
  it('brand uses bg-brand-50', () => {
    const { container } = render(<Badge kind="brand">b</Badge>);
    expect((container.firstChild as HTMLElement).className).toContain('bg-brand-50');
  });
  it('mono uses font-mono', () => {
    const { container } = render(<Badge kind="mono">v1.0</Badge>);
    expect((container.firstChild as HTMLElement).className).toContain('font-mono');
  });
});