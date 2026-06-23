import { shortenSpec } from '@/lib/format';
import type { PublishedDependency } from '@/lib/published';

export function DependencyTable({ deps }: { deps: PublishedDependency[] }) {
  if (deps.length === 0) return <p className="text-sm text-gray-500">无依赖。</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-gray-200 text-left text-gray-500">
        <tr>
          <th className="py-2">包</th>
          <th className="py-2">规范</th>
          <th className="py-2">最低</th>
          <th className="py-2">最高</th>
        </tr>
      </thead>
      <tbody>
        {deps.map((d) => (
          <tr key={d.name} className="border-b border-gray-100">
            <td className="py-2 font-mono">{d.name}</td>
            <td className="py-2 font-mono" title={d.spec}>{shortenSpec(d.spec)}</td>
            <td className="py-2 font-mono">{d.min_version ?? '—'}</td>
            <td className="py-2 font-mono">{d.max_version ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
