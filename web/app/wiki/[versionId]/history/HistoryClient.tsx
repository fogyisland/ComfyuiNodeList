'use client';
import { useState } from 'react';
import { DiffViewer } from '@/app/(wiki)/_components/DiffViewer';
import type { FieldDiff } from '@/lib/diff';

type Item = {
  id: number;
  editSummary: string;
  status: string;
  authorUsername: string;
  createdAt: string;
};

type Props = { items: Item[]; versionId: number };

export function HistoryClient({ items, versionId: _versionId }: Props) {
  const [fromId, setFromId] = useState<number | null>(items[1]?.id ?? null);
  const [toId, setToId] = useState<number | null>(items[0]?.id ?? null);
  const [diff, setDiff] = useState<FieldDiff[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadDiff() {
    if (!fromId || !toId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/wiki/diff?from=${fromId}&to=${toId}`);
      if (!res.ok) {
        setDiff([]);
        return;
      }
      const body = (await res.json()) as { diff: FieldDiff[] };
      setDiff(body.diff);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <label>
          from:{' '}
          <select
            value={fromId ?? ''}
            onChange={(e) => setFromId(Number(e.target.value) || null)}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            <option value="">--</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                #{it.id} {it.authorUsername} {it.editSummary}
              </option>
            ))}
          </select>
        </label>
        <label>
          to:{' '}
          <select
            value={toId ?? ''}
            onChange={(e) => setToId(Number(e.target.value) || null)}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            <option value="">--</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                #{it.id} {it.authorUsername} {it.editSummary}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={loadDiff}
          disabled={!fromId || !toId || loading}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '加载中…' : '查看 diff'}
        </button>
      </div>

      {diff && <DiffViewer diff={diff} />}

      <ul className="divide-y divide-gray-200">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <div className="font-mono text-xs text-gray-500">#{it.id}</div>
              <div className="font-medium">{it.editSummary}</div>
              <div className="text-xs text-gray-500">
                {it.authorUsername} · {it.createdAt} · status: {it.status}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
