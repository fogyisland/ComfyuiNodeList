import { describe, it, expect } from 'vitest';
import { checkConflicts } from '@/lib/conflict-engine';

describe('checkConflicts (Plan 2 stub)', () => {
  it('returns an empty array for any input', async () => {
    const r = await checkConflicts({ installed: [] });
    expect(r).toEqual([]);
  });
  it('returns an empty array even with many installed packages', async () => {
    const r = await checkConflicts({
      installed: [
        { owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' },
        { owner: 'rgthree', repo: 'rgthree-comfy', version_tag: 'v1.0.3' },
      ],
    });
    expect(r).toEqual([]);
  });
});
