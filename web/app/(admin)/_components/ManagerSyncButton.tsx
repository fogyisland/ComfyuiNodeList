'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/_components/Button';
import { Card } from '@/app/_components/Card';

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'polling'; startedAt: number }
  | { kind: 'done'; status: 'ok' | 'failed'; error?: string }
  | { kind: 'timeout' };

const TIMEOUT_MS = 180_000;
const POLL_INTERVALS_MS = [1000, 1000, 5000];

export function ManagerSyncButton({ managerSystemUserId }: { managerSystemUserId: number | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const cancelledRef = useRef<boolean>(false);
  // `managerSystemUserId` is part of the existing component contract.
  // We don't need it on the client side (the API handles auth); keep the prop
  // so the parent signature is unchanged.
  void managerSystemUserId;

  useEffect(() => {
    return () => { cancelledRef.current = true; };
  }, []);

  async function startPolling() {
    const startedAt = Date.now();
    setPhase({ kind: 'polling', startedAt });
    let i = 0;

    const tick = async () => {
      if (cancelledRef.current) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        if (!cancelledRef.current) setPhase({ kind: 'timeout' });
        return;
      }
      try {
        const res = await fetch('/api/v1/admin/manager/sync/status', { cache: 'no-store' });
        if (res.ok) {
          const { run } = await res.json();
          if (run && (run.status === 'ok' || run.status === 'failed')) {
            if (run.status === 'ok') {
              router.refresh();
              if (!cancelledRef.current) setPhase({ kind: 'done', status: 'ok' });
            } else {
              const errText = run.error ?? '同步失败';
              if (!cancelledRef.current) setPhase({ kind: 'done', status: 'failed', error: errText });
            }
            return;
          }
          // run === null or run.status === 'running' -> keep polling
        }
        // 401/403 or other non-ok: keep polling silently (don't spam errors)
      } catch {
        // network blip - keep polling
      }
      if (cancelledRef.current) return;
      setTimeout(tick, POLL_INTERVALS_MS[Math.min(i++, POLL_INTERVALS_MS.length - 1)]);
    };

    // Fire first tick immediately so we don't wait a full interval before the first poll
    tick();
  }

  async function onClick() {
    setPhase({ kind: 'submitting' });
    let triggerOk = false;
    try {
      const res = await fetch('/api/v1/admin/manager/sync', { method: 'POST' });
      triggerOk = res.ok;
    } catch {
      setPhase({ kind: 'done', status: 'failed', error: '请求失败' });
      return;
    }
    if (!triggerOk) {
      setPhase({ kind: 'done', status: 'failed', error: '触发接口返回非 2xx' });
      return;
    }
    await startPolling();
  }

  const isBusy = phase.kind === 'submitting' || phase.kind === 'polling';
  let label: string;
  if (phase.kind === 'submitting') label = '触发中…';
  else if (phase.kind === 'polling') {
    const elapsed = Math.floor((Date.now() - phase.startedAt) / 1000);
    label = `同步中… (${elapsed}s)`;
  }
  else if (phase.kind === 'done' && phase.status === 'failed') label = '重试';
  else label = '同步 Manager 目录';

  const title = isBusy
    ? '正在同步…'
    : '拉取 ComfyUI Manager 目录,作为待审提交写入本地数据库';

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-fg-primary">ComfyUI Manager 目录同步</div>
          <div className="mt-1 text-xs text-fg-tertiary">{title}</div>
        </div>
        <Button onClick={onClick} disabled={isBusy}>{label}</Button>
      </div>
      <div className="flex items-center gap-3 mt-3">
        {phase.kind === 'done' && phase.status === 'ok' && (
          <span className="text-sm bg-tint-success text-success">已同步</span>
        )}
        {phase.kind === 'done' && phase.status === 'failed' && (
          <span className="text-sm bg-tint-danger text-danger">{phase.error}</span>
        )}
        {phase.kind === 'timeout' && (
          <span className="text-sm text-fg-tertiary">仍在后台运行,刷新页面查看</span>
        )}
      </div>
    </Card>
  );
}