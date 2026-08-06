'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function LoginPage() {
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
    const res = await signIn('credentials', {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    setBusy(false);
    if (res?.error) {
      setError('用户名或密码错误');
      return;
    }
    router.push(res?.url ?? callbackUrl);
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold">登录</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-gray-700">用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-700">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-accent px-3 py-2 text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-600">
        没有账号? <Link href="/register" className="text-accent hover:underline">注册</Link>
      </p>
    </main>
  );
}