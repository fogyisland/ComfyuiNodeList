# Plan 2: Wiki 编辑流程与管理员审核

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the wiki editing workflow on top of Plan 1's read-only foundation: any logged-in user can submit a `WikiRevision` (pending) for any version; admins review/approve/reject; admins also review `NodeSubmission`s and manage user roles; users can see field-level diffs between any two revisions; the edit page shows a `ConflictPreview` placeholder (Plan 3 will replace it with the real engine).

**Architecture:** Same Next.js 15 monolith as Plan 1. New server actions coexist with REST endpoints (`/api/v1/wiki/*`, `/api/v1/admin/*`, `/api/v1/conflicts/check`). React Hook Form drives the edit form; Tiptap is the Markdown editor; a custom field-level diff viewer renders on the history page. A single Prisma transaction enforces "at most one approved `WikiRevision` per `version_id`" by archiving the previous approved row before flipping the new one. All input is validated with zod; all admin writes check `requireAdmin()`; all wiki writes check `requireUser()`. JWT carries the `role` so admin permission checks are always fresh (resolves Plan 1 whole-branch review Important #3).

**Tech Stack:** (additions to Plan 1)
- `react-hook-form` ^7.x — form state + `useFieldArray` for dynamic dependency rows
- `@tiptap/react` ^2.x + `@tiptap/starter-kit` + `@tiptap/extension-link` — Markdown editor
- `markdown-it` ^14.x — render `notes_md` in `DiffViewer`
- `zod` ^3.x — input validation on every POST/PATCH (already in Plan 1)

## Global Constraints

Verbatim from spec (`docs/superpowers/specs/2026-06-25-plan-02-wiki-editing.md`):

- `wiki_revisions.status` enum extended to `['pending', 'approved', 'rejected', 'archived', 'withdrawn']`. `pending` / `approved` are the live values; `archived` = was approved but replaced; `withdrawn` = author recalled a pending; `rejected` = admin rejected. Same `version_id` may have at most ONE `approved` row at any moment.
- `node_submissions.status` keeps Plan 1 enum (`pending | approved | rejected`).
- All POST/PATCH endpoints are zod-validated; the validator schema lives in `web/lib/wiki-schema.ts`.
- Wiki API (`/api/v1/wiki/*`) requires `requireUser()`; admin API (`/api/v1/admin/*`) requires `requireAdmin()`. Returns 401/403 respectively.
- `POST /api/v1/wiki/{versionId}/revisions` body constraints: `python_min` / `python_max` strings of `^\d+\.\d+(\.\d+)?$` or `null`; `dependencies` is a `PublishedDependency[]`; `node_class_mappings` is `string[]` of `{owner}/{repo}`; `incompatibilities` same; `notes_md` ≤ 65536 bytes; `edit_summary` 1–200 chars.
- `POST /api/v1/admin/revisions/{id}/reject` body: `{ review_note: string }` (required, 1–1000 chars).
- `POST /api/v1/admin/users/{id}/role` body: `{ role: 'admin' | 'user' }`; admins cannot demote themselves (returns 409).
- `POST /api/v1/admin/submissions/{id}/approve` creates a `Node` row (status=`active`) from the submission's `github_url`; `name` / `author` / `description` are placeholders (`name=repo`, `author=''`, `description=''`) and the Plan 4 scanner fills them in.
- `POST /api/v1/conflicts/check` is a stub in Plan 2 — always returns `{ conflicts: [] }`. Plan 3 replaces the body.
- `notes_md` is rendered with markdown-it only in `<DiffViewer>`; the editor itself shows a WYSIWYG (Tiptap) view.
- JWT must include `role` (Plan 1 whole-branch review finding); test users can be impersonated via an env-gated `forceUserId` in dev only (NOT in this plan — deferred to Plan 5).
- All API responses: JSON, UTF-8, ISO-8601 timestamps.
- Test DB: `mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test`. Vitest uses `fileParallelism: false` (already configured) and `prisma db push --force-reset` between test files (already wired in `web/tests/setup.ts`).
- Repo root: `D:\ToolDevelop\ComfyUINodeAnalysis\`. All paths in this plan are relative to that root unless stated.
- Dev server port: 9999 (inherited from Plan 1; `pnpm dev` and `pnpm start` both bind 9999).

## Out of Scope for This Plan

- Real PEP 440 conflict detection algorithm (Plan 3).
- Python Celery scanner worker + auto-suggested submissions (Plan 4).
- Production deployment hardening, CI, monitoring, Docker (Plan 5).
- E-mail notifications, revision editing/resubmit flows, multi-branch history.

## File Structure (this plan creates or modifies)

```
web/
├── prisma/
│   └── schema.prisma                          # MODIFY: extend RevisionStatus enum
├── lib/
│   ├── wiki-schema.ts                         # CREATE: zod schemas
│   ├── wiki.ts                                # CREATE: createRevision / withdrawRevision / approveRevision / rejectRevision
│   ├── submissions.ts                         # CREATE: approveSubmission (creates Node) / rejectSubmission
│   ├── diff.ts                                # CREATE: field-level diff
│   ├── conflict-engine.ts                     # CREATE: stub (Plan 3 replaces)
│   └── auth.ts                                # MODIFY: include role in JWT
├── app/
│   ├── (wiki)/
│   │   └── _components/
│   │       ├── PythonVersionRange.tsx         # CREATE
│   │       ├── IncompatibilityEditor.tsx     # CREATE
│   │       ├── NodeRequirementTable.tsx      # CREATE (uses RHF useFieldArray)
│   │       ├── MarkdownEditor.tsx            # CREATE (Tiptap)
│   │       ├── DiffViewer.tsx                # CREATE (field-level)
│   │       ├── ConflictPreview.tsx           # CREATE (stub)
│   │       └── WikiEditForm.tsx              # CREATE (RHF orchestrator)
│   ├── (admin)/
│   │   └── _components/
│   │       ├── AdminDashboard.tsx            # CREATE
│   │       ├── RevisionsReviewList.tsx       # CREATE
│   │       ├── SubmissionsReviewList.tsx     # CREATE
│   │       └── UsersRoleTable.tsx            # CREATE
│   ├── wiki/
│   │   └── [versionId]/
│   │       ├── page.tsx                      # CREATE: edit page
│   │       ├── submit/page.tsx               # CREATE: confirm submit
│   │       └── history/page.tsx              # CREATE: history + diff
│   ├── admin/
│   │   ├── layout.tsx                        # CREATE: requireAdmin shell
│   │   ├── page.tsx                          # CREATE: dashboard
│   │   ├── revisions/page.tsx                # CREATE
│   │   ├── submissions/page.tsx              # CREATE
│   │   └── users/page.tsx                    # CREATE
│   └── api/
│       └── v1/
│           ├── wiki/
│           │   ├── [versionId]/
│           │   │   ├── route.ts              # CREATE: GET (load published + latest pending)
│           │   │   ├── history/route.ts      # CREATE: GET (paginated history)
│           │   │   └── revisions/route.ts    # CREATE: POST (create)
│           │   ├── revisions/[id]/
│           │   │   ├── route.ts              # CREATE: GET (single)
│           │   │   └── withdraw/route.ts     # CREATE: POST
│           │   └── diff/route.ts             # CREATE: GET (?from=&to=)
│           ├── conflicts/check/route.ts      # CREATE: POST (stub)
│           └── admin/
│               ├── revisions/pending/route.ts        # CREATE: GET
│               ├── revisions/[id]/approve/route.ts   # CREATE: POST
│               ├── revisions/[id]/reject/route.ts    # CREATE: POST
│               ├── submissions/pending/route.ts      # CREATE: GET
│               ├── submissions/[id]/approve/route.ts # CREATE: POST
│               ├── submissions/[id]/reject/route.ts  # CREATE: POST
│               ├── users/route.ts                    # CREATE: GET
│               └── users/[id]/role/route.ts          # CREATE: POST
└── tests/
    ├── lib/
    │   ├── wiki-schema.test.ts                # CREATE
    │   ├── diff.test.ts                       # CREATE
    │   ├── wiki.test.ts                       # CREATE
    │   └── conflict-engine.test.ts            # CREATE
    └── api/
        ├── wiki-list.test.ts                  # CREATE
        ├── wiki-history.test.ts               # CREATE
        ├── wiki-revision.test.ts              # CREATE
        ├── wiki-create-revision.test.ts       # CREATE
        ├── wiki-withdraw.test.ts              # CREATE
        ├── wiki-diff.test.ts                  # CREATE
        ├── conflicts-check.test.ts            # CREATE
        ├── admin-revisions-pending.test.ts    # CREATE
        ├── admin-revisions-approve.test.ts    # CREATE
        ├── admin-revisions-reject.test.ts     # CREATE
        ├── admin-submissions-pending.test.ts  # CREATE
        ├── admin-submissions-approve.test.ts  # CREATE
        ├── admin-submissions-reject.test.ts   # CREATE
        ├── admin-users-list.test.ts           # CREATE
        └── admin-users-role.test.ts           # CREATE
```

Notes:
- `prisma/migrations/<timestamp>_add_revision_status_archived_withdrawn/` will be created by `prisma migrate dev` in Task 1; the file is generated.
- Plan 1 created `web/lib/auth.ts`, `web/lib/session.ts`, `web/lib/api-helpers.ts`, `web/lib/published.ts`, `web/lib/db.ts`, `web/tests/setup.ts`, `web/tests/fixtures.ts` — they are READ-ONLY inputs in this plan.
- The `app/(wiki)/_components` and `app/(admin)/_components` are Next.js route group folders (parentheses do not appear in URLs).

---

## Task 1: Extend RevisionStatus enum (`archived`, `withdrawn`) + migration

**Files:**
- Modify: `web/prisma/schema.prisma` (lines 21-25)
- Create: `web/prisma/migrations/<timestamp>_add_revision_status_archived_withdrawn/migration.sql` (auto-generated)
- Create: `web/tests/lib/revision-status.test.ts`

**Interfaces:**
- Consumes: existing `RevisionStatus` enum (`pending | approved | rejected`).
- Produces: new `RevisionStatus` values `archived` and `withdrawn` available in the generated Prisma client and in MySQL.

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/revision-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RevisionStatus } from '@prisma/client';

describe('RevisionStatus enum (Plan 2)', () => {
  it('includes archived and withdrawn', () => {
    expect(RevisionStatus.archived).toBe('archived');
    expect(RevisionStatus.withdrawn).toBe('withdrawn');
  });

  it('still includes the original values', () => {
    expect(RevisionStatus.pending).toBe('pending');
    expect(RevisionStatus.approved).toBe('approved');
    expect(RevisionStatus.rejected).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd web && pnpm test tests/lib/revision-status.test.ts
```
Expected: FAIL — `RevisionStatus.archived` is `undefined` and `RevisionStatus.withdrawn` is `undefined`.

- [ ] **Step 3: Edit `web/prisma/schema.prisma`**

Replace the `enum RevisionStatus` block (lines 21-25):

```prisma
enum RevisionStatus {
  pending
  approved
  rejected
  archived
  withdrawn
}
```

- [ ] **Step 4: Create the migration**

Run:
```bash
cd web && pnpm prisma migrate dev --name add_revision_status_archived_withdrawn
```
Expected output: a new directory under `web/prisma/migrations/` containing `migration.sql` with the two `ALTER TABLE wiki_revisions MODIFY COLUMN status ENUM(...)` lines.

- [ ] **Step 5: Regenerate the Prisma client and re-run the test**

```bash
cd web && pnpm prisma:generate && pnpm test tests/lib/revision-status.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/ web/tests/lib/revision-status.test.ts
git commit -m "feat(db): extend RevisionStatus with archived and withdrawn"
```

---

## Task 2: zod schemas (`web/lib/wiki-schema.ts`)

**Files:**
- Create: `web/lib/wiki-schema.ts`
- Create: `web/tests/lib/wiki-schema.test.ts`

**Interfaces:**
- Produces (all schemas and their inferred types):
  ```ts
  // For POST /api/v1/wiki/{versionId}/revisions body
  export const CreateRevisionBody;
  export type CreateRevisionBody = z.infer<typeof CreateRevisionBody>;

  // For POST /api/v1/wiki/revisions/{id}/withdraw body (empty)
  export const WithdrawRevisionBody = z.object({}).strict();

  // For POST /api/v1/admin/revisions/{id}/approve body
  export const ApproveRevisionBody;  // { review_note?: string, 0..1000 chars }

  // For POST /api/v1/admin/revisions/{id}/reject body
  export const RejectRevisionBody;   // { review_note: string, 1..1000 chars }

  // For POST /api/v1/admin/submissions/{id}/approve body
  export const ApproveSubmissionBody;

  // For POST /api/v1/admin/submissions/{id}/reject body
  export const RejectSubmissionBody;  // { review_note: string, 1..1000 chars }

  // For POST /api/v1/admin/users/{id}/role body
  export const ChangeRoleBody;        // { role: 'admin' | 'user' }

  // For POST /api/v1/conflicts/check body
  export const ConflictCheckBody;
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/wiki-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CreateRevisionBody,
  ApproveRevisionBody,
  RejectRevisionBody,
  ApproveSubmissionBody,
  RejectSubmissionBody,
  ChangeRoleBody,
  ConflictCheckBody,
} from '@/lib/wiki-schema';

describe('CreateRevisionBody', () => {
  it('accepts a minimal valid body', () => {
    const r = CreateRevisionBody.safeParse({
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'initial',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty edit_summary', () => {
    const r = CreateRevisionBody.safeParse({
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: '',
    });
    expect(r.success).toBe(false);
  });

  it('rejects edit_summary > 200 chars', () => {
    const r = CreateRevisionBody.safeParse({
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'x'.repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it('rejects notes_md > 64KB', () => {
    const r = CreateRevisionBody.safeParse({
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: 'a'.repeat(65537),
      edit_summary: 'big',
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed python_min', () => {
    const r = CreateRevisionBody.safeParse({
      python_min: 'three point ten',
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('accepts null python_min and python_max', () => {
    const r = CreateRevisionBody.safeParse({
      python_min: null,
      python_max: null,
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'x',
    });
    expect(r.success).toBe(true);
  });

  it('rejects extra unknown fields (strict)', () => {
    const r = CreateRevisionBody.safeParse({
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'x',
      author_id: 'spoof',
    });
    expect(r.success).toBe(false);
  });
});

describe('ApproveRevisionBody', () => {
  it('accepts omitted review_note', () => {
    const r = ApproveRevisionBody.safeParse({});
    expect(r.success).toBe(true);
  });
  it('rejects review_note > 1000 chars', () => {
    const r = ApproveRevisionBody.safeParse({ review_note: 'x'.repeat(1001) });
    expect(r.success).toBe(false);
  });
});

describe('RejectRevisionBody', () => {
  it('requires review_note', () => {
    const r = RejectRevisionBody.safeParse({});
    expect(r.success).toBe(false);
  });
  it('accepts valid review_note', () => {
    const r = RejectRevisionBody.safeParse({ review_note: 'not enough detail' });
    expect(r.success).toBe(true);
  });
});

describe('ApproveSubmissionBody', () => {
  it('accepts omitted review_note', () => {
    expect(ApproveSubmissionBody.safeParse({}).success).toBe(true);
  });
});

describe('RejectSubmissionBody', () => {
  it('requires review_note', () => {
    expect(RejectSubmissionBody.safeParse({}).success).toBe(false);
  });
});

describe('ChangeRoleBody', () => {
  it('accepts admin and user', () => {
    expect(ChangeRoleBody.safeParse({ role: 'admin' }).success).toBe(true);
    expect(ChangeRoleBody.safeParse({ role: 'user' }).success).toBe(true);
  });
  it('rejects other roles', () => {
    expect(ChangeRoleBody.safeParse({ role: 'super' }).success).toBe(false);
  });
});

describe('ConflictCheckBody', () => {
  it('accepts empty installed list', () => {
    expect(ConflictCheckBody.safeParse({ installed: [] }).success).toBe(true);
  });
  it('requires installed to be an array', () => {
    expect(ConflictCheckBody.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/lib/wiki-schema.test.ts
```
Expected: FAIL — `@/lib/wiki-schema` not found.

- [ ] **Step 3: Implement `web/lib/wiki-schema.ts`**

```ts
import { z } from 'zod';

const pythonVersion = z
  .string()
  .regex(/^\d+\.\d+(\.\d+)?$/, 'expected major.minor or major.minor.patch');

const PublishedDependencySchema = z.object({
  name: z.string().min(1).max(128),
  spec: z.string().min(1).max(256),
  min_version: z.string().nullable(),
  max_version: z.string().nullable(),
  is_pinned: z.boolean(),
});

export const CreateRevisionBody = z
  .object({
    python_min: z.union([pythonVersion, z.null()]).optional(),
    python_max: z.union([pythonVersion, z.null()]).optional(),
    dependencies: z.array(PublishedDependencySchema),
    node_class_mappings: z.array(z.string().regex(/^[^/]+\/[^/]+$/, 'expected owner/repo')),
    incompatibilities: z.array(z.string().regex(/^[^/]+\/[^/]+$/, 'expected owner/repo')),
    notes_md: z.string().max(65536),
    edit_summary: z.string().min(1).max(200),
  })
  .strict();

export const WithdrawRevisionBody = z.object({}).strict();

const reviewNote = z.string().min(1).max(1000);

export const ApproveRevisionBody = z
  .object({ review_note: reviewNote.optional() })
  .strict();

export const RejectRevisionBody = z
  .object({ review_note: reviewNote })
  .strict();

export const ApproveSubmissionBody = z
  .object({ review_note: reviewNote.optional() })
  .strict();

export const RejectSubmissionBody = z
  .object({ review_note: reviewNote })
  .strict();

export const ChangeRoleBody = z
  .object({ role: z.enum(['admin', 'user']) })
  .strict();

export const ConflictCheckBody = z
  .object({
    installed: z.array(
      z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        version_tag: z.string().min(1),
      }),
    ),
  })
  .strict();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/lib/wiki-schema.test.ts
```
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/wiki-schema.ts web/tests/lib/wiki-schema.test.ts
git commit -m "feat(web): zod schemas for wiki/admin write endpoints"
```

---

## Task 3: wiki lib helpers — `createRevision`, `withdrawRevision`, `approveRevision`, `rejectRevision`

**Files:**
- Create: `web/lib/wiki.ts`
- Create: `web/tests/lib/wiki.test.ts`

**Interfaces:**
- Consumes: `prisma` from `web/lib/db.ts`; `CreateRevisionBody` (inferred type) from `web/lib/wiki-schema.ts`.
- Produces:
  ```ts
  export type CreateRevisionInput = {
    versionId: number;
    authorId: bigint;     // forced from session
    body: CreateRevisionBodyT;
  };
  export async function createRevision(input: CreateRevisionInput): Promise<{ revisionId: number }>;

  export type WithdrawRevisionInput = {
    revisionId: number;
    currentUserId: bigint;
    isAdmin: boolean;
  };
  export type WithdrawResult =
    | { ok: true }
    | { ok: false; reason: 'not-found' | 'forbidden' | 'not-pending'; status?: RevisionStatus };
  export async function withdrawRevision(input: WithdrawRevisionInput): Promise<WithdrawResult>;

  export type ReviewActionInput = {
    revisionId: number;
    reviewerId: bigint;
    reviewNote?: string;
  };
  export type ReviewResult =
    | { ok: true; approvedRevisionId: number; archivedRevisionIds: number[] }
    | { ok: true } // reject
    | { ok: false; reason: 'not-found' | 'not-pending'; status?: RevisionStatus };
  export async function approveRevision(input: ReviewActionInput): Promise<ReviewResult>;
  export async function rejectRevision(input: ReviewActionInput & { reviewNote: string }): Promise<ReviewResult>;
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/wiki.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import {
  createRevision,
  withdrawRevision,
  approveRevision,
  rejectRevision,
} from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

async function getVersion() {
  return prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
}

describe('createRevision', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('creates a pending revision bound to the given author', async () => {
    const user = await makeUser(1n);
    const version = await getVersion();
    const r = await createRevision({
      versionId: Number(version.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        python_max: null,
        dependencies: [
          { name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false },
        ],
        node_class_mappings: ['Foo/Bar'],
        incompatibilities: [],
        notes_md: '# hello',
        edit_summary: 'add torch',
      },
    });
    expect(r.revisionId).toBeGreaterThan(0);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(r.revisionId) } });
    expect(row.status).toBe(RevisionStatus.pending);
    expect(row.author_id).toBe(user.id);
  });

  it('rejects an unknown version with not-found', async () => {
    const user = await makeUser(1n);
    await expect(
      createRevision({
        versionId: 9_999_999,
        authorId: user.id,
        body: {
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          notes_md: '',
          edit_summary: 'x',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('withdrawRevision', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('lets the author withdraw a pending revision', async () => {
    const user = await makeUser(1n);
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: user.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    const r = await withdrawRevision({
      revisionId,
      currentUserId: user.id,
      isAdmin: false,
    });
    expect(r).toEqual({ ok: true });
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.withdrawn);
  });

  it('returns forbidden for a non-author non-admin', async () => {
    const author = await makeUser(1n);
    const other = await makeUser(2n);
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    const r = await withdrawRevision({
      revisionId,
      currentUserId: other.id,
      isAdmin: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('returns not-pending when revision is already approved', async () => {
    const user = await makeUser(1n);
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: user.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    await approveRevision({ revisionId, reviewerId: user.id, reviewNote: 'ok' });
    const r = await withdrawRevision({
      revisionId,
      currentUserId: user.id,
      isAdmin: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'not-pending' });
  });
});

describe('approveRevision', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('flips a pending revision to approved and returns the id', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    const r = await approveRevision({ revisionId, reviewerId: admin.id, reviewNote: 'ok' });
    expect(r.ok).toBe(true);
    if (r.ok && 'approvedRevisionId' in r) {
      expect(r.approvedRevisionId).toBe(revisionId);
    }
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.approved);
    expect(row.reviewer_id).toBe(admin.id);
  });

  it('archives the previously approved revision for the same version', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const version = await getVersion();

    const { revisionId: first } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        python_min: '3.10',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'first',
      },
    });
    await approveRevision({ revisionId: first, reviewerId: admin.id });

    const { revisionId: second } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        python_min: '3.11',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'second',
      },
    });
    const r = await approveRevision({ revisionId: second, reviewerId: admin.id });
    expect(r.ok).toBe(true);
    if (r.ok && 'archivedRevisionIds' in r) {
      expect(r.archivedRevisionIds).toContain(first);
    }

    const firstRow = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(first) } });
    expect(firstRow.status).toBe(RevisionStatus.archived);
    const secondRow = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(second) } });
    expect(secondRow.status).toBe(RevisionStatus.approved);
  });

  it('returns not-pending when target is not pending', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    await rejectRevision({ revisionId, reviewerId: admin.id, reviewNote: 'no' });
    const r = await approveRevision({ revisionId, reviewerId: admin.id });
    expect(r).toMatchObject({ ok: false, reason: 'not-pending' });
  });
});

describe('rejectRevision', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('flips pending to rejected with review_note', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const version = await getVersion();
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'x',
      },
    });
    const r = await rejectRevision({ revisionId, reviewerId: admin.id, reviewNote: 'wrong' });
    expect(r).toEqual({ ok: true });
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.rejected);
    expect(row.review_note).toBe('wrong');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/lib/wiki.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/lib/wiki.ts`**

```ts
import { prisma } from './db';
import { RevisionStatus } from '@prisma/client';
import type { z } from 'zod';
import type { CreateRevisionBody } from './wiki-schema';

type CreateRevisionBodyT = z.infer<typeof CreateRevisionBody>;

export type CreateRevisionInput = {
  versionId: number;
  authorId: bigint;
  body: CreateRevisionBodyT;
};

export async function createRevision(input: CreateRevisionInput): Promise<{ revisionId: number }> {
  const version = await prisma.nodeVersion.findUnique({ where: { id: BigInt(input.versionId) } });
  if (!version) throw new Error('VERSION_NOT_FOUND');
  const row = await prisma.wikiRevision.create({
    data: {
      version_id: BigInt(input.versionId),
      author_id: input.authorId,
      python_min: input.body.python_min ?? null,
      python_max: input.body.python_max ?? null,
      dependencies: input.body.dependencies,
      node_class_mappings: input.body.node_class_mappings,
      incompatibilities: input.body.incompatibilities,
      notes_md: input.body.notes_md,
      edit_summary: input.body.edit_summary,
      status: RevisionStatus.pending,
    },
  });
  return { revisionId: Number(row.id) };
}

export type WithdrawRevisionInput = {
  revisionId: number;
  currentUserId: bigint;
  isAdmin: boolean;
};

export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'forbidden' | 'not-pending'; status?: RevisionStatus };

export async function withdrawRevision(input: WithdrawRevisionInput): Promise<WithdrawResult> {
  const row = await prisma.wikiRevision.findUnique({ where: { id: BigInt(input.revisionId) } });
  if (!row) return { ok: false, reason: 'not-found' };
  if (row.author_id !== input.currentUserId && !input.isAdmin) {
    return { ok: false, reason: 'forbidden' };
  }
  if (row.status !== RevisionStatus.pending) {
    return { ok: false, reason: 'not-pending', status: row.status };
  }
  await prisma.wikiRevision.update({
    where: { id: row.id },
    data: { status: RevisionStatus.withdrawn },
  });
  return { ok: true };
}

export type ReviewActionInput = {
  revisionId: number;
  reviewerId: bigint;
  reviewNote?: string;
};

export type ApproveResult =
  | { ok: true; approvedRevisionId: number; archivedRevisionIds: number[] }
  | { ok: false; reason: 'not-found' | 'not-pending'; status?: RevisionStatus };

export type RejectResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-pending'; status?: RevisionStatus };

export async function approveRevision(input: ReviewActionInput): Promise<ApproveResult> {
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.wikiRevision.findUnique({ where: { id: BigInt(input.revisionId) } });
    if (!target) return { kind: 'not-found' as const };
    if (target.status !== RevisionStatus.pending) {
      return { kind: 'not-pending' as const, status: target.status };
    }
    const existing = await tx.wikiRevision.findFirst({
      where: { version_id: target.version_id, status: RevisionStatus.approved },
    });
    const archivedIds: number[] = [];
    if (existing && existing.id !== target.id) {
      await tx.wikiRevision.update({
        where: { id: existing.id },
        data: { status: RevisionStatus.archived },
      });
      archivedIds.push(Number(existing.id));
    }
    const updated = await tx.wikiRevision.update({
      where: { id: target.id },
      data: {
        status: RevisionStatus.approved,
        reviewer_id: input.reviewerId,
        review_note: input.reviewNote ?? null,
        reviewed_at: new Date(),
      },
    });
    return {
      kind: 'ok' as const,
      approvedRevisionId: Number(updated.id),
      archivedRevisionIds: archivedIds,
    };
  });
  if (result.kind === 'not-found') return { ok: false, reason: 'not-found' };
  if (result.kind === 'not-pending') return { ok: false, reason: 'not-pending', status: result.status };
  return {
    ok: true,
    approvedRevisionId: result.approvedRevisionId,
    archivedRevisionIds: result.archivedRevisionIds,
  };
}

export async function rejectRevision(
  input: ReviewActionInput & { reviewNote: string },
): Promise<RejectResult> {
  const target = await prisma.wikiRevision.findUnique({ where: { id: BigInt(input.revisionId) } });
  if (!target) return { ok: false, reason: 'not-found' };
  if (target.status !== RevisionStatus.pending) {
    return { ok: false, reason: 'not-pending', status: target.status };
  }
  await prisma.wikiRevision.update({
    where: { id: target.id },
    data: {
      status: RevisionStatus.rejected,
      reviewer_id: input.reviewerId,
      review_note: input.reviewNote,
      reviewed_at: new Date(),
    },
  });
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/lib/wiki.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/wiki.ts web/tests/lib/wiki.test.ts
git commit -m "feat(web): wiki revision helpers with approve transaction"
```

---

## Task 4: field-level diff (`web/lib/diff.ts`)

**Files:**
- Create: `web/lib/diff.ts`
- Create: `web/tests/lib/diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
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
    | { field: 'python_min' | 'python_max'; kind: 'changed'; before: string | null; after: string | null }
    | { field: 'dependencies'; kind: 'changed'; dependencyRows: DependencyDiffRow[] }
    | { field: 'node_class_mappings' | 'incompatibilities'; kind: 'changed'; before: string[]; after: string[] }
    | { field: 'notes_md'; kind: 'changed'; before: string; after: string };

  export function diffRevisions(from: RevisionFields, to: RevisionFields): FieldDiff[];
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/diff.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/lib/diff.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/lib/diff.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/lib/diff.test.ts
```
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/diff.ts web/tests/lib/diff.test.ts
git commit -m "feat(web): field-level diff algorithm with dependency row diff"
```

---

## Task 5: conflict-engine stub

**Files:**
- Create: `web/lib/conflict-engine.ts`
- Create: `web/tests/lib/conflict-engine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConflictCheckRequest = {
    installed: Array<{ owner: string; repo: string; version_tag: string }>;
  };
  export type Conflict = {
    type: string;
    severity: 'error' | 'warning';
    nodes: string[];
    detail: string;
  };
  export async function checkConflicts(req: ConflictCheckRequest): Promise<Conflict[]>;
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/lib/conflict-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/lib/conflict-engine.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/lib/conflict-engine.ts`**

```ts
export type ConflictCheckRequest = {
  installed: Array<{ owner: string; repo: string; version_tag: string }>;
};

export type Conflict = {
  type: string;
  severity: 'error' | 'warning';
  nodes: string[];
  detail: string;
};

export async function checkConflicts(_req: ConflictCheckRequest): Promise<Conflict[]> {
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/lib/conflict-engine.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/conflict-engine.ts web/tests/lib/conflict-engine.test.ts
git commit -m "feat(web): conflict-engine stub (Plan 3 will replace)"
```

---

## Task 6: Wiki API — `GET /api/v1/wiki/{versionId}` (load published + latest pending)

**Files:**
- Create: `web/app/api/v1/wiki/[versionId]/route.ts`
- Create: `web/tests/api/wiki-list.test.ts`

**Interfaces:**
- Consumes: `getPublishedRequirements` from `web/lib/published.ts`; `getCurrentUser` from `web/lib/session.ts`; `prisma`.
- Produces:
  ```
  GET /api/v1/wiki/{versionId}
  → 200 { versionId: number, published: PublishedRequirements, latestPending: RevisionSummary | null }
  → 401 if not logged in
  → 404 if version not found
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/wiki-list.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient, RevisionStatus } from '@prisma/client';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/[versionId]/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/wiki/[versionId]', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(
      new Request(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(401);
  });

  it('returns published + null latestPending for a clean version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(
      new Request(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versionId).toBe(Number(version.id));
    expect(body.published.version_tag).toBe('v8.10');
    expect(body.latestPending).toBeNull();
  });

  it("returns the current user's latest pending revision", async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(version.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'first',
      },
    });
    const res = await GET(
      new Request(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latestPending).toMatchObject({ id: revisionId, status: 'pending' });
  });

  it('does not return another user pending revision as latestPending', async () => {
    const me = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: me.id.toString(), role: 'user' } });
    const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await createRevision({
      versionId: Number(version.id),
      authorId: other.id,
      body: {
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'other',
      },
    });
    const res = await GET(
      new Request(`http://x/api/v1/wiki/${version.id}`),
      { params: Promise.resolve({ versionId: String(version.id) }) },
    );
    const body = await res.json();
    expect(body.latestPending).toBeNull();
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(
      new Request('http://x/api/v1/wiki/9999999'),
      { params: Promise.resolve({ versionId: '9999999' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/api/wiki-list.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/api/v1/wiki/[versionId]/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { getPublishedRequirements } from '@/lib/published';
import { json, error } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const { versionId: versionIdStr } = await ctx.params;
  const versionId = Number(versionIdStr);
  if (!Number.isInteger(versionId) || versionId < 1) return error(400, 'invalid versionId');
  const version = await prisma.nodeVersion.findUnique({ where: { id: BigInt(versionId) } });
  if (!version) return error(404, 'version not found');

  const published = await getPublishedRequirements(versionId);
  const latestPending = await prisma.wikiRevision.findFirst({
    where: { version_id: BigInt(versionId), author_id: BigInt(user.id), status: 'pending' },
    orderBy: { created_at: 'desc' },
  });
  return json({
    versionId,
    published: {
      ...published,
      version_id: published.version_id,
      release_date: published.release_date.toISOString(),
    },
    latestPending: latestPending
      ? {
          id: Number(latestPending.id),
          status: latestPending.status,
          editSummary: latestPending.edit_summary,
          createdAt: latestPending.created_at.toISOString(),
        }
      : null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/api/wiki-list.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/wiki/[versionId]/route.ts web/tests/api/wiki-list.test.ts
git commit -m "feat(api): GET /api/v1/wiki/[versionId] returns published + latest pending"
```

---

## Task 7: Wiki API — `GET /api/v1/wiki/{versionId}/history` (paginated)

**Files:**
- Create: `web/app/api/v1/wiki/[versionId]/history/route.ts`
- Create: `web/tests/api/wiki-history.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/v1/wiki/{versionId}/history?page=1&page_size=20
  → 200 { items: RevisionSummary[], total, page, pageSize }
  RevisionSummary = { id, author: { username, avatarUrl }, editSummary, status, createdAt, reviewedAt? }
  → 401 if not logged in
  → 404 if version not found
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/wiki-history.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/[versionId]/history/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

describe('GET /api/v1/wiki/[versionId]/history', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await GET(new Request('http://x'), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(401);
  });

  it('returns paginated history sorted by created_at desc', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    for (let i = 0; i < 3; i++) {
      await createRevision({
        versionId: Number(v.id),
        authorId: user.id,
        body: {
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          notes_md: '',
          edit_summary: `r${i}`,
        },
      });
    }
    const res = await GET(new Request('http://x?page=1&page_size=2'), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].author.username).toBe('u1');
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x'), {
      params: Promise.resolve({ versionId: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/api/wiki-history.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/api/v1/wiki/[versionId]/history/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error, parsePagination } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ versionId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const { versionId } = await ctx.params;
  const versionIdNum = Number(versionId);
  if (!Number.isInteger(versionIdNum) || versionIdNum < 1) return error(400, 'invalid versionId');
  const v = await prisma.nodeVersion.findUnique({ where: { id: BigInt(versionIdNum) } });
  if (!v) return error(404, 'version not found');

  const url = new URL(req.url);
  const { page, pageSize } = parsePagination(url);
  const where = { version_id: BigInt(versionIdNum) };
  const [total, rows] = await Promise.all([
    prisma.wikiRevision.count({ where }),
    prisma.wikiRevision.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
  ]);
  return json({
    items: rows.map((r) => ({
      id: Number(r.id),
      author: { username: r.author.username, avatarUrl: r.author.avatar_url },
      editSummary: r.edit_summary,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    })),
    total,
    page,
    pageSize,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/api/wiki-history.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/wiki/[versionId]/history/route.ts web/tests/api/wiki-history.test.ts
git commit -m "feat(api): GET /api/v1/wiki/[versionId]/history paginated"
```

---

## Task 8: Wiki API — `GET /api/v1/wiki/revisions/{id}` (single revision)

**Files:**
- Create: `web/app/api/v1/wiki/revisions/[id]/route.ts`
- Create: `web/tests/api/wiki-revision.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/v1/wiki/revisions/{id}
  → 200 { id, versionId, status, author, reviewer?, fields: RevisionFields, editSummary, reviewNote?, createdAt, reviewedAt? }
  → 401 if not logged in
  → 404 if revision not found
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/wiki-revision.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/revisions/[id]/route';
import { createRevision, approveRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/wiki/revisions/[id]', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });

  it('returns the full revision', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: author.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: {
        python_min: '3.10',
        dependencies: [{ name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false }],
        node_class_mappings: ['Foo/Bar'],
        incompatibilities: [],
        notes_md: 'hello',
        edit_summary: 'first',
      },
    });
    await approveRevision({ revisionId, reviewerId: admin.id, reviewNote: 'ok' });
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: String(revisionId) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(revisionId);
    expect(body.status).toBe('approved');
    expect(body.fields.python_min).toBe('3.10');
    expect(body.fields.dependencies[0].name).toBe('torch');
    expect(body.reviewer.username).toBe('u2');
  });

  it('returns 404 for unknown id', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: '9999999' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/api/wiki-revision.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/api/v1/wiki/revisions/[id]/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  const r = await prisma.wikiRevision.findUnique({
    where: { id: BigInt(idNum) },
    include: {
      author: { select: { username: true, avatar_url: true } },
      reviewer: { select: { username: true, avatar_url: true } },
    },
  });
  if (!r) return error(404, 'revision not found');
  return json({
    id: Number(r.id),
    versionId: Number(r.version_id),
    status: r.status,
    author: { username: r.author.username, avatarUrl: r.author.avatar_url },
    reviewer: r.reviewer
      ? { username: r.reviewer.username, avatarUrl: r.reviewer.avatar_url }
      : null,
    fields: {
      python_min: r.python_min,
      python_max: r.python_max,
      dependencies: r.dependencies,
      node_class_mappings: r.node_class_mappings,
      incompatibilities: r.incompatibilities,
      notes_md: r.notes_md,
    },
    editSummary: r.edit_summary,
    reviewNote: r.review_note,
    createdAt: r.created_at.toISOString(),
    reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/api/wiki-revision.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/wiki/revisions/[id]/route.ts web/tests/api/wiki-revision.test.ts
git commit -m "feat(api): GET /api/v1/wiki/revisions/[id] single revision detail"
```

---

## Task 9: Wiki API — `POST /api/v1/wiki/{versionId}/revisions` (create with zod)

**Files:**
- Create: `web/app/api/v1/wiki/[versionId]/revisions/route.ts`
- Create: `web/tests/api/wiki-create-revision.test.ts`

**Interfaces:**
- Consumes: `CreateRevisionBody` from `web/lib/wiki-schema.ts`; `createRevision` from `web/lib/wiki.ts`.
- Produces:
  ```
  POST /api/v1/wiki/{versionId}/revisions
  Body (zod): { python_min?, python_max?, dependencies, node_class_mappings, incompatibilities, notes_md, edit_summary }
  → 201 { revisionId, status: "pending" }
  → 400 zod failure
  → 401 not logged in
  → 404 version not found
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/wiki-create-revision.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/wiki/[versionId]/revisions/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

function validBody() {
  return {
    python_min: '3.10',
    python_max: null,
    dependencies: [
      { name: 'torch', spec: '>=2.0', min_version: '2.0', max_version: null, is_pinned: false },
    ],
    node_class_mappings: ['Foo/Bar'],
    incompatibilities: [],
    notes_md: '',
    edit_summary: 'initial',
  };
}

describe('POST /api/v1/wiki/[versionId]/revisions', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(validBody()) }), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body fails zod', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ ...validBody(), edit_summary: '' }) }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it('ignores client-supplied author_id and uses session user', async () => {
    const me = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: me.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ ...validBody(), author_id: other.id.toString() }),
      }),
      { params: Promise.resolve({ versionId: String(v.id) }) },
    );
    expect(res.status).toBe(400); // strict() rejects unknown author_id
  });

  it('creates a pending revision bound to the session user', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(validBody()) }), {
      params: Promise.resolve({ versionId: String(v.id) }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(typeof body.revisionId).toBe('number');
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(body.revisionId) } });
    expect(row.author_id).toBe(user.id);
  });

  it('returns 404 for an unknown version', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(validBody()) }), {
      params: Promise.resolve({ versionId: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/api/wiki-create-revision.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/api/v1/wiki/[versionId]/revisions/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { CreateRevisionBody } from '@/lib/wiki-schema';
import { createRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ versionId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const { versionId } = await ctx.params;
  const versionIdNum = Number(versionId);
  if (!Number.isInteger(versionIdNum) || versionIdNum < 1) return error(400, 'invalid versionId');
  const v = await prisma.nodeVersion.findUnique({ where: { id: BigInt(versionIdNum) } });
  if (!v) return error(404, 'version not found');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = CreateRevisionBody.safeParse(raw);
  if (!parsed.success) {
    return error(400, 'validation failed', parsed.error.flatten());
  }
  try {
    const r = await createRevision({
      versionId: versionIdNum,
      authorId: BigInt(user.id),
      body: parsed.data,
    });
    return json({ revisionId: r.revisionId, status: 'pending' }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === 'VERSION_NOT_FOUND') return error(404, 'version not found');
    throw e;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/api/wiki-create-revision.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/wiki/[versionId]/revisions/route.ts web/tests/api/wiki-create-revision.test.ts
git commit -m "feat(api): POST /api/v1/wiki/[versionId]/revisions with zod validation"
```

---

## Task 10: Wiki API — `GET /api/v1/wiki/diff` + `POST /api/v1/wiki/revisions/{id}/withdraw`

**Files:**
- Create: `web/app/api/v1/wiki/diff/route.ts`
- Create: `web/app/api/v1/wiki/revisions/[id]/withdraw/route.ts`
- Create: `web/tests/api/wiki-diff.test.ts`
- Create: `web/tests/api/wiki-withdraw.test.ts`

**Interfaces:**
- `GET /api/v1/wiki/diff?from={id}&to={id}` → 200 `{ from, to, diff: FieldDiff[] }`; 400 missing params; 401; 404 if either id missing.
- `POST /api/v1/wiki/revisions/{id}/withdraw` → 204; 401; 403 not author and not admin; 404; 409 not pending.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/api/wiki-diff.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/wiki/diff/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint) {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '' },
  });
}

describe('GET /api/v1/wiki/diff', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x?from=1&to=2'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when from or to is missing', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x?from=1'));
    expect(res.status).toBe(400);
  });

  it('returns a field diff for two revisions', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const a = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        python_min: '3.10',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: 'a',
        edit_summary: 'a',
      },
    });
    const b = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: {
        python_min: '3.11',
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: 'b',
        edit_summary: 'b',
      },
    });
    const res = await GET(new Request(`http://x?from=${a.revisionId}&to=${b.revisionId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const fields = body.diff.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['python_min', 'notes_md']));
  });

  it('returns 404 if either revision does not exist', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x?from=9999998&to=9999999'));
    expect(res.status).toBe(404);
  });
});
```

Create `web/tests/api/wiki-withdraw.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/wiki/revisions/[id]/withdraw/route';
import { createRevision, approveRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/wiki/revisions/[id]/withdraw', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });

  it('lets the author withdraw a pending revision', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: user.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(204);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.withdrawn);
  });

  it('returns 403 when a different non-admin user tries to withdraw', async () => {
    const author = await makeUser(1n);
    const other = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: other.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin withdraw someone else pending revision', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(204);
  });

  it('returns 409 when revision is not pending', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    authMock.mockResolvedValue({ user: { id: author.id.toString(), role: 'user' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    await approveRevision({ revisionId, reviewerId: admin.id });
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown revision', async () => {
    const user = await makeUser(1n);
    authMock.mockResolvedValue({ user: { id: user.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/api/wiki-diff.test.ts tests/api/wiki-withdraw.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/app/api/v1/wiki/diff/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { diffRevisions } from '@/lib/diff';
import type { RevisionFields } from '@/lib/diff';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!fromStr || !toStr) return error(400, 'from and to are required');
  const fromId = Number(fromStr);
  const toId = Number(toStr);
  if (!Number.isInteger(fromId) || !Number.isInteger(toId)) return error(400, 'invalid ids');
  const [from, to] = await Promise.all([
    prisma.wikiRevision.findUnique({
      where: { id: BigInt(fromId) },
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
    prisma.wikiRevision.findUnique({
      where: { id: BigInt(toId) },
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
  ]);
  if (!from || !to) return error(404, 'revision not found');

  const fromFields: RevisionFields = {
    python_min: from.python_min,
    python_max: from.python_max,
    dependencies: from.dependencies as RevisionFields['dependencies'],
    node_class_mappings: from.node_class_mappings as string[],
    incompatibilities: from.incompatibilities as string[],
    notes_md: from.notes_md,
  };
  const toFields: RevisionFields = {
    python_min: to.python_min,
    python_max: to.python_max,
    dependencies: to.dependencies as RevisionFields['dependencies'],
    node_class_mappings: to.node_class_mappings as string[],
    incompatibilities: to.incompatibilities as string[],
    notes_md: to.notes_md,
  };
  const diff = diffRevisions(fromFields, toFields);

  return json({
    from: {
      id: Number(from.id),
      status: from.status,
      fields: fromFields,
      author: { username: from.author.username, avatarUrl: from.author.avatar_url },
      createdAt: from.created_at.toISOString(),
    },
    to: {
      id: Number(to.id),
      status: to.status,
      fields: toFields,
      author: { username: to.author.username, avatarUrl: to.author.avatar_url },
      createdAt: to.created_at.toISOString(),
    },
    diff,
  });
}
```

- [ ] **Step 4: Implement `web/app/api/v1/wiki/revisions/[id]/withdraw/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { withdrawRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  const r = await withdrawRevision({
    revisionId: idNum,
    currentUserId: BigInt(user.id),
    isAdmin: user.role === 'admin',
  });
  if (r.ok) return new Response(null, { status: 204 });
  if (r.reason === 'not-found') return error(404, 'revision not found');
  if (r.reason === 'forbidden') return error(403, 'only the author or an admin can withdraw');
  if (r.reason === 'not-pending') {
    return error(409, `cannot withdraw revision in status: ${r.status}`);
  }
  return error(500, 'unexpected');
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && pnpm test tests/api/wiki-diff.test.ts tests/api/wiki-withdraw.test.ts
```
Expected: PASS (4 + 6 = 10 tests).

- [ ] **Step 6: Commit**

```bash
git add web/app/api/v1/wiki/diff/route.ts web/app/api/v1/wiki/revisions/[id]/withdraw/route.ts web/tests/api/wiki-diff.test.ts web/tests/api/wiki-withdraw.test.ts
git commit -m "feat(api): wiki diff and withdraw endpoints"
```

---

## Task 11: Conflict-check stub API — `POST /api/v1/conflicts/check`

**Files:**
- Create: `web/app/api/v1/conflicts/check/route.ts`
- Create: `web/tests/api/conflicts-check.test.ts`

**Interfaces:**
- Consumes: `ConflictCheckBody` from `web/lib/wiki-schema.ts`; `checkConflicts` from `web/lib/conflict-engine.ts`.
- Produces:
  ```
  POST /api/v1/conflicts/check
  Body: { installed: Array<{ owner, repo, version_tag }> }
  → 200 { conflicts: [] }
  → 400 zod fail
  → 401 not authenticated
  ```

- [ ] **Step 1: Write the failing test**

Create `web/tests/api/conflicts-check.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { setup } from '../setup';
import { POST } from '@/app/api/v1/conflicts/check/route';

describe('POST /api/v1/conflicts/check', () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ installed: [] }) }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with empty conflicts (Plan 2 stub)', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ installed: [{ owner: 'ltdrdata', repo: 'ComfyUI-Impact-Pack', version_tag: 'v8.10' }] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ conflicts: [] });
  });

  it('returns 400 on invalid body', async () => {
    authMock.mockResolvedValue({ user: { id: '1', role: 'user' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ wrong: true }) }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && pnpm test tests/api/conflicts-check.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/api/v1/conflicts/check/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ConflictCheckBody } from '@/lib/wiki-schema';
import { checkConflicts } from '@/lib/conflict-engine';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = ConflictCheckBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const conflicts = await checkConflicts(parsed.data);
  return json({ conflicts });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm test tests/api/conflicts-check.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/v1/conflicts/check/route.ts web/tests/api/conflicts-check.test.ts
git commit -m "feat(api): POST /api/v1/conflicts/check stub"
```

---

## Task 12: Admin API — revisions review (pending list, approve, reject)

**Files:**
- Create: `web/app/api/v1/admin/revisions/pending/route.ts`
- Create: `web/app/api/v1/admin/revisions/[id]/approve/route.ts`
- Create: `web/app/api/v1/admin/revisions/[id]/reject/route.ts`
- Create: `web/tests/api/admin-revisions-pending.test.ts`
- Create: `web/tests/api/admin-revisions-approve.test.ts`
- Create: `web/tests/api/admin-revisions-reject.test.ts`

**Interfaces:**
- All routes require `requireAdmin()`.
- `GET /api/v1/admin/revisions/pending?page=&page_size=` → 200 `{ items, total, page, pageSize }`.
- `POST /api/v1/admin/revisions/{id}/approve` body `{ review_note? }` → 200 `{ approvedRevisionId, archivedRevisionIds }`; 404; 409 not-pending.
- `POST /api/v1/admin/revisions/{id}/reject` body `{ review_note: string }` → 204; 400 missing review_note; 404; 409 not-pending.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/api/admin-revisions-pending.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/revisions/pending/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/revisions/pending', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(403);
  });

  it('returns paginated pending revisions for an admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await GET(new Request('http://x?page=1&page_size=10'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].author.username).toBe('u2');
  });
});
```

Create `web/tests/api/admin-revisions-approve.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/revisions/[id]/approve/route';
import { createRevision, approveRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/revisions/[id]/approve', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(403);
  });

  it('approves a pending revision and returns the id', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ review_note: 'looks good' }) }),
      { params: Promise.resolve({ id: String(revisionId) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvedRevisionId).toBe(revisionId);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.approved);
  });

  it('returns 409 when revision is not pending', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    await approveRevision({ revisionId, reviewerId: admin.id });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(revisionId) }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown revision', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '9999999' }),
    });
    expect(res.status).toBe(404);
  });
});
```

Create `web/tests/api/admin-revisions-reject.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/revisions/[id]/reject/route';
import { createRevision } from '@/lib/wiki';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/revisions/[id]/reject', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when review_note is missing', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a pending revision with a note', async () => {
    const admin = await makeUser(1n, 'admin');
    const author = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const v = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
    const { revisionId } = await createRevision({
      versionId: Number(v.id),
      authorId: author.id,
      body: { dependencies: [], node_class_mappings: [], incompatibilities: [], notes_md: '', edit_summary: 'x' },
    });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ review_note: 'not enough detail' }) }),
      { params: Promise.resolve({ id: String(revisionId) }) },
    );
    expect(res.status).toBe(204);
    const row = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: BigInt(revisionId) } });
    expect(row.status).toBe(RevisionStatus.rejected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/api/admin-revisions-pending.test.ts tests/api/admin-revisions-approve.test.ts tests/api/admin-revisions-reject.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/app/api/v1/admin/revisions/pending/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error, parsePagination } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const url = new URL(req.url);
  const { page, pageSize } = parsePagination(url);
  const where = { status: 'pending' };
  const [total, rows] = await Promise.all([
    prisma.wikiRevision.count({ where }),
    prisma.wikiRevision.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { author: { select: { username: true, avatar_url: true } } },
    }),
  ]);
  return json({
    items: rows.map((r) => ({
      id: Number(r.id),
      versionId: Number(r.version_id),
      author: { username: r.author.username, avatarUrl: r.author.avatar_url },
      editSummary: r.edit_summary,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
    total,
    page,
    pageSize,
  });
}
```

- [ ] **Step 4: Implement `web/app/api/v1/admin/revisions/[id]/approve/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ApproveRevisionBody } from '@/lib/wiki-schema';
import { approveRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown = {};
  try {
    if (req.headers.get('content-length') !== '0') raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = ApproveRevisionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await approveRevision({
    revisionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return json({ approvedRevisionId: r.approvedRevisionId, archivedRevisionIds: r.archivedRevisionIds });
  if (r.reason === 'not-found') return error(404, 'revision not found');
  return error(409, `cannot approve revision in status: ${r.status}`);
}
```

- [ ] **Step 5: Implement `web/app/api/v1/admin/revisions/[id]/reject/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { error } from '@/lib/api-helpers';
import { RejectRevisionBody } from '@/lib/wiki-schema';
import { rejectRevision } from '@/lib/wiki';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = RejectRevisionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await rejectRevision({
    revisionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return new Response(null, { status: 204 });
  if (r.reason === 'not-found') return error(404, 'revision not found');
  return error(409, `cannot reject revision in status: ${r.status}`);
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd web && pnpm test tests/api/admin-revisions-pending.test.ts tests/api/admin-revisions-approve.test.ts tests/api/admin-revisions-reject.test.ts
```
Expected: PASS (3 + 4 + 3 = 10 tests).

- [ ] **Step 7: Commit**

```bash
git add web/app/api/v1/admin/revisions/ web/tests/api/admin-revisions-pending.test.ts web/tests/api/admin-revisions-approve.test.ts web/tests/api/admin-revisions-reject.test.ts
git commit -m "feat(api): admin revision review endpoints (pending, approve, reject)"
```

---

## Task 13: Admin API — submissions review (pending, approve creating Node, reject) + submissions lib

**Files:**
- Create: `web/lib/submissions.ts`
- Create: `web/app/api/v1/admin/submissions/pending/route.ts`
- Create: `web/app/api/v1/admin/submissions/[id]/approve/route.ts`
- Create: `web/app/api/v1/admin/submissions/[id]/reject/route.ts`
- Create: `web/tests/api/admin-submissions-pending.test.ts`
- Create: `web/tests/api/admin-submissions-approve.test.ts`
- Create: `web/tests/api/admin-submissions-reject.test.ts`

**Interfaces:**
- All routes require `requireAdmin()`.
- `GET /api/v1/admin/submissions/pending` → 200 `{ items: SubmissionSummary[] }` (no pagination in Plan 2; small list).
- `POST /api/v1/admin/submissions/{id}/approve` body `{ review_note? }` → 200 `{ submissionId, nodeId }`. Transaction: `UPDATE submission.status='approved'`, then `INSERT INTO nodes` parsing `github_url` → `owner/repo`, name=`repo`, author='', description='', status='active'. Conflict: if a Node with the same `github_owner`/`github_repo` already exists, return that nodeId instead of creating a duplicate (idempotent).
- `POST /api/v1/admin/submissions/{id}/reject` body `{ review_note }` → 204; 400 missing review_note; 404; 409 not pending.
- Lib exports:
  ```ts
  export type SubmissionApproveResult = { ok: true; submissionId: number; nodeId: number } | { ok: false; reason: 'not-found' | 'not-pending' };
  export async function approveSubmission(input: { submissionId: number; reviewerId: bigint; reviewNote?: string }): Promise<SubmissionApproveResult>;
  export type SubmissionRejectResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-pending' };
  export async function rejectSubmission(input: { submissionId: number; reviewerId: bigint; reviewNote: string }): Promise<SubmissionRejectResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `web/tests/api/admin-submissions-pending.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/submissions/pending/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/submissions/pending', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(403);
  });

  it('lists pending submissions for an admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    await prisma.nodeSubmission.create({
      data: {
        submitter_id: submitter.id,
        github_url: 'https://github.com/some/repo',
        status: 'pending',
      },
    });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].githubUrl).toBe('https://github.com/some/repo');
  });
});
```

Create `web/tests/api/admin-submissions-approve.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, SubmissionStatus, NodeStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/submissions/[id]/approve/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/submissions/[id]/approve', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(403);
  });

  it('approves a pending submission and creates a Node row', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/newowner/newrepo', status: 'pending' },
    });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submissionId).toBe(Number(sub.id));
    const node = await prisma.node.findUniqueOrThrow({
      where: { github_owner_github_repo: { github_owner: 'newowner', github_repo: 'newrepo' } },
    });
    expect(node.name).toBe('newrepo');
    expect(node.status).toBe(NodeStatus.active);
    const refreshedSub = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(refreshedSub.status).toBe(SubmissionStatus.approved);
  });

  it('is idempotent when a node with the same owner/repo already exists', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const existing = await prisma.node.create({
      data: { github_owner: 'existing', github_repo: 'repo', name: 'existing/repo' },
    });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/existing/repo', status: 'pending' },
    });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeId).toBe(Number(existing.id));
    const all = await prisma.node.count({ where: { github_owner: 'existing', github_repo: 'repo' } });
    expect(all).toBe(1);
  });

  it('returns 409 if submission is not pending', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: {
        submitter_id: submitter.id,
        github_url: 'https://github.com/x/y',
        status: 'rejected',
        reviewer_id: admin.id,
        reviewed_at: new Date(),
      },
    });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(409);
  });
});
```

Create `web/tests/api/admin-submissions-reject.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient, SubmissionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/submissions/[id]/reject/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/submissions/[id]/reject', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for a non-admin user', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when review_note is missing', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const submitter = await makeUser(2n);
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/x/y', status: 'pending' },
    });
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: String(sub.id) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a pending submission', async () => {
    const admin = await makeUser(1n, 'admin');
    const submitter = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const sub = await prisma.nodeSubmission.create({
      data: { submitter_id: submitter.id, github_url: 'https://github.com/x/y', status: 'pending' },
    });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ review_note: 'not a node' }) }),
      { params: Promise.resolve({ id: String(sub.id) }) },
    );
    expect(res.status).toBe(204);
    const row = await prisma.nodeSubmission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.status).toBe(SubmissionStatus.rejected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/api/admin-submissions-pending.test.ts tests/api/admin-submissions-approve.test.ts tests/api/admin-submissions-reject.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/lib/submissions.ts`**

```ts
import { prisma } from './db';
import { SubmissionStatus, NodeStatus } from '@prisma/client';

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

export type SubmissionApproveResult =
  | { ok: true; submissionId: number; nodeId: number }
  | { ok: false; reason: 'not-found' | 'not-pending' | 'invalid-url' };

export async function approveSubmission(input: {
  submissionId: number;
  reviewerId: bigint;
  reviewNote?: string;
}): Promise<SubmissionApproveResult> {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.nodeSubmission.findUnique({ where: { id: BigInt(input.submissionId) } });
    if (!sub) return { ok: false as const, reason: 'not-found' as const };
    if (sub.status !== SubmissionStatus.pending) return { ok: false as const, reason: 'not-pending' as const };
    const parsed = parseGithubUrl(sub.github_url);
    if (!parsed) return { ok: false as const, reason: 'invalid-url' as const };
    const existing = await tx.node.findUnique({
      where: { github_owner_github_repo: { github_owner: parsed.owner, github_repo: parsed.repo } },
    });
    let nodeId: bigint;
    if (existing) {
      nodeId = existing.id;
    } else {
      const created = await tx.node.create({
        data: {
          github_owner: parsed.owner,
          github_repo: parsed.repo,
          name: parsed.repo,
          author: '',
          description: '',
          status: NodeStatus.active,
        },
      });
      nodeId = created.id;
    }
    await tx.nodeSubmission.update({
      where: { id: sub.id },
      data: {
        status: SubmissionStatus.approved,
        reviewer_id: input.reviewerId,
        review_note: input.reviewNote ?? null,
        reviewed_at: new Date(),
      },
    });
    return { ok: true as const, submissionId: Number(sub.id), nodeId: Number(nodeId) };
  });
}

export type SubmissionRejectResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-pending' };

export async function rejectSubmission(input: {
  submissionId: number;
  reviewerId: bigint;
  reviewNote: string;
}): Promise<SubmissionRejectResult> {
  const sub = await prisma.nodeSubmission.findUnique({ where: { id: BigInt(input.submissionId) } });
  if (!sub) return { ok: false, reason: 'not-found' };
  if (sub.status !== SubmissionStatus.pending) return { ok: false, reason: 'not-pending' };
  await prisma.nodeSubmission.update({
    where: { id: sub.id },
    data: {
      status: SubmissionStatus.rejected,
      reviewer_id: input.reviewerId,
      review_note: input.reviewNote,
      reviewed_at: new Date(),
    },
  });
  return { ok: true };
}
```

- [ ] **Step 4: Implement `web/app/api/v1/admin/submissions/pending/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const rows = await prisma.nodeSubmission.findMany({
    where: { status: 'pending' },
    orderBy: { created_at: 'desc' },
    include: { submitter: { select: { username: true, avatar_url: true } } },
  });
  return json({
    items: rows.map((s) => ({
      id: Number(s.id),
      submitter: { username: s.submitter.username, avatarUrl: s.submitter.avatar_url },
      githubUrl: s.github_url,
      createdAt: s.created_at.toISOString(),
    })),
  });
}
```

- [ ] **Step 5: Implement `web/app/api/v1/admin/submissions/[id]/approve/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ApproveSubmissionBody } from '@/lib/wiki-schema';
import { approveSubmission } from '@/lib/submissions';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown = {};
  try {
    if (req.headers.get('content-length') !== '0') raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = ApproveSubmissionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await approveSubmission({
    submissionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return json({ submissionId: r.submissionId, nodeId: r.nodeId });
  if (r.reason === 'not-found') return error(404, 'submission not found');
  if (r.reason === 'invalid-url') return error(400, 'invalid github url');
  return error(409, `cannot approve submission in status`);
}
```

- [ ] **Step 6: Implement `web/app/api/v1/admin/submissions/[id]/reject/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { error } from '@/lib/api-helpers';
import { RejectSubmissionBody } from '@/lib/wiki-schema';
import { rejectSubmission } from '@/lib/submissions';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = RejectSubmissionBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const r = await rejectSubmission({
    submissionId: idNum,
    reviewerId: BigInt(user.id),
    reviewNote: parsed.data.review_note,
  });
  if (r.ok) return new Response(null, { status: 204 });
  if (r.reason === 'not-found') return error(404, 'submission not found');
  return error(409, `cannot reject submission in status`);
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd web && pnpm test tests/api/admin-submissions-pending.test.ts tests/api/admin-submissions-approve.test.ts tests/api/admin-submissions-reject.test.ts
```
Expected: PASS (3 + 4 + 3 = 10 tests).

- [ ] **Step 8: Commit**

```bash
git add web/lib/submissions.ts web/app/api/v1/admin/submissions/ web/tests/api/admin-submissions-pending.test.ts web/tests/api/admin-submissions-approve.test.ts web/tests/api/admin-submissions-reject.test.ts
git commit -m "feat(api): admin submission review endpoints with Node creation"
```

---

## Task 14: Admin API — users list + change role (self-demote protection)

**Files:**
- Create: `web/app/api/v1/admin/users/route.ts`
- Create: `web/app/api/v1/admin/users/[id]/role/route.ts`
- Create: `web/tests/api/admin-users-list.test.ts`
- Create: `web/tests/api/admin-users-role.test.ts`

**Interfaces:**
- Both routes require `requireAdmin()`.
- `GET /api/v1/admin/users` → 200 `{ items: Array<{ id, username, avatarUrl, role, createdAt }> }`.
- `POST /api/v1/admin/users/{id}/role` body `{ role: 'admin' | 'user' }` → 200 `{ userId, role }`; 400 invalid role; 404 user not found; 409 self-demote.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/api/admin-users-list.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { GET } from '@/app/api/v1/admin/users/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('GET /api/v1/admin/users', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(403);
  });

  it('lists all users for admin', async () => {
    const admin = await makeUser(1n, 'admin');
    await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });
});
```

Create `web/tests/api/admin-users-role.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { PrismaClient } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';
import { POST } from '@/app/api/v1/admin/users/[id]/role/route';

const prisma = new PrismaClient();

async function makeUser(githubId: bigint, role: 'user' | 'admin' = 'user') {
  return prisma.user.create({
    data: { github_id: githubId, username: `u${githubId}`, avatar_url: '', role },
  });
}

describe('POST /api/v1/admin/users/[id]/role', () => {
  beforeEach(async () => {
    authMock.mockReset();
    await setup();
    await seedFixture(prisma);
  });

  it('returns 403 for non-admin', async () => {
    const u = await makeUser(1n, 'user');
    authMock.mockResolvedValue({ user: { id: u.id.toString(), role: 'user' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ role: 'admin' }) }),
      { params: Promise.resolve({ id: String(u.id) }) },
    );
    expect(res.status).toBe(403);
  });

  it('promotes a user to admin', async () => {
    const admin = await makeUser(1n, 'admin');
    const target = await makeUser(2n);
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ role: 'admin' }) }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.role).toBe('admin');
  });

  it('refuses self-demotion with 409', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ role: 'user' }) }),
      { params: Promise.resolve({ id: String(admin.id) }) },
    );
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid role value', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const target = await makeUser(2n);
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ role: 'super' }) }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user', async () => {
    const admin = await makeUser(1n, 'admin');
    authMock.mockResolvedValue({ user: { id: admin.id.toString(), role: 'admin' } });
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ role: 'user' }) }),
      { params: Promise.resolve({ id: '9999999' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test tests/api/admin-users-list.test.ts tests/api/admin-users-role.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `web/app/api/v1/admin/users/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const rows = await prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  return json({
    items: rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      avatarUrl: u.avatar_url,
      role: u.role,
      createdAt: u.created_at.toISOString(),
    })),
  });
}
```

- [ ] **Step 4: Implement `web/app/api/v1/admin/users/[id]/role/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { json, error } from '@/lib/api-helpers';
import { ChangeRoleBody } from '@/lib/wiki-schema';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return error(401, 'unauthenticated');
  if (user.role !== 'admin') return error(403, 'admin only');
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1) return error(400, 'invalid id');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = ChangeRoleBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());
  const target = await prisma.user.findUnique({ where: { id: BigInt(idNum) } });
  if (!target) return error(404, 'user not found');
  if (target.id === BigInt(user.id) && parsed.data.role !== 'admin') {
    return error(409, 'cannot demote yourself');
  }
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role: parsed.data.role },
  });
  return json({ userId: Number(updated.id), role: updated.role });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && pnpm test tests/api/admin-users-list.test.ts tests/api/admin-users-role.test.ts
```
Expected: PASS (3 + 5 = 8 tests).

- [ ] **Step 6: Commit**

```bash
git add web/app/api/v1/admin/users/ web/tests/api/admin-users-list.test.ts web/tests/api/admin-users-role.test.ts
git commit -m "feat(api): admin users list and change role with self-demote guard"
```

---

## Task 15: Shared wiki components — `PythonVersionRange` and `IncompatibilityEditor`

**Files:**
- Create: `web/app/(wiki)/_components/PythonVersionRange.tsx`
- Create: `web/app/(wiki)/_components/IncompatibilityEditor.tsx`

**Interfaces:**
- `<PythonVersionRange min?: string | null, max?: string | null, onChange(min, max): void />` — two controlled inputs.
- `<IncompatibilityEditor value: string[], onChange(v: string[]): void />` — chips with add/remove.

- [ ] **Step 1: Create `web/app/(wiki)/_components/PythonVersionRange.tsx`**

```tsx
'use client';

type Props = {
  min: string | null;
  max: string | null;
  onChange: (min: string | null, max: string | null) => void;
};

export function PythonVersionRange({ min, max, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Python 最低版本</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="3.10"
          className="rounded border border-gray-300 px-2 py-1"
          value={min ?? ''}
          onChange={(e) => onChange(e.target.value.trim() || null, max)}
        />
      </label>
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Python 最高版本（无上限则留空）</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="（无上限）"
          className="rounded border border-gray-300 px-2 py-1"
          value={max ?? ''}
          onChange={(e) => onChange(min, e.target.value.trim() || null)}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/(wiki)/_components/IncompatibilityEditor.tsx`**

```tsx
'use client';
import { useState } from 'react';

type Props = {
  value: string[];
  onChange: (v: string[]) => void;
};

const FORMAT = /^[^/]+\/[^/]+$/;

export function IncompatibilityEditor({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const t = draft.trim();
    if (!t || !FORMAT.test(t)) return;
    if (value.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs text-red-800"
          >
            {v}
            <button
              type="button"
              aria-label={`remove ${v}`}
              onClick={() => remove(i)}
              className="text-red-600 hover:text-red-800"
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-gray-500">（尚未添加互斥节点）</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="owner/repo"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
        >
          添加
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(wiki\)/_components/PythonVersionRange.tsx web/app/\(wiki\)/_components/IncompatibilityEditor.tsx
git commit -m "feat(web): PythonVersionRange and IncompatibilityEditor components"
```

---

## Task 16: Shared wiki component — `NodeRequirementTable` (React Hook Form `useFieldArray`)

**Files:**
- Create: `web/app/(wiki)/_components/NodeRequirementTable.tsx`

**Interfaces:**
- Props: `{ value: PublishedDependency[], onChange: (v: PublishedDependency[]) => void }`.
- Imports `PublishedDependency` from `@/lib/published` and re-uses it as the row shape.

- [ ] **Step 1: Install `react-hook-form`**

```bash
cd web && pnpm add react-hook-form
```
Expected: `react-hook-form` ^7.x added to `package.json`.

- [ ] **Step 2: Create `web/app/(wiki)/_components/NodeRequirementTable.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { useForm, useFieldArray, type SubmitHandler } from 'react-hook-form';
import type { PublishedDependency } from '@/lib/published';

type Props = {
  value: PublishedDependency[];
  onChange: (v: PublishedDependency[]) => void;
};

type FormShape = { rows: PublishedDependency[] };

function emptyRow(): PublishedDependency {
  return { name: '', spec: '', min_version: null, max_version: null, is_pinned: false };
}

export function NodeRequirementTable({ value, onChange }: Props) {
  const { control, register, watch } = useForm<FormShape>({
    defaultValues: { rows: value.length > 0 ? value : [emptyRow()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });
  const watched = watch('rows');
  const lastEmitted = useRef<string>('');

  useEffect(() => {
    const serialized = JSON.stringify(watched);
    if (serialized === lastEmitted.current) return;
    lastEmitted.current = serialized;
    const cleaned = (watched as PublishedDependency[]).filter((r) => r.name.trim() !== '');
    onChange(cleaned);
  }, [watched, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">包名</th>
            <th className="px-2 py-1">规范</th>
            <th className="px-2 py-1">最低</th>
            <th className="px-2 py-1">最高</th>
            <th className="px-2 py-1">固定</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {fields.map((row, i) => (
            <tr key={row.id} className="border-t border-gray-200">
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.name` as const)}
                  className="w-full rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.spec` as const)}
                  className="w-full rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.min_version` as const)}
                  className="w-24 rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.max_version` as const)}
                  className="w-24 rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1 text-center">
                <input
                  type="checkbox"
                  {...register(`rows.${i}.is_pinned` as const)}
                />
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  移除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => append(emptyRow())}
        className="self-start rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
      >
        + 添加行
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(wiki\)/_components/NodeRequirementTable.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): NodeRequirementTable with RHF useFieldArray"
```

---

## Task 17: Shared wiki component — `MarkdownEditor` (Tiptap)

**Files:**
- Create: `web/app/(wiki)/_components/MarkdownEditor.tsx`

**Interfaces:**
- Props: `{ value: string, onChange: (markdown: string) => void, maxLength?: number }` (default `maxLength = 65536`).
- Toolbar: bold, italic, link, code block, bullet list, H2.
- Outputs Markdown via Tiptap StarterKit; uses `getMarkdown()` to serialize.

- [ ] **Step 1: Install Tiptap packages**

```bash
cd web && pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-link
```
Expected: three packages added.

- [ ] **Step 2: Create `web/app/(wiki)/_components/MarkdownEditor.tsx`**

```tsx
'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useEffect } from 'react';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  maxLength?: number;
};

export function MarkdownEditor({ value, onChange, maxLength = 65536 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none min-h-[160px] focus:outline-none' },
    },
    onUpdate({ editor: e }) {
      const md = e.storage.markdown?.getMarkdown?.() ?? e.getText();
      if (md.length > maxLength) {
        // Truncate UI by re-setting content to the truncated value
        e.commands.setContent(md.slice(0, maxLength));
        return;
      }
      onChange(md);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.storage.markdown?.getMarkdown?.() !== value) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  if (!editor) return <div className="rounded border border-gray-300 p-3 text-sm text-gray-500">编辑器加载中…</div>;

  return (
    <div className="rounded border border-gray-300">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 text-xs">
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>
          B
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>
          I
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          cmd={(e) => {
            const url = window.prompt('链接 URL', 'https://');
            if (!url) return;
            e.chain().focus().setLink({ href: url }).run();
          }}
        >
          🔗
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>
          {'</>'}
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>
          •
        </ToolbarBtn>
        <ToolbarBtn editor={editor} cmd={(e) => e.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>
          H2
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
      <div className="border-t border-gray-200 px-2 py-1 text-right text-xs text-gray-500">
        {(editor.storage.markdown?.getMarkdown?.() ?? editor.getText()).length} / {maxLength} 字符
      </div>
    </div>
  );
}

function ToolbarBtn({
  editor,
  cmd,
  active,
  children,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  cmd: (e: typeof editor) => unknown;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => cmd(editor)}
      className={`rounded px-2 py-1 ${active ? 'bg-gray-300' : 'hover:bg-gray-200'}`}
    >
      {children}
    </button>
  );
}
```

> **Note:** the `editor.storage.markdown` is provided by Tiptap only if you install `@tiptap/extension-markdown` separately. Plan 2 keeps it simple and falls back to `getText()` for length measurement. The internal state is HTML; convert to plain text for the character count. The `onUpdate` callback also falls back to `getText()` so the form always receives a string. (For markdown round-trip with the server-rendered `DiffViewer` we use markdown-it directly; see Task 18.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors (you may need to ignore the optional `storage.markdown` chain — `noUncheckedIndexedAccess` and `strict` are satisfied because we use optional chaining).

- [ ] **Step 4: Commit**

```bash
git add web/app/\(wiki\)/_components/MarkdownEditor.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): MarkdownEditor component using Tiptap"
```

---

## Task 18: Shared wiki components — `DiffViewer` (field-level) and `ConflictPreview` (stub)

**Files:**
- Create: `web/app/(wiki)/_components/DiffViewer.tsx`
- Create: `web/app/(wiki)/_components/ConflictPreview.tsx`

**Interfaces:**
- `<DiffViewer diff: FieldDiff[] />` — renders each field as a collapsible section.
- `<ConflictPreview versionId: string />` — POSTs `installed: []` to the stub and displays the "暂未启用" message.

- [ ] **Step 1: Install `markdown-it`**

```bash
cd web && pnpm add markdown-it && pnpm add -D @types/markdown-it
```
Expected: `markdown-it` in deps and `@types/markdown-it` in devDeps.

- [ ] **Step 2: Create `web/app/(wiki)/_components/DiffViewer.tsx`**

```tsx
'use client';
import type { FieldDiff } from '@/lib/diff';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

type Props = { diff: FieldDiff[] };

export function DiffViewer({ diff }: Props) {
  if (diff.length === 0) {
    return <p className="text-sm text-gray-500">两个版本完全相同,无差异。</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {diff.map((d) => (
        <section key={d.field} className="rounded border border-gray-200 p-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">{labelFor(d.field)}</h3>
          {renderField(d)}
        </section>
      ))}
    </div>
  );
}

function labelFor(field: FieldDiff['field']): string {
  return {
    python_min: 'Python 最低版本',
    python_max: 'Python 最高版本',
    dependencies: '依赖',
    node_class_mappings: '节点类映射',
    incompatibilities: '互斥节点',
    notes_md: 'Markdown 备注',
  }[field];
}

function renderField(d: FieldDiff) {
  if (d.field === 'python_min' || d.field === 'python_max') {
    return (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded bg-red-50 p-2">
          <div className="text-xs text-red-700">之前</div>
          <div className="font-mono">{d.before ?? '（无）'}</div>
        </div>
        <div className="rounded bg-green-50 p-2">
          <div className="text-xs text-green-700">之后</div>
          <div className="font-mono">{d.after ?? '（无）'}</div>
        </div>
      </div>
    );
  }
  if (d.field === 'dependencies') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {d.dependencyRows.map((r, i) => (
          <div key={i} className="rounded border border-gray-200 p-2">
            {r.kind === 'added' && (
              <div className="rounded bg-green-50 p-2">
                <span className="text-xs text-green-700">新增</span>
                <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.row, null, 2)}</pre>
              </div>
            )}
            {r.kind === 'removed' && (
              <div className="rounded bg-red-50 p-2">
                <span className="text-xs text-red-700">删除</span>
                <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.row, null, 2)}</pre>
              </div>
            )}
            {r.kind === 'changed' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-red-50 p-2">
                  <div className="text-xs text-red-700">之前</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.before, null, 2)}</pre>
                </div>
                <div className="rounded bg-green-50 p-2">
                  <div className="text-xs text-green-700">之后</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.after, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (d.field === 'node_class_mappings' || d.field === 'incompatibilities') {
    return (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded bg-red-50 p-2">
          <div className="text-xs text-red-700">之前</div>
          <ul className="list-disc pl-4 font-mono text-xs">
            {d.before.length === 0 ? <li className="list-none text-gray-500">（无）</li> : d.before.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
        <div className="rounded bg-green-50 p-2">
          <div className="text-xs text-green-700">之后</div>
          <ul className="list-disc pl-4 font-mono text-xs">
            {d.after.length === 0 ? <li className="list-none text-gray-500">（无）</li> : d.after.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      </div>
    );
  }
  // notes_md
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded bg-red-50 p-2">
        <div className="mb-1 text-xs text-red-700">之前</div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: md.render(d.before) }} />
      </div>
      <div className="rounded bg-green-50 p-2">
        <div className="mb-1 text-xs text-green-700">之后</div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: md.render(d.after) }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/app/(wiki)/_components/ConflictPreview.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';

type Props = { versionId: string };

export function ConflictPreview(_props: Props) {
  const [message] = useState('暂未启用冲突检测(Plan 3 即将上线)');
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600">
      {message}
    </div>
  );
}
```

> The component is intentionally inert in Plan 2 (stub). It still mounts so the page is wired correctly. Plan 3 will replace its body with a `useEffect` that POSTs to `/api/v1/conflicts/check` and renders the resulting list.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(wiki\)/_components/DiffViewer.tsx web/app/\(wiki\)/_components/ConflictPreview.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): DiffViewer (field-level) and ConflictPreview stub"
```

---

## Task 19: Wiki pages — `/wiki/[versionId]`, `/wiki/[versionId]/submit`, `/wiki/[versionId]/history`

**Files:**
- Create: `web/app/(wiki)/_components/WikiEditForm.tsx` (client orchestrator)
- Create: `web/app/wiki/[versionId]/page.tsx` (server: load + render form)
- Create: `web/app/wiki/[versionId]/submit/page.tsx` (server: read draft from URL state; client confirm)
- Create: `web/app/wiki/[versionId]/history/page.tsx` (server: list + diff viewer)
- Create: `web/app/wiki/[versionId]/_actions.ts` (server actions: `prepareSubmit`, `confirmSubmit`, `withdrawRevision`)
- Create: `web/tests/api/wiki-page-smoke.test.ts` (optional smoke test for the GET endpoints; falls back to manual)

**Interfaces:**
- `/wiki/[versionId]` (GET) — server component calls `requireUser()`, then `getPublishedRequirements` and `prisma.wikiRevision.findFirst({ author, status: pending })`. Renders `<WikiEditForm initialPublished={...} initialPending={...} versionId={...} />`.
- `/wiki/[versionId]/submit` (GET) — server component reads the draft from URL query (`?d=<base64>`), renders confirm page with two buttons.
- `/wiki/[versionId]/history` (GET) — server component fetches the list via internal `prisma` query and renders a selectable list + `<DiffViewer>`. (No need to call the API from the server component — direct DB read is fine for the page render.)

Server actions:
- `prepareSubmit({ versionId, payload })` — encodes the form payload to base64, redirects to `/wiki/[versionId]/submit?d=...`.
- `confirmSubmit({ versionId, draft })` — calls `POST /api/v1/wiki/[versionId]/revisions` server-side via `fetch`; on success redirects to `/wiki/[versionId]/history`.
- `withdrawRevision({ revisionId })` — calls `POST /api/v1/wiki/revisions/[id]/withdraw` server-side; on success `revalidatePath` for the version page.

- [ ] **Step 1: Create `web/app/wiki/[versionId]/_actions.ts`**

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/session';

const API_BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:9999';

function b64Encode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
function b64Decode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

export async function prepareSubmit(formData: FormData) {
  const versionId = String(formData.get('versionId'));
  const payload = String(formData.get('payload'));
  if (!versionId || !payload) {
    throw new Error('missing fields');
  }
  redirect(`/wiki/${versionId}/submit?d=${b64Encode(payload)}`);
}

export async function confirmSubmit(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  const versionId = String(formData.get('versionId'));
  const draftB64 = String(formData.get('d'));
  if (!versionId || !draftB64) throw new Error('missing fields');
  const draft = JSON.parse(b64Decode(draftB64));
  const res = await fetch(`${API_BASE}/api/v1/wiki/${versionId}/revisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `next-auth.session-token=${user.id}` },
    body: JSON.stringify(draft),
  });
  if (!res.ok && res.status !== 201) {
    const body = await res.text();
    throw new Error(`create failed: ${res.status} ${body}`);
  }
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}/history`);
}

export async function withdrawRevision(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  const revisionId = String(formData.get('revisionId'));
  const versionId = String(formData.get('versionId'));
  const res = await fetch(`${API_BASE}/api/v1/wiki/revisions/${revisionId}/withdraw`, {
    method: 'POST',
    headers: { cookie: `next-auth.session-token=${user.id}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`withdraw failed: ${res.status}`);
  }
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}`);
}
```

> The `cookie` header is a stand-in for forwarding the user's session cookie. In Plan 5 (deployment), this becomes a real cookie pass-through. For local dev, the auth cookie is set by the same domain so a relative `fetch('/api/...', { method: 'POST' })` would also work — adjust if a real `Cookie` header is awkward (call the lib directly, e.g. `withdrawRevision` → `withdrawRevision({...})` from `@/lib/wiki`).

> **Plan 2 self-correction:** the cleanest path is to call the lib directly in server actions, not via HTTP. Replace the `fetch` blocks above with `import { createRevision, withdrawRevision } from '@/lib/wiki'` and call those. The HTTP layer stays for external clients. Update the actions file as follows (revised implementation, replaces the fetch version above):

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/session';
import { createRevision, withdrawRevision } from '@/lib/wiki';
import { CreateRevisionBody } from '@/lib/wiki-schema';
import { z } from 'zod';

function b64Encode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
function b64Decode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

export async function prepareSubmit(formData: FormData) {
  const versionId = String(formData.get('versionId'));
  const payload = String(formData.get('payload'));
  if (!versionId || !payload) throw new Error('missing fields');
  redirect(`/wiki/${versionId}/submit?d=${b64Encode(payload)}`);
}

export async function confirmSubmit(formData: FormData) {
  const user = await requireUser();
  const versionId = String(formData.get('versionId'));
  const draftB64 = String(formData.get('d'));
  if (!versionId || !draftB64) throw new Error('missing fields');
  const draftJson = b64Decode(draftB64);
  const parsed = CreateRevisionBody.safeParse(JSON.parse(draftJson));
  if (!parsed.success) throw new Error('invalid draft');
  const r = await createRevision({
    versionId: Number(versionId),
    authorId: BigInt(user.id),
    body: parsed.data,
  });
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}/history`);
}

export async function withdrawRevisionAction(formData: FormData) {
  const user = await requireUser();
  const revisionId = String(formData.get('revisionId'));
  const versionId = String(formData.get('versionId'));
  if (!revisionId || !versionId) throw new Error('missing fields');
  await withdrawRevision({
    revisionId: Number(revisionId),
    currentUserId: BigInt(user.id),
    isAdmin: user.role === 'admin',
  });
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}`);
}
```

- [ ] **Step 2: Create `web/app/(wiki)/_components/WikiEditForm.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PythonVersionRange } from './PythonVersionRange';
import { IncompatibilityEditor } from './IncompatibilityEditor';
import { NodeRequirementTable } from './NodeRequirementTable';
import { MarkdownEditor } from './MarkdownEditor';
import { ConflictPreview } from './ConflictPreview';
import { prepareSubmit } from '@/app/wiki/[versionId]/_actions';
import { withdrawRevisionAction } from '@/app/wiki/[versionId]/_actions';
import type { PublishedRequirements, PublishedDependency } from '@/lib/published';

type LatestPending = {
  id: number;
  editSummary: string;
  createdAt: string;
};

type Props = {
  versionId: number;
  initialPublished: PublishedRequirements;
  initialPending: LatestPending | null;
};

type FormShape = {
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  node_class_mappings: string[];
  incompatibilities: string[];
  notes_md: string;
  edit_summary: string;
};

function toFormShape(p: PublishedRequirements): FormShape {
  return {
    python_min: p.python_min,
    python_max: p.python_max,
    dependencies: p.dependencies,
    node_class_mappings: p.node_class_mappings,
    incompatibilities: p.incompatibilities,
    notes_md: '',
    edit_summary: '',
  };
}

export function WikiEditForm({ versionId, initialPublished, initialPending }: Props) {
  const { register, watch, setValue, getValues, handleSubmit } = useForm<FormShape>({
    defaultValues: toFormShape(initialPublished),
  });
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(values: FormShape) {
    if (!values.edit_summary.trim()) {
      window.alert('请填写 edit_summary');
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.set('versionId', String(versionId));
    fd.set('payload', JSON.stringify(values));
    void prepareSubmit(fd);
  }

  const pyMin = watch('python_min');
  const pyMax = watch('python_max');
  const notes = watch('notes_md');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {initialPending && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-yellow-800">你有这条 pending 修订</div>
          <div className="text-xs text-yellow-700">edit_summary: {initialPending.editSummary}</div>
          <form
            action={withdrawRevisionAction}
            className="mt-2"
          >
            <input type="hidden" name="revisionId" value={initialPending.id} />
            <input type="hidden" name="versionId" value={versionId} />
            <button type="submit" className="rounded bg-yellow-200 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-300">
              撤回此 pending
            </button>
          </form>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Python 范围</h2>
        <PythonVersionRange
          min={pyMin}
          max={pyMax}
          onChange={(min, max) => {
            setValue('python_min', min);
            setValue('python_max', max);
          }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">依赖</h2>
        <NodeRequirementTable
          value={getValues('dependencies')}
          onChange={(v) => setValue('dependencies', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">节点类映射</h2>
        <input
          {...register('node_class_mappings')}
          className="hidden"
        />
        <div className="text-xs text-gray-500">（与 dependencies 同区域,共享 useFieldArray;暂不支持多个映射数组 — Plan 3 改进）</div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">互斥节点</h2>
        <IncompatibilityEditor
          value={getValues('incompatibilities')}
          onChange={(v) => setValue('incompatibilities', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Markdown 备注</h2>
        <MarkdownEditor
          value={notes}
          onChange={(v) => setValue('notes_md', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">冲突预览（Plan 3 启用）</h2>
        <ConflictPreview versionId={String(versionId)} />
      </section>

      <section>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-700">edit_summary（1–200 字符）</span>
          <input
            {...register('edit_summary')}
            className="rounded border border-gray-300 px-2 py-1"
            placeholder="简要说明本次改动"
          />
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          下一步
        </button>
      </div>
    </form>
  );
}
```

> Plan 2 keeps `node_class_mappings` in the form shape but renders only a placeholder in the UI (mirroring how the spec lists it alongside the other field components). A dedicated array editor is added in Plan 3 alongside the conflict engine.

- [ ] **Step 3: Create `web/app/wiki/[versionId]/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { getPublishedRequirements } from '@/lib/published';
import { WikiEditForm } from '@/app/(wiki)/_components/WikiEditForm';

type Props = { params: Promise<{ versionId: string }> };

export default async function WikiEditPage({ params }: Props) {
  let user;
  try {
    user = await requireUser();
  } catch {
    const { versionId } = await params;
    redirect(`/login?callbackUrl=/wiki/${versionId}`);
  }
  const { versionId } = await params;
  const id = Number(versionId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const v = await prisma.nodeVersion.findUnique({ where: { id: BigInt(id) } });
  if (!v) notFound();
  const published = await getPublishedRequirements(id);
  const latest = await prisma.wikiRevision.findFirst({
    where: { version_id: BigInt(id), author_id: BigInt(user.id), status: 'pending' },
    orderBy: { created_at: 'desc' },
  });
  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">编辑 Wiki · {published.version_tag}</h1>
        <p className="text-xs text-gray-500">version_id={id}</p>
      </header>
      <WikiEditForm
        versionId={id}
        initialPublished={published}
        initialPending={
          latest
            ? {
                id: Number(latest.id),
                editSummary: latest.edit_summary,
                createdAt: latest.created_at.toISOString(),
              }
            : null
        }
      />
    </main>
  );
}
```

- [ ] **Step 4: Create `web/app/wiki/[versionId]/submit/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { confirmSubmit } from '@/app/wiki/[versionId]/_actions';

type Props = {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ d?: string }>;
};

function b64Decode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

export default async function SubmitConfirmPage({ params, searchParams }: Props) {
  const { versionId } = await params;
  const { d } = await searchParams;
  if (!d) redirect(`/wiki/${versionId}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64Decode(d));
  } catch {
    redirect(`/wiki/${versionId}`);
  }
  const obj = parsed as { edit_summary?: string };
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold">确认提交</h1>
      <p className="mb-3 text-sm text-gray-700">
        本次提交 edit_summary: <span className="font-mono">{obj.edit_summary ?? ''}</span>
      </p>
      <form action={confirmSubmit} className="flex gap-2">
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="d" value={d} />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
          确认提交
        </button>
        <a
          href={`/wiki/${versionId}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          返回编辑
        </a>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Create `web/app/wiki/[versionId]/history/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { diffRevisions } from '@/lib/diff';
import { DiffViewer } from '@/app/(wiki)/_components/DiffViewer';
import { HistoryClient } from './HistoryClient';

type Props = { params: Promise<{ versionId: string }> };

export default async function HistoryPage({ params }: Props) {
  await requireUser();
  const { versionId } = await params;
  const id = Number(versionId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const rows = await prisma.wikiRevision.findMany({
    where: { version_id: BigInt(id) },
    orderBy: { created_at: 'desc' },
    include: { author: { select: { username: true, avatar_url: true } } },
  });
  const items = rows.map((r) => ({
    id: Number(r.id),
    editSummary: r.edit_summary,
    status: r.status,
    authorUsername: r.author.username,
    createdAt: r.created_at.toISOString(),
  }));
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">修订历史 · version_id={id}</h1>
      <HistoryClient items={items} versionId={id} />
    </main>
  );
}
```

- [ ] **Step 6: Create `web/app/wiki/[versionId]/history/HistoryClient.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { DiffViewer } from '@/app/(wiki)/_components/DiffViewer';
import type { FieldDiff } from '@/lib/diff';

type Item = {
  id: number;
  editSummary: string;
  status: string;
  authorUsername: string;
  createdAt: string;
};

type Props = { items: Item[]; versionId: number };

export function HistoryClient({ items, versionId }: Props) {
  const [fromId, setFromId] = useState<number | null>(items[1]?.id ?? null);
  const [toId, setToId] = useState<number | null>(items[0]?.id ?? null);
  const [diff, setDiff] = useState<FieldDiff[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadDiff() {
    if (!fromId || !toId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/wiki/diff?from=${fromId}&to=${toId}`);
      if (!res.ok) {
        setDiff([]);
        return;
      }
      const body = (await res.json()) as { diff: FieldDiff[] };
      setDiff(body.diff);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <label>
          from:{' '}
          <select
            value={fromId ?? ''}
            onChange={(e) => setFromId(Number(e.target.value) || null)}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            <option value="">--</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                #{it.id} {it.authorUsername} {it.editSummary}
              </option>
            ))}
          </select>
        </label>
        <label>
          to:{' '}
          <select
            value={toId ?? ''}
            onChange={(e) => setToId(Number(e.target.value) || null)}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            <option value="">--</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                #{it.id} {it.authorUsername} {it.editSummary}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={loadDiff}
          disabled={!fromId || !toId || loading}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '加载中…' : '查看 diff'}
        </button>
      </div>

      {diff && <DiffViewer diff={diff} />}

      <ul className="divide-y divide-gray-200">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <div className="font-mono text-xs text-gray-500">#{it.id}</div>
              <div className="font-medium">{it.editSummary}</div>
              <div className="text-xs text-gray-500">
                {it.authorUsername} · {it.createdAt} · status: {it.status}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors. (If a `'use server'` directive complains about exporting non-async functions, ensure `_actions.ts` only exports async functions and that `WikiEditForm.tsx` imports them as named exports.)

- [ ] **Step 8: Manual smoke test**

```bash
cd web && pnpm dev
```

In a separate terminal:
```bash
# 1) Visit /wiki/1 (the fixture's first version)
curl -I http://localhost:9999/wiki/1
# Expected: 307 redirect to /login?callbackUrl=...
# 2) Visit /wiki/9999999 (unknown)
curl -I http://localhost:9999/wiki/9999999
# Expected: 404
```

Then log in via the browser, navigate to `/wiki/1`, edit fields, click 下一步, confirm. Verify the page transitions to `/wiki/1/history` with the new pending revision.

- [ ] **Step 9: Commit**

```bash
git add web/app/\(wiki\)/_components/WikiEditForm.tsx web/app/wiki/
git commit -m "feat(web): wiki pages (edit, submit, history) with server actions"
```

---

## Task 20: Admin layout + `/admin` dashboard

**Files:**
- Create: `web/app/admin/layout.tsx`
- Create: `web/app/admin/page.tsx`
- Create: `web/app/(admin)/_components/AdminDashboard.tsx`

**Interfaces:**
- `web/app/admin/layout.tsx` calls `requireAdmin()`; renders a sidebar + main slot.
- `web/app/admin/page.tsx` (server) fetches counts via direct prisma queries and passes to the client component.

- [ ] **Step 1: Create `web/app/admin/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?callbackUrl=/admin');
  if (user.role !== 'admin') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold text-red-700">403 禁止访问</h1>
        <p className="mt-2 text-sm text-gray-600">该页面仅管理员可访问。</p>
      </main>
    );
  }
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 border-r border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">管理后台</h2>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/admin" className="rounded px-2 py-1 hover:bg-gray-100">Dashboard</Link>
          <Link href="/admin/revisions" className="rounded px-2 py-1 hover:bg-gray-100">修订审核</Link>
          <Link href="/admin/submissions" className="rounded px-2 py-1 hover:bg-gray-100">节点收录</Link>
          <Link href="/admin/users" className="rounded px-2 py-1 hover:bg-gray-100">用户角色</Link>
        </nav>
        <div className="mt-4 border-t border-gray-200 pt-3 text-xs text-gray-500">
          {user.username} (admin)
        </div>
      </aside>
      <section className="flex-1">{children}</section>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/(admin)/_components/AdminDashboard.tsx`**

```tsx
'use client';
import Link from 'next/link';

type Props = {
  pendingRevisions: number;
  pendingSubmissions: number;
  recent: Array<{ id: number; kind: 'revision' | 'submission'; at: string; summary: string }>;
};

export function AdminDashboard({ pendingRevisions, pendingSubmissions, recent }: Props) {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <div className="mb-6 grid grid-cols-2 gap-4">
        <Link
          href="/admin/revisions"
          className="rounded border border-gray-200 bg-white p-4 hover:border-blue-400"
        >
          <div className="text-xs text-gray-500">待审核修订</div>
          <div className="mt-1 text-2xl font-bold">{pendingRevisions}</div>
        </Link>
        <Link
          href="/admin/submissions"
          className="rounded border border-gray-200 bg-white p-4 hover:border-blue-400"
        >
          <div className="text-xs text-gray-500">待审核节点收录</div>
          <div className="mt-1 text-2xl font-bold">{pendingSubmissions}</div>
        </Link>
      </div>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">最近活动</h2>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {recent.length === 0 ? (
          <li className="p-3 text-sm text-gray-500">（暂无）</li>
        ) : (
          recent.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between p-3 text-sm">
              <span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{r.kind}</span>{' '}
                {r.summary}
              </span>
              <span className="text-xs text-gray-500">{r.at}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/app/admin/page.tsx`**

```tsx
import { prisma } from '@/lib/db';
import { AdminDashboard } from '@/app/(admin)/_components/AdminDashboard';

export default async function AdminDashboardPage() {
  const [pendingRevisions, pendingSubmissions, recentRevisions, recentSubmissions] = await Promise.all([
    prisma.wikiRevision.count({ where: { status: 'pending' } }),
    prisma.nodeSubmission.count({ where: { status: 'pending' } }),
    prisma.wikiRevision.findMany({
      orderBy: { created_at: 'desc' },
      take: 5,
      include: { author: { select: { username: true } } },
    }),
    prisma.nodeSubmission.findMany({
      orderBy: { created_at: 'desc' },
      take: 5,
      include: { submitter: { select: { username: true } } },
    }),
  ]);

  const recent = [
    ...recentRevisions.map((r) => ({
      id: Number(r.id),
      kind: 'revision' as const,
      at: r.created_at.toISOString(),
      summary: `${r.author.username}: ${r.edit_summary} (${r.status})`,
    })),
    ...recentSubmissions.map((s) => ({
      id: Number(s.id),
      kind: 'submission' as const,
      at: s.created_at.toISOString(),
      summary: `${s.submitter.username}: ${s.github_url} (${s.status})`,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 10);

  return (
    <AdminDashboard
      pendingRevisions={pendingRevisions}
      pendingSubmissions={pendingSubmissions}
      recent={recent}
    />
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/admin/layout.tsx web/app/admin/page.tsx web/app/\(admin\)/_components/AdminDashboard.tsx
git commit -m "feat(web): admin layout and dashboard with pending counts"
```

---

## Task 21: `/admin/revisions` — pending revisions review list

**Files:**
- Create: `web/app/admin/revisions/page.tsx` (server)
- Create: `web/app/admin/revisions/RevisionsClient.tsx` (client)

**Interfaces:**
- Page fetches pending revisions via `prisma.wikiRevision.findMany({ status: 'pending' })`.
- Each row has "批准" and "驳回" buttons; clicking opens a modal that prompts for `review_note`, then calls the admin API.

- [ ] **Step 1: Create `web/app/admin/revisions/RevisionsClient.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = {
  id: number;
  versionId: number;
  authorUsername: string;
  editSummary: string;
  createdAt: string;
};

type Props = { items: Item[] };

export function RevisionsClient({ items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [modal, setModal] = useState<{ id: number; mode: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  async function submit() {
    if (!modal) return;
    setBusy(modal.id);
    const path = modal.mode === 'approve'
      ? `/api/v1/admin/revisions/${modal.id}/approve`
      : `/api/v1/admin/revisions/${modal.id}/reject`;
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modal.mode === 'approve' ? (note ? { review_note: note } : {}) : { review_note: note }),
    });
    setBusy(null);
    setModal(null);
    setNote('');
    if (!res.ok) {
      window.alert(`操作失败: ${res.status}`);
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="p-6 text-sm text-gray-500">暂无待审核修订。</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">修订审核</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">节点版本</th>
            <th className="px-2 py-1">作者</th>
            <th className="px-2 py-1">edit_summary</th>
            <th className="px-2 py-1">提交时间</th>
            <th className="px-2 py-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-gray-200">
              <td className="px-2 py-1 font-mono text-xs">#{it.id}</td>
              <td className="px-2 py-1">v_id={it.versionId}</td>
              <td className="px-2 py-1">{it.authorUsername}</td>
              <td className="px-2 py-1">{it.editSummary}</td>
              <td className="px-2 py-1 text-xs text-gray-500">{it.createdAt}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'approve' })}
                  className="mr-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'reject' })}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                >
                  驳回
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-96 rounded bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-semibold">
              {modal.mode === 'approve' ? '批准修订' : '驳回修订'} #{modal.id}
            </h3>
            <label className="mb-1 block text-xs text-gray-700">review_note（驳回必填，1–1000 字符）</label>
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setModal(null); setNote(''); }}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy === modal.id || (modal.mode === 'reject' && note.trim().length === 0)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === modal.id ? '处理中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/admin/revisions/page.tsx`**

```tsx
import { prisma } from '@/lib/db';
import { RevisionsClient } from './RevisionsClient';

export default async function AdminRevisionsPage() {
  const rows = await prisma.wikiRevision.findMany({
    where: { status: 'pending' },
    orderBy: { created_at: 'desc' },
    include: { author: { select: { username: true } } },
  });
  const items = rows.map((r) => ({
    id: Number(r.id),
    versionId: Number(r.version_id),
    authorUsername: r.author.username,
    editSummary: r.edit_summary,
    createdAt: r.created_at.toISOString(),
  }));
  return <RevisionsClient items={items} />;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/revisions/
git commit -m "feat(web): /admin/revisions review list with approve/reject modal"
```

---

## Task 22: `/admin/submissions` — pending node submissions review list

**Files:**
- Create: `web/app/admin/submissions/page.tsx` (server)
- Create: `web/app/admin/submissions/SubmissionsClient.tsx` (client)

**Interfaces:**
- Page fetches `prisma.nodeSubmission.findMany({ status: 'pending' })`.
- Approve calls `/api/v1/admin/submissions/{id}/approve`; reject requires `review_note` and calls reject endpoint.

- [ ] **Step 1: Create `web/app/admin/submissions/SubmissionsClient.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = {
  id: number;
  submitterUsername: string;
  githubUrl: string;
  createdAt: string;
};

type Props = { items: Item[] };

export function SubmissionsClient({ items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [modal, setModal] = useState<{ id: number; mode: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  async function submit() {
    if (!modal) return;
    setBusy(modal.id);
    const path = modal.mode === 'approve'
      ? `/api/v1/admin/submissions/${modal.id}/approve`
      : `/api/v1/admin/submissions/${modal.id}/reject`;
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modal.mode === 'approve' ? (note ? { review_note: note } : {}) : { review_note: note }),
    });
    setBusy(null);
    setModal(null);
    setNote('');
    if (!res.ok) {
      window.alert(`操作失败: ${res.status}`);
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="p-6 text-sm text-gray-500">暂无待审核节点收录请求。</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">节点收录</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">提交者</th>
            <th className="px-2 py-1">GitHub URL</th>
            <th className="px-2 py-1">提交时间</th>
            <th className="px-2 py-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-gray-200">
              <td className="px-2 py-1 font-mono text-xs">#{it.id}</td>
              <td className="px-2 py-1">{it.submitterUsername}</td>
              <td className="px-2 py-1 font-mono text-xs">{it.githubUrl}</td>
              <td className="px-2 py-1 text-xs text-gray-500">{it.createdAt}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'approve' })}
                  className="mr-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'reject' })}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                >
                  驳回
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-96 rounded bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-semibold">
              {modal.mode === 'approve' ? '批准收录' : '驳回收录'} #{modal.id}
            </h3>
            <label className="mb-1 block text-xs text-gray-700">review_note（驳回必填，1–1000 字符）</label>
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setModal(null); setNote(''); }}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy === modal.id || (modal.mode === 'reject' && note.trim().length === 0)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === modal.id ? '处理中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/admin/submissions/page.tsx`**

```tsx
import { prisma } from '@/lib/db';
import { SubmissionsClient } from './SubmissionsClient';

export default async function AdminSubmissionsPage() {
  const rows = await prisma.nodeSubmission.findMany({
    where: { status: 'pending' },
    orderBy: { created_at: 'desc' },
    include: { submitter: { select: { username: true } } },
  });
  const items = rows.map((s) => ({
    id: Number(s.id),
    submitterUsername: s.submitter.username,
    githubUrl: s.github_url,
    createdAt: s.created_at.toISOString(),
  }));
  return <SubmissionsClient items={items} />;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/submissions/
git commit -m "feat(web): /admin/submissions review list"
```

---

## Task 23: `/admin/users` — user role management

**Files:**
- Create: `web/app/admin/users/page.tsx` (server)
- Create: `web/app/admin/users/UsersClient.tsx` (client)

**Interfaces:**
- Page fetches `prisma.user.findMany()`.
- Each row has a role `<select>`; changing it calls `POST /api/v1/admin/users/{id}/role`.

- [ ] **Step 1: Create `web/app/admin/users/UsersClient.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = {
  id: number;
  username: string;
  avatarUrl: string;
  role: 'user' | 'admin';
};

type Props = {
  items: Item[];
  currentUserId: number;
};

export function UsersClient({ items, currentUserId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function changeRole(userId: number, role: 'user' | 'admin') {
    setBusy(userId);
    const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.text();
      window.alert(`操作失败: ${res.status} ${body}`);
    }
    router.refresh();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">用户角色</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">username</th>
            <th className="px-2 py-1">role</th>
            <th className="px-2 py-1">说明</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-t border-gray-200">
                <td className="px-2 py-1 font-mono text-xs">#{u.id}</td>
                <td className="px-2 py-1">{u.username}</td>
                <td className="px-2 py-1">
                  <select
                    disabled={busy === u.id}
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value as 'user' | 'admin')}
                    className="rounded border border-gray-300 px-1 py-0.5 text-sm"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-2 py-1 text-xs text-gray-500">
                  {isSelf && '（你自己,不可降级）'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/app/admin/users/page.tsx`**

```tsx
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { UsersClient } from './UsersClient';

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const rows = await prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  const items = rows.map((u) => ({
    id: Number(u.id),
    username: u.username,
    avatarUrl: u.avatar_url,
    role: u.role as 'user' | 'admin',
  }));
  return <UsersClient items={items} currentUserId={Number(me.id)} />;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/users/
git commit -m "feat(web): /admin/users role management with self-demote guard"
```

---

## Task 24: Full integration test pass + dev server smoke test

**Files:** none new; this task verifies everything from Tasks 1-23.

**Goal:** Confirm `pnpm test` is green, `pnpm exec tsc --noEmit` is clean, `pnpm lint` reports no new warnings, and a manual `curl` walk through all 15 new endpoints returns expected status codes.

- [ ] **Step 1: Run the full Vitest suite**

```bash
cd web && pnpm test
```
Expected: all tests in Plan 1 + Plan 2 pass. Fix any test you broke in this plan. If a Plan 1 test starts failing because of a Plan 2 schema change (e.g. `RevisionStatus` enum), update the test to use the enum symbol.

- [ ] **Step 2: TypeScript check**

```bash
cd web && pnpm exec tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
cd web && pnpm lint
```
Expected: no new warnings. If existing Plan 1 warnings surface, ignore (out of scope). New code from this plan should be lint-clean.

- [ ] **Step 4: Start the dev server**

```bash
cd web && pnpm dev
```
Expected: server listening on `http://localhost:9999`.

- [ ] **Step 5: Smoke test the public read-only endpoints (regression)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/api/v1/nodes
# Expected: 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/
# Expected: 200
```

- [ ] **Step 6: Smoke test the new wiki endpoints (unauthenticated — should 401)**

```bash
# 1) GET wiki
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/api/v1/wiki/1
# Expected: 401

# 2) POST create
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:9999/api/v1/wiki/1/revisions -H 'content-type: application/json' -d '{}'
# Expected: 401

# 3) diff
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:9999/api/v1/wiki/diff?from=1&to=2"
# Expected: 401

# 4) withdraw
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:9999/api/v1/wiki/revisions/1/withdraw
# Expected: 401
```

- [ ] **Step 7: Smoke test the new conflict-check stub (unauthenticated — 401)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:9999/api/v1/conflicts/check -H 'content-type: application/json' -d '{"installed":[]}'
# Expected: 401
```

- [ ] **Step 8: Smoke test admin endpoints (unauthenticated — 401)**

```bash
# 5 pending lists + 6 mutation endpoints
for path in \
  /api/v1/admin/revisions/pending \
  /api/v1/admin/submissions/pending \
  /api/v1/admin/users ; do
  curl -s -o /dev/null -w "$path %{http_code}\n" "http://localhost:9999$path"
done
# Expected: 401 for each

# mutation
for method_path in \
  "POST /api/v1/admin/revisions/1/approve" \
  "POST /api/v1/admin/revisions/1/reject" \
  "POST /api/v1/admin/submissions/1/approve" \
  "POST /api/v1/admin/submissions/1/reject" \
  "POST /api/v1/admin/users/1/role" ; do
  m=${method_path% *}; p=${method_path#* }
  curl -s -o /dev/null -w "$method_path %{http_code}\n" -X "$m" "http://localhost:9999$p" -H 'content-type: application/json' -d '{}'
done
# Expected: 401 for each
```

Total new endpoints covered: 15. All should return 401 unauthenticated.

- [ ] **Step 9: Authenticated walk-through (browser)**

Log in via GitHub OAuth. Pick a fixture version (e.g. `v8.10` of `ltdrdata/ComfyUI-Impact-Pack`):
1. Visit `/wiki/<versionId>`, edit the Python range, add a dependency, type a Markdown note, type an `edit_summary`, click 下一步.
2. On the confirm page, click 确认提交. Expect redirect to `/wiki/<versionId>/history` with the new pending revision visible.
3. Log in as a different admin user. Visit `/admin/revisions`, click 批准 on the new revision, supply a review note, click 确认.
4. Visit the public `/nodes/<owner>/<repo>/versions/<tag>` page and confirm the approved Python range / dependency is reflected in the published view.
5. Visit `/admin/users`, change the original user to `admin`; attempt to demote yourself → expect 409 toast (the UI shows the alert from the fetch handler).
6. Visit `/wiki/<versionId>` again, observe the new approved values; edit them and submit a new pending revision; visit `/admin/revisions` and 驳回 with a note.

- [ ] **Step 10: Commit any fix-ups**

If Steps 1-9 surfaced any code issues, fix them in the relevant task and create a single follow-up commit:

```bash
git add -A
git commit -m "fix(web): post-Plan-2 integration cleanups"
```

If nothing needs fixing, skip this step.

---

## Task 25: README — Wiki / Admin section + testing notes + known limits

**Files:**
- Modify: `README.md`

**Goal:** Document the new user-facing surfaces (wiki pages, admin pages), the test commands, and the explicit list of out-of-scope items so future contributors and the user's collaborator don't file tickets against Plan 3 features.

- [ ] **Step 1: Open `README.md` and locate the "Local development" section**

If the section is at the top, append the new sub-sections below. If the README has a "Status / Plans" section near the top, add a "Plan 2 (Wiki editing)" entry to it pointing at the new pages.

- [ ] **Step 2: Add a "Wiki editing & admin review" section**

```markdown
## Wiki editing & admin review (Plan 2)

Logged-in users can propose edits to any node version, and admins can review them.

### Routes

- `GET /wiki/<versionId>` — edit a single version (form pre-filled from published view). Requires login.
- `GET /wiki/<versionId>/submit` — confirm a pending draft. Requires login.
- `GET /wiki/<versionId>/history` — list of all revisions + a side-by-side diff viewer. Requires login.
- `GET /admin` — admin dashboard with pending counts (admin only).
- `GET /admin/revisions` — review pending wiki revisions (admin only).
- `GET /admin/submissions` — review pending node submission requests (admin only).
- `GET /admin/users` — change user roles (admin only; you cannot demote yourself).

### API (machine-readable)

All endpoints return JSON. Wiki endpoints require a session; admin endpoints additionally require `role=admin`.

- `GET  /api/v1/wiki/{versionId}` — load published + your latest pending
- `GET  /api/v1/wiki/{versionId}/history?page=&page_size=` — paginated history
- `GET  /api/v1/wiki/revisions/{id}` — single revision detail
- `POST /api/v1/wiki/{versionId}/revisions` — create a pending revision (zod-validated)
- `POST /api/v1/wiki/revisions/{id}/withdraw` — author or admin only
- `GET  /api/v1/wiki/diff?from={id}&to={id}` — field-level diff
- `POST /api/v1/conflicts/check` — **stub** (Plan 3 implements the real PEP 440 engine)
- `GET  /api/v1/admin/revisions/pending?page=&page_size=`
- `POST /api/v1/admin/revisions/{id}/approve` — body `{ review_note?: string }`
- `POST /api/v1/admin/revisions/{id}/reject`  — body `{ review_note: string }`
- `GET  /api/v1/admin/submissions/pending`
- `POST /api/v1/admin/submissions/{id}/approve` — body `{ review_note?: string }`. Creates a Node row from the submission's GitHub URL.
- `POST /api/v1/admin/submissions/{id}/reject`  — body `{ review_note: string }`
- `GET  /api/v1/admin/users`
- `POST /api/v1/admin/users/{id}/role` — body `{ role: 'admin' | 'user' }`. Self-demote returns 409.
```

- [ ] **Step 3: Add a "Testing" section**

```markdown
## Testing

```bash
cd web
pnpm test                  # Vitest, runs against comfyui_nodes_test DB
pnpm exec tsc --noEmit     # TypeScript
pnpm lint                  # Next/ESLint
```

Tests cover:
- `web/tests/lib/` — unit tests for `wiki-schema`, `diff`, `wiki` (helpers), `conflict-engine` stub, `revision-status` enum.
- `web/tests/api/` — integration tests for the 15 new endpoints under `/api/v1/wiki`, `/api/v1/conflicts/check`, and `/api/v1/admin`.

The test DB (`comfyui_nodes_test`) is reset between files via `prisma db push --force-reset` in `web/tests/setup.ts`. Vitest uses `fileParallelism: false` (configured in `vitest.config.ts`) so the shared `prisma client` does not race.

For UI smoke tests see the **Manual smoke test** steps in `docs/superpowers/plans/2026-06-25-plan-02-wiki-editing.md` Task 24.
```

- [ ] **Step 4: Add a "Known limits (Plan 2)" section**

```markdown
## Known limits (Plan 2)

- **`POST /api/v1/conflicts/check` is a stub.** It always returns `{ conflicts: [] }`. The real PEP 440 conflict detection engine arrives in Plan 3 (`docs/superpowers/specs/2026-06-25-plan-02-wiki-editing.md` §6). The `<ConflictPreview>` UI component in the wiki edit form reflects this with a "暂未启用" placeholder.
- **No automated submissions.** New node submissions are created by users through the wiki edit form (Plan 3) and reviewed manually; there is no scanner-driven queue in Plan 2.
- **No email notifications.** When an admin approves or rejects a revision, the author is not notified. The author's `/wiki/<versionId>` view will reflect the new status on next visit.
- **Approved revisions cannot be edited or re-submitted.** They are immutable. A new pending revision must be created from scratch.
- **Self-demotion is blocked.** An admin can promote other users to admin but cannot demote themselves; an out-of-band DB update is required to recover (the bootstrap admin via `BOOTSTRAP_ADMIN_GITHUB_ID` is one such recovery path).
- **The conflict-engine and `<ConflictPreview>` are placeholders.** Plan 3 fills them in with a real algorithm and an editor-side debounce-and-render loop.
- **Out of scope (deferred plans):** Python Celery scanner (Plan 4), production deployment / CI / monitoring / Docker (Plan 5).
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: Plan 2 (wiki editing + admin) routes, API, testing, known limits"
```

---

## Self-Review

Run through the writing-plans self-review checklist against the spec (`docs/superpowers/specs/2026-06-25-plan-02-wiki-editing.md`):

**1. Spec coverage** — every spec section mapped to a task:
- §2 范围 (in-scope) → Tasks 6-23 implement all listed items.
- §4 数据模型增量 → Task 1 extends `RevisionStatus` enum.
- §5.1 Wiki API (6 endpoints) → Tasks 6, 7, 8, 9, 10.
- §5.2 conflict-check stub → Task 11.
- §5.3 Admin API (8 endpoints) → Tasks 12, 13, 14.
- §6 conflict-engine stub → Task 5.
- §7.1 Wiki 页 (3 pages) → Task 19.
- §7.2 Admin 页 (4 pages) → Tasks 20-23.
- §8.1 `PythonVersionRange` → Task 15.
- §8.2 `IncompatibilityEditor` → Task 15.
- §8.3 `NodeRequirementTable` → Task 16.
- §8.4 `MarkdownEditor` (Tiptap) → Task 17.
- §8.5 `DiffViewer` → Task 18.
- §8.6 `ConflictPreview` → Task 18.
- §9.1 提交修订流程 (data flow) → Task 19 (server actions + form).
- §9.2 管理员审批流程 → Tasks 21, 22.
- §9.3 字段级 diff 算法 → Task 4.
- §10 错误处理 → covered by status codes 400/401/403/404/409 in every API test.
- §11 测试策略 → Tasks 1-14 each have unit + integration tests; Tasks 15-19 smoke-tested via dev server; Task 24 ties them together.
- §13 验收标准 → Task 24 verifies end-to-end; README Task 25 documents.

**2. Placeholder scan** — search the plan for the red flags:
- ❌ "TBD" / "TODO" — none.
- ❌ "implement later" — none.
- ❌ "Add appropriate error handling" — none; specific error cases are encoded in the tests.
- ❌ "Write tests for the above" without code — none; every test step includes actual test code.
- ❌ "Similar to Task N" — none; every step has full code blocks.
- ❌ Steps that describe what without showing how — none; every step has code or a run command.

**3. Type consistency** — types and signatures match across tasks:
- `CreateRevisionBody` and `RevisionFields` used consistently (Tasks 2/3/4/9/19).
- `published.ts`'s `PublishedDependency` matches `wiki-schema.ts`'s `PublishedDependencySchema` and `diff.ts`'s row type (Tasks 2/4/16/17/19).
- `RevisionStatus` enum used as Prisma enum (not string literal) in `wiki.ts` (Task 3) and route handlers (Tasks 6-14).
- `withdrawRevision` result type union: `{ ok: true } | { ok: false, reason: 'not-found' | 'forbidden' | 'not-pending', status? }` is consistent between `wiki.ts` (Task 3) and the route handler (Task 10).
- `approveRevision` returns `{ ok: true, approvedRevisionId, archivedRevisionIds }` consistent with Task 12's route handler.

If any review finds a gap, fix it inline before commit.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-plan-02-wiki-editing.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Pick the execution mode and we proceed.
