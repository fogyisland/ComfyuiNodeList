from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator
from urllib.parse import urlparse

import pymysql
from pymysql.cursors import DictCursor


def _config_from_env() -> dict[str, Any]:
    url = os.environ.get("DATABASE_URL")
    if url:
        # mysql://user:pass@host:port/db
        parsed = urlparse(url)
        return {
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 3306,
            "user": parsed.username or "root",
            "password": parsed.password or "",
            "database": (parsed.path or "/comfyui_nodes_test").lstrip("/"),
        }
    return {
        "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ.get("MYSQL_USER", "root"),
        "password": os.environ.get("MYSQL_PASSWORD", "Admin909217"),
        "database": os.environ.get("MYSQL_DB", "comfyui_nodes_test"),
    }


@contextmanager
def get_connection() -> Iterator[pymysql.connections.Connection]:
    cfg = _config_from_env()
    conn = pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )
    try:
        yield conn
    finally:
        conn.close()


def get_active_nodes() -> list[tuple[int, str, str]]:
    """Return [(node_id, github_owner, github_repo), ...] for every active node."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, github_owner, github_repo FROM nodes WHERE status = 'active' ORDER BY id ASC")
            return [(row["id"], row["github_owner"], row["github_repo"]) for row in cur.fetchall()]


def upsert_version(node_id: int, version_tag: str, git_sha: str, release_date: datetime) -> int:
    """Insert or update a node_versions row. Returns the version_id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO node_versions (node_id, version_tag, git_sha, release_date) "
                "VALUES (%s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE git_sha = VALUES(git_sha), release_date = VALUES(release_date), scanned_at = NOW()",
                (node_id, version_tag, git_sha, release_date),
            )
            # Fetch the id (either newly inserted or existing)
            cur.execute(
                "SELECT id FROM node_versions WHERE node_id = %s AND version_tag = %s",
                (node_id, version_tag),
            )
            row = cur.fetchone()
            version_id = row["id"]
        conn.commit()
        return version_id


def upsert_raw_requirements(version_id: int, parsed: dict[str, Any]) -> None:
    """Upsert the 7 fields of node_raw_requirements. JSON fields are serialized."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO node_raw_requirements "
                "(version_id, python_min, python_max, dependencies, node_class_mappings, incompatibilities, scan_warnings, raw_files) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE "
                "python_min = VALUES(python_min), python_max = VALUES(python_max), "
                "dependencies = VALUES(dependencies), node_class_mappings = VALUES(node_class_mappings), "
                "incompatibilities = VALUES(incompatibilities), scan_warnings = VALUES(scan_warnings), "
                "raw_files = VALUES(raw_files)",
                (
                    version_id,
                    parsed.get("python_min"),
                    parsed.get("python_max"),
                    json.dumps(parsed.get("dependencies", [])),
                    json.dumps(parsed.get("node_class_mappings", [])),
                    json.dumps(parsed.get("incompatibilities", [])),
                    json.dumps(parsed.get("scan_warnings", [])),
                    json.dumps(parsed.get("raw_files", {})),
                ),
            )
        conn.commit()


def record_scan_failure(node_id: int, task_name: str, error_message: str, will_retry: bool) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO scan_failures (node_id, task_name, error_message, will_retry) VALUES (%s, %s, %s, %s)",
                (node_id, task_name, error_message, will_retry),
            )
        conn.commit()


def delete_old_versions(node_id: int, keep: int = 5) -> int:
    """Delete versions beyond `keep` (oldest first) for a node. Returns count deleted.
    `node_raw_requirements` rows are removed via FK CASCADE. `wiki_revisions` are NOT touched."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM node_versions WHERE node_id = %s ORDER BY release_date DESC, id DESC LIMIT %s OFFSET %s",
                (node_id, keep, 0),
            )
            keep_ids = [row["id"] for row in cur.fetchall()]
            if not keep_ids:
                return 0
            placeholders = ",".join(["%s"] * len(keep_ids))
            cur.execute(
                f"DELETE FROM node_versions WHERE node_id = %s AND id NOT IN ({placeholders})",
                [node_id, *keep_ids],
            )
            deleted = cur.rowcount
        conn.commit()
        return deleted
