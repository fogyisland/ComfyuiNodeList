import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const globals = readFileSync(
  join(process.cwd(), 'app/globals.css'),
  'utf-8',
);
const tailwind = readFileSync(
  join(process.cwd(), 'tailwind.config.ts'),
  'utf-8',
);

describe('design tokens', () => {
  const requiredVars = [
    '--bg-canvas',
    '--bg-surface',
    '--bg-subtle',
    '--border-default',
    '--fg-primary',
    '--brand-500',
    '--accent-cyan',
    '--gradient-brand',
    '--shadow-sm',
  ];
  for (const v of requiredVars) {
    it(`globals.css defines ${v}`, () => {
      expect(globals).toContain(v);
    });
  }
  it('globals.css defines a .dark block', () => {
    expect(globals).toMatch(/\.dark\s*\{/);
  });
  it('tailwind.config maps bg-canvas to var(--bg-canvas)', () => {
    expect(tailwind).toMatch(/canvas:\s*['"]var\(--bg-canvas\)/);
  });
  it('tailwind.config maps bg-gradient-brand utility', () => {
    expect(tailwind).toMatch(/['"]gradient-brand['"]/);
  });
});
