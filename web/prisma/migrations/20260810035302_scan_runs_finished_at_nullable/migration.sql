-- DropIndex
DROP INDEX `scan_runs_task_name_finished_at_idx` ON `scan_runs`;

-- AlterTable
ALTER TABLE `scan_runs` MODIFY `finished_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `scan_runs_task_name_finished_at_idx` ON `scan_runs`(`task_name`, `finished_at` DESC);
