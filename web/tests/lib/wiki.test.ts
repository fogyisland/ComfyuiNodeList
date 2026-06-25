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
