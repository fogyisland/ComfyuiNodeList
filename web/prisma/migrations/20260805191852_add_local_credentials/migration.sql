-- Add local Credentials login support.
--
-- Changes:
--   1. users.github_id: BIGINT NOT NULL UNIQUE -> BIGINT NULL UNIQUE
--      Local (non-GitHub) users have NULL github_id. MySQL UNIQUE allows
--      multiple NULL values, so multiple local users can coexist.
--   2. users.username: VARCHAR(64) NOT NULL -> VARCHAR(64) NOT NULL UNIQUE
--      Credentials login identifies users by username, so we need a unique
--      index on it. GitHub username collision is already prevented by the
--      seed data + signIn upsert path; the explicit unique constraint
--      makes that guarantee structural rather than procedural.
--   3. users.password_hash: add VARCHAR(255) NULL.
--      NULL = legacy GitHub-only user (cannot login via Credentials).
--      Non-NULL = local user with bcrypt-hashed password.

ALTER TABLE `users` MODIFY COLUMN `github_id` BIGINT NULL;

ALTER TABLE `users` ADD UNIQUE INDEX `users_username_key`(`username`);

ALTER TABLE `users` ADD COLUMN `password_hash` VARCHAR(255) NULL;