'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/app/_components/Card';
import { Input, Textarea, Field } from '@/app/_components/Input';
import { Button } from '@/app/_components/Button';
import { Badge } from '@/app/_components/Badge';

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'ok'; owner: string; repo: string }
  | { kind: 'invalid' }
  | { kind: 'duplicate-node' }
  | { kind: 'duplicate-pending' };

function parseGithubUrlClient(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

export function SubmitForm() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<number | null>(null);

  useEffect(() => {
    if (!url) { setPreview({ kind: 'idle' }); return; }
    const t = setTimeout(async () => {
      const parsed = parseGithubUrlClient(url);
      if (!parsed) { setPreview({ kind: 'invalid' }); return; }
      setPreview({ kind: 'ok', owner: parsed.owner, repo: parsed.repo });
    }, 300);
    return () => clearTimeout(t);
  }, [url]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_url: url, name, description }),
    });
    setBusy(false);
    if (res.status === 201) {
      const body = await res.json();
      setSuccessId(body.id);
      return;
    }
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.message ?? body?.error ?? 'unknown';
    setError(`提交失败:${code}`);
  }

  if (successId !== null) {
    return (
      <Card variant="elevated">
        <div className="text-display-sm text-fg-primary">提交成功</div>
        <p className="mt-2 text-sm text-fg-secondary">已加入待审队列,ID: #{successId}</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => location.href = '/my-submissions'}>查看我的提交</Button>
          <Button variant="secondary" onClick={() => { setSuccessId(null); setUrl(''); setName(''); setDescription(''); }}>提交下一个</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="elevated">
      <form onSubmit={onSubmit} className="space-y-6">
        <Field label="GitHub 仓库 URL *" htmlFor="url" error={preview.kind === 'invalid' ? 'URL 无法解析' : null}>
          <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" required maxLength={512} invalid={preview.kind === 'invalid'} />
          {preview.kind === 'ok' && (
            <p className="mt-2 flex items-center gap-2 text-xs text-success">
              <span>✓ {preview.owner}/{preview.repo}</span>
              <a href={url} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">在 GitHub 打开 →</a>
            </p>
          )}
        </Field>
        <Field label="展示名 *" htmlFor="name">
          <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} placeholder="ComfyUI Impact Pack" />
        </Field>
        <Field label="简短描述 *" htmlFor="description" helper="1-500 字符" error={description.length > 500 ? '描述过长' : null}>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={500} placeholder="Detector, detailer, sampler and other impact nodes for ComfyUI." invalid={description.length > 500} />
          <div className="mt-1 text-right text-xs text-fg-tertiary">{description.length}/500</div>
        </Field>
        {error && (
          <div className="flex items-center gap-2 rounded-sm bg-red-50 p-3 text-sm text-danger">
            <Badge kind="danger">!</Badge> {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => history.back()}>取消</Button>
          <Button type="submit" disabled={busy || preview.kind !== 'ok'}>{busy ? '提交中…' : '提交审核'}</Button>
        </div>
      </form>
    </Card>
  );
}