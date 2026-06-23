import type { NextRequest } from 'next/server';
import { NodeStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { json, parsePagination, parseSearch } from '@/lib/api-helpers';

export async function GET(request: NextRequest | Request) {
  const url = new URL(request.url);
  const { page, pageSize } = parsePagination(url);
  const { q } = parseSearch(url);

  const where = {
    status: { in: [NodeStatus.active, NodeStatus.deprecated] },
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { author: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.node.count({ where }),
    prisma.node.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        github_owner: true,
        github_repo: true,
        name: true,
        author: true,
        description: true,
        updated_at: true,
      },
    }),
  ]);

  return json({
    items: items.map((n) => ({
      owner: n.github_owner,
      repo: n.github_repo,
      name: n.name,
      author: n.author,
      description: n.description,
      updated_at: n.updated_at.toISOString(),
    })),
    page,
    page_size: pageSize,
    total,
  });
}
