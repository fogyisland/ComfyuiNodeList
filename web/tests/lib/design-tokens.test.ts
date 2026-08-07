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

  // Regression guard for Task 4 fix round 2:
  // `--success` / `--danger` are raw hex strings; Tailwind 3's `/<opacity>`
  // modifier only works on space-separated RGB channel triplets, so
  // `bg-success/10` is silently dropped at build time. To get a tinted
  // background we expose separate `--bg-{success,warning,danger,info}`
  // variables and map them under `tint.*` in tailwind config so consumers
  // can write `bg-tint-success`, `bg-tint-danger`, etc.
  for (const v of ['--bg-success', '--bg-warning', '--bg-danger', '--bg-info']) {
    it(`globals.css defines tinted semantic bg var ${v} (light)`, () => {
      // 2nd `:root` block would mean a duplicate definition; check both blocks contain it.
      const rootBlock = globals.match(/:root\s*\{[^}]*\}/);
      expect(rootBlock, 'expected a :root block in globals.css').not.toBeNull();
      expect(rootBlock![0]).toContain(v);
    });
  }
  it('globals.css overrides tinted semantic bg vars in .dark', () => {
    const darkBlock = globals.match(/\.dark\s*\{[^}]*\}/);
    expect(darkBlock, 'expected a .dark block in globals.css').not.toBeNull();
    for (const v of ['--bg-success', '--bg-warning', '--bg-danger', '--bg-info']) {
      expect(darkBlock![0]).toContain(v);
    }
  });
  it('tailwind.config maps tint.success/danger to tinted bg vars', () => {
    expect(tailwind).toMatch(/tint:\s*\{/);
    expect(tailwind).toMatch(/success:\s*['"]var\(--bg-success\)/);
    expect(tailwind).toMatch(/danger:\s*['"]var\(--bg-danger\)/);
  });
  it('ManagerSyncButton uses bg-tint-success / bg-tint-danger (regression guard)', () => {
    const btn = readFileSync(
      join(process.cwd(), 'app/(admin)/_components/ManagerSyncButton.tsx'),
      'utf-8',
    );
    expect(btn).toContain('bg-tint-success');
    expect(btn).toContain('bg-tint-danger');
    // Must NOT use the broken bg-success/10 pattern (silently dropped by Tailwind 3).
    expect(btn).not.toMatch(/bg-success\/10/);
    expect(btn).not.toMatch(/bg-danger\/10/);
  });
});
