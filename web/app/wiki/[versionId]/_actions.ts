'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/session';
import { createRevision, withdrawRevision } from '@/lib/wiki';
import { CreateRevisionBody } from '@/lib/wiki-schema';

function b64Encode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
function b64Decode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

export async function prepareSubmit(formData: FormData) {
  const versionId = String(formData.get('versionId'));
  const payload = String(formData.get('payload'));
  if (!versionId || !payload) throw new Error('missing fields');
  redirect(`/wiki/${versionId}/submit?d=${b64Encode(payload)}`);
}

export async function confirmSubmit(formData: FormData) {
  const user = await requireUser();
  const versionId = String(formData.get('versionId'));
  const draftB64 = String(formData.get('d'));
  if (!versionId || !draftB64) throw new Error('missing fields');
  const draftJson = b64Decode(draftB64);
  const parsed = CreateRevisionBody.safeParse(JSON.parse(draftJson));
  if (!parsed.success) throw new Error('invalid draft');
  await createRevision({
    versionId: Number(versionId),
    authorId: BigInt(user.id),
    body: parsed.data,
  });
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}/history`);
}

export async function withdrawRevisionAction(formData: FormData) {
  const user = await requireUser();
  const revisionId = String(formData.get('revisionId'));
  const versionId = String(formData.get('versionId'));
  if (!revisionId || !versionId) throw new Error('missing fields');
  await withdrawRevision({
    revisionId: Number(revisionId),
    currentUserId: BigInt(user.id),
    isAdmin: user.role === 'admin',
  });
  revalidatePath(`/wiki/${versionId}`);
  redirect(`/wiki/${versionId}`);
}