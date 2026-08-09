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


# --- Helpers for Manager sync tests (Task 1) ---


def _insert_user(db, username="u", role="user"):
    """Insert a user with no github_id / password_hash (system-style)."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, avatar_url, role, created_at) "
                "VALUES (%s, '', %s, NOW())",
                (username, role),
            )
            user_id = cur.lastrowid
        conn.commit()
        return user_id


# --- fetch_existing_owner_repo_pairs ---


def test_fetch_existing_owner_repo_pairs_empty(db):
    from scanner.db import fetch_existing_owner_repo_pairs
    assert fetch_existing_owner_repo_pairs() == set()


def test_fetch_existing_owner_repo_pairs_includes_nodes(db):
    _insert_node(db, "foo", "bar", "active")
    _insert_node(db, "BAZ", "QUX", "deprecated")  # any status counts
    from scanner.db import fetch_existing_owner_repo_pairs
    pairs = fetch_existing_owner_repo_pairs()
    assert pairs == {("foo", "bar"), ("baz", "qux")}  # lowercased


def test_fetch_existing_owner_repo_pairs_includes_pending_submissions(db):
    from scanner.db import insert_pending_submission, fetch_existing_owner_repo_pairs
    submitter = _insert_user(db, username="u1")
    insert_pending_submission(submitter, "https://github.com/foo/bar")
    pairs = fetch_existing_owner_repo_pairs()
    assert ("foo", "bar") in pairs


def test_fetch_existing_owner_repo_pairs_excludes_approved_submissions(db):
    from scanner.db import insert_pending_submission, fetch_existing_owner_repo_pairs
    submitter = _insert_user(db, username="u1")
    new_id = insert_pending_submission(submitter, "https://github.com/foo/bar")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='approved' WHERE id=%s", (new_id,))
        conn.commit()
    assert ("foo", "bar") not in fetch_existing_owner_repo_pairs()


# --- fetch_system_submitter_id ---


def test_fetch_system_submitter_id_missing(db):
    from scanner.db import fetch_system_submitter_id
    assert fetch_system_submitter_id() is None


def test_fetch_system_submitter_id_found(db):
    from scanner.db import fetch_system_submitter_id
    _insert_user(db, username="comfyui-manager")
    uid = fetch_system_submitter_id()
    assert uid is not None
    assert isinstance(uid, int)


# --- insert_pending_submission ---


def test_insert_pending_submission_creates_pending_row(db):
    from scanner.db import insert_pending_submission, get_connection
    submitter = _insert_user(db, username="alice")
    new_id = insert_pending_submission(submitter, "https://github.com/foo/bar")
    assert new_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT submitter_id, github_url, status FROM node_submissions WHERE id = %s",
                (new_id,),
            )
            row = cur.fetchone()
    assert row["submitter_id"] == submitter
    assert row["github_url"] == "https://github.com/foo/bar"
    assert row["status"] == "pending"


# --- insert_pending_submission name/description kwargs (Task 2) ---


def test_insert_pending_submission_with_name_and_description(db):
    """New signature accepts optional name/description kwargs."""
    from scanner.db import insert_pending_submission
    submitter = _insert_user(db, username="alice")
    new_id = insert_pending_submission(
        submitter,
        "https://github.com/foo/bar",
        name="Foo Title",
        description="Foo description",
    )
    assert isinstance(new_id, int) and new_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["name"] == "Foo Title"
    assert row["description"] == "Foo description"


def test_insert_pending_submission_without_name_description(db):
    """When name/description omitted, columns are NULL (existing default behavior)."""
    from scanner.db import insert_pending_submission
    submitter = _insert_user(db, username="bob")
    new_id = insert_pending_submission(submitter, "https://github.com/baz/qux")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["name"] is None
    assert row["description"] is None


# --- update_node_from_manager (Task 2) ---


def test_update_node_from_manager_sets_source_manager_and_fields(db):
    """Helper sets source_manager=true and overrides name/description/author."""
    from scanner.db import update_node_from_manager
    # Pre-seed a node
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, false, NOW(), NOW())",
                ("foo", "bar", "OldName", "OldAuthor", "OldDesc"),
            )
        conn.commit()
    # Run the helper
    affected = update_node_from_manager(
        "foo", "bar", name="NewName", description="NewDesc", author="NewAuthor"
    )
    assert affected == 1
    # Verify post-state
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, author, description, source_manager FROM nodes "
                "WHERE github_owner='foo' AND github_repo='bar'"
            )
            row = cur.fetchone()
    assert row["name"] == "NewName"
    assert row["author"] == "NewAuthor"
    assert row["description"] == "NewDesc"
    # pymysql returns TINYINT(1) BOOLEAN columns as int 0/1, not Python bool
    assert row["source_manager"] == 1


def test_update_node_from_manager_coalesce_preserves_existing(db):
    """When Manager kwargs are None, COALESCE preserves existing DB values."""
    from scanner.db import update_node_from_manager
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, false, NOW(), NOW())",
                ("x", "y", "ExistingName", "ExistingAuthor", "ExistingDesc"),
            )
        conn.commit()
    affected = update_node_from_manager("x", "y")  # all kwargs None
    assert affected == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, author, description, source_manager FROM nodes "
                "WHERE github_owner='x' AND github_repo='y'"
            )
            row = cur.fetchone()
    assert row["name"] == "ExistingName"
    assert row["author"] == "ExistingAuthor"
    assert row["description"] == "ExistingDesc"
    # pymysql returns TINYINT(1) BOOLEAN columns as int 0/1, not Python bool
    assert row["source_manager"] == 1  # still flipped even when fields None


def test_update_node_from_manager_case_insensitive_match(db):
    """Owner/repo matching uses LOWER() on both sides."""
    from scanner.db import update_node_from_manager
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, false, NOW(), NOW())",
                ("Foo", "Bar", "n", "a", "d"),
            )
        conn.commit()
    affected = update_node_from_manager("FOO", "BAR", name="Updated")
    assert affected == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM nodes WHERE LOWER(github_owner)='foo' AND LOWER(github_repo)='bar'"
            )
            row = cur.fetchone()
    assert row["name"] == "Updated"


# --- insert_scan_run (Task 2 of Plan 5.1.4) ---


def test_insert_scan_run_writes_row(db):
    """Happy path: row contains all expected fields."""
    from scanner.db import insert_scan_run
    started = datetime(2026, 8, 9, 5, 0, 0)
    finished = datetime(2026, 8, 9, 5, 1, 30)
    new_id = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=started,
        finished_at=finished,
        status="ok",
        counts={"added": 3, "updated_nodes": 1, "errors_count": 0},
    )
    assert isinstance(new_id, int) and new_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_name, started_at, finished_at, status, counts, error "
                "FROM scan_runs WHERE id = %s",
                (new_id,),
            )
            row = cur.fetchone()
    assert row["task_name"] == "sync_manager_catalog"
    assert row["status"] == "ok"
    assert row["error"] is None
    # counts is JSON; column comes back as str on PyMySQL
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed["added"] == 3
    assert parsed["updated_nodes"] == 1


def test_insert_scan_run_with_error_field(db):
    """Failed status persists error truncated to 1024 chars."""
    from scanner.db import insert_scan_run
    long_err = "x" * 2000
    new_id = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=datetime(2026, 8, 9, 5, 0, 0),
        finished_at=datetime(2026, 8, 9, 5, 0, 5),
        status="failed",
        counts={"errors_count": 1},
        error=long_err,
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status, error FROM scan_runs WHERE id = %s", (new_id,))
            row = cur.fetchone()
    assert row["status"] == "failed"
    assert row["error"] is not None
    assert len(row["error"]) == 1024  # truncated


def test_insert_scan_run_does_not_raise_on_db_blip(db, monkeypatch):
    """DB blip returns -1 and does NOT raise (safe for finally blocks)."""
    from scanner import db as db_module
    from scanner.db import insert_scan_run

    def broken_execute(*args, **kwargs):
        import pymysql
        raise pymysql.OperationalError("simulated DB blip")

    monkeypatch.setattr(db_module, "get_connection", broken_execute)
    result = insert_scan_run(
        task_name="sync_manager_catalog",
        started_at=datetime(2026, 8, 9, 5, 0, 0),
        finished_at=datetime(2026, 8, 9, 5, 0, 5),
        status="ok",
        counts={},
    )
    assert result == -1
