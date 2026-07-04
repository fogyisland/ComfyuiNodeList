-- Migration: change wiki_revisions.version_id FK from Cascade to NoAction
-- and reassign existing wiki_revisions from versions that have been deleted
-- (or are about to be deleted) to the most-recent surviving version of the same node.
--
-- Per spec §7.2 Task 4, cleanup must NOT delete wiki_revisions. The previous
-- Cascade FK contradicted this and forced a workaround that created orphan
-- versions. After this migration, the FK is NoAction and the application
-- (scanner.db.reassign_orphan_revisions) is responsible for reassigning
-- wiki_revisions to the most-recent surviving version of the same node
-- before the version is deleted.

-- Step 1: For every wiki_revision whose version_id no longer exists in node_versions,
-- repoint it to the most-recent surviving version of the same node.
UPDATE wiki_revisions wr
JOIN node_versions nv_old ON wr.version_id = nv_old.id
JOIN node_versions nv_new ON nv_old.node_id = nv_new.node_id
LEFT JOIN node_versions nv_existing ON wr.version_id = nv_existing.id
SET wr.version_id = nv_new.id
WHERE nv_existing.id IS NULL
  AND nv_new.id = (
    SELECT id FROM node_versions
    WHERE node_id = nv_old.node_id
    ORDER BY release_date DESC, id DESC
    LIMIT 1
  );

-- Step 2: Drop the existing Cascade FK
ALTER TABLE wiki_revisions DROP FOREIGN KEY wiki_revisions_version_id_fkey;

-- Step 3: Re-add the FK as NoAction
ALTER TABLE wiki_revisions
  ADD CONSTRAINT wiki_revisions_version_id_fkey
  FOREIGN KEY (version_id) REFERENCES node_versions(id)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;
