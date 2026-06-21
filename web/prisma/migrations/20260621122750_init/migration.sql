-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `github_id` BIGINT NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NULL,
    `avatar_url` VARCHAR(512) NOT NULL,
    `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_github_id_key`(`github_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nodes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `github_owner` VARCHAR(128) NOT NULL,
    `github_repo` VARCHAR(128) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `author` VARCHAR(128) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('active', 'deprecated', 'hidden') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `nodes_status_updated_at_idx`(`status`, `updated_at`),
    UNIQUE INDEX `nodes_github_owner_github_repo_key`(`github_owner`, `github_repo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `node_versions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `node_id` BIGINT NOT NULL,
    `version_tag` VARCHAR(64) NOT NULL,
    `git_sha` CHAR(40) NOT NULL,
    `release_date` DATETIME(3) NOT NULL,
    `scanned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `node_versions_node_id_release_date_idx`(`node_id`, `release_date`),
    UNIQUE INDEX `node_versions_node_id_version_tag_key`(`node_id`, `version_tag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `node_raw_requirements` (
    `version_id` BIGINT NOT NULL,
    `python_min` VARCHAR(16) NULL,
    `python_max` VARCHAR(16) NULL,
    `dependencies` JSON NOT NULL,
    `node_class_mappings` JSON NOT NULL,
    `incompatibilities` JSON NOT NULL,
    `scan_warnings` JSON NOT NULL,
    `raw_files` JSON NOT NULL,

    PRIMARY KEY (`version_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wiki_revisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `version_id` BIGINT NOT NULL,
    `author_id` BIGINT NOT NULL,
    `python_min` VARCHAR(16) NULL,
    `python_max` VARCHAR(16) NULL,
    `dependencies` JSON NOT NULL,
    `node_class_mappings` JSON NOT NULL,
    `incompatibilities` JSON NOT NULL,
    `notes_md` MEDIUMTEXT NOT NULL,
    `edit_summary` VARCHAR(500) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewer_id` BIGINT NULL,
    `review_note` TEXT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wiki_revisions_version_id_status_created_at_idx`(`version_id`, `status`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `node_submissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `submitter_id` BIGINT NOT NULL,
    `github_url` VARCHAR(512) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewer_id` BIGINT NULL,
    `review_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,

    INDEX `node_submissions_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `node_versions` ADD CONSTRAINT `node_versions_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `node_raw_requirements` ADD CONSTRAINT `node_raw_requirements_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `node_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wiki_revisions` ADD CONSTRAINT `wiki_revisions_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `node_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wiki_revisions` ADD CONSTRAINT `wiki_revisions_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wiki_revisions` ADD CONSTRAINT `wiki_revisions_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `node_submissions` ADD CONSTRAINT `node_submissions_submitter_id_fkey` FOREIGN KEY (`submitter_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `node_submissions` ADD CONSTRAINT `node_submissions_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
