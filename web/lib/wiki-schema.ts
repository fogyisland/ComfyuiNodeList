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

export type CreateRevisionBody = z.infer<typeof CreateRevisionBody>;
export type WithdrawRevisionBody = z.infer<typeof WithdrawRevisionBody>;
export type ApproveRevisionBody = z.infer<typeof ApproveRevisionBody>;
export type RejectRevisionBody = z.infer<typeof RejectRevisionBody>;
export type ApproveSubmissionBody = z.infer<typeof ApproveSubmissionBody>;
export type RejectSubmissionBody = z.infer<typeof RejectSubmissionBody>;
export type ChangeRoleBody = z.infer<typeof ChangeRoleBody>;
export type ConflictCheckBody = z.infer<typeof ConflictCheckBody>;
