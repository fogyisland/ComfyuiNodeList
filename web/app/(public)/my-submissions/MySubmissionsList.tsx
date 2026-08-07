'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/app/_components/Card';
import { Badge } from '@/app/_components/Badge';
import { LinkButton } from '@/app/_components/Button';
import { parseGithubUrl } from '@/lib/parse-github-url';

type Status = 'pending' | 'approved' | 'rejected';

type Row = {
  id: number;
  github_url: string;
  name: string | null;
  description: string | null;
  status: Status;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewer_username: string | null;
};

type Filter = 'all' | Status;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
];

const BADGE_KIND: Record<Status, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

/** Narrow an arbitrary `?status=` value to a known filter; anything else is 全部. */
function toFilter(value: string | null): Filter {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : 'all';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

export function MySubmissionsList() {
  const router = useRouter();
  const search = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>(() => toFilter(search.get('status')));

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/submissions/mine')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Row[]) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  function selectFilter(key: Filter) {
    setFilter(key);
    router.replace(key === 'all' ? '/my-submissions' : `/my-submissions?status=${key}`, { scroll: false });
  }

  if (rows === null) return <p className="text-sm text-fg-tertiary">加载中…</p>;

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => selectFilter(f.key)}
            className={
              'rounded-pill px-3 py-1 text-xs transition ' +
              (filter === f.key
                ? 'bg-brand-50 text-brand-600'
                : 'bg-subtle text-fg-secondary hover:text-fg-primary')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card variant="flat">
          <p className="text-sm text-fg-tertiary">（暂无提交）</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const parsed = parseGithubUrl(r.github_url);
            const nodeHref = parsed ? `/nodes/${parsed.owner}/${parsed.repo}` : null;
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg-tertiary">#{r.id}</span>
                      <span className="truncate text-display-sm text-fg-primary">
                        {r.name ?? r.github_url}
                      </span>
                      <Badge kind={BADGE_KIND[r.status]}>{r.status}</Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-fg-tertiary">{r.github_url}</div>
                    <div className="mt-1 text-xs text-fg-tertiary">提交于 {formatTime(r.created_at)}</div>
                    {r.status === 'approved' && r.reviewed_at && (
                      <div className="mt-1 text-xs text-fg-tertiary">
                        通过于 {formatTime(r.reviewed_at)}
                        {r.reviewer_username && <> · 审核人 {r.reviewer_username}</>}
                      </div>
                    )}
                    {r.status === 'rejected' && r.review_note && (
                      <details className="mt-2 rounded-sm bg-tint-danger p-2 text-xs text-danger">
                        <summary className="cursor-pointer select-none font-medium">审核备注</summary>
                        <p className="mt-1 whitespace-pre-wrap">{r.review_note}</p>
                      </details>
                    )}
                  </div>
                  {r.status === 'approved' && nodeHref && (
                    <LinkButton href={nodeHref} variant="secondary" size="sm">
                      查看 →
                    </LinkButton>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
