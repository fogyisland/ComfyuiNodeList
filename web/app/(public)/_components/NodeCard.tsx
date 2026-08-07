import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { Card, CardTitle, CardMeta } from '@/app/_components/Card';

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
    <Link href={`/nodes/${owner}/${repo}`} className="block">
      <Card>
        <div className="flex items-baseline justify-between">
          <CardTitle>{name}</CardTitle>
          <CardMeta>{formatDate(updatedAt)}</CardMeta>
        </div>
        <div className="mt-1 text-sm text-fg-tertiary">by {author}</div>
        {description && <p className="mt-2 text-sm text-fg-secondary">{description}</p>}
      </Card>
    </Link>
  );
}