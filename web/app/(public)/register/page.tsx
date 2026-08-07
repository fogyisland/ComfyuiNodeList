'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Card } from '@/app/_components/Card';
import { Input, Field } from '@/app/_components/Input';
import { Button } from '@/app/_components/Button';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const body: Record<string, string> = { username, password };
    if (email) body.email = email;

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.error?.message ?? '注册失败';
      setError(msg);
      setBusy(false);
      return;
    }

    // Auto-login after successful registration.
    const signinRes = await signIn('credentials', {
      username,
      password,
      redirect: false,
    });
    setBusy(false);
    if (signinRes?.error) {
      router.push('/login');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md p-4 md:p-8">
      <Card variant="elevated" className="mt-8">
        <h1 className="text-display-md text-fg-primary">注册</h1>
        <p className="mt-1 text-sm text-fg-tertiary">创建账号后即可提交节点。</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="用户名 (3-64 字符,字母/数字/_/-)" htmlFor="username">
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9_-]+"
              autoComplete="username"
            />
          </Field>
          <Field label="密码 (至少 8 字符)" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
          <Field label="邮箱 (可选)" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? '注册中…' : '注册'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-fg-secondary">
          已有账号? <Link href="/login" className="text-brand-500 hover:underline">登录</Link>
        </p>
      </Card>
    </main>
  );
}