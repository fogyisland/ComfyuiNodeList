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
  // The transaction enforces the invariant: at most one `approved` row per `version_id`.
  // Inside the same tx we (1) locate the previous approved row, (2) archive it if it
  // exists and is not the same revision, then (3) flip the target revision to approved.
  // All three steps must succeed or all must roll back, so a partial state cannot leak.
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
