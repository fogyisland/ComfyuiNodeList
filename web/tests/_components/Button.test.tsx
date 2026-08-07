// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Button } from '@/app/_components/Button';

describe('Button', () => {
  it('Primary uses bg-gradient-brand', () => {
    const { container } = render(<Button variant="primary">go</Button>);
    const btn = container.firstChild as HTMLElement;
    expect(btn.className).toContain('bg-gradient-brand');
    expect(btn.className).toContain('rounded-sm');
  });
  it('Secondary uses bg-surface and border-border-default', () => {
    const { container } = render(<Button variant="secondary">go</Button>);
    const btn = container.firstChild as HTMLElement;
    expect(btn.className).toContain('bg-surface');
    expect(btn.className).toContain('border-border-default');
  });
  it('Destructive uses bg-danger', () => {
    const { container } = render(<Button variant="destructive">del</Button>);
    const btn = container.firstChild as HTMLElement;
    expect(btn.className).toContain('bg-danger');
  });
  it('Icon is 36x36 with rounded-md', () => {
    const { container } = render(<Button variant="icon" aria-label="x">×</Button>);
    const btn = container.firstChild as HTMLElement;
    expect(btn.className).toContain('rounded-md');
    expect(btn.className).toMatch(/h-9|w-9/);
  });
});