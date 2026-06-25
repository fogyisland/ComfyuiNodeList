import { describe, it, expect } from 'vitest';
import { diffRevisions } from '@/lib/diff';
import type { RevisionFields } from '@/lib/diff';

const base: RevisionFields = {
  python_min: '3.10',
  python_max: null,
  dependencies: [
    { name: 'torch', spec: '>=2.0,<3.0', min_version: '2.0', max_version: '3.0', is_pinned: false },
  ],
  node_class_mappings: ['SAMLoader'],
  incompatibilities: ['comfyui-impact-pack'],
  notes_md: 'hello',
};

describe('diffRevisions', () => {
  it('returns empty when both sides are identical', () => {
    expect(diffRevisions(base, { ...base })).toEqual([]);
  });

  it('detects python_min change', () => {
    const r = diffRevisions(base, { ...base, python_min: '3.11' });
    expect(r).toEqual([{ field: 'python_min', kind: 'changed', before: '3.10', after: '3.11' }]);
  });

  it('detects python_max null -> value', () => {
    const r = diffRevisions(base, { ...base, python_max: '3.12' });
    expect(r).toEqual([{ field: 'python_max', kind: 'changed', before: null, after: '3.12' }]);
  });

  it('detects node_class_mappings added/removed', () => {
    const r = diffRevisions(base, { ...base, node_class_mappings: ['SAMLoader', 'BarNode'] });
    expect(r).toEqual([
      {
        field: 'node_class_mappings',
        kind: 'changed',
        before: ['SAMLoader'],
        after: ['SAMLoader', 'BarNode'],
      },
    ]);
  });

  it('detects incompatibilities removed-only', () => {
    const r = diffRevisions(base, { ...base, incompatibilities: [] });
    expect(r).toEqual([
      { field: 'incompatibilities', kind: 'changed', before: ['comfyui-impact-pack'], after: [] },
    ]);
  });

  it('detects notes_md change', () => {
    const r = diffRevisions(base, { ...base, notes_md: 'world' });
    expect(r).toEqual([{ field: 'notes_md', kind: 'changed', before: 'hello', after: 'world' }]);
  });

  it('diffs dependencies row-level: added', () => {
    const r = diffRevisions(base, {
      ...base,
      dependencies: [
        ...base.dependencies,
        { name: 'numpy', spec: '>=1.0', min_version: '1.0', max_version: null, is_pinned: false },
      ],
    });
    expect(r).toHaveLength(1);
    if (r[0]?.field === 'dependencies' && r[0].kind === 'changed') {
      expect(r[0].dependencyRows).toEqual([
        { kind: 'added', row: { name: 'numpy', spec: '>=1.0', min_version: '1.0', max_version: null, is_pinned: false } },
      ]);
    } else {
      throw new Error('expected dependencies diff');
    }
  });

  it('diffs dependencies row-level: removed', () => {
    const r = diffRevisions(base, { ...base, dependencies: [] });
    expect(r).toHaveLength(1);
    if (r[0]?.field === 'dependencies' && r[0].kind === 'changed') {
      expect(r[0].dependencyRows).toEqual([
        { kind: 'removed', row: base.dependencies[0]! },
      ]);
    } else {
      throw new Error('expected dependencies diff');
    }
  });

  it('diffs dependencies row-level: changed', () => {
    const r = diffRevisions(base, {
      ...base,
      dependencies: [
        { name: 'torch', spec: '>=2.1,<3.0', min_version: '2.1', max_version: '3.0', is_pinned: false },
      ],
    });
    expect(r).toHaveLength(1);
    if (r[0]?.field === 'dependencies' && r[0].kind === 'changed') {
      expect(r[0].dependencyRows).toEqual([
        {
          kind: 'changed',
          before: base.dependencies[0]!,
          after: { name: 'torch', spec: '>=2.1,<3.0', min_version: '2.1', max_version: '3.0', is_pinned: false },
        },
      ]);
    } else {
      throw new Error('expected dependencies diff');
    }
  });

  it('returns multiple field diffs when several change', () => {
    const r = diffRevisions(base, {
      python_min: '3.11',
      python_max: '3.13',
      dependencies: base.dependencies,
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: 'world',
    });
    const fields = r.map((d) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['python_min', 'python_max', 'node_class_mappings', 'incompatibilities', 'notes_md']),
    );
  });
});
