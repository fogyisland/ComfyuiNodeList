import { describe, it, expect } from 'vitest';
import {
  detectPythonVersionConflicts,
  detectPackageVersionConflicts,
  detectNodeClassConflicts,
  detectIncompatibilityConflicts,
} from '@/lib/conflict-engine';
import type { ConflictNodeData } from '@/lib/conflict-engine';
import type { Conflict } from '@/lib/conflict-engine';

const n = (label: string, rest: Partial<ConflictNodeData> = {}): ConflictNodeData => ({
  label,
  python_min: null,
  python_max: null,
  dependencies: [],
  node_class_mappings: [],
  incompatibilities: [],
  ...rest,
});

describe('detectPythonVersionConflicts', () => {
  it('no conflict when ranges overlap', () => {
    const r = detectPythonVersionConflicts([
      n('a/repo@1.0', { python_min: '3.10', python_max: '3.12' }),
      n('b/repo@1.0', { python_min: '3.11', python_max: '3.13' }),
    ]);
    expect(r).toEqual([]);
  });
  it('conflict when ranges do not overlap', () => {
    const r = detectPythonVersionConflicts([
      n('a/repo@1.0', { python_min: '3.8', python_max: '3.9' }),
      n('b/repo@1.0', { python_min: '3.10', python_max: '3.12' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('python_version');
    expect(r[0].severity).toBe('error');
    expect(r[0].nodes).toEqual(['a/repo@1.0', 'b/repo@1.0']);
  });
  it('no conflict when one has no constraint', () => {
    const r = detectPythonVersionConflicts([
      n('a/repo@1.0'),
      n('b/repo@1.0', { python_min: '3.10', python_max: '3.12' }),
    ]);
    expect(r).toEqual([]);
  });
});

describe('detectPackageVersionConflicts', () => {
  it('no conflict when single dep', () => {
    const r = detectPackageVersionConflicts([
      n('a/repo@1.0', { dependencies: [{ name: 'torch', spec: '>=2.0.0', min_version: '2.0.0', max_version: null, is_pinned: false }] }),
    ]);
    expect(r).toEqual([]);
  });
  it('error when pinned spec conflicts', () => {
    const r = detectPackageVersionConflicts([
      n('a/repo@1.0', { dependencies: [{ name: 'torch', spec: '==1.13.0', min_version: '1.13.0', max_version: '1.13.0', is_pinned: true }] }),
      n('b/repo@1.0', { dependencies: [{ name: 'torch', spec: '>=2.0.0', min_version: '2.0.0', max_version: null, is_pinned: false }] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('package_version');
    expect(r[0].severity).toBe('error');
    expect((r[0] as Extract<Conflict, { type: 'package_version' }>).package).toBe('torch');
  });
  it('warning when non-pinned ranges are disjoint', () => {
    const r = detectPackageVersionConflicts([
      n('a/repo@1.0', { dependencies: [{ name: 'torch', spec: '>=1.0.0', min_version: '1.0.0', max_version: null, is_pinned: false }] }),
      n('b/repo@1.0', { dependencies: [{ name: 'torch', spec: '<1.0.0', min_version: null, max_version: '1.0.0', is_pinned: false }] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe('warning');
  });
  it('no conflict when ranges overlap', () => {
    const r = detectPackageVersionConflicts([
      n('a/repo@1.0', { dependencies: [{ name: 'torch', spec: '>=1.0.0,<3.0.0', min_version: '1.0.0', max_version: '3.0.0', is_pinned: false }] }),
      n('b/repo@1.0', { dependencies: [{ name: 'torch', spec: '>=2.0.0', min_version: '2.0.0', max_version: null, is_pinned: false }] }),
    ]);
    expect(r).toEqual([]);
  });
});

describe('detectNodeClassConflicts', () => {
  it('no conflict when class names differ', () => {
    const r = detectNodeClassConflicts([
      n('a/repo@1.0', { node_class_mappings: ['ClassA'] }),
      n('b/repo@1.0', { node_class_mappings: ['ClassB'] }),
    ]);
    expect(r).toEqual([]);
  });
  it('error when class name is duplicated', () => {
    const r = detectNodeClassConflicts([
      n('a/repo@1.0', { node_class_mappings: ['ClassA', 'ClassB'] }),
      n('b/repo@1.0', { node_class_mappings: ['ClassA'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('node_class');
    expect(r[0].severity).toBe('error');
    expect((r[0] as Extract<Conflict, { type: 'node_class' }>).className).toBe('ClassA');
    expect(r[0].nodes).toEqual(['a/repo@1.0', 'b/repo@1.0']);
  });
});

describe('detectIncompatibilityConflicts', () => {
  it('no conflict when no incompatibility', () => {
    const r = detectIncompatibilityConflicts([n('a/repo@1.0'), n('b/repo@1.0')]);
    expect(r).toEqual([]);
  });
  it('warning when a declares b as incompatible', () => {
    const r = detectIncompatibilityConflicts([
      n('a/repo@1.0', { incompatibilities: ['b/repo'] }),
      n('b/repo@1.0'),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('incompatibility');
    expect(r[0].severity).toBe('warning');
  });
  it('warning when both declare each other', () => {
    const r = detectIncompatibilityConflicts([
      n('a/repo@1.0', { incompatibilities: ['b/repo'] }),
      n('b/repo@1.0', { incompatibilities: ['a/repo'] }),
    ]);
    // Single pair → one conflict (not two)
    expect(r).toHaveLength(1);
  });
});
