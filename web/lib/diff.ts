import type { PublishedDependency } from './published';

export type RevisionFields = {
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
  notes_md: string;
};

export type DependencyDiffRow =
  | { kind: 'added'; row: PublishedDependency }
  | { kind: 'removed'; row: PublishedDependency }
  | { kind: 'changed'; before: PublishedDependency; after: PublishedDependency };

export type FieldDiff =
  | {
      field: 'python_min' | 'python_max';
      kind: 'changed';
      before: string | null;
      after: string | null;
    }
  | { field: 'dependencies'; kind: 'changed'; dependencyRows: DependencyDiffRow[] }
  | {
      field: 'node_class_mappings' | 'incompatibilities';
      kind: 'changed';
      before: string[];
      after: string[];
    }
  | { field: 'notes_md'; kind: 'changed'; before: string; after: string };

// Structural deep equality for plain JSON-shaped values (strings, numbers, booleans,
// null, arrays, and plain objects). Used to compare PublishedDependency rows and
// string-array fields where reference/structural identity is required.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

// Row-level diff of dependency lists keyed by `name`. A row is considered:
//   - added    if its name appears in `after` only
//   - removed  if its name appears in `before` only
//   - changed  if its name appears in both but the row payload differs
// The output is a flat list (no further grouping) suitable for the UI to render
// in order.
function diffDependencies(
  before: PublishedDependency[],
  after: PublishedDependency[],
): DependencyDiffRow[] {
  const beforeByName = new Map(before.map((d) => [d.name, d]));
  const afterByName = new Map(after.map((d) => [d.name, d]));
  const names = new Set([...beforeByName.keys(), ...afterByName.keys()]);
  const rows: DependencyDiffRow[] = [];
  for (const name of names) {
    const b = beforeByName.get(name);
    const a = afterByName.get(name);
    if (!b && a) rows.push({ kind: 'added', row: a });
    else if (b && !a) rows.push({ kind: 'removed', row: b });
    else if (b && a && !deepEqual(b, a)) rows.push({ kind: 'changed', before: b, after: a });
  }
  return rows;
}

export function diffRevisions(from: RevisionFields, to: RevisionFields): FieldDiff[] {
  const out: FieldDiff[] = [];
  if (from.python_min !== to.python_min) {
    out.push({ field: 'python_min', kind: 'changed', before: from.python_min, after: to.python_min });
  }
  if (from.python_max !== to.python_max) {
    out.push({ field: 'python_max', kind: 'changed', before: from.python_max, after: to.python_max });
  }
  const depRows = diffDependencies(from.dependencies, to.dependencies);
  if (depRows.length > 0) {
    out.push({ field: 'dependencies', kind: 'changed', dependencyRows: depRows });
  }
  if (!deepEqual(from.node_class_mappings, to.node_class_mappings)) {
    out.push({
      field: 'node_class_mappings',
      kind: 'changed',
      before: from.node_class_mappings,
      after: to.node_class_mappings,
    });
  }
  if (!deepEqual(from.incompatibilities, to.incompatibilities)) {
    out.push({
      field: 'incompatibilities',
      kind: 'changed',
      before: from.incompatibilities,
      after: to.incompatibilities,
    });
  }
  if (from.notes_md !== to.notes_md) {
    out.push({ field: 'notes_md', kind: 'changed', before: from.notes_md, after: to.notes_md });
  }
  return out;
}
