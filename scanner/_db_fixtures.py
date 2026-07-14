"""Shared helpers for test fixtures that reset the test database.

These helpers are used by both `scanner/conftest.py` (the `db` fixture) and
`scanner/tests/test_tasks.py` (the `db_eager` fixture). Extracted into a
module so the test_tasks fixture can import them without re-defining them
inside the test file.
"""

from __future__ import annotations

import os
import shutil
import subprocess

import pymysql


def _drop_all_tables(database_url: str) -> None:
    """Connect to the given MySQL DB and drop every user table including
    `_prisma_migrations`. Used by the `db` fixture to reset state between tests
    so `prisma migrate deploy` re-applies all migrations from scratch."""
    parsed = _parse_db_url(database_url)
    conn = pymysql.connect(
        host=parsed["host"],
        port=parsed["port"],
        user=parsed["user"],
        password=parsed["password"],
        database=parsed["database"],
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
    parsed = _parse_db_url(database_url)
    conn = pymysql.connect(
        host=parsed["host"],
        port=parsed["port"],
        user=parsed["user"],
        password=parsed["password"],
        database=parsed["database"],
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


def _parse_db_url(database_url: str) -> dict[str, str | int]:
    """Parse a `mysql://user:pass@host:port/db` URL into pymysql kwargs."""
    from urllib.parse import urlparse

    parsed = urlparse(database_url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": parsed.username or "root",
        "password": parsed.password or "",
        "database": (parsed.path or "/").lstrip("/"),
    }


def _reset_database(database_url: str, web_dir: str) -> None:
    """Reset the test DB to a clean, fully-migrated state.

    Sequence:
      1. `_drop_all_tables` — wipe everything (including `_prisma_migrations`)
         so each test starts from a clean slate.
      2. `prisma migrate deploy` — re-apply all migrations from scratch
         (avoids the MySQL 5.7 strict-mode `db push --force-reset` issue).
      3. `_ensure_scan_failures` — create the `scan_failures` table which
         exists in schema.prisma but has no migration file (pre-existing gap).

    Locates `pnpm` via `shutil.which` first, then falls back to the Windows
    npm install path (`%APPDATA%\\npm\\pnpm.cmd`) because Python's subprocess
    on Windows does not inherit Git Bash's PATH.
    """
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        candidate = os.path.join(os.environ.get("APPDATA", ""), "npm", "pnpm.cmd")
        if os.path.isfile(candidate):
            pnpm = candidate
    assert pnpm is not None, "pnpm executable not found in PATH"
    env = {**os.environ, "DATABASE_URL": database_url}
    _drop_all_tables(database_url)
    subprocess.run(
        [pnpm, "exec", "prisma", "migrate", "deploy"],
        cwd=web_dir,
        check=True,
        capture_output=True,
        env=env,
    )
    _ensure_scan_failures(database_url)
