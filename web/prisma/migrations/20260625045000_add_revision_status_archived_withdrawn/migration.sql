-- AlterTable
ALTER TABLE `wiki_revisions` MODIFY `status` ENUM('pending', 'approved', 'rejected', 'archived', 'withdrawn') NOT NULL DEFAULT 'pending';