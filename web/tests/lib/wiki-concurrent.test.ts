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

async function makePending(authorId: bigint) {
  const version = await getVersion();
  const { revisionId } = await createRevision({
    versionId: Number(version.id),
    authorId,
    body: {
      dependencies: [],
      node_class_mappings: [],
      incompatibilities: [],
      notes_md: '',
      edit_summary: 'x',
    },
  });
  return revisionId;
}

describe('concurrent reject (race protection)', () => {
  beforeEach(async () => {
    await setup();
    await seedFixture(prisma);
  });

  it('two admins reject the same pending revision — exactly one wins', async () => {
    const author = await makeUser(1n);
    const adminA = await makeUser(2n, 'admin');
    const adminB = await makeUser(3n, 'admin');
    const revisionId = await makePending(author.id);

    const [r1, r2] = await Promise.all([
      rejectRevision({ revisionId, reviewerId: adminA.id, reviewNote: 'first' }),
      rejectRevision({ revisionId, reviewerId: adminB.id, reviewNote: 'second' }),
    ]);

    const oks = [r1, r2].filter((r) => r.ok).length;
    const notPending = [r1, r2].filter(
      (r) => !r.ok && r.reason === 'not-pending',
    ).length;
    expect(oks).toBe(1);
    expect(notPending).toBe(1);

    const row = await prisma.wikiRevision.findUniqueOrThrow({
      where: { id: BigInt(revisionId) },
    });
    expect(row.status).toBe(RevisionStatus.rejected);
    expect([adminA.id, adminB.id]).toContain(row.reviewer_id);
  });

  it('admin reject + author withdraw race — exactly one wins', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const revisionId = await makePending(author.id);

    const [rReject, rWithdraw] = await Promise.all([
      rejectRevision({ revisionId, reviewerId: admin.id, reviewNote: 'no' }),
      withdrawRevision({
        revisionId,
        currentUserId: author.id,
        isAdmin: false,
      }),
    ]);

    const oks = [rReject, rWithdraw].filter((r) => r.ok).length;
    expect(oks).toBe(1);

    const row = await prisma.wikiRevision.findUniqueOrThrow({
      where: { id: BigInt(revisionId) },
    });
    expect([RevisionStatus.rejected, RevisionStatus.withdrawn]).toContain(row.status);
  });

  it('admin reject + admin approve race — exactly one wins', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const revisionId = await makePending(author.id);

    const [rReject, rApprove] = await Promise.all([
      rejectRevision({ revisionId, reviewerId: admin.id, reviewNote: 'no' }),
      approveRevision({ revisionId, reviewerId: admin.id, reviewNote: 'ok' }),
    ]);

    const oks = [rReject, rApprove].filter((r) => r.ok).length;
    expect(oks).toBe(1);

    const row = await prisma.wikiRevision.findUniqueOrThrow({
      where: { id: BigInt(revisionId) },
    });
    expect([RevisionStatus.rejected, RevisionStatus.approved]).toContain(row.status);
  });

  it('withdraw an already-withdrawn revision returns not-pending', async () => {
    const author = await makeUser(1n);
    const revisionId = await makePending(author.id);

    const first = await withdrawRevision({
      revisionId,
      currentUserId: author.id,
      isAdmin: false,
    });
    expect(first).toEqual({ ok: true });

    const second = await withdrawRevision({
      revisionId,
      currentUserId: author.id,
      isAdmin: false,
    });
    expect(second).toMatchObject({
      ok: false,
      reason: 'not-pending',
      status: RevisionStatus.withdrawn,
    });
  });

  it('reject an already-archived revision returns not-pending', async () => {
    const author = await makeUser(1n);
    const admin = await makeUser(2n, 'admin');
    const version = await getVersion();

    const { revisionId: first } = await createRevision({
      versionId: Number(version.id),
      authorId: author.id,
      body: {
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
        dependencies: [],
        node_class_mappings: [],
        incompatibilities: [],
        notes_md: '',
        edit_summary: 'second',
      },
    });
    // Flip the second to archived directly (mirrors approve-on-same-version flow)
    await prisma.wikiRevision.update({
      where: { id: BigInt(second) },
      data: { status: RevisionStatus.archived },
    });

    const r = await rejectRevision({
      revisionId: second,
      reviewerId: admin.id,
      reviewNote: 'no',
    });
    expect(r).toMatchObject({
      ok: false,
      reason: 'not-pending',
      status: RevisionStatus.archived,
    });
  });
});