import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient, RevisionStatus } from '@prisma/client';
import { setup } from '../setup';
import { seedFixture } from '../fixtures';

const prisma = new PrismaClient();

describe('RevisionStatus enum (Plan 2)', () => {
  it('includes archived and withdrawn', () => {
    expect(RevisionStatus.archived).toBe('archived');
    expect(RevisionStatus.withdrawn).toBe('withdrawn');
  });

  it('still includes the original values', () => {
    expect(RevisionStatus.pending).toBe('pending');
    expect(RevisionStatus.approved).toBe('approved');
    expect(RevisionStatus.rejected).toBe('rejected');
  });

  describe('DB acceptance', () => {
    beforeEach(async () => {
      await setup();
      await seedFixture(prisma);
    });

    it('accepts archived in the wiki_revisions.status column', async () => {
      const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
      const author = await prisma.user.create({
        data: { github_id: 100n, username: 'archiver', avatar_url: '', role: 'user' },
      });
      const created = await prisma.wikiRevision.create({
        data: {
          version_id: version.id,
          author_id: author.id,
          python_min: '3.10',
          python_max: null,
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          notes_md: '',
          edit_summary: 'archive test',
          status: 'archived',
          reviewer_id: author.id,
          reviewed_at: new Date('2026-04-01T00:00:00Z'),
        },
      });
      const fetched = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: created.id } });
      expect(fetched.status).toBe('archived');
    });

    it('accepts withdrawn in the wiki_revisions.status column', async () => {
      const version = await prisma.nodeVersion.findFirstOrThrow({ where: { version_tag: 'v8.10' } });
      const author = await prisma.user.create({
        data: { github_id: 101n, username: 'withdrawer', avatar_url: '', role: 'user' },
      });
      const created = await prisma.wikiRevision.create({
        data: {
          version_id: version.id,
          author_id: author.id,
          python_min: '3.10',
          python_max: null,
          dependencies: [],
          node_class_mappings: [],
          incompatibilities: [],
          notes_md: '',
          edit_summary: 'withdraw test',
          status: 'withdrawn',
        },
      });
      const fetched = await prisma.wikiRevision.findUniqueOrThrow({ where: { id: created.id } });
      expect(fetched.status).toBe('withdrawn');
    });
  });
});
