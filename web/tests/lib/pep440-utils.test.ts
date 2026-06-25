import { describe, it, expect } from 'vitest';
import { parseSpec, rangesOverlap, intersectRanges } from '@/lib/pep440-utils';

describe('parseSpec', () => {
  it('parses >=1.0.0', () => {
    expect(parseSpec('>=1.0.0')).toEqual({ min: '1.0.0', max: null, isPinned: false });
  });
  it('parses <2.0.0', () => {
    expect(parseSpec('<2.0.0')).toEqual({ min: null, max: '2.0.0', isPinned: false });
  });
  it('parses pinned ==1.5.0', () => {
    expect(parseSpec('==1.5.0')).toEqual({ min: '1.5.0', max: '1.5.0', isPinned: true });
  });
  it('parses a range with both bounds', () => {
    expect(parseSpec('>=1.0.0,<2.0.0')).toEqual({ min: '1.0.0', max: '2.0.0', isPinned: false });
  });
  it('parses unbounded (any version)', () => {
    expect(parseSpec('')).toEqual({ min: null, max: null, isPinned: false });
  });
});

describe('rangesOverlap', () => {
  it('overlapping ranges', () => {
    expect(rangesOverlap({ min: '1.0.0', max: '2.0.0' }, { min: '1.5.0', max: '2.5.0' })).toBe(true);
  });
  it('non-overlapping (a strictly less than b)', () => {
    expect(rangesOverlap({ min: '1.0.0', max: '1.5.0' }, { min: '2.0.0', max: '2.5.0' })).toBe(false);
  });
  it('non-overlapping (a strictly greater than b)', () => {
    expect(rangesOverlap({ min: '2.0.0', max: '2.5.0' }, { min: '1.0.0', max: '1.5.0' })).toBe(false);
  });
  it('null min is no lower bound (always overlaps from below)', () => {
    expect(rangesOverlap({ min: null, max: '2.0.0' }, { min: '1.5.0', max: '2.5.0' })).toBe(true);
  });
  it('null max is no upper bound (always overlaps from above)', () => {
    expect(rangesOverlap({ min: '1.0.0', max: null }, { min: '1.5.0', max: '2.5.0' })).toBe(true);
  });
  it('both unbounded always overlap', () => {
    expect(rangesOverlap({ min: null, max: null }, { min: null, max: null })).toBe(true);
  });
  it('touching at a single point is overlap', () => {
    expect(rangesOverlap({ min: '1.0.0', max: '2.0.0' }, { min: '2.0.0', max: '3.0.0' })).toBe(true);
  });
});

describe('intersectRanges', () => {
  it('returns single spec unchanged', () => {
    expect(intersectRanges(['>=1.0.0'])).toEqual({ min: '1.0.0', max: null, isPinned: false });
  });
  it('intersects two compatible ranges', () => {
    expect(intersectRanges(['>=1.0.0', '<2.0.0'])).toEqual({ min: '1.0.0', max: '2.0.0', isPinned: false });
  });
  it('intersects three ranges', () => {
    expect(intersectRanges(['>=1.0.0,<3.0.0', '>=1.5.0', '<2.5.0'])).toEqual({ min: '1.5.0', max: '2.5.0', isPinned: false });
  });
  it('returns null for disjoint ranges', () => {
    expect(intersectRanges(['>=1.0.0', '<1.0.0'])).toBeNull();
  });
  it('marks as pinned if any spec is pinned', () => {
    expect(intersectRanges(['>=1.0.0', '==1.5.0'])).toEqual({ min: '1.5.0', max: '1.5.0', isPinned: true });
  });
  it('returns null for empty array', () => {
    expect(intersectRanges([])).toBeNull();
  });
});
