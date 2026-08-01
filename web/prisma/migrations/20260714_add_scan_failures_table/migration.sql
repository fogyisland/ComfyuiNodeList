-- CreateTable
CREATE TABLE `scan_failures` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `node_id` BIGINT NOT NULL,
    `task_name` VARCHAR(128) NOT NULL,
    `error_message` TEXT NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `will_retry` BOOLEAN NOT NULL DEFAULT false,

    INDEX `scan_failures_node_id_occurred_at_idx`(`node_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `scan_failures` ADD CONSTRAINT `scan_failures_node_id_fkey` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
