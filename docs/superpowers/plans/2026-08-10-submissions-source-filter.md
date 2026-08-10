# Admin submissions source filter — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/admin/submissions`, add a tab-like filter (全部 / Manager / 用户提交) backed by `?source=` URL query param. Server component applies the Prisma `where` clause; client renders the tabs.

**Architecture:** Server-side filtering via Next.js `searchParams`. The page reads `searchParams.source`, normalizes to `all|manager|user`, and applies a `where` clause. `SubmissionsClient` receives `source` as a prop and renders `<Link>` tabs.

## Global Constraints

- **Filter values:** exactly three states — `all` (no `?source=` or `?source=all`), `manager` (`?source=manager`), `user` (`?source=user`). Any other value is treated as `all`.
- **Filter is server-side:** The Prisma `where` clause applies the filter. No client-side re-filter after fetch.
- **URL is the source of truth:** Filter state encoded in URL via `?source=`. Tabs are `<Link>` elements; deep-linking works, refresh preserves state.
- **Tab UI:** Three tabs above the table: 全部 / Manager / 用户提交. Active tab visually highlighted. No count badges (out of scope).
- **Default page state:** No `?source=` → all submissions shown (preserves current behavior).
- **No new dependencies, no schema changes.** Reuse existing Tailwind classes consistent with `SubmissionsClient.tsx`.

---

## Task 1: Server-side filtering in `page.tsx` + page tests

**Files:**
- Modify: `web/app/admin/submissions/page.tsx` (read `searchParams`, build `where`, pass `source` to client)
- Create: `web/tests/admin/submissions-page.test.tsx` (3 cases: manager / user / default)

**Interfaces:**
- Consumes: existing `prisma` from `web/lib/db.ts`, existing `SubmissionStatus` enum, existing `SubmissionsClient`
- Produces: `page.tsx` accepts `{ searchParams: { source?: string } }` prop and renders `<SubmissionsClient items={...} source={...} />`

### Step 1: Write failing tests for page filtering

Create `web/tests/admin/submissions-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const findManyMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    nodeSubmission: {
      findMany: findManyMock,
    },
  },
}));
vi.mock('@/app/admin/submissions/SubmissionsClient', () => ({
  SubmissionsClient: ({ items, source }: { items: unknown; source: unknown }) => (
    <div data-testid="submissions-client" data-source={String(source)} data-count={String((items as unknown[]).length)} />
  ),
}));

describe('AdminSubmissionsPage', () => {
  it('queries manager submitters when ?source=manager', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 1n,
        github_url: 'https://github.com/a/b',
        created_at: new Date('2026-08-10T05:00:00Z'),
        submitter: { username: 'comfyui-manager' },
      },
    ]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: { source: 'manager' } });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          submitter: { username: 'comfyui-manager' },
        }),
      }),
    );
    expect(el.props.source).toBe('manager');
  });

  it('queries non-manager submitters when ?source=user', async () => {
    findManyMock.mockResolvedValue([]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: { source: 'user' } });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          submitter: { is: { username: { not: 'comfyui-manager' } } },
        }),
      }),
    );
    expect(el.props.source).toBe('user');
  });

  it('shows all pending submissions when ?source is absent or invalid', async () => {
    findManyMock.mockResolvedValue([]);
    const { default: AdminSubmissionsPage } = await import('@/app/admin/submissions/page');
    const el = await AdminSubmissionsPage({ searchParams: {} });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
      }),
    );
    expect(el.props.source).toBe('all');
  });
});
```

Notes:
- `web/tests/admin/page.test.tsx` (from Plan 5.1.4 Task 4) used a similar pattern — mock `prisma` and `SubmissionsClient` then call the async server component. If the file uses `web/tests/admin/page.test.tsx` as a reference, the pattern matches.
- The `1n` BigInt literal matches Prisma's `id` column type.
- The third test uses `expect.objectContaining({ where: { status: 'pending' } })` (exact match) because the default path has no extra `where` keys. Adjust if your Vitest version complains about partial match.
- If `SubmissionStatus.pending` is `'pending'` (string) the literal works; if it's a typed enum, the mock with `where: { status: 'pending' }` will match via objectContaining.

### Step 2: Run tests to verify they fail

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/admin/submissions-page.test.tsx --reporter=basic
```

Expected: 3 failures (`@/app/admin/submissions/page` does not accept `searchParams` yet, or the existing page signature doesn't return the right shape).

### Step 3: Implement searchParams handling in `page.tsx`

Replace `web/app/admin/submissions/page.tsx` with:

```tsx
import { prisma } from '@/lib/db';
import { SubmissionStatus } from '@prisma/client';
import { SubmissionsClient } from './SubmissionsClient';

type Source = 'all' | 'manager' | 'user';

function normalizeSource(raw: string | undefined): Source {
  if (raw === 'manager' || raw === 'user') return raw;
  return 'all';
}

function buildWhere(source: Source) {
  const base = { status: SubmissionStatus.pending };
  if (source === 'manager') {
    return { ...base, submitter: { username: 'comfyui-manager' } };
  }
  if (source === 'user') {
    return { ...base, submitter: { is: { username: { not: 'comfyui-manager' } } } };
  }
  return base;
}

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: { source?: string };
}) {
  const source = normalizeSource(searchParams.source);
  const rows = await prisma.nodeSubmission.findMany({
    where: buildWhere(source),
    orderBy: { created_at: 'desc' },
    include: { submitter: { select: { username: true } } },
  });
  const items = rows.map((s) => ({
    id: Number(s.id),
    submitterUsername: s.submitter.username,
    submitterSource: (s.submitter.username === 'comfyui-manager' ? 'manager' : 'user') as 'manager' | 'user',
    githubUrl: s.github_url,
    createdAt: s.created_at.toISOString(),
  }));
  return <SubmissionsClient items={items} source={source} />;
}
```

### Step 4: Re-run tests to verify they pass

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/admin/submissions-page.test.tsx --reporter=basic
```

Expected: 3 passes.

If the third test fails because `findManyMock` was called with a different `where` shape, the issue is the spread on the base. Adjust as needed — the intent is that the default `where` has exactly `{ status: 'pending' }` and nothing else.

### Step 5: Run full vitest to confirm no regression

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 246 prior + 3 submissions-page = 249/249 pass. (Plan 5.1.4 baseline is 246.)

If the full suite hits the pre-existing P1014 race, run `cd web && npx prisma migrate reset --force --skip-seed` once and re-run.

### Step 6: Commit

```bash
cd web && git add app/admin/submissions/page.tsx tests/admin/submissions-page.test.tsx
git commit -m "feat(admin): server-side ?source= filter on /admin/submissions"
```

(Or run `git add` from repo root if you prefer; either way, both files are staged.)

---

## Task 2: Tab UI in `SubmissionsClient.tsx` + client tests

**Files:**
- Modify: `web/app/admin/submissions/SubmissionsClient.tsx` (add `source` prop, render tab nav above table)
- Modify: `web/tests/_components/SubmissionsClient.test.tsx` (add 3 cases: tabs render / active highlight / hrefs)

**Interfaces:**
- Consumes: existing `Item` type, `useState`, `useRouter` (already used for `router.refresh()`)
- Produces: `<SubmissionsClient items={...} source={'all'|'manager'|'user'} />` with tab nav

### Step 1: Read existing test file to understand structure

```bash
cat web/tests/_components/SubmissionsClient.test.tsx
```

The file was created by Plan 5.1.3 Task 6. It should already test the badge rendering and approve/reject flow.

### Step 2: Write failing tests for tabs

Append to `web/tests/_components/SubmissionsClient.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { SubmissionsClient } from '@/app/admin/submissions/SubmissionsClient';

describe('SubmissionsClient tabs', () => {
  it('renders three tabs (全部 / Manager / 用户提交)', () => {
    render(<SubmissionsClient items={[]} source="all" />);
    expect(screen.getByRole('link', { name: /全部/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manager/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /用户提交/ })).toBeTruthy();
  });

  it('highlights the active tab when source matches', () => {
    render(<SubmissionsClient items={[]} source="manager" />);
    const managerTab = screen.getByRole('link', { name: /Manager/ });
    expect(managerTab.className).toMatch(/bg-blue-600/);
    const allTab = screen.getByRole('link', { name: /全部/ });
    expect(allTab.className).not.toMatch(/bg-blue-600/);
  });

  it('tab links have correct hrefs', () => {
    render(<SubmissionsClient items={[]} source="all" />);
    expect(screen.getByRole('link', { name: /全部/ }).getAttribute('href')).toBe('/admin/submissions');
    expect(screen.getByRole('link', { name: /Manager/ }).getAttribute('href')).toBe('/admin/submissions?source=manager');
    expect(screen.getByRole('link', { name: /用户提交/ }).getAttribute('href')).toBe('/admin/submissions?source=user');
  });
});
```

If the test file already imports `render` / `screen` at the top, no new imports needed. Otherwise add the imports shown.

### Step 3: Run tests to verify they fail

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/SubmissionsClient.test.tsx --reporter=basic
```

Expected: 3 new failures (tabs not implemented yet). Pre-existing tests in this file should still pass.

### Step 4: Implement tabs in `SubmissionsClient.tsx`

Modify `web/app/admin/submissions/SubmissionsClient.tsx`:

1. Update the `Props` type to include `source`:

```tsx
type Props = { items: Item[]; source: 'all' | 'manager' | 'user' };
```

2. Update the component signature:

```tsx
export function SubmissionsClient({ items, source }: Props) {
```

4. Import `Link` at the top:

```tsx
import Link from 'next/link';
```

5. Add tab nav above the table (after the empty-state guard, before the `<table>`):

```tsx
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">节点收录</h1>
      <nav className="mb-4 flex gap-1 border-b border-gray-200">
        <FilterTab href="/admin/submissions" active={source === 'all'}>全部</FilterTab>
        <FilterTab href="/admin/submissions?source=manager" active={source === 'manager'}>Manager</FilterTab>
        <FilterTab href="/admin/submissions?source=user" active={source === 'user'}>用户提交</FilterTab>
      </nav>
      <table className="w-full text-sm">
        {/* ... existing table ... */}
      </table>
      {/* ... existing modal ... */}
    </div>
  );
```

6. Add the `FilterTab` helper component (file-local, below `SubmissionsClient`):

```tsx
type FilterTabProps = {
  href: string;
  active: boolean;
  children: React.ReactNode;
};

function FilterTab({ href, active, children }: FilterTabProps) {
  const base = 'rounded-t px-3 py-2 text-sm';
  const cls = active
    ? `${base} bg-blue-600 text-white`
    : `${base} text-gray-600 hover:bg-gray-100`;
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
```

The empty-state branch (`if (items.length === 0)`) must render the tabs even when the list is empty — move the tabs **above** the empty-state guard:

```tsx
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">节点收录</h1>
      <nav className="mb-4 flex gap-1 border-gray-200">
        {/* tabs */}
      </nav>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">暂无待审核节点收录请求。</p>
      ) : (
        <table>...</table>
      )}
      {modal && (...)}
    </div>
  );
```

### Step 5: Re-run tests to verify they pass

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run tests/_components/SubmissionsClient.test.tsx --reporter=basic
```

Expected: 3 new passes; pre-existing tests in this file still pass.

### Step 6: Run full vitest to confirm no regression

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic
```

Expected: 249 prior + 3 client tabs = 252/252 pass.

### Step 7: Run `tsc --noEmit` and lint (best-effort)

```bash
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit
cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/next lint --quiet 2>/dev/null || PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/eslint . --quiet
```

Expected: 0 new errors. Pre-existing `ThemeToggle.test.tsx:11` TS error + 13 lint warnings are NOT new.

### Step 8: Commit

```bash
cd web && git add app/admin/submissions/SubmissionsClient.tsx tests/_components/SubmissionsClient.test.tsx
git commit -m "feat(admin): tab nav (全部/Manager/用户提交) for source filter"
```

---

## Final Verification (post-implementation)

- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/vitest run --reporter=basic` — 252/252 pass
- [ ] `cd web && PATH="/c/pnpm-runtime:$PATH" ./node_modules/.bin/tsc --noEmit` — 0 new errors
- [ ] Manual smoke (best-effort): start dev server, visit `/admin/submissions`, click each tab, verify URL updates and rows filter; refresh page with `?source=manager`, verify only Manager rows show
- [ ] Final whole-branch review dispatched by orchestrator before push

## Out of Scope (NOT in this plan)

- Submitter username text search
- Per-filter count badges
- Multi-select filters (status + source)
- Sorting options
- Date range filter

## Self-Review Notes

### Spec coverage

| Spec section / requirement | Covered by task |
|---|---|
| Filter values: all / manager / user | Task 1 (normalize + where) |
| Server-side filtering | Task 1 (Prisma where clause) |
| URL is source of truth | Task 2 (Link tabs) |
| Tab UI above table | Task 2 |
| Default page state (no source = all) | Task 1 |
| Tab labels (全部 / Manager / 用户提交) | Task 2 |
| Existing 来源 column unchanged | Task 2 (no change to existing column) |
| Tests for filter behavior | Task 1 (3 cases) |
| Tests for tabs | Task 2 (3 cases) |

No gaps.

### Placeholder scan

No "TBD", "TODO", "implement later". All concrete file paths and code.

### Type consistency

- `source: 'all' | 'manager' | 'user'` consistent between `page.tsx` and `SubmissionsClient.tsx`.
- `Item` type unchanged from current `SubmissionsClient.tsx`.
- `findMany` `where` shape matches Prisma 5 `nodeSubmission` schema (no relation joins other than `submitter`).

### Risks surfaced

- **Pre-existing P1014 race** affects full vitest runs (mitigation: `prisma migrate reset --force --skip-seed`).
- **Pre-existing `ThemeToggle.test.tsx:11` TS error** — out of scope.
- **`user` filter uses Prisma `NOT IN` semantics** — `submitter: { is: { username: { not: 'comfyui-manager' } } }`. If a submission has `submitter = null` (orphaned FK), it would NOT match (which is correct — we want username-known submissions).
- **Tabs are `<Link>` not `<button>`** — refresh behavior is consistent with Next.js conventions; user can right-click "Open in new tab".
- **Empty state** — tabs still render even when items.length === 0, so user can switch filters without a "back to all" button.