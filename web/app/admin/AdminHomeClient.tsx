'use client';

import { AdminDashboard } from '@/app/(admin)/_components/AdminDashboard';
import type { ScanRunSummary } from '@/lib/scan-runs';

type AdminDashboardRecentItem = {
  id: number;
  kind: 'revision' | 'submission';
  at: string;
  summary: string;
};

type Props = {
  pendingRevisions: number;
  pendingSubmissions: number;
  recent: AdminDashboardRecentItem[];
  managerSystemUserId: number | null;
  latestRun: ScanRunSummary | null;
};

export function AdminHomeClient({
  pendingRevisions,
  pendingSubmissions,
  recent,
  managerSystemUserId,
  latestRun,
}: Props) {
  return (
    <AdminDashboard
      pendingRevisions={pendingRevisions}
      pendingSubmissions={pendingSubmissions}
      recent={recent}
      managerSystemUserId={managerSystemUserId}
      latestRun={latestRun}
    />
  );
}
