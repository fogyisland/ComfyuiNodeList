import { describe, it, expect } from 'vitest';
import { json, error, parsePagination, parseSearch } from '@/lib/api-helpers';

describe('json', () => {
  it('sets Content-Type and serializes body', async () => {
    const r = json({ hello: 'world' });
    expect(r.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(await r.json()).toEqual({ hello: 'world' });
  });
  it('respects init.status', () => {
    const r = json({}, { status: 201 });
    expect(r.status).toBe(201);
  });
});

describe('error', () => {
  it('wraps message in error object', async () => {
    const r = error(404, 'not found');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { message: 'not found', detail: undefined } });
  });
});

describe('parsePagination', () => {
  it('defaults to page 1 size 20', () => {
    expect(parsePagination(new URL('http://x/'))).toEqual({ page: 1, pageSize: 20 });
  });
  it('clamps pageSize to 100', () => {
    expect(parsePagination(new URL('http://x/?page_size=999')).pageSize).toBe(100);
  });
  it('rejects negative or zero values', () => {
    expect(parsePagination(new URL('http://x/?page=-1')).page).toBe(1);
    expect(parsePagination(new URL('http://x/?page_size=0')).pageSize).toBe(20);
  });
});

describe('parseSearch', () => {
  it('returns null q when absent', () => {
    expect(parseSearch(new URL('http://x/')).q).toBeNull();
  });
  it('returns trimmed q when present', () => {
    expect(parseSearch(new URL('http://x/?q=  foo  ')).q).toBe('foo');
  });
});