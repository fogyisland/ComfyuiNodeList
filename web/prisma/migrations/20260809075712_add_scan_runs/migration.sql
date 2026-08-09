-- CreateTable
CREATE TABLE `scan_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_name` VARCHAR(64) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `counts` JSON NULL,
    `error` TEXT NULL,

    INDEX `scan_runs_task_name_finished_at_idx`(`task_name`, `finished_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
