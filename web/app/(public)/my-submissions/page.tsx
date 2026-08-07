import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LinkButton } from '@/app/_components/Button';
import { MySubmissionsList } from './MySubmissionsList';

export default async function MySubmissionsPage() {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) redirect('/login?callbackUrl=/my-submissions');

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <nav className="mb-4 text-sm text-fg-tertiary">
        <Link href="/" className="hover:text-fg-secondary">Home</Link>
        <span className="mx-2">/</span>
        <span>my-submissions</span>
      </nav>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-display-md text-fg-primary">我的提交</h1>
        <LinkButton href="/submit" variant="primary">+ 提交新节点</LinkButton>
      </div>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-fg-tertiary">加载中…</p>}>
          <MySubmissionsList />
        </Suspense>
      </div>
    </main>
  );
}
