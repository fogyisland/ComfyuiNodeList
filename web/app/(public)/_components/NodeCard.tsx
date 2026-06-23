import Link from 'next/link';
import { formatDate } from '@/lib/format';

type Props = {
  owner: string;
  repo: string;
  name: string;
  author: string;
  description: string | null;
  updatedAt: string | Date;
};

export function NodeCard({ owner, repo, name, author, description, updatedAt }: Props) {
  return (
    <Link
      href={`/nodes/${owner}/${repo}`}
      className="block rounded border border-gray-200 bg-white p-4 hover:border-accent"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        <span className="text-xs text-gray-500">{formatDate(updatedAt)}</span>
      </div>
      <div className="mt-1 text-sm text-gray-500">by {author}</div>
      {description && <p className="mt-2 text-sm text-gray-700">{description}</p>}
    </Link>
  );
}
