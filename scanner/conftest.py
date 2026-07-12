"""Shared pytest fixtures for the scanner test suite."""

from __future__ import annotations

import os
import shutil
import subprocess
from urllib.parse import urlparse

import pymysql
import pytest


@pytest.fixture
def db():
    """Provide a clean test DB: drop all tables, then re-apply migrations, then yield.

    Drops all tables in the test database (`comfyui_nodes_test`) so each test starts
    with empty tables, then runs `prisma migrate deploy` to re-create the schema
    from migrations. Using `migrate deploy` (rather than `db push --force-reset`)
    avoids the prisma-engine's strict-mode DATETIME default issue on MySQL 5.7.
    """
    # Use absolute path so cwd is correct regardless of where pytest is invoked
    web_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web"))
    # Locate pnpm explicitly — on Windows, Python's subprocess doesn't inherit Git Bash's PATH,
    # so `pnpm` may not be found by CreateProcess. shutil.which respects the current PATH.
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        # Common Windows install path for pnpm via npm
        candidate = os.path.join(os.environ.get("APPDATA", ""), "npm", "pnpm.cmd")
        if os.path.isfile(candidate):
            pnpm = candidate
    assert pnpm is not None, "pnpm executable not found in PATH"
    # Force DATABASE_URL to the test DB. Prisma loads web/.env by default which points at
    # the dev DB (comfyui_nodes); we must override it for the test run.
    test_db_url = "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test"
    env = {**os.environ, "DATABASE_URL": test_db_url}
    # Drop all tables first so each test starts with a clean slate
    _drop_all_tables(test_db_url)
    subprocess.run(
        [pnpm, "exec", "prisma", "migrate", "deploy"],
        cwd=web_dir,
        check=True,
        capture_output=True,
        env=env,
    )
    # Create scan_failures table which exists in schema.prisma but has no
    # migration file (a pre-existing gap). Needed by test_record_scan_failure_inserts.
    _ensure_scan_failures(test_db_url)
    yield


def _drop_all_tables(database_url: str) -> None:
    """Connect to the given MySQL DB and drop every user table including
    `_prisma_migrations`. Used by the `db` fixture to reset state between tests
    so `prisma migrate deploy` re-applies all migrations from scratch."""
    parsed = urlparse(database_url)
    conn = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=parsed.username or "root",
        password=parsed.password or "",
        database=(parsed.path or "/").lstrip("/"),
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            cur.execute("SHOW TABLES")
            tables = [row[0] for row in cur.fetchall()]
            for table in tables:
                cur.execute(f"DROP TABLE IF EXISTS `{table}`")
            cur.execute("SET FOREIGN_KEY_CHECKS=1")
        conn.commit()
    finally:
        conn.close()


def _ensure_scan_failures(database_url: str) -> None:
    """Create the `scan_failures` table if it doesn't exist. This table is
    declared in schema.prisma but has no migration file (pre-existing gap in
    the migration set)."""
    parsed = urlparse(database_url)
    conn = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=parsed.username or "root",
        password=parsed.password or "",
        database=(parsed.path or "/").lstrip("/"),
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scan_failures (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    node_id BIGINT NOT NULL,
                    task_name VARCHAR(128) NOT NULL,
                    error_message TEXT NOT NULL,
                    occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    will_retry TINYINT(1) NOT NULL DEFAULT 0,
                    INDEX scan_failures_node_id_occurred_at_idx (node_id, occurred_at),
                    CONSTRAINT scan_failures_node_id_fkey FOREIGN KEY (node_id)
                        REFERENCES nodes(id) ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
        conn.commit()
    finally:
        conn.close()
