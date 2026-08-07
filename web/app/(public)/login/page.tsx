'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/app/_components/Card';
import { Input, Field } from '@/app/_components/Input';
import { Button } from '@/app/_components/Button';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get('callbackUrl') ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await signIn('credentials', { username, password, redirect: false, callbackUrl });
    setBusy(false);
    if (res?.error) { setError('用户名或密码错误'); return; }
    router.push(res?.url ?? callbackUrl);
    router.refresh();
  }

  return (
    <Card variant="elevated" className="mt-8">
      <h1 className="text-display-md text-fg-primary">登录</h1>
      <p className="mt-1 text-sm text-fg-tertiary">登录后可以提交节点、编辑 wiki。</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="用户名" htmlFor="username">
          <Input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
        </Field>
        <Field label="密码" htmlFor="password">
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-fg-secondary">
        没有账号? <Link href="/register" className="text-brand-500 hover:underline">注册</Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md p-4 md:p-8">
      <Suspense fallback={<Card variant="elevated" className="mt-8" aria-busy="true" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}