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
