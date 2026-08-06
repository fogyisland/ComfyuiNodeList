'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

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
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold">注册</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-gray-700">用户名 (3-64 字符,字母/数字/_/-)</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={64}
            pattern="[A-Za-z0-9_-]+"
            autoComplete="username"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-700">密码 (至少 8 字符)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-700">邮箱 (可选)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-accent px-3 py-2 text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '注册中…' : '注册'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-600">
        已有账号? <Link href="/login" className="text-accent hover:underline">登录</Link>
      </p>
    </main>
  );
}