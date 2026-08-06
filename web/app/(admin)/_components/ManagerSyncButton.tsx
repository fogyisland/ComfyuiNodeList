'use client';
import { useState } from 'react';

type Props = {
  managerSystemUserId: number | null;
};

export function ManagerSyncButton({ managerSystemUserId }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function onClick() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/admin/manager/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ kind: 'success', text: `已加入队列，task_id=${body.task_id ?? '?'}` });
      } else {
        const detail = body?.error?.message ?? res.statusText;
        setMessage({ kind: 'error', text: `同步失败: ${detail}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage({ kind: 'error', text: `网络错误: ${msg}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  }

  const disabled = busy || managerSystemUserId === null;
  const title =
    managerSystemUserId === null
      ? '系统用户未初始化，请运行 pnpm prisma:seed'
      : busy
      ? '正在发送…'
      : '拉取 ComfyUI Manager 目录，作为待审提交写入本地数据库';

  return (
    <div className="mb-6 rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">ComfyUI Manager 目录同步</div>
          <div className="mt-1 text-xs text-gray-500">{title}</div>
        </div>
        <button
          onClick={onClick}
          disabled={disabled}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '同步中…' : '同步 Manager 目录'}
        </button>
      </div>
      {message && (
        <div
          className={
            message.kind === 'success'
              ? 'mt-3 rounded bg-green-50 p-2 text-sm text-green-700'
              : 'mt-3 rounded bg-red-50 p-2 text-sm text-red-700'
          }
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
