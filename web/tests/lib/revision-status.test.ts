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