"""Shared helpers for test fixtures that reset the test database.

These helpers are used by both `scanner/conftest.py` (the `db` fixture) and
`scanner/tests/test_tasks.py` (the `db_eager` fixture). Extracted into a
module so the test_tasks fixture can import them without re-defining them
inside the test file.
"""

from __future__ import annotations

from urllib.parse import urlparse

import pymysql


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