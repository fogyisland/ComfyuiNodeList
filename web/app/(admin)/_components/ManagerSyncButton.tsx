'use client';
import { useState } from 'react';
import { Button } from '@/app/_components/Button';
import { Card } from '@/app/_components/Card';

type Props = { managerSystemUserId: number | null };

export function ManagerSyncButton({ managerSystemUserId }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function onClick() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/admin/manager/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMessage({ kind: 'success', text: `已加入队列,task_id=${body.task_id ?? '?'}` });
      else setMessage({ kind: 'error', text: `同步失败:${body?.error?.message ?? res.statusText}` });
    } catch (e) {
      setMessage({ kind: 'error', text: `网络错误:${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  }

  const disabled = busy || managerSystemUserId === null;
  const title = managerSystemUserId === null
    ? '系统用户未初始化,请运行 pnpm prisma:seed'
    : busy ? '正在发送…' : '拉取 ComfyUI Manager 目录,作为待审提交写入本地数据库';

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-fg-primary">ComfyUI Manager 目录同步</div>
          <div className="mt-1 text-xs text-fg-tertiary">{title}</div>
        </div>
        <Button onClick={onClick} disabled={disabled}>{busy ? '同步中…' : '同步 Manager 目录'}</Button>
      </div>
      {message && (
        <div
          className={
            'mt-3 rounded-sm p-2 text-sm ' +
            (message.kind === 'success'
              ? 'bg-tint-success text-success'
              : 'bg-tint-danger text-danger')
          }
        >
          {message.text}
        </div>
      )}
    </Card>
  );
}