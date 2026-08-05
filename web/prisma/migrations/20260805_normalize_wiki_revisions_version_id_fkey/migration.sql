-- Normalize wiki_revisions.version_id FK to NoAction.
--
-- The original 20260626_wiki_revisions_no_action migration had the correct
-- intent (DROP + ADD as NoAction), but the dev DB drifted back to CASCADE
-- via some out-of-band path (likely a `prisma db push` against the dev DB
-- at a point where schema.prisma still had Cascade, before the migration
-- ran). Test DB and fresh DB both have NoAction today, so this migration
-- is a no-op for them (DROP + ADD of an identical FK).
--
-- Idempotent: the DROP succeeds because the FK exists; the ADD is identical
-- to the current FK on test/fresh and is the corrective change on dev.

ALTER TABLE `wiki_revisions` DROP FOREIGN KEY `wiki_revisions_version_id_fkey`;

ALTER TABLE `wiki_revisions`
  ADD CONSTRAINT `wiki_revisions_version_id_fkey`
  FOREIGN KEY (`version_id`) REFERENCES `node_versions`(`id`)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;
