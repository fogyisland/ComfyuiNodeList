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