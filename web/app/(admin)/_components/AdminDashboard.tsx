'use client';
import Link from 'next/link';
import { ManagerSyncButton } from './ManagerSyncButton';
import { Card } from '@/app/_components/Card';
import { Badge } from '@/app/_components/Badge';
import type { ScanRunSummary } from '@/lib/scan-runs';

type Props = {
  pendingRevisions: number;
  pendingSubmissions: number;
  recent: Array<{ id: number; kind: 'revision' | 'submission'; at: string; summary: string }>;
  managerSystemUserId: number | null;
  latestRun: ScanRunSummary | null;
};

export function AdminDashboard({ pendingRevisions, pendingSubmissions, recent, managerSystemUserId, latestRun }: Props) {
  // Plan 5.1.4 Task 4 will render <LastSyncedAt run={latestRun} /> next to
  // <ManagerSyncButton>. Reference the prop here so it is consumed by
  // TypeScript's noUnusedLocals check; Task 4 will replace this with the
  // actual component.
  void latestRun;
  return (
    <div className="space-y-6">
      <h1 className="text-display-md text-fg-primary">Dashboard</h1>
      <div className="flex items-center gap-4">
        <ManagerSyncButton managerSystemUserId={managerSystemUserId} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { href: '/admin/revisions', label: '待审核修订', value: pendingRevisions },
          { href: '/admin/submissions', label: '待审核节点', value: pendingSubmissions },
          { href: '/nodes', label: '本周新增', value: 0 },
          { href: '/admin', label: '本周同步', value: 0 },
        ].map((s) => (
          <Link key={s.label} href={s.href}>
            <Card>
              <div className="text-xs uppercase tracking-wider text-fg-tertiary">{s.label}</div>
              <div className="mt-2 text-display-md text-fg-primary">{s.value}</div>
            </Card>
          </Link>
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-display-sm text-fg-primary">最近活动</h2>
        <Card variant="elevated" className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-2xs uppercase tracking-wider text-fg-tertiary">
              <tr>
                <th className="px-4 py-3 text-left">类型</th>
                <th className="px-4 py-3 text-left">详情</th>
                <th className="px-4 py-3 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {recent.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-fg-tertiary">（暂无）</td></tr>
              ) : recent.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="hover:bg-subtle">
                  <td className="px-4 py-3">
                    <Badge kind={r.kind === 'revision' ? 'info' : 'brand'}>{r.kind}</Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">{r.summary}</td>
                  <td className="px-4 py-3 text-right text-xs text-fg-tertiary">{r.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}