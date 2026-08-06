import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { RegisterBody } from '@/lib/wiki-schema';

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid json');
  }
  const parsed = RegisterBody.safeParse(raw);
  if (!parsed.success) return error(400, 'validation failed', parsed.error.flatten());

  const { username, password, email } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return error(409, 'username already taken');

  const password_hash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: {
      username,
      email: email ?? null,
      avatar_url: '',
      password_hash,
      role: 'user',
    },
  });

  return json(
    { userId: Number(created.id), username: created.username, role: created.role },
    { status: 201 },
  );
}