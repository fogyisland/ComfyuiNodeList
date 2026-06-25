'use client';
import Link from 'next/link';

type Props = {
  pendingRevisions: number;
  pendingSubmissions: number;
  recent: Array<{ id: number; kind: 'revision' | 'submission'; at: string; summary: string }>;
};

export function AdminDashboard({ pendingRevisions, pendingSubmissions, recent }: Props) {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <div className="mb-6 grid grid-cols-2 gap-4">
        <Link
          href="/admin/revisions"
          className="rounded border border-gray-200 bg-white p-4 hover:border-blue-400"
        >
          <div className="text-xs text-gray-500">待审核修订</div>
          <div className="mt-1 text-2xl font-bold">{pendingRevisions}</div>
        </Link>
        <Link
          href="/admin/submissions"
          className="rounded border border-gray-200 bg-white p-4 hover:border-blue-400"
        >
          <div className="text-xs text-gray-500">待审核节点收录</div>
          <div className="mt-1 text-2xl font-bold">{pendingSubmissions}</div>
        </Link>
      </div>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">最近活动</h2>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {recent.length === 0 ? (
          <li className="p-3 text-sm text-gray-500">（暂无）</li>
        ) : (
          recent.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between p-3 text-sm">
              <span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{r.kind}</span>{' '}
                {r.summary}
              </span>
              <span className="text-xs text-gray-500">{r.at}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
