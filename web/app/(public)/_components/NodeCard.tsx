import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { Card, CardTitle, CardMeta } from '@/app/_components/Card';
import { Badge } from '@/app/_components/Badge';

type Props = {
  owner: string;
  repo: string;
  name: string;
  author: string;
  description: string | null;
  updatedAt: string | Date;
  sourceManager?: boolean;
};

export function NodeCard({ owner, repo, name, author, description, updatedAt, sourceManager }: Props) {
  return (
    <Link href={`/nodes/${owner}/${repo}`} className="block">
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <CardTitle>{name}</CardTitle>
            {sourceManager && <Badge kind="manager">via Manager</Badge>}
          </div>
          <CardMeta>{formatDate(updatedAt)}</CardMeta>
        </div>
        <div className="mt-1 text-sm text-fg-tertiary">by {author}</div>
        {description && <p className="mt-2 text-sm text-fg-secondary">{description}</p>}
      </Card>
    </Link>
  );
}
