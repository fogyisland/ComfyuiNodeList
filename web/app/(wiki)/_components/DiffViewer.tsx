'use client';
import type { FieldDiff } from '@/lib/diff';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

type Props = { diff: FieldDiff[] };

export function DiffViewer({ diff }: Props) {
  if (diff.length === 0) {
    return <p className="text-sm text-gray-500">两个版本完全相同,无差异。</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {diff.map((d) => (
        <section key={d.field} className="rounded border border-gray-200 p-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">{labelFor(d.field)}</h3>
          {renderField(d)}
        </section>
      ))}
    </div>
  );
}

function labelFor(field: FieldDiff['field']): string {
  return {
    python_min: 'Python 最低版本',
    python_max: 'Python 最高版本',
    dependencies: '依赖',
    node_class_mappings: '节点类映射',
    incompatibilities: '互斥节点',
    notes_md: 'Markdown 备注',
  }[field];
}

function renderField(d: FieldDiff) {
  if (d.field === 'python_min' || d.field === 'python_max') {
    return (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded bg-red-50 p-2">
          <div className="text-xs text-red-700">之前</div>
          <div className="font-mono">{d.before ?? '（无）'}</div>
        </div>
        <div className="rounded bg-green-50 p-2">
          <div className="text-xs text-green-700">之后</div>
          <div className="font-mono">{d.after ?? '（无）'}</div>
        </div>
      </div>
    );
  }
  if (d.field === 'dependencies') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {d.dependencyRows.map((r, i) => (
          <div key={i} className="rounded border border-gray-200 p-2">
            {r.kind === 'added' && (
              <div className="rounded bg-green-50 p-2">
                <span className="text-xs text-green-700">新增</span>
                <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.row, null, 2)}</pre>
              </div>
            )}
            {r.kind === 'removed' && (
              <div className="rounded bg-red-50 p-2">
                <span className="text-xs text-red-700">删除</span>
                <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.row, null, 2)}</pre>
              </div>
            )}
            {r.kind === 'changed' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-red-50 p-2">
                  <div className="text-xs text-red-700">之前</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.before, null, 2)}</pre>
                </div>
                <div className="rounded bg-green-50 p-2">
                  <div className="text-xs text-green-700">之后</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(r.after, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (d.field === 'node_class_mappings' || d.field === 'incompatibilities') {
    return (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded bg-red-50 p-2">
          <div className="text-xs text-red-700">之前</div>
          <ul className="list-disc pl-4 font-mono text-xs">
            {d.before.length === 0 ? <li className="list-none text-gray-500">（无）</li> : d.before.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
        <div className="rounded bg-green-50 p-2">
          <div className="text-xs text-green-700">之后</div>
          <ul className="list-disc pl-4 font-mono text-xs">
            {d.after.length === 0 ? <li className="list-none text-gray-500">（无）</li> : d.after.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
      </div>
    );
  }
  // notes_md
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded bg-red-50 p-2">
        <div className="mb-1 text-xs text-red-700">之前</div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: md.render(String(d.before ?? '')) }} />
      </div>
      <div className="rounded bg-green-50 p-2">
        <div className="mb-1 text-xs text-green-700">之后</div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: md.render(String(d.after ?? '')) }} />
      </div>
    </div>
  );
}
