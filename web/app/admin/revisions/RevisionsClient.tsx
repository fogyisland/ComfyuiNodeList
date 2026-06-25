'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = {
  id: number;
  versionId: number;
  authorUsername: string;
  editSummary: string;
  createdAt: string;
};

type Props = { items: Item[] };

export function RevisionsClient({ items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [modal, setModal] = useState<{ id: number; mode: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  async function submit() {
    if (!modal) return;
    setBusy(modal.id);
    const path = modal.mode === 'approve'
      ? `/api/v1/admin/revisions/${modal.id}/approve`
      : `/api/v1/admin/revisions/${modal.id}/reject`;
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modal.mode === 'approve' ? (note ? { review_note: note } : {}) : { review_note: note }),
    });
    setBusy(null);
    setModal(null);
    setNote('');
    if (!res.ok) {
      window.alert(`操作失败: ${res.status}`);
    }
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="p-6 text-sm text-gray-500">暂无待审核修订。</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">修订审核</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">节点版本</th>
            <th className="px-2 py-1">作者</th>
            <th className="px-2 py-1">edit_summary</th>
            <th className="px-2 py-1">提交时间</th>
            <th className="px-2 py-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-gray-200">
              <td className="px-2 py-1 font-mono text-xs">#{it.id}</td>
              <td className="px-2 py-1">v_id={it.versionId}</td>
              <td className="px-2 py-1">{it.authorUsername}</td>
              <td className="px-2 py-1">{it.editSummary}</td>
              <td className="px-2 py-1 text-xs text-gray-500">{it.createdAt}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'approve' })}
                  className="mr-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ id: it.id, mode: 'reject' })}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                >
                  驳回
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-96 rounded bg-white p-4 shadow-lg">
            <h3 className="mb-2 text-sm font-semibold">
              {modal.mode === 'approve' ? '批准修订' : '驳回修订'} #{modal.id}
            </h3>
            <label className="mb-1 block text-xs text-gray-700">review_note（驳回必填，1–1000 字符）</label>
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setModal(null); setNote(''); }}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy === modal.id || (modal.mode === 'reject' && note.trim().length === 0)}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === modal.id ? '处理中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
