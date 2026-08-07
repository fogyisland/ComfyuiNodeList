import { prisma } from './db';
import { SubmissionStatus } from '@prisma/client';
import { parseGithubUrl } from './parse-github-url';

export { parseGithubUrl };

export type CreateSubmissionInput = {
  github_url: string;
  name: string;
  description: string;
};

export type CreateSubmissionResult =
  | { ok: true; id: number }
  | { ok: false; reason: 'invalid-url' | 'missing-field' | 'description-too-long' | 'already-exists' | 'duplicate-pending' };

export async function createSubmission(
  submitterId: bigint,
  input: CreateSubmissionInput,
): Promise<CreateSubmissionResult> {
  const github_url = (input.github_url ?? '').trim();
  const name = (input.name ?? '').trim();
  const description = (input.description ?? '').trim();

  if (!github_url || !name || !description) return { ok: false, reason: 'missing-field' };
  if (description.length > 500) return { ok: false, reason: 'description-too-long' };

  const parsed = parseGithubUrl(github_url);
  if (!parsed) return { ok: false, reason: 'invalid-url' };

  const existing = await prisma.node.findUnique({
    where: { github_owner_github_repo: { github_owner: parsed.owner, github_repo: parsed.repo } },
  });
  if (existing) return { ok: false, reason: 'already-exists' };

  const dup = await prisma.nodeSubmission.findFirst({
    where: { github_url, status: SubmissionStatus.pending },
  });
  if (dup) return { ok: false, reason: 'duplicate-pending' };

  const created = await prisma.nodeSubmission.create({
    data: { submitter_id: submitterId, github_url, name, description, status: SubmissionStatus.pending },
  });
  return { ok: true, id: Number(created.id) };
}