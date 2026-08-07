import Link from 'next/link';
import { SubmitForm } from './SubmitForm';

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-2xl p-4 md:p-8">
      <nav className="mb-4 text-sm text-fg-tertiary">
        <Link href="/" className="hover:text-fg-secondary">Home</Link>
        <span className="mx-2">/</span>
        <span>submit</span>
      </nav>
      <h1 className="text-display-md text-fg-primary">提交你的 ComfyUI 节点</h1>
      <p className="mt-2 text-sm text-fg-secondary">提交后等待管理员审核,通过后会收录到 Wiki。</p>
      <div className="mt-6">
        <SubmitForm />
      </div>
      <p className="mt-6 text-xs text-fg-tertiary">提示:已收录的节点会立即拒绝;重复提交会被去重。</p>
    </main>
  );
}