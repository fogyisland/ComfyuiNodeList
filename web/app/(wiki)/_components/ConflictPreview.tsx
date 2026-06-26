'use client';
import { useEffect, useState } from 'react';

type Installed = { owner: string; repo: string; version_tag: string };
type Draft = {
  python_min?: string | null;
  python_max?: string | null;
  dependencies: { name: string; spec: string; min_version: string | null; max_version: string | null; is_pinned: boolean }[];
  node_class_mappings: string[];
  incompatibilities: string[];
};
type Conflict =
  | { type: 'python_version'; severity: 'error'; nodes: string[]; detail: string }
  | { type: 'package_version'; severity: 'error' | 'warning'; nodes: string[]; detail: string; package: string }
  | { type: 'node_class'; severity: 'error'; nodes: string[]; detail: string; className: string }
  | { type: 'incompatibility'; severity: 'warning'; nodes: string[]; detail: string };

type Props = {
  installed: Installed[];
  draft: Draft;
  currentLabel: string;
};

export function ConflictPreview({ installed, draft, currentLabel }: Props) {
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/conflicts/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ installed, draft }),
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { conflicts: Conflict[] };
        setConflicts(data.conflicts);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [installed, draft]);

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        无法获取冲突信息：{error}
      </div>
    );
  }
  if (conflicts === null) {
    return (
      <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
        正在检查冲突…
      </div>
    );
  }
  if (conflicts.length === 0) {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">
        无冲突 ✓
      </div>
    );
  }
  // Replace <draft> with currentLabel in nodes and detail
  const labelize = (s: string) => s.replace(/<draft>/g, currentLabel);
  const sections: Array<{ title: string; items: Conflict[] }> = [
    { title: 'Python 版本冲突', items: conflicts.filter((c) => c.type === 'python_version') },
    { title: '包版本冲突', items: conflicts.filter((c) => c.type === 'package_version') },
    { title: '节点类冲突', items: conflicts.filter((c) => c.type === 'node_class') },
    { title: '互斥声明', items: conflicts.filter((c) => c.type === 'incompatibility') },
  ];
  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) =>
        s.items.length === 0 ? null : (
          <div key={s.title} className="rounded border border-gray-300 p-3 text-sm">
            <h3 className="mb-2 font-semibold">{s.title}</h3>
            <ul className="flex flex-col gap-1">
              {s.items.map((c, i) => (
                <li
                  key={i}
                  className={`rounded px-2 py-1 ${
                    c.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800'
                  }`}
                >
                  <span className="font-mono text-xs">[{c.severity}]</span> {labelize(c.detail)}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
