-- CreateTable
CREATE TABLE `gitsha_resolutions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner` VARCHAR(255) NOT NULL,
    `repo` VARCHAR(255) NOT NULL,
    `ref` VARCHAR(255) NOT NULL,
    `sha` CHAR(40) NOT NULL,
    `resolved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `gitsha_resolutions_owner_repo_ref_key`(`owner`, `repo`, `ref`),
    INDEX `gitsha_resolutions_resolved_at_idx`(`resolved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
