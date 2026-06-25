'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = {
  id: number;
  username: string;
  avatarUrl: string;
  role: 'user' | 'admin';
};

type Props = {
  items: Item[];
  currentUserId: number;
};

export function UsersClient({ items, currentUserId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function changeRole(userId: number, role: 'user' | 'admin') {
    setBusy(userId);
    const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.text();
      window.alert(`操作失败: ${res.status} ${body}`);
    }
    router.refresh();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">用户角色</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">username</th>
            <th className="px-2 py-1">role</th>
            <th className="px-2 py-1">说明</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-t border-gray-200">
                <td className="px-2 py-1 font-mono text-xs">#{u.id}</td>
                <td className="px-2 py-1">{u.username}</td>
                <td className="px-2 py-1">
                  <select
                    disabled={busy === u.id}
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value as 'user' | 'admin')}
                    className="rounded border border-gray-300 px-1 py-0.5 text-sm"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-2 py-1 text-xs text-gray-500">
                  {isSelf && '（你自己,不可降级）'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
