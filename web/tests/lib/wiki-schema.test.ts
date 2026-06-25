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
