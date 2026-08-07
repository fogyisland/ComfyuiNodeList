'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/app/_components/Card';
import { Input, Textarea, Field } from '@/app/_components/Input';
import { Button } from '@/app/_components/Button';
import { Badge } from '@/app/_components/Badge';
import { parseGithubUrl } from '@/lib/parse-github-url';

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'ok'; owner: string; repo: string }
  | { kind: 'invalid' }
  | { kind: 'duplicate-node' }
  | { kind: 'duplicate-pending' };

type SubmitError =
  | { kind: 'network'; message: string }
  | { kind: 'duplicate-node'; message: string }
  | { kind: 'duplicate-pending'; message: string }
  | { kind: 'invalid-url'; message: string }
  | { kind: 'missing-field'; message: string }
  | { kind: 'description-too-long'; message: string }
  | { kind: 'unknown'; message: string };

const ERROR_COPY: Record<SubmitError['kind'], string> = {
  network: '网络错误,请重试',
  'duplicate-node': '该节点已收录,无需重复提交',
  'duplicate-pending': '已有待审提交,请等待管理员审核',
  'invalid-url': 'URL 无法解析',
  'missing-field': '请填写所有必填字段',
  'description-too-long': '描述过长(>500 字符)',
  unknown: '提交失败,请稍后重试',
};

export function SubmitForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const [successId, setSuccessId] = useState<number | null>(null);

  useEffect(() => {
    if (!url) { setPreview({ kind: 'idle' }); return; }
    const t = setTimeout(() => {
      const parsed = parseGithubUrl(url);
      if (!parsed) { setPreview({ kind: 'invalid' }); return; }
      setPreview({ kind: 'ok', owner: parsed.owner, repo: parsed.repo });
    }, 300);
    return () => clearTimeout(t);
  }, [url]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: url, name, description }),
      });
      if (res.status === 201) {
        const body = await res.json();
        setSuccessId(body.id);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const code = body?.error?.message ?? body?.error ?? 'unknown';
      switch (code) {
        case 'already-exists':
          setError({ kind: 'duplicate-node', message: ERROR_COPY['duplicate-node'] });
          break;
        case 'duplicate-pending':
          setError({ kind: 'duplicate-pending', message: ERROR_COPY['duplicate-pending'] });
          break;
        case 'invalid-url':
          setError({ kind: 'invalid-url', message: ERROR_COPY['invalid-url'] });
          break;
        case 'missing-field':
          setError({ kind: 'missing-field', message: ERROR_COPY['missing-field'] });
          break;
        case 'description-too-long':
          setError({ kind: 'description-too-long', message: ERROR_COPY['description-too-long'] });
          break;
        default:
          setError({ kind: 'unknown', message: ERROR_COPY.unknown });
      }
    } catch {
      setError({ kind: 'network', message: ERROR_COPY.network });
    } finally {
      setBusy(false);
    }
  }

  if (successId !== null) {
    return (
      <Card variant="elevated">
        <div className="text-display-sm text-fg-primary">提交成功</div>
        <p className="mt-2 text-sm text-fg-secondary">已加入待审队列,ID: #{successId}</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => router.push('/my-submissions')}>查看我的提交</Button>
          <Button variant="secondary" onClick={() => { setSuccessId(null); setUrl(''); setName(''); setDescription(''); setPreview({ kind: 'idle' }); setError(null); }}>提交下一个</Button>
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
          {preview.kind === 'duplicate-node' && (
            <p className="mt-2 flex items-center gap-2 text-xs text-danger">
              <Badge kind="danger">!</Badge> 已收录
            </p>
          )}
          {preview.kind === 'duplicate-pending' && (
            <p className="mt-2 flex items-center gap-2 text-xs text-warning">
              <Badge kind="warning">!</Badge> 已有待审
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
          <div className="flex items-center gap-2 rounded-sm bg-tint-danger p-3 text-sm text-danger">
            <Badge kind="danger">!</Badge> {error.message}
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