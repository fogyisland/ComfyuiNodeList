import { compare, validRange } from '@renovatebot/pep440';

export type ParsedSpec = {
  min: string | null;
  max: string | null;
  isPinned: boolean;
};

export function parseSpec(spec: string): ParsedSpec {
  if (!spec || !validRange(spec)) {
    return { min: null, max: null, isPinned: false };
  }
  // isPinned iff the spec is a single ==X.Y.Z (not a comma-separated range)
  const isPinned = /^==\d/.test(spec) && !spec.includes(',');
  // Extract min/max by simple parsing
  let min: string | null = null;
  let max: string | null = null;
  for (const part of spec.split(',').map((p) => p.trim())) {
    if (part.startsWith('>=') || part.startsWith('>')) {
      min = part.replace(/^>=?/, '').trim();
    } else if (part.startsWith('<=') || part.startsWith('<')) {
      max = part.replace(/^<=?/, '').trim();
    } else if (part.startsWith('==')) {
      const v = part.slice(2).trim();
      min = v;
      max = v;
    } else if (!part.startsWith('!=')) {
      // bare version, treat as both
      min = part;
      max = part;
    }
  }
  return { min, max, isPinned };
}

export function rangesOverlap(
  a: { min: string | null; max: string | null },
  b: { min: string | null; max: string | null },
): boolean {
  if (a.min && b.max && compare(a.min, b.max) > 0) return false;
  if (b.min && a.max && compare(b.min, a.max) > 0) return false;
  return true;
}

export function intersectRanges(
  specs: string[],
): { min: string; max: string; isPinned: boolean } | null {
  if (specs.length === 0) return null;
  if (specs.length === 1) {
    const p = parseSpec(specs[0]);
    if (!p.min && !p.max) return null;
    return { min: p.min ?? '0', max: p.max as string, isPinned: p.isPinned };
  }
  // Compute the max of mins and min of maxes, while tracking which spec
  // contributes the winning bound and whether that bound is inclusive or exclusive.
  let maxMin: string | null = null;
  let maxMinExclusive = false;
  for (const s of specs) {
    const part = s.split(',').map((p) => p.trim());
    for (const p of part) {
      if (p.startsWith('>=') || p.startsWith('>')) {
        const v = p.replace(/^>=?/, '').trim();
        const exclusive = p.startsWith('>') && !p.startsWith('>=');
        if (!maxMin || compare(v, maxMin) > 0) {
          maxMin = v;
          maxMinExclusive = exclusive;
        } else if (compare(v, maxMin) === 0 && exclusive) {
          maxMinExclusive = true;
        }
      } else if (p.startsWith('==')) {
        const v = p.slice(2).trim();
        if (!maxMin || compare(v, maxMin) > 0) {
          maxMin = v;
          maxMinExclusive = false;
        }
      }
    }
  }
  let minMax: string | null = null;
  let minMaxExclusive = false;
  for (const s of specs) {
    const part = s.split(',').map((p) => p.trim());
    for (const p of part) {
      if (p.startsWith('<=') || p.startsWith('<')) {
        const v = p.replace(/^<=?/, '').trim();
        const exclusive = p.startsWith('<') && !p.startsWith('<=');
        if (!minMax || compare(v, minMax) < 0) {
          minMax = v;
          minMaxExclusive = exclusive;
        } else if (compare(v, minMax) === 0 && exclusive) {
          minMaxExclusive = true;
        }
      } else if (p.startsWith('==')) {
        const v = p.slice(2).trim();
        if (!minMax || compare(v, minMax) < 0) {
          minMax = v;
          minMaxExclusive = false;
        }
      }
    }
  }
  if (maxMin && minMax) {
    const cmp = compare(maxMin, minMax);
    if (cmp > 0) return null;
    if (cmp === 0 && (maxMinExclusive || minMaxExclusive)) return null;
  }
  const parsed = specs.map((s) => parseSpec(s));
  const isPinned = parsed.some((p) => p.isPinned);
  return { min: maxMin ?? '0', max: minMax ?? '', isPinned };
}
