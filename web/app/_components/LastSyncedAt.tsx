type Props = {
  run: {
    finishedAt: Date | string;
  } | null;
};

function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 天前`;
}

function absoluteTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

export function LastSyncedAt({ run }: Props) {
  if (!run) {
    return (
      <span className="text-xs text-gray-400" data-testid="last-synced-at">
        Manager sync never ran
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-500" data-testid="last-synced-at">
      Last synced at:{' '}
      <span className="font-medium text-gray-700">{relativeTime(run.finishedAt)}</span>
      <span className="ml-1 text-gray-400" title={absoluteTime(run.finishedAt)}>
        ({absoluteTime(run.finishedAt)})
      </span>
    </span>
  );
}
