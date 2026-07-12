import json
import os
from datetime import datetime, timezone

import pymysql

from scanner.db import (
    get_active_nodes,
    get_connection,
    upsert_version,
    upsert_raw_requirements,
    record_scan_failure,
    delete_old_versions,
)


def _insert_node(db, github_owner="foo", github_repo="bar", status="active"):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, NOW(), NOW())",
                (github_owner, github_repo, github_owner, "x", status),
            )
            node_id = cur.lastrowid
        conn.commit()
        return node_id


def test_get_active_nodes_returns_active_only(db):
    _insert_node(db, "foo", "bar", "active")
    _insert_node(db, "baz", "qux", "deprecated")
    active = get_active_nodes()
    assert len(active) == 1
    assert active[0] == (1, "foo", "bar")


def test_upsert_version_creates_row(db):
    node_id = _insert_node(db)
    version_id = upsert_version(
        node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc)
    )
    assert version_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_tag, git_sha FROM node_versions WHERE id = %s", (version_id,))
            row = cur.fetchone()
    # With DictCursor, fetchone() returns a dict
    assert row["version_tag"] == "v1.0.0"
    assert row["git_sha"] == "a" * 40


def test_upsert_version_is_idempotent(db):
    node_id = _insert_node(db)
    v1 = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    v2 = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    assert v1 == v2


def test_upsert_raw_requirements_round_trip(db):
    node_id = _insert_node(db)
    version_id = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    parsed = {
        "python_min": "3.10",
        "python_max": "3.12",
        "dependencies": [{"name": "torch", "spec": "torch>=2.0.0", "min_version": "2.0.0", "max_version": None, "is_pinned": False}],
        "node_class_mappings": ["MyNode"],
        "incompatibilities": ["bad-node"],
        "scan_warnings": [],
        "raw_files": {"pyproject.toml": "..."},
    }
    upsert_raw_requirements(version_id, parsed)
    with get_connection() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT * FROM node_raw_requirements WHERE version_id = %s", (version_id,))
            row = cur.fetchone()
    assert row["python_min"] == "3.10"
    assert row["python_max"] == "3.12"
    assert json.loads(row["dependencies"]) == parsed["dependencies"]


def test_record_scan_failure_inserts(db):
    node_id = _insert_node(db)
    record_scan_failure(node_id, "fetch_releases", "rate limited", will_retry=True)
    with get_connection() as conn:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT task_name, error_message, will_retry FROM scan_failures WHERE node_id = %s", (node_id,))
            row = cur.fetchone()
    assert row == {"task_name": "fetch_releases", "error_message": "rate limited", "will_retry": 1}


def test_delete_old_versions_keeps_5(db):
    node_id = _insert_node(db)
    # Insert 7 versions
    for i in range(7):
        upsert_version(node_id, f"v{i}.0.0", f"{i:040d}", datetime(2026, 1, i + 1, tzinfo=timezone.utc))
    deleted = delete_old_versions(node_id, keep=5)
    assert deleted == 2
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM node_versions WHERE node_id = %s", (node_id,))
            row = cur.fetchone()
    # With DictCursor, COUNT(*) column name is "COUNT(*)"
    assert row["COUNT(*)"] == 5


def test_lookup_branch_sha_returns_none_when_missing(db):
    """No row -> returns None (cache miss)."""
    from scanner.db import lookup_branch_sha
    assert lookup_branch_sha("foo", "bar", "main") is None


def test_lookup_branch_sha_returns_sha_when_fresh(db):
    """Recently-upserted entry -> returns the SHA."""
    from scanner.db import lookup_branch_sha, upsert_branch_sha
    upsert_branch_sha("foo", "bar", "main", "a" * 40)
    assert lookup_branch_sha("foo", "bar", "main") == "a" * 40


def test_lookup_branch_sha_returns_none_when_expired(db):
    """8-day-old entry -> returns None (stale, caller must re-resolve)."""
    from scanner.db import get_connection, lookup_branch_sha
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO gitsha_resolutions (owner, repo, ref, sha, resolved_at) "
                "VALUES (%s, %s, %s, %s, NOW() - INTERVAL 8 DAY)",
                ("foo", "bar", "main", "a" * 40),
            )
        conn.commit()
    assert lookup_branch_sha("foo", "bar", "main") is None


def test_prune_expired_resolutions_removes_old_entries(db):
    """TTL boundary: entries with resolved_at < NOW() - 7d are deleted; fresh entries kept."""
    from scanner.db import (
        get_connection,
        lookup_branch_sha,
        prune_expired_resolutions,
        upsert_branch_sha,
    )
    upsert_branch_sha("foo", "bar", "main", "a" * 40)  # fresh
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO gitsha_resolutions (owner, repo, ref, sha, resolved_at) "
                "VALUES (%s, %s, %s, %s, NOW() - INTERVAL 8 DAY)",
                ("foo", "bar", "old-branch", "b" * 40),
            )
        conn.commit()
    deleted = prune_expired_resolutions()
    assert deleted == 1
    assert lookup_branch_sha("foo", "bar", "old-branch") is None
    assert lookup_branch_sha("foo", "bar", "main") == "a" * 40


def test_upsert_branch_sha_refreshes_existing_entry(db):
    """Calling upsert twice with same key refreshes sha and resolved_at; calling
    with a different sha updates the existing row in place (no duplicate)."""
    from scanner.db import get_connection, upsert_branch_sha
    upsert_branch_sha("foo", "bar", "main", "a" * 40)
    upsert_branch_sha("foo", "bar", "main", "b" * 40)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT sha FROM gitsha_resolutions WHERE owner=%s AND repo=%s AND ref=%s",
                        ("foo", "bar", "main"))
            row = cur.fetchone()
            cur.execute("SELECT COUNT(*) AS n FROM gitsha_resolutions WHERE owner=%s AND repo=%s AND ref=%s",
                        ("foo", "bar", "main"))
            count = cur.fetchone()
    assert row["sha"] == "b" * 40
    assert count["n"] == 1


def test_gitsha_resolutions_table_exists(db):
    """The cache table from Task 1 must exist and have the expected columns."""
    from scanner.db import get_connection
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s "
                        "ORDER BY ORDINAL_POSITION", "gitsha_resolutions")
            cols = [row["COLUMN_NAME"] for row in cur.fetchall()]
    assert cols == ["id", "owner", "repo", "ref", "sha", "resolved_at"]
