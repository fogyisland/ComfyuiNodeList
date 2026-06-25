import { redirect } from 'next/navigation';
import { confirmSubmit } from '@/app/wiki/[versionId]/_actions';

type Props = {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ d?: string }>;
};

function b64Decode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

export default async function SubmitConfirmPage({ params, searchParams }: Props) {
  const { versionId } = await params;
  const { d } = await searchParams;
  if (!d) redirect(`/wiki/${versionId}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64Decode(d));
  } catch {
    redirect(`/wiki/${versionId}`);
  }
  const obj = parsed as { edit_summary?: string };
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-semibold">确认提交</h1>
      <p className="mb-3 text-sm text-gray-700">
        本次提交 edit_summary: <span className="font-mono">{obj.edit_summary ?? ''}</span>
      </p>
      <form action={confirmSubmit} className="flex gap-2">
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="d" value={d} />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
          确认提交
        </button>
        <a
          href={`/wiki/${versionId}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          返回编辑
        </a>
      </form>
    </main>
  );
}