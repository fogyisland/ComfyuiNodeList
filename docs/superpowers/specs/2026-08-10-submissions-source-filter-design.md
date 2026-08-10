# Admin submissions — source filter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/admin/submissions`, add a tab-like filter (全部 / Manager / 用户提交) that lets admins view only Manager-sourced or user-submitted pending submissions, with the filter state reflected in the URL.

**Architecture:** Server-side filtering via Next.js `searchParams`. The page server component reads `?source=` and applies a Prisma `where` clause; the client component renders tab buttons that use `router.replace()` to update the URL.

**Tech Stack:**
- Next.js 14+ app router (existing)
- React 18 (existing)
- Prisma 5 + MySQL (existing)
- TypeScript (existing)

## Context

Plan 5.1.3 Task 6 added a "来源" column to the admin submissions list, displaying a "Manager" badge for entries sourced from ComfyUI-Manager catalog sync and a "—" for user-submitted entries. The followup here is to make that column actionable as a filter.

The current `/admin/submissions` page (`web/app/admin/submissions/page.tsx`) is a server component that fetches **all** pending submissions and renders them via `SubmissionsClient`. For a typical admin workflow, "show me only the Manager submissions I need to review" or "show me only the user-submitted ones" is the common ask.

This followup is in the `docs/superpowers/specs/2026-08-07-manager-sync-operational-design.md` `§Followups` list:
> Filter / search `/admin/submissions` by source (`user` vs `manager`)

The "search" part (submitter username search) is out of scope for this spec; only the source filter is in. If username search is needed later, that's a separate spec.

## Global Constraints

- **Filter values:** exactly three states — `all` (no `?source=` param, or `?source=all`), `manager` (`?source=manager`), `user` (`?source=user`). Any other value is treated as `all`.
- **Filter is server-side:** The Prisma `where` clause applies the filter. The client does not re-filter after fetching — full data set per page render.
- **URL is the source of truth:** The filter state is encoded in the URL via `?source=`. Tabs are `<Link>` elements with `router.replace()` (not `useState`); deep-linking works, refresh preserves state.
- **Tab UI:** Three tabs at the top of the page (above the table): 全部 / Manager / 用户提交. Active tab is visually highlighted. Tab count badges (showing how many submissions match each filter) are NOT included — keeps the spec minimal; can be added later.
- **Default page state:** No `?source=` → all submissions shown (preserves current behavior).
- **No new dependencies, no schema changes.**
- **Style:** Reuse existing Tailwind classes consistent with `web/app/admin/submissions/SubmissionsClient.tsx`.

## Design

### URL state machine

| URL                        | Filter state | Prisma `where` clause |
|---------------------------|--------------|------------------------|
| `/admin/submissions`      | all          | `{ status: pending }` |
| `/admin/submissions?source=all` | all     | `{ status: pending }` |
| `/admin/submissions?source=manager` | manager | `{ status: pending, submitter: { username: 'comfyui-manager' } }` |
| `/admin/submissions?source=user`   | user    | `{ status: pending, submitter: { is: { username: { not: 'comfyui-manager' } } } }` |

### Tab UI

At the top of `SubmissionsClient`, before the table:

```tsx
<nav className="mb-4 flex gap-1 border-b border-gray-200">
  <FilterTab href="/admin/submissions" active={source === 'all'}>全部</FilterTab>
  <FilterTab href="/admin/submissions?source=manager" active={source === 'manager'}>Manager</FilterTab>
  <FilterTab href="/admin/submissions?source=user" active={source === 'user'}>用户提交</FilterTab>
</nav>
```

`FilterTab` is a tiny inline component (or just `<Link>` with active styling) that visually highlights the current tab and uses Next.js `<Link>` for client-side navigation.

### Page component changes

`web/app/admin/submissions/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { SubmissionStatus } from '@prisma/client';
import { SubmissionsClient } from './SubmissionsClient';

type SearchParams = { source?: string };

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const source = normalizeSource(searchParams.source);
  const where = buildWhere(source);

  const rows = await prisma.nodeSubmission.findMany({
    where,
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

function normalizeSource(raw: string | undefined): 'all' | 'manager' | 'user' {
  if (raw === 'manager' || raw === 'user') return raw;
  return 'all';
}

function buildWhere(source: 'all' | 'manager' | 'user') {
  const base = { status: SubmissionStatus.pending };
  if (source === 'manager') {
    return { ...base, submitter: { username: 'comfyui-manager' } };
  }
  if (source === 'user') {
    return { ...base, submitter: { is: { username: { not: 'comfyui-manager' } } } };
  }
  return base;
}
```

### Client component changes

`web/app/admin/submissions/SubmissionsClient.tsx`:

- Add `source: 'all' | 'manager' | 'user'` prop.
- Render tab nav above the table.
- Tabs are `<Link href="...">` with active-state styling. Active tab uses `bg-blue-600 text-white`; inactive tabs use `text-gray-600 hover:bg-gray-100`.
- Tab labels (Chinese): 全部 / Manager / 用户提交.
- The existing "来源" column stays (it shows the badge for each row) — no change to that.

## File Structure

- **Modify:** `web/app/admin/submissions/page.tsx` (~30 lines added for searchParams handling + where builder)
- **Modify:** `web/app/admin/submissions/SubmissionsClient.tsx` (~25 lines added for tabs)
- **Modify:** `web/tests/admin/submissions-page.test.tsx` (new file or extend existing — see test plan below)

## Test Plan

### `web/tests/admin/submissions-page.test.tsx` (new)

Three test cases (mirroring the existing `web/tests/admin/page.test.tsx` style):

1. **`test_filter_manager_queries_manager_submitter`** — mock `prisma.nodeSubmission.findMany` to capture the `where` clause; render the page with `?source=manager`; assert `where.submitter.username === 'comfyui-manager'`.

2. **`test_filter_user_queries_non_manager_submitter`** — render with `?source=user`; assert `where.submitter.is.username.not === 'comfyui-manager'`.

3. **`test_default_no_param_shows_all`** — render with no `searchParams`; assert `where` is `{ status: SubmissionStatus.pending }` only (no submitter filter).

### `web/tests/admin/submissions-client.test.tsx` (extend if not exists)

If `web/tests/_components/SubmissionsClient.test.tsx` already exists (it does — Plan 5.1.3 Task 6 created it), extend it with:

4. **`test_renders_three_tabs`** — render `<SubmissionsClient items={[]} source="all" />`; assert all three tab labels (全部 / Manager / 用户提交) are present.

5. **`test_active_tab_highlighted`** — render with `source="manager"`; assert the Manager tab has the active class while the others don't.

6. **`test_tab_links_have_correct_hrefs`** — assert each tab's `href` points to the correct URL.

If `SubmissionsClient.test.tsx` does NOT exist, create it with the 3 cases above.

## Acceptance Criteria

- [ ] `web/app/admin/submissions/page.tsx` accepts `searchParams` and applies a `where` clause based on `?source=`
- [ ] Three filter states work: `all` (default), `manager`, `user`
- [ ] `?source=anything-else` is treated as `all` (defensive)
- [ ] Tab UI shows three tabs: 全部 / Manager / 用户提交, with active tab highlighted
- [ ] Tab links use Next.js `<Link>` with correct hrefs
- [ ] Existing "来源" column with Manager badge continues to work
- [ ] All existing tests pass
- [ ] New tests for page + client tabs pass
- [ ] vitest 100% green (baseline 246 + new ~6 = 252+)
- [ ] No new lint warnings (pre-existing 13 warnings acceptable)
- [ ] No new TypeScript errors (pre-existing `ThemeToggle.test.tsx:11` acceptable)

## Out of Scope (NOT in this spec)

- Submitter username text search (separate spec if needed)
- Per-filter count badges on tabs (could be added later)
- Multi-select filters (status + source)
- Sorting options within each filter (currently always `created_at desc`)
- "Last 7 days" / date range filter
- Approval/rejection modal changes (no change needed)