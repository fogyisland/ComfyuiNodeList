'use client';

type Props = {
  min: string | null;
  max: string | null;
  onChange: (min: string | null, max: string | null) => void;
};

export function PythonVersionRange({ min, max, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Python 最低版本</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="3.10"
          className="rounded border border-gray-300 px-2 py-1"
          value={min ?? ''}
          onChange={(e) => onChange(e.target.value.trim() || null, max)}
        />
      </label>
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Python 最高版本（无上限则留空）</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="（无上限）"
          className="rounded border border-gray-300 px-2 py-1"
          value={max ?? ''}
          onChange={(e) => onChange(min, e.target.value.trim() || null)}
        />
      </label>
    </div>
  );
}