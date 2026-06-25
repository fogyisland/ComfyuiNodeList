'use client';
import { useEffect, useState } from 'react';

type Props = { versionId: string };

export function ConflictPreview(_props: Props) {
  const [message] = useState('暂未启用冲突检测(Plan 3 即将上线)');
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-600">
      {message}
    </div>
  );
}