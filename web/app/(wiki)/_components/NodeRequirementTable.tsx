'use client';
import { useEffect, useRef } from 'react';
import { useForm, useFieldArray, type SubmitHandler } from 'react-hook-form';
import type { PublishedDependency } from '@/lib/published';

type Props = {
  value: PublishedDependency[];
  onChange: (v: PublishedDependency[]) => void;
};

type FormShape = { rows: PublishedDependency[] };

function emptyRow(): PublishedDependency {
  return { name: '', spec: '', min_version: null, max_version: null, is_pinned: false };
}

export function NodeRequirementTable({ value, onChange }: Props) {
  const { control, register, watch } = useForm<FormShape>({
    defaultValues: { rows: value.length > 0 ? value : [emptyRow()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });
  const watched = watch('rows');
  const lastEmitted = useRef<string>('');

  useEffect(() => {
    const serialized = JSON.stringify(watched);
    if (serialized === lastEmitted.current) return;
    lastEmitted.current = serialized;
    const cleaned = (watched as PublishedDependency[]).filter((r) => r.name.trim() !== '');
    onChange(cleaned);
  }, [watched, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-700">
            <th className="px-2 py-1">包名</th>
            <th className="px-2 py-1">规范</th>
            <th className="px-2 py-1">最低</th>
            <th className="px-2 py-1">最高</th>
            <th className="px-2 py-1">固定</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {fields.map((row, i) => (
            <tr key={row.id} className="border-t border-gray-200">
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.name` as const)}
                  className="w-full rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.spec` as const)}
                  className="w-full rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.min_version` as const)}
                  className="w-24 rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  {...register(`rows.${i}.max_version` as const)}
                  className="w-24 rounded border border-gray-300 px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-1 text-center">
                <input
                  type="checkbox"
                  {...register(`rows.${i}.is_pinned` as const)}
                />
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  移除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => append(emptyRow())}
        className="self-start rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
      >
        + 添加行
      </button>
    </div>
  );
}
