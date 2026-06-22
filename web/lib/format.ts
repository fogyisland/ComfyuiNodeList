export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 19) + 'Z';
}

export function shortenSpec(spec: string, max = 24): string {
  if (spec.length <= max) return spec;
  return spec.slice(0, max - 2) + '...';
}