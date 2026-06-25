# Plan 3: 冲突检测引擎 (Conflict Detection Engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan 2 conflict-check stub (`web/lib/conflict-engine.ts` returns `[]`) with a real PEP 440-based conflict detection engine that identifies 4 categories of conflicts — `python_version` (error), `package_version` (error/warning), `node_class` (error), `incompatibility` (warning) — and surface them in real time on the wiki edit page via a debounced `<ConflictPreview>`.

**Architecture:** Pure TypeScript in `web/lib/conflict-engine.ts`. The engine loads all installed versions' published requirements via the existing `getPublishedRequirements()` helper (which already merges `node_raw_requirements` + latest approved `wiki_revisions`), then runs 4 independent detector functions that each return `Conflict[]`. The `checkConflicts()` orchestrator loads the data once, applies an optional `draft` (the current wiki edit form) as a virtual version, runs all detectors, and returns the combined list. The `<ConflictPreview>` client component takes the form state + a server-provided list of "other installed nodes" and debounces by 500ms before POSTing to the existing `POST /api/v1/conflicts/check` endpoint (extended with an optional `draft` field for backward compatibility).

**Tech Stack:** (additions to Plan 1/2)
- `pep440` ^0.6.0 (npm package — parse spec strings to `(min, max, is_pinned)`)
- All other deps from Plan 1/2

## Global Constraints

Verbatim from spec (`docs/superpowers/specs/2026-06-21-comfyui-node-wiki-design.md` §6) + extensions documented in this plan:

- Engine location: `web/lib/conflict-engine.ts` (replaces Plan 2 stub). Exported function signature `checkConflicts(req): Promise<Conflict[]>` MUST stay stable — Plan 2's route handler and tests already depend on it.
- 4 conflict types: `python_version` (severity: `error`), `package_version` (severity: `error` or `warning`), `node_class` (severity: `error`), `incompatibility` (severity: `warning`).
- Python version check: for every pair of nodes, their `python_min`/`python_max` ranges must overlap. If any pair has no overlap → emit one `python_version` error.
- Package version check: group dependencies by `name`. For each name group with ≥2 specs, use the `pep440` npm package to parse each spec; if the intersection of all ranges is empty OR a pinned spec is incompatible with another → emit a `package_version` error (pinned) or warning (non-pinned). Single-spec groups emit no conflict.
- Node class check: collect all `node_class_mappings` strings across all nodes; if any class name appears in 2+ nodes → emit one `node_class` error per duplicate.
- Incompatibility check: for each node pair, if `a.incompatibilities` contains `b.owner/b.repo` OR `b.incompatibilities` contains `a.owner/b.repo` → emit one `incompatibility` warning.
- Use existing `getPublishedRequirements(versionId)` from `web/lib/published.ts` to load merged (raw + latest approved) data per version — do NOT load `raw_requirements` or `wiki_revisions` directly.
- API endpoint: `POST /api/v1/conflicts/check` (already exists from Plan 2 Task 11) — body extended with optional `draft` field for the wiki edit page use case. Backward-compatible: existing clients that omit `draft` still work (the engine then computes conflicts among the `installed` list only).
- API auth: `requireUser()` (unchanged from Plan 2). Returns 401 if unauthenticated.
- All API responses: JSON, UTF-8, ISO-8601 timestamps.
- Engine is async + pure data flow; no side effects (no DB writes).
- Conflict type is a discriminated union (tagged union) with optional `package?: string` and `className?: string` fields for the `package_version` and `node_class` variants.
- Test DB: `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test`. Vitest uses `fileParallelism: false` (already configured) and `prisma db push --force-reset` between test files (already wired in `web/tests/setup.ts`).
- Repo root: `D:\ToolDevelop\ComfyUINodeAnalysis\`. All paths in this plan are relative to that root unless stated.
- Dev server port: 9999 (inherited from Plan 1; `pnpm dev` binds 9999).
- TDD pattern: write failing test first, then implement, then verify green, then commit. Pure-function utilities get full unit coverage. Detector functions get full unit coverage. `checkConflicts()` orchestrator gets integration tests against the real DB.

## Out of Scope for This Plan

- Webhook integrations / real-time push (future, post-Plan 5)
- User-configurable "check against" list (ConflictPreview checks against all other nodes by default; user-specified subset deferred)
- Conflict matrix view (whole-network table — original spec §14)
- Performance optimization (e.g., result caching, parallel fetching)
- E2E browser tests (Plan 1/2 used curl + dev server smoke tests; same convention here)
- Email/notification when a draft would create conflicts
- Resolving the 2 deferred Important findings from Plan 2 whole-branch review (TOCTOU in reject/withdraw; submit page missing page-level gate) — leave as follow-up

## File Structure (this plan creates or modifies)

```
web/
├── package.json                          # MODIFY: add pep440 dep
├── pnpm-lock.yaml                        # MODIFY: lockfile
├── lib/
│   ├── conflict-engine.ts                # MODIFY: replace stub with real impl
│   ├── pep440-utils.ts                   # CREATE: spec parser + range utilities
│   └── wiki-schema.ts                    # MODIFY: add optional draft field to ConflictCheckBody
├── app/
│   ├── (wiki)/
│   │   └── _components/
│   │       └── ConflictPreview.tsx       # MODIFY: replace stub with real impl
│   └── wiki/
│       └── [versionId]/
│           └── page.tsx                  # MODIFY: fetch other nodes list, pass to WikiEditForm
├── tests/
│   ├── lib/
│   │   ├── conflict-engine.test.ts       # MODIFY: replace 2 stub tests with comprehensive coverage
│   │   └── pep440-utils.test.ts          # CREATE: unit tests for utility functions
│   └── api/
│       └── conflicts-check.test.ts       # MODIFY: add draft field integration tests
└── README.md                             # MODIFY: Plan 3 section + tech notes
```

## Tech Decisions

| Decision | Choice | Reason |
|---|---|---|
| PEP 440 parser | `pep440` npm package (v0.6.x) | Original spec §6.3 mandates it; pure JS, no native deps |
| Algorithm language | Pure TypeScript | Original spec §6.3: "无运行时 Python 依赖"; Python scanner only extracts spec strings |
| Draft state handling | Optional `draft` field in API body | Backward-compatible extension; supports wiki edit preview use case; preserves generic API contract (works for any caller, not just wiki edit page) |
| Wiki edit installed list | Server passes list of all other `(owner, repo, tag)` triples (latest version per node) | Original spec §8.4: "会跟哪些已发布节点冲突" implies check against all published nodes; "latest version" is the realistic "what user has installed" |
| Debounce duration | 500ms | Plan 2 spec §8.6 already specifies this |
| Conflict type discrimination | Tagged union in TypeScript | Allows specific fields per type (e.g., `package` for `package_version`, `className` for `node_class`); compile-time safety; clean `switch` handling in UI |
| Data loading | Reuse `getPublishedRequirements(versionId)` | Already merges raw + latest approved; ensures consistency with `/api/v1/nodes/{owner}/{repo}/versions/{tag}` |
| `pep440` API shape | Wrap in `pep440-utils.ts` to centralize parsing + range logic | Spec parsing has many edge cases; isolating in one file makes it testable and replaceable |

---

## Tasks

### Task 1: Add `pep440` dependency

**Files:**
- Modify: `web/package.json` (add `pep440` to `dependencies`)
- Modify: `web/pnpm-lock.yaml` (lockfile regenerated by pnpm)

**Interfaces:**
- Consumes: none (additive change)
- Produces: `import { SpecifierSet, Version } from 'pep440'` available throughout `web/lib/**`

**Goal:** Install the `pep440` npm package so subsequent tasks can use it.

- [ ] **Step 1: Install the package**

```bash
cd web && pnpm add pep440
```

Expected: `pep440` appears in `web/package.json` `dependencies`, lockfile updated.

- [ ] **Step 2: Verify install**

```bash
cd web && pnpm ls pep440
```

Expected: prints `pep440 0.6.x` (or current latest).

- [ ] **Step 3: Verify import works**

```bash
cd web && pnpm exec node -e "const p = require('pep440'); console.log(typeof p.SpecifierSet);"
```

Expected: prints `function` (or `class` — implementer should verify the package exports a constructor).

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "chore(deps): add pep440 npm package for conflict engine"
```

---

### Task 2: `web/lib/pep440-utils.ts` — spec parser + range utilities

**Files:**
- Create: `web/lib/pep440-utils.ts`
- Create: `web/tests/lib/pep440-utils.test.ts`

**Interfaces:**
- Produces:
  - `parseSpec(spec: string): { min: string | null; max: string | null; isPinned: boolean }`
  - `rangesOverlap(a: { min: string | null; max: string | null }, b: { min: string | null; max: string | null }): boolean`
  - `intersectRanges(specs: string[]): { min: string; max: string; isPinned: boolean } | null`

**Goal:** Provide pure-function utilities for parsing PEP 440 spec strings and computing range intersections. Used by all 4 conflict detector functions in Task 3. No DB, no I/O.

**Notes:**
- The `pep440` npm package's `SpecifierSet` class represents a set of version specifiers. It has properties like `minimum`, `maximum` (or methods to get bounds). The implementer should read its README/types to determine the exact API.
- `isPinned` means a single `==X.Y.Z` spec (not a range).
- For `intersectRanges`, the simplest implementation: parse all specs, take the max of all `min` and the min of all `max`; if `max < min`, return null. Mark `isPinned` if any spec is pinned.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/lib/pep440-utils.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm exec vitest run tests/lib/pep440-utils.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/pep440-utils'` (or similar import error).

- [ ] **Step 3: Implement the utilities**

Create `web/lib/pep440-utils.ts`:

```ts
import { SpecifierSet, Version } from 'pep440';

export type ParsedSpec = {
  min: string | null;
  max: string | null;
  isPinned: boolean;
};

export function parseSpec(spec: string): ParsedSpec {
  if (!spec) {
    return { min: null, max: null, isPinned: false };
  }
  const set = new SpecifierSet(spec);
  // isPinned iff the specifier set is a single ==X.Y.Z spec
  const isPinned =
    set.specifiers.length === 1 && (set.specifiers[0] as { operator: string }).operator === '==';
  return {
    min: getMin(set),
    max: getMax(set),
    isPinned,
  };
}

function getMin(set: SpecifierSet): string | null {
  // pep440 package exposes minimum/maximum as Version or string depending on version
  // Implementer should read package types and adapt this snippet.
  const m = (set as { minimum?: Version | string | null }).minimum;
  if (!m) return null;
  return typeof m === 'string' ? m : m.toString();
}

function getMax(set: SpecifierSet): string | null {
  const m = (set as { maximum?: Version | string | null }).maximum;
  if (!m) return null;
  return typeof m === 'string' ? m : m.toString();
}

export function rangesOverlap(
  a: { min: string | null; max: string | null },
  b: { min: string | null; max: string | null },
): boolean {
  // Two ranges [aMin, aMax] and [bMin, bMax] overlap iff aMin <= bMax AND bMin <= aMax.
  // null min = no lower bound; null max = no upper bound.
  if (a.min && b.max) {
    if (new Version(a.min).compare(new Version(b.max)) > 0) return false;
  }
  if (b.min && a.max) {
    if (new Version(b.min).compare(new Version(a.max)) > 0) return false;
  }
  return true;
}

export function intersectRanges(
  specs: string[],
): { min: string; max: string; isPinned: boolean } | null {
  if (specs.length === 0) return null;
  if (specs.length === 1) {
    const p = parseSpec(specs[0]);
    if (!p.min && !p.max) return null;
    return { min: p.min ?? '0', max: p.max ?? '', isPinned: p.isPinned };
  }
  // Find max of all mins, min of all maxes.
  const parsed = specs.map((s) => parseSpec(s));
  let maxMin: Version | null = null;
  for (const p of parsed) {
    if (!p.min) continue;
    const v = new Version(p.min);
    if (!maxMin || v.compare(maxMin) > 0) maxMin = v;
  }
  let minMax: Version | null = null;
  for (const p of parsed) {
    if (!p.max) continue;
    const v = new Version(p.max);
    if (!minMax || v.compare(minMax) < 0) minMax = v;
  }
  if (maxMin && minMax && maxMin.compare(minMax) > 0) return null;
  const isPinned = parsed.some((p) => p.isPinned);
  return {
    min: maxMin ? maxMin.toString() : '0',
    max: minMax ? minMax.toString() : '',
    isPinned,
  };
}
```

> **Note for implementer:** The `pep440` npm package API may have changed between versions. If `SpecifierSet.specifiers` is not directly accessible, or `minimum`/`maximum` are not exposed, adapt the helpers `getMin` / `getMax` accordingly. The test cases above are the source of truth — they must all pass.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && pnpm exec vitest run tests/lib/pep440-utils.test.ts
```

Expected: 17 tests pass (5 parseSpec + 7 rangesOverlap + 5 intersectRanges).

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
cd web && pnpm test
```

Expected: 127 + 17 = 144 tests pass (or whatever the current baseline is plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add web/lib/pep440-utils.ts web/tests/lib/pep440-utils.test.ts
git commit -m "feat(lib): add pep440-utils for spec parsing and range intersection"
```

---

### Task 3: `web/lib/conflict-engine.ts` — 4 detector functions (pure, no DB)

**Files:**
- Modify: `web/lib/conflict-engine.ts` (replace stub; keep exports stable)
- Modify: `web/tests/lib/conflict-engine.test.ts` (replace 2 stub tests with detector coverage)

**Interfaces:**
- `Conflict` is a tagged union:
  ```ts
  export type Conflict =
    | { type: 'python_version'; severity: 'error'; nodes: string[]; detail: string }
    | { type: 'package_version'; severity: 'error' | 'warning'; nodes: string[]; detail: string; package: string }
    | { type: 'node_class'; severity: 'error'; nodes: string[]; detail: string; className: string }
    | { type: 'incompatibility'; severity: 'warning'; nodes: string[]; detail: string };
  ```
- `ConflictCheckRequest` keeps Plan 2 shape: `{ installed: Array<{owner, repo, version_tag}> }`. **No change to existing signature.**
- New internal type `ConflictNodeData`:
  ```ts
  type ConflictNodeData = {
    label: string;          // "owner/repo@tag" — used in `nodes` and `detail`
    python_min: string | null;
    python_max: string | null;
    dependencies: PublishedDependency[];
    node_class_mappings: string[];
    incompatibilities: string[];
  };
  ```
- 4 detector functions (pure, exported for direct unit testing):
  - `detectPythonVersionConflicts(nodes: ConflictNodeData[]): Conflict[]`
  - `detectPackageVersionConflicts(nodes: ConflictNodeData[]): Conflict[]`
  - `detectNodeClassConflicts(nodes: ConflictNodeData[]): Conflict[]`
  - `detectIncompatibilityConflicts(nodes: ConflictNodeData[]): Conflict[]`

**Goal:** Implement the 4 conflict detectors as pure functions over `ConflictNodeData[]`. No DB, no I/O. `checkConflicts()` will be wired in Task 4.

**Notes:**
- Plan 2 stub has `Conflict.type: string` and a `severity: 'error' | 'warning'`. The new tagged union narrows `type` to a literal — Task 11's existing route handler does not inspect `type` so this is safe. Update the type only.
- `nodes` array contains the labels (`"owner/repo@tag"`) of the conflicting nodes. For pair conflicts, include both labels. For multi-node conflicts (e.g., 3+ packages), include all involved.
- `detail` is a Chinese or English human-readable description. Match Plan 2's existing Chinese copy convention where appropriate (e.g., page-level error toasts).
- The `package_version` conflict's `severity` is `error` if any spec in the group is pinned and another spec excludes the pinned version; `warning` if all specs are ranges but the intersection is empty.

- [ ] **Step 1: Replace the stub with the new types + detector skeletons**

Replace `web/lib/conflict-engine.ts` content with:

```ts
import { intersectRanges, parseSpec } from './pep440-utils';
import type { PublishedDependency } from './published';

export type ConflictCheckRequest = {
  installed: Array<{ owner: string; repo: string; version_tag: string }>;
};

export type Conflict =
  | { type: 'python_version'; severity: 'error'; nodes: string[]; detail: string }
  | { type: 'package_version'; severity: 'error' | 'warning'; nodes: string[]; detail: string; package: string }
  | { type: 'node_class'; severity: 'error'; nodes: string[]; detail: string; className: string }
  | { type: 'incompatibility'; severity: 'warning'; nodes: string[]; detail: string };

export type ConflictNodeData = {
  label: string;
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export async function checkConflicts(_req: ConflictCheckRequest): Promise<Conflict[]> {
  // Wired in Task 4 — for now, return empty so the file compiles.
  return [];
}

export function detectPythonVersionConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlap = rangesOverlapCompat(
        { min: a.python_min, max: a.python_max },
        { min: b.python_min, max: b.python_max },
      );
      if (!overlap) {
        out.push({
          type: 'python_version',
          severity: 'error',
          nodes: [a.label, b.label],
          detail: `Python 版本不兼容：${a.label} 要求 ${a.python_min ?? '无下限'}–${a.python_max ?? '无上限'}，与 ${b.label} 的 ${b.python_min ?? '无下限'}–${b.python_max ?? '无上限'} 无交集`,
        });
      }
    }
  }
  return out;
}

export function detectPackageVersionConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  const byName = new Map<string, Array<{ node: ConflictNodeData; dep: PublishedDependency }>>();
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!byName.has(dep.name)) byName.set(dep.name, []);
      byName.get(dep.name)!.push({ node, dep });
    }
  }
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue;
    const specs = entries.map((e) => e.dep.spec);
    const intersection = intersectRanges(specs);
    if (intersection) continue; // no conflict
    // Intersection is empty → conflict
    const labels = entries.map((e) => e.node.label);
    const isPinned = entries.some((e) => parseSpec(e.dep.spec).isPinned);
    out.push({
      type: 'package_version',
      severity: isPinned ? 'error' : 'warning',
      nodes: labels,
      detail: `包 ${name} 版本不兼容：${entries.map((e) => `${e.node.label}=${e.dep.spec}`).join(' vs ')}`,
      package: name,
    });
  }
  return out;
}

export function detectNodeClassConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  const byClass = new Map<string, string[]>();
  for (const node of nodes) {
    for (const cls of node.node_class_mappings) {
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push(node.label);
    }
  }
  for (const [cls, labels] of byClass) {
    if (labels.length < 2) continue;
    out.push({
      type: 'node_class',
      severity: 'error',
      nodes: labels,
      detail: `节点类 ${cls} 被多个节点声明：${labels.join(', ')}`,
      className: cls,
    });
  }
  return out;
}

export function detectIncompatibilityConflicts(nodes: ConflictNodeData[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const aExcludesB = a.incompatibilities.some((s) => matchesRef(s, b.label));
      const bExcludesA = b.incompatibilities.some((s) => matchesRef(s, a.label));
      if (aExcludesB || bExcludesA) {
        out.push({
          type: 'incompatibility',
          severity: 'warning',
          nodes: [a.label, b.label],
          detail: `${a.label} 与 ${b.label} 互相声明不兼容`,
        });
      }
    }
  }
  return out;
}

// Helpers
import { rangesOverlap } from './pep440-utils';

function rangesOverlapCompat(
  a: { min: string | null; max: string | null },
  b: { min: string | null; max: string | null },
): boolean {
  return rangesOverlap(a, b);
}

function matchesRef(ref: string, label: string): boolean {
  // label format: "owner/repo@tag". ref format: "owner/repo" (per spec).
  return ref === label.split('@')[0];
}
```

> **Note for implementer:** The `import { rangesOverlap } from './pep440-utils'` at the bottom is a stylistic choice — move it to the top if your linter enforces order. The `matchesRef` helper trims `@tag` from the label for comparison against the bare `owner/repo` ref format.

- [ ] **Step 2: Write the failing detector tests**

Replace `web/tests/lib/conflict-engine.test.ts` content:

```ts
import { describe, it, expect } from 'vitest';
import {
  detectPythonVersionConflicts,
  detectPackageVersionConflicts,
  detectNodeClassConflicts,
  detectIncompatibilityConflicts,
} from '@/lib/conflict-engine';
import type { ConflictNodeData } from '@/lib/conflict-engine';

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
    expect(r[0].package).toBe('torch');
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
    expect(r[0].className).toBe('ClassA');
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
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd web && pnpm exec vitest run tests/lib/conflict-engine.test.ts
```

Expected: 11 detector tests pass (3 + 4 + 2 + 2). The 2 original stub tests are removed.

- [ ] **Step 4: Run full suite to confirm no regressions**

```bash
cd web && pnpm test
```

Expected: previous baseline + 17 (Task 2) + 11 (this task) = baseline + 28 tests, all pass.

- [ ] **Step 5: Run TypeScript check**

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add web/lib/conflict-engine.ts web/tests/lib/conflict-engine.test.ts
git commit -m "feat(lib): add 4 conflict detector functions (python/package/node_class/incompatibility)"
```

---

### Task 4: `web/lib/conflict-engine.ts` — wire `checkConflicts()` to load from DB + apply draft

**Files:**
- Modify: `web/lib/conflict-engine.ts` (replace `checkConflicts` stub body)

**Interfaces:**
- `checkConflicts(req: ConflictCheckRequest): Promise<Conflict[]>` — the Plan 2 contract. Now does:
  1. For each `installed` entry, look up the matching `NodeVersion` (by owner/repo/tag), load via `getPublishedRequirements(versionId)`, and convert to `ConflictNodeData`.
  2. If the request body includes a `draft` (extended in Task 5), include it as a virtual `ConflictNodeData` labeled `"<draft>"`.
  3. Run all 4 detectors, concatenate, return.
- Plan 2's `ConflictCheckRequest` does NOT yet have `draft`. The current Task 4 implementation accepts the `draft` via a new optional field on the request — Task 5 will update the zod schema to match. For now, use a type-safe pattern (e.g., a separate internal function `checkConflictsWithDraft` that takes the draft explicitly, while `checkConflicts` reads `req.draft` if present).

**Goal:** Wire the orchestrator so the route handler in `web/app/api/v1/conflicts/check/route.ts` (unchanged) gets real conflicts back from a real DB.

**Notes:**
- `getPublishedRequirements(versionId: number)` returns a `PublishedRequirements` shape. Build a `ConflictNodeData` from it, with `label = "${owner}/${repo}@${tag}"`.
- Missing `installed` entries (DB lookup returns nothing) should be silently skipped — they are not "conflicts", just absent nodes. Log a `console.warn` for debugging.
- The `draft` shape (from `ConflictCheckBody.draft` in Task 5) is: `{ python_min, python_max, dependencies, node_class_mappings, incompatibilities }`. All fields optional except `dependencies` (required but may be `[]`) and the string arrays.
- Order of `nodes` in each emitted conflict is consistent: sort alphabetically by label so tests are deterministic.

- [ ] **Step 1: Update `checkConflicts` and add the internal orchestrator**

Replace the `checkConflicts` body in `web/lib/conflict-engine.ts`:

```ts
import { prisma } from './db';
import { getPublishedRequirements } from './published';

export type ConflictDraftData = {
  python_min?: string | null;
  python_max?: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
};

export async function checkConflicts(req: ConflictCheckRequest): Promise<Conflict[]> {
  return checkConflictsWithDraft(req.installed, (req as { draft?: ConflictDraftData }).draft);
}

export async function checkConflictsWithDraft(
  installed: ConflictCheckRequest['installed'],
  draft?: ConflictDraftData,
): Promise<Conflict[]> {
  const data: ConflictNodeData[] = [];
  // Load all installed versions
  for (const ref of installed) {
    const version = await prisma.nodeVersion.findFirst({
      where: { version_tag: ref.version_tag, node: { github_owner: ref.owner, github_repo: ref.repo } },
    });
    if (!version) {
      console.warn(`[conflict-engine] installed ref not found: ${ref.owner}/${ref.repo}@${ref.version_tag}`);
      continue;
    }
    const pub = await getPublishedRequirements(Number(version.id));
    data.push({
      label: `${ref.owner}/${ref.repo}@${ref.version_tag}`,
      python_min: pub.python_min,
      python_max: pub.python_max,
      dependencies: pub.dependencies,
      node_class_mappings: pub.node_class_mappings,
      incompatibilities: pub.incompatibilities,
    });
  }
  // Apply draft as virtual node
  if (draft) {
    data.push({
      label: '<draft>',
      python_min: draft.python_min ?? null,
      python_max: draft.python_max ?? null,
      dependencies: draft.dependencies,
      node_class_mappings: draft.node_class_mappings,
      incompatibilities: draft.incompatibilities,
    });
  }
  // Run all 4 detectors
  const conflicts: Conflict[] = [
    ...detectPythonVersionConflicts(data),
    ...detectPackageVersionConflicts(data),
    ...detectNodeClassConflicts(data),
    ...detectIncompatibilityConflicts(data),
  ];
  // Sort for determinism
  conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return conflicts;
}
```

> **Note for implementer:** The `ConflictCheckRequest` type from Plan 2 does not include `draft`. The `(req as { draft?: ConflictDraftData }).draft` cast is intentional and will be replaced with a clean type once Task 5 updates the zod schema. Task 5's zod update will add `draft` to the exported `ConflictCheckBody` schema; the corresponding TS type will flow into this function via the route handler.

- [ ] **Step 2: Add an integration test (real DB)**

Append to `web/tests/lib/conflict-engine.test.ts`:

```ts
import { setup } from '../setup';
import { prisma } from '@/lib/db';
import { checkConflictsWithDraft } from '@/lib/conflict-engine';

describe('checkConflictsWithDraft (integration)', () => {
  beforeEach(async () => {
    await setup();
    // Seed: 2 nodes, 1 version each, with conflicting python ranges
    await prisma.node.create({
      data: {
        github_owner: 'ltdrdata',
        github_repo: 'ComfyUI-Impact-Pack',
        name: 'Impact Pack',
        author: 'ltdrdata',
        status: 'active',
        versions: {
          create: [
            {
              version_tag: 'v8.10',
              git_sha: 'a'.repeat(40),
              release_date: new Date('2026-01-01'),
              raw_requirements: {
                create: {
                  python_min: '3.8',
                  python_max: '3.9',
                  dependencies: [],
                  node_class_mappings: [],
                  incompatibilities: [],
                  scan_warnings: [],
                  raw_files: {},
                },
              },
            },
          ],
        },
      },
    });
    await prisma.node.create({
      data: {
        github_owner: 'rgthree',
        github_repo: 'rgthree-comfy',
        name: 'rgthree',
        author: 'rgthree',
        status: 'active',
        versions: {
          create: [
            {
              version_tag: 'v1.0.3',
              git_sha: 'b'.repeat(40),
              release_date: new Date('2026-01-01'),
              raw_requirements: {
                create: {
                  python_min: '3.10',
                  python_max: '3.12',
                  dependencies: [],
                  node_class_mappings: [],
                  incompatibilities: [],
                  scan_warnings: [],
                  raw_files: {},
                },
              },
            },
          ],
        },
      },
    });
  });

  it('returns python_version error when ranges do not overlap', async () => {
    const r = await checkConflictsWithDraft([
      { owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' },
      { owner: 'rgthree', repo: 'rgthree-comfy', version_tag: 'v1.0.3' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('python_version');
  });

  it('returns no conflicts when ranges overlap', async () => {
    await prisma.nodeRawRequirement.update({
      where: { version_id: (await prisma.nodeVersion.findFirst({ where: { version_tag: 'v8.10' } }))!.id },
      data: { python_min: '3.10', python_max: '3.12' },
    });
    const r = await checkConflictsWithDraft([
      { owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' },
      { owner: 'rgthree', repo: 'rgthree-comfy', version_tag: 'v1.0.3' },
    ]);
    expect(r).toEqual([]);
  });

  it('applies draft as a virtual node and detects conflicts', async () => {
    const r = await checkConflictsWithDraft(
      [{ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' }],
      {
        python_min: '3.10',
        python_max: '3.12',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
      },
    );
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('python_version');
    expect(r[0].nodes).toContain('<draft>');
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd web && pnpm exec vitest run tests/lib/conflict-engine.test.ts
```

Expected: 11 detector tests + 3 integration tests = 14 tests pass.

- [ ] **Step 4: Run full suite + tsc**

```bash
cd web && pnpm test
cd web && pnpm exec tsc --noEmit
```

Expected: full suite green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/conflict-engine.ts web/tests/lib/conflict-engine.test.ts
git commit -m "feat(lib): wire checkConflicts() to load from DB and apply draft"
```

---

### Task 5: Extend `web/lib/wiki-schema.ts` + endpoint to accept `draft` field

**Files:**
- Modify: `web/lib/wiki-schema.ts` (add `draft` field to `ConflictCheckBody`)
- Modify: `web/app/api/v1/conflicts/check/route.ts` (pass `req.draft` through to `checkConflicts`)
- Modify: `web/tests/api/conflicts-check.test.ts` (add tests for `draft` field)

**Interfaces:**
- `ConflictCheckBody` adds optional `draft: { python_min?, python_max?, dependencies: PublishedDependency[], node_class_mappings: string[], incompatibilities: string[] } | undefined`.
- Route handler unchanged signature; `parsed.data.draft` is now available and forwarded to `checkConflicts`.

**Goal:** Make the API accept the optional `draft` field so the wiki edit page can preview conflicts against unsaved form state.

**Notes:**
- Backward compatibility: existing clients that POST without `draft` still work (the field is optional).
- `ConflictCheckBody` is `.strict()` (per Plan 2 Global Constraint), so unknown keys are still rejected. `draft` is a known key.
- Reuse `PublishedDependencySchema` from Plan 2 for the draft's `dependencies` field.

- [ ] **Step 1: Add `draft` to the zod schema**

Edit `web/lib/wiki-schema.ts` — modify the `ConflictCheckBody` definition (lines 51-61):

```ts
export const ConflictDraftSchema = z.object({
  python_min: z.union([pythonVersion, z.null()]).optional(),
  python_max: z.union([pythonVersion, z.null()]).optional(),
  dependencies: z.array(PublishedDependencySchema),
  node_class_mappings: z.array(z.string()),
  incompatibilities: z.array(z.string()),
});

export const ConflictCheckBody = z
  .object({
    installed: z.array(
      z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        version_tag: z.string().min(1),
      }),
    ),
    draft: ConflictDraftSchema.optional(),
  })
  .strict();
```

Also add to the type exports block at the bottom:

```ts
export type ConflictDraft = z.infer<typeof ConflictDraftSchema>;
```

- [ ] **Step 2: Pass `draft` through the route handler**

Edit `web/app/api/v1/conflicts/check/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ConflictCheckBody } from '@/lib/wiki-schema';
import { checkConflicts } from '@/lib/conflict-engine';

export async function POST(req: NextRequest) {
  const user = await requireUser().catch((e: Error) => {
    if (e.message === 'UNAUTHENTICATED') return null;
    throw e;
  });
  if (!user) return error(401, 'unauthenticated');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = ConflictCheckBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const conflicts = await checkConflicts({ installed: parsed.data.installed, draft: parsed.data.draft });
  return json({ conflicts });
}
```

- [ ] **Step 3: Add `draft` tests to the existing conflicts-check test file**

Append to `web/tests/api/conflicts-check.test.ts` (find the existing test file; if it doesn't have a "draft" test, add one similar to):

```ts
import { setup } from '../setup';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/v1/conflicts/check/route';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';

vi.mock('next-auth'); // if not already mocked

describe('POST /api/v1/conflicts/check with draft', () => {
  beforeEach(async () => {
    await setup();
    // ... seed similar to Task 4 integration test
  });

  it('accepts a draft field and applies it', async () => {
    // mock auth
    // POST with installed + draft
    // expect response includes python_version conflict involving <draft>
  });

  it('rejects unknown fields in draft', async () => {
    // POST with draft = { ..., extra: 'x' } → 400
  });
});
```

> **Note for implementer:** Look at the existing `web/tests/api/conflicts-check.test.ts` to see the auth mocking pattern used in this project. Match it. The file may use `vi.mock('@/lib/session', ...)` instead of `next-auth` directly.

- [ ] **Step 4: Run tests + tsc**

```bash
cd web && pnpm exec vitest run tests/api/conflicts-check.test.ts
cd web && pnpm exec tsc --noEmit
```

Expected: all tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/wiki-schema.ts web/app/api/v1/conflicts/check/route.ts web/tests/api/conflicts-check.test.ts
git commit -m "feat(api): extend POST /api/v1/conflicts/check with optional draft field"
```

---

### Task 6: `/wiki/[versionId]/page.tsx` — fetch other-node list and pass to WikiEditForm

**Files:**
- Modify: `web/app/wiki/[versionId]/page.tsx` (fetch all other nodes' latest versions)
- Modify: `web/app/(wiki)/_components/WikiEditForm.tsx` (accept and forward `installed` prop)

**Interfaces:**
- `WikiEditForm` adds a prop: `installed: Array<{ owner: string; repo: string; version_tag: string }>` (the "other installed nodes" list, used by `<ConflictPreview>`).
- `page.tsx` adds: `const otherNodes = await prisma.nodeVersion.findMany({ where: { NOT: { id: BigInt(versionId) } }, orderBy: { release_date: 'desc' }, take: 1, ...per node } )` — actually use a per-node "latest" query.

**Goal:** Make the wiki edit page provide a list of all other nodes' latest versions to the form, so the conflict preview has data to check against.

**Notes:**
- "All other nodes" = every node in the DB except the one being edited, taking the latest version of each.
- Efficient query: `prisma.node.findMany({ where: { versions: { some: ... }, NOT: { versions: { some: { id: BigInt(versionId) } } } }, include: { versions: { orderBy: { release_date: 'desc' }, take: 1 } } })` — verify Prisma supports this nested filter, otherwise use two queries.

- [ ] **Step 1: Update `page.tsx` to fetch other nodes**

Edit `web/app/wiki/[versionId]/page.tsx` (the server component from Plan 2 Task 19):

```tsx
import { prisma } from '@/lib/db';
// ... other imports

export default async function WikiEditPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId: versionIdStr } = await params;
  const versionId = Number(versionIdStr);
  // ... existing code: getCurrentUser, getPublishedRequirements, latestPending
  // ... existing code: redirect / 404 logic

  // NEW: fetch latest version of every OTHER node
  const allNodes = await prisma.node.findMany({
    include: {
      versions: {
        orderBy: { release_date: 'desc' },
        take: 1,
        select: { id: true, version_tag: true },
      },
    },
  });
  const otherInstalled = allNodes
    .filter((node) => !node.versions.some((v) => Number(v.id) === versionId))
    .flatMap((node) =>
      node.versions.map((v) => ({
        owner: node.github_owner,
        repo: node.github_repo,
        version_tag: v.version_tag,
      })),
    );

  return <WikiEditForm
    versionId={versionId}
    initialPublished={pub}
    initialPending={latestPending}
    installed={otherInstalled}
  />;
}
```

- [ ] **Step 2: Update `WikiEditForm` props**

Edit `web/app/(wiki)/_components/WikiEditForm.tsx`:

```tsx
type Props = {
  versionId: number;
  initialPublished: PublishedRequirements;
  initialPending: LatestPending | null;
  installed: Array<{ owner: string; repo: string; version_tag: string }>; // NEW
};

export function WikiEditForm({ versionId, initialPublished, initialPending, installed }: Props) {
  // ... existing code, plus pass `installed` to <ConflictPreview> in Task 7
}
```

- [ ] **Step 3: Run tsc + full suite**

```bash
cd web && pnpm exec tsc --noEmit
cd web && pnpm test
```

Expected: tsc clean (the prop is required; the existing tests for WikiEditForm may need a type update, or the prop is optional with default `[]`).

- [ ] **Step 4: Commit**

```bash
git add web/app/wiki/[versionId]/page.tsx web/app/(wiki)/_components/WikiEditForm.tsx
git commit -m "feat(web): fetch other-node list on wiki edit page and forward to form"
```

---

### Task 7: `<ConflictPreview>` — replace stub with real debounced + fetched implementation

**Files:**
- Modify: `web/app/(wiki)/_components/ConflictPreview.tsx`

**Interfaces:**
- Props: `{ installed: Array<{ owner, repo, version_tag }>; draft: ConflictDraft; currentLabel: string }`
  - `installed` — list of "other installed" nodes (from `WikiEditForm`'s prop).
  - `draft` — current form state (`python_min`, `python_max`, `dependencies`, `node_class_mappings`, `incompatibilities`).
  - `currentLabel` — label for the draft (e.g., "v1.0.0") shown in conflict `nodes` arrays. The server-side orchestrator will use `<draft>` for the draft's own conflicts; the UI can replace `<draft>` with `currentLabel` in the rendered output for user-friendliness.

**Goal:** Replace the stub with a real component that:
1. Watches the form's relevant fields (passed in as `draft`).
2. Debounces 500ms.
3. POSTs to `/api/v1/conflicts/check` with `{ installed, draft }`.
4. Renders the returned conflicts grouped by type with severity color.

**Notes:**
- Use `useEffect` + `setTimeout` for debounce.
- Use `fetch()` directly — no need for SWR / React Query (single endpoint, simple).
- 4 conflict type sections, each with:
  - Title (e.g., "Python 版本冲突", "包版本冲突", "节点类冲突", "互斥声明")
  - Color: `error` → red, `warning` → yellow
  - List of conflicts with their `detail` text
- If 0 conflicts, show "无冲突 ✓".
- If the fetch fails, show "无法获取冲突信息" with the error message.
- Replace `<draft>` in the rendered `nodes`/`detail` with `currentLabel` for readability.

- [ ] **Step 1: Implement the component**

Replace `web/app/(wiki)/_components/ConflictPreview.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

type Installed = { owner: string; repo: string; version_tag: string };
type Draft = {
  python_min?: string | null;
  python_max?: string | null;
  dependencies: { name: string; spec: string; min_version: string | null; max_version: string | null; is_pinned: boolean }[];
  node_class_mappings: string[];
  incompatibilities: string[];
};
type Conflict =
  | { type: 'python_version'; severity: 'error'; nodes: string[]; detail: string }
  | { type: 'package_version'; severity: 'error' | 'warning'; nodes: string[]; detail: string; package: string }
  | { type: 'node_class'; severity: 'error'; nodes: string[]; detail: string; className: string }
  | { type: 'incompatibility'; severity: 'warning'; nodes: string[]; detail: string };

type Props = {
  installed: Installed[];
  draft: Draft;
  currentLabel: string;
};

export function ConflictPreview({ installed, draft, currentLabel }: Props) {
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/conflicts/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ installed, draft }),
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { conflicts: Conflict[] };
        setConflicts(data.conflicts);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [installed, draft]);

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        无法获取冲突信息：{error}
      </div>
    );
  }
  if (conflicts === null) {
    return (
      <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
        正在检查冲突…
      </div>
    );
  }
  if (conflicts.length === 0) {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">
        无冲突 ✓
      </div>
    );
  }
  // Replace <draft> with currentLabel in nodes and detail
  const labelize = (s: string) => s.replace(/<draft>/g, currentLabel);
  const sections: Array<{ title: string; items: Conflict[] }> = [
    { title: 'Python 版本冲突', items: conflicts.filter((c) => c.type === 'python_version') },
    { title: '包版本冲突', items: conflicts.filter((c) => c.type === 'package_version') },
    { title: '节点类冲突', items: conflicts.filter((c) => c.type === 'node_class') },
    { title: '互斥声明', items: conflicts.filter((c) => c.type === 'incompatibility') },
  ];
  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) =>
        s.items.length === 0 ? null : (
          <div key={s.title} className="rounded border border-gray-300 p-3 text-sm">
            <h3 className="mb-2 font-semibold">{s.title}</h3>
            <ul className="flex flex-col gap-1">
              {s.items.map((c, i) => (
                <li
                  key={i}
                  className={`rounded px-2 py-1 ${
                    c.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800'
                  }`}
                >
                  <span className="font-mono text-xs">[{c.severity}]</span> {labelize(c.detail)}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run tsc + smoke test in browser**

```bash
cd web && pnpm exec tsc --noEmit
cd web && pnpm dev  # background
```

Then visit `http://localhost:9999/wiki/1` (or any version ID) and verify the preview renders.

- [ ] **Step 3: Commit**

```bash
git add web/app/(wiki)/_components/ConflictPreview.tsx
git commit -m "feat(web): real ConflictPreview with debounce + fetch + render"
```

---

### Task 8: Wire `WikiEditForm` to pass draft + installed to `<ConflictPreview>`

**Files:**
- Modify: `web/app/(wiki)/_components/WikiEditForm.tsx`

**Goal:** Pass the watched form state + `installed` prop down to `<ConflictPreview>`.

- [ ] **Step 1: Update WikiEditForm to watch the relevant fields**

Edit `web/app/(wiki)/_components/WikiEditForm.tsx`:

```tsx
// Add at the top of the component body, after the existing `const pyMin = watch('python_min');` lines:
const pyMin = watch('python_min');
const pyMax = watch('python_max');
const notes = watch('notes_md');
const dependencies = watch('dependencies');
const incompatibilities = watch('incompatibilities');

// ... existing code

// In the JSX, replace the existing <ConflictPreview> line:
<section>
  <h2 className="mb-2 text-sm font-semibold">冲突预览</h2>
  <ConflictPreview
    installed={installed}
    draft={{
      python_min: pyMin,
      python_max: pyMax,
      dependencies,
      node_class_mappings: [],  // WikiEditForm does not yet edit this field
      incompatibilities,
    }}
    currentLabel={`version ${versionId}`}
  />
</section>
```

> **Note for implementer:** `node_class_mappings` is not yet exposed in the wiki edit form (Plan 2 §8.4 listed it but the Task 19 implementer left a placeholder — "（暂不支持多个映射数组 — Plan 3 改进）"). For Plan 3, we leave the form as-is and pass `[]` to the conflict preview. This means node_class conflicts will not be previewable for the draft, only for the installed list. Documented in README as a known limit.

- [ ] **Step 2: Run tsc + smoke test**

```bash
cd web && pnpm exec tsc --noEmit
```

Then in the dev server, edit the form on `/wiki/<id>` and verify the preview updates as the form changes (after 500ms debounce).

- [ ] **Step 3: Commit**

```bash
git add web/app/(wiki)/_components/WikiEditForm.tsx
git commit -m "feat(web): wire WikiEditForm form state to ConflictPreview"
```

---

### Task 9: Final integration test pass + dev server smoke test

**Files:** none new; this task verifies everything from Tasks 1-8.

**Goal:** Confirm `pnpm test` is green, `pnpm exec tsc --noEmit` is clean, `pnpm lint` has no new warnings, and a manual `curl` walk through the conflict-check endpoint returns expected conflicts.

**Notes:**
- Use `localhost:9999` (project port).
- The conflict-check endpoint requires auth (401 unauthenticated).
- For an authenticated smoke test, you'll need a logged-in user — use the Plan 2 dev login flow (or skip the authenticated smoke test and rely on the integration tests in `web/tests/api/conflicts-check.test.ts`).

- [ ] **Step 1: Run the full Vitest suite**

```bash
cd web && pnpm test
```

Expected: 127 (Plan 2 baseline) + 17 (Task 2) + 14 (Task 3+4) + ~3 (Task 5) + ~0 (Tasks 6-8 are UI, no new tests) = ~160 tests pass.

- [ ] **Step 2: TypeScript check**

```bash
cd web && pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
cd web && pnpm lint
```

Expected: no new warnings (10 pre-existing Plan 2 warnings may persist — out of scope).

- [ ] **Step 4: Start dev server**

```bash
cd web && pnpm dev
```

Use `run_in_background: true`. Wait ~5s.

- [ ] **Step 5: Smoke test the conflict-check endpoint (unauthenticated — 401)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:9999/api/v1/conflicts/check -H 'content-type: application/json' -d '{"installed":[]}'
# Expected: 401
```

- [ ] **Step 6: Browser walkthrough**

Visit `http://localhost:9999/wiki/1` (login first), edit the form fields, verify `<ConflictPreview>` updates after 500ms. Check:
- Editing `python_min` / `python_max` → python_version section appears if a conflict exists.
- Editing dependencies → package_version section appears.
- No conflicts → "无冲突 ✓".

- [ ] **Step 7: Stop the dev server**

Use TaskStop on the background dev server task.

- [ ] **Step 8: Commit any fix-ups**

If steps 1-3 surfaced real Plan 3 regressions (not pre-existing), fix and commit:

```bash
git add -A
git commit -m "fix(web): post-Plan-3 integration cleanups"
```

If nothing needs fixing, skip.

---

### Task 10: README — Plan 3 section + testing notes + known limits

**Files:**
- Modify: `README.md`

**Goal:** Document the new conflict detection engine, update the "下一步" list, and list Plan 3's known limits so future contributors don't file tickets against them.

**Notes:**
- Append a new section AFTER the existing "Known limits (Plan 2)" section.
- Update the "下一步" section to remove "Plan 3" from the to-do list and add Plan 4.

- [ ] **Step 1: Update the "下一步" section**

Change:
```markdown
- Plan 3：冲突检测引擎 + `POST /api/v1/conflicts/check`（替换 Plan 2 stub）
- Plan 4：Python Celery 扫描器
- Plan 5：生产部署
```
to:
```markdown
- Plan 4：Python Celery 扫描器
- Plan 5：生产部署
```

- [ ] **Step 2: Append "Conflict detection engine (Plan 3)" section**

Append at the end:

```markdown
## Conflict detection engine (Plan 3)

`POST /api/v1/conflicts/check` now runs a real PEP 440-based conflict detection algorithm in `web/lib/conflict-engine.ts`. The endpoint takes:

```json
{
  "installed": [{"owner": "...", "repo": "...", "version_tag": "..."}],
  "draft": {                       // OPTIONAL — wiki edit form uses this
    "python_min": "...", "python_max": "...",
    "dependencies": [...],
    "node_class_mappings": [...],
    "incompatibilities": [...]
  }
}
```

It returns 4 categories of conflicts:

- `python_version` (error) — node pairs with non-overlapping `python_min`/`python_max`
- `package_version` (error if pinned+incompatible, warning if ranges disjoint) — packages with the same name but incompatible specs
- `node_class` (error) — class names declared by 2+ nodes
- `incompatibility` (warning) — node pairs that declare each other as incompatible

### Wiki edit page integration

The `<ConflictPreview>` component on `/wiki/[versionId]` debounces the form state by 500ms and shows real-time conflicts against all other published nodes.

### API + algorithm

- The `pep440` npm package parses spec strings (`>=1.0.0,<2.0.0`, `==1.5.0`, etc.) into `(min, max, is_pinned)` tuples.
- Pure-function detectors live in `web/lib/conflict-engine.ts`; each is unit-tested in `web/tests/lib/conflict-engine.test.ts`.
- The `checkConflicts()` orchestrator loads each installed version's published data via `getPublishedRequirements()` and applies the `draft` as a virtual node.

## Testing (Plan 3 additions)

Plan 3 adds:
- `web/tests/lib/pep440-utils.test.ts` — 17 tests for spec parsing + range intersection
- `web/tests/lib/conflict-engine.test.ts` — 11 detector tests + 3 integration tests (real DB)
- `web/tests/api/conflicts-check.test.ts` — extended with `draft` field tests

## Known limits (Plan 3)

- **`node_class_mappings` is not editable in the wiki form.** The Plan 2 form has a placeholder ("暂不支持多个映射数组 — Plan 3 改进") and Plan 3 does not fix it. The conflict engine fully supports `node_class` detection, but only against the `installed` list, not the `draft`. To fix: add a `NodeClassMappingEditor` component (deferred).
- **No caching.** Every form keystroke (after debounce) triggers a fresh DB load. Acceptable for now (the query is small) but a future plan can add Redis-backed caching.
- **No background conflict scan.** The check is on-demand only; the wiki edit page does not pre-warm conflicts.
- **Pinned-version check uses simple intersection.** A pinned `==X.Y.Z` is treated as `[X.Y.Z, X.Y.Z]`. Exotic cases like `===X.Y.Z` or `~=X.Y.Z` may not be fully handled — verify against real-world spec strings in Plan 4 integration.
- **Out of scope (deferred plans):** Python Celery scanner (Plan 4), production deployment (Plan 5), resolving Plan 2's 2 Important non-blocking findings (TOCTOU in reject/withdraw; submit page missing page-level gate).
```

- [ ] **Step 3: Verify the README**

Re-read the file and confirm:
- Intro unchanged
- "下一步" updated
- 1 new section appended
- Markdown syntax valid
- Trailing newline at end of file

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Plan 3 (conflict engine) section, testing notes, known limits"
```

---

## Plan 3 Acceptance Criteria

### Functional
- [ ] `POST /api/v1/conflicts/check` returns real conflicts (4 types) instead of empty array
- [ ] `draft` field is accepted and used as a virtual node
- [ ] `<ConflictPreview>` on `/wiki/[versionId]` shows real-time conflicts, debounced 500ms
- [ ] All 4 conflict types are correctly detected with the right severity

### Testing
- [ ] `pnpm test` all green
- [ ] `pnpm exec tsc --noEmit` 0 errors
- [ ] `pnpm lint` no new warnings
- [ ] Each detector function has ≥2 unit tests
- [ ] `checkConflictsWithDraft` has ≥3 integration tests

### Performance
- [ ] Conflict check (10 nodes) returns in < 1s (original spec §12.2)
- [ ] Debounce 500ms prevents thrashing on fast typing

### Security
- [ ] Endpoint requires auth (401 unauthenticated)
- [ ] Zod validation rejects unknown fields in `draft` (`.strict()` preserved)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `pep440` npm package API differs from assumptions | Task 2 cast through `as` types; tests are the source of truth |
| Integration test DB race conditions (Plan 2 known issue: `fileParallelism: false`) | Already configured; no new test infrastructure needed |
| Backward incompatibility if existing clients send `draft: null` | zod `.optional()` accepts both `null` and `undefined`; check the route handler explicitly |
| Conflict detail text length explodes for large dependency lists | Cap `entries` in the package_version detail (e.g., first 5 + "等 N 项") |
| `<ConflictPreview>` re-renders too often (every keystroke) | Debounce 500ms; only re-fetch when the form state actually changes |
| `node_class_mappings` not in form → users think the engine is broken | README documents this; `<ConflictPreview>` only shows `node_class` section when there are conflicts from `installed` |

## Out of Scope but Worth Tracking (post-Plan 3)

- Plan 2 deferred Important #1: TOCTOU in `rejectRevision` / `rejectSubmission` / `withdrawRevision` — wrap in `prisma.$transaction` with `where: { id, status: 'pending' }`
- Plan 2 deferred Important #2: `/wiki/[versionId]/submit/page.tsx` missing page-level auth gate — add `try { await requireUser() } catch { redirect('/login?') }`
- Performance: cache the "other installed nodes" list (server-side) — currently fetched on every wiki edit page load
- UX: let the user select WHICH other nodes to check against (instead of "all other published nodes")
- UX: add a `NodeClassMappingEditor` so the wiki form can edit `node_class_mappings` (currently hard-coded `[]` in the form's draft)
- Algorithm: handle exotic PEP 440 specifiers (`~=`, `===`, `!=`)
