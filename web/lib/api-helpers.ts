export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, message: string, detail?: unknown): Response {
  return json({ error: { message, detail } }, { status });
}

export function parsePagination(url: URL): { page: number; pageSize: number } {
  const rawPage = Number(url.searchParams.get('page') ?? 1);
  const rawSize = Number(url.searchParams.get('page_size') ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : 20;
  return { page, pageSize };
}

export function parseSearch(url: URL): { q: string | null } {
  const raw = url.searchParams.get('q') ?? url.searchParams.get('search');
  if (!raw) return { q: null };
  const q = raw.trim();
  return { q: q.length === 0 ? null : q };
}