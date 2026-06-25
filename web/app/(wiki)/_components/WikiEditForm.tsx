'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PythonVersionRange } from './PythonVersionRange';
import { IncompatibilityEditor } from './IncompatibilityEditor';
import { NodeRequirementTable } from './NodeRequirementTable';
import { MarkdownEditor } from './MarkdownEditor';
import { ConflictPreview } from './ConflictPreview';
import { prepareSubmit, withdrawRevisionAction } from '@/app/wiki/[versionId]/_actions';
import type { PublishedRequirements, PublishedDependency } from '@/lib/published';

type LatestPending = {
  id: number;
  editSummary: string;
  createdAt: string;
};

type Props = {
  versionId: number;
  initialPublished: PublishedRequirements;
  initialPending: LatestPending | null;
};

type FormShape = {
  python_min: string | null;
  python_max: string | null;
  dependencies: PublishedDependency[];
  incompatibilities: string[];
  notes_md: string;
  edit_summary: string;
};

function toFormShape(p: PublishedRequirements): FormShape {
  return {
    python_min: p.python_min,
    python_max: p.python_max,
    dependencies: p.dependencies,
    incompatibilities: p.incompatibilities,
    notes_md: '',
    edit_summary: '',
  };
}

export function WikiEditForm({ versionId, initialPublished, initialPending }: Props) {
  const { register, watch, setValue, getValues, handleSubmit } = useForm<FormShape>({
    defaultValues: toFormShape(initialPublished),
  });
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(values: FormShape) {
    if (!values.edit_summary.trim()) {
      window.alert('请填写 edit_summary');
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.set('versionId', String(versionId));
    fd.set('payload', JSON.stringify(values));
    void prepareSubmit(fd);
  }

  const pyMin = watch('python_min');
  const pyMax = watch('python_max');
  const notes = watch('notes_md');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {initialPending && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-yellow-800">你有这条 pending 修订</div>
          <div className="text-xs text-yellow-700">edit_summary: {initialPending.editSummary}</div>
          <form
            action={withdrawRevisionAction}
            className="mt-2"
          >
            <input type="hidden" name="revisionId" value={initialPending.id} />
            <input type="hidden" name="versionId" value={versionId} />
            <button type="submit" className="rounded bg-yellow-200 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-300">
              撤回此 pending
            </button>
          </form>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Python 范围</h2>
        <PythonVersionRange
          min={pyMin}
          max={pyMax}
          onChange={(min, max) => {
            setValue('python_min', min);
            setValue('python_max', max);
          }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">依赖</h2>
        <NodeRequirementTable
          value={getValues('dependencies')}
          onChange={(v) => setValue('dependencies', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">节点类映射</h2>
        <div className="text-xs text-gray-500">（暂不支持多个映射数组 — Plan 3 改进）</div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">互斥节点</h2>
        <IncompatibilityEditor
          value={getValues('incompatibilities')}
          onChange={(v) => setValue('incompatibilities', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Markdown 备注</h2>
        <MarkdownEditor
          value={notes}
          onChange={(v) => setValue('notes_md', v)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">冲突预览（Plan 3 启用）</h2>
        <ConflictPreview versionId={String(versionId)} />
      </section>

      <section>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-700">edit_summary（1–200 字符）</span>
          <input
            {...register('edit_summary')}
            className="rounded border border-gray-300 px-2 py-1"
            placeholder="简要说明本次改动"
          />
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          下一步
        </button>
      </div>
    </form>
  );
}
