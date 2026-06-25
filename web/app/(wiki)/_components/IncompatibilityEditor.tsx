'use client';
import { useState } from 'react';

type Props = {
  value: string[];
  onChange: (v: string[]) => void;
};

const FORMAT = /^[^/]+\/[^/]+$/;

export function IncompatibilityEditor({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');

  function add() {
    const t = draft.trim();
    if (!t || !FORMAT.test(t)) return;
    if (value.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs text-red-800"
          >
            {v}
            <button
              type="button"
              aria-label={`remove ${v}`}
              onClick={() => remove(i)}
              className="text-red-600 hover:text-red-800"
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-gray-500">（尚未添加互斥节点）</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="owner/repo"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
        >
          添加
        </button>
      </div>
    </div>
  );
}