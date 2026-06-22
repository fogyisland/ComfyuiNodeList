import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, shortenSpec } from '@/lib/format';

describe('formatDate', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2026-03-05T12:34:56Z'))).toBe('2026-03-05');
  });
  it('accepts an ISO string', () => {
    expect(formatDate('2026-03-05T12:34:56Z')).toBe('2026-03-05');
  });
});

describe('formatDateTime', () => {
  it('formats a Date as ISO-8601 with seconds', () => {
    expect(formatDateTime(new Date('2026-03-05T12:34:56Z'))).toBe('2026-03-05T12:34:56Z');
  });
});

describe('shortenSpec', () => {
  it('truncates specs longer than max', () => {
    expect(shortenSpec('>=2.0.0,<3.0.0,!=2.5.0', 10)).toBe('>=2.0.0,...');
  });
  it('returns short specs unchanged', () => {
    expect(shortenSpec('>=2.0', 10)).toBe('>=2.0');
  });
});