-- Extend `wiki_revisions.status` ENUM with `archived` and `withdrawn`.
--
-- Note on the index: Prisma's auto-generated migration originally included a
-- DROP INDEX / CREATE INDEX pair on `wiki_revisions_version_id_status_created_at_idx`.
-- That pair was intentionally removed because the index's leading column
-- `version_id` is referenced by a foreign key constraint to `node_versions`,
-- and MySQL refuses to drop such an index with error 1553
-- ("Cannot drop index ... needed in a foreign key constraint").
-- The index column list `(version_id, status, created_at DESC)` is unchanged,
-- so the drop/recreate was unnecessary for this ENUM-only change.

-- AlterTable
ALTER TABLE `wiki_revisions` MODIFY `status` ENUM('pending', 'approved', 'rejected', 'archived', 'withdrawn') NOT NULL DEFAULT 'pending';
