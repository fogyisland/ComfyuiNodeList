"""Tests for scanner.tasks.sync_manager_catalog.

Uses:
- `db_eager` fixture (resets test DB + enables Celery eager mode)
- `system_user` fixture (idempotent 'comfyui-manager' user)
- `httpx_mock` (pytest-httpx) for HTTP interception
"""
import json
import os

# Force eager mode BEFORE importing celery_app
os.environ.setdefault("CELERY_TEST_EAGER", "1")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from pytest_httpx import httpx_mock

from scanner.celery_app import celery_app
from scanner.db import get_connection, insert_pending_submission
from scanner.tasks.sync_manager_catalog import sync_manager_catalog


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "manager_catalog.json")
MANAGER_URL = "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"


def _load_fixture() -> dict:
    with open(FIXTURE_PATH) as f:
        return json.load(f)


def _pending_submissions() -> list[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT github_url, submitter_id, status FROM node_submissions ORDER BY id")
            return list(cur.fetchall())


def test_happy_path(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json=_load_fixture())
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    # 2 entries have valid github URLs (valid-node, nested-path); 3 invalid
    assert result["added"] == 2
    assert result["skipped_invalid_url"] == 3
    assert result["skipped_existing"] == 0
    assert result["skipped_pending"] == 0
    assert result["errors"] == []
    rows = _pending_submissions()
    assert len(rows) == 2
    assert {r["github_url"] for r in rows} == {
        "https://github.com/alice/valid-node",
        "https://github.com/dave/nested-path",
    }
    for r in rows:
        assert r["submitter_id"] == system_user
        assert r["status"] == "pending"


def _insert_node_helper(db_eager, owner="x", repo="y", status="active"):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, NOW(), NOW())",
                (owner, repo, owner, "x", status),
            )
            node_id = cur.lastrowid
        conn.commit()
        return node_id


def _insert_user_helper(db_eager, username="u", role="user"):
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


def test_all_existing_in_nodes(db_eager, system_user, httpx_mock):
    _insert_node_helper(db_eager, "alice", "valid-node")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1  # Now we know it's in nodes, not pending


def test_all_pending_in_submissions(db_eager, system_user, httpx_mock):
    other = _insert_user_helper(db_eager, username="bob")
    insert_pending_submission(other, "https://github.com/alice/valid-node")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_pending"] == 1
    assert result["skipped_existing"] == 0


def test_approved_not_in_dedup(db_eager, system_user, httpx_mock):
    other = _insert_user_helper(db_eager, username="bob")
    new_id = insert_pending_submission(other, "https://github.com/alice/valid-node")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='approved' WHERE id=%s", (new_id,))
        conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 1  # approved submission doesn't block re-import


def test_rejected_not_in_dedup(db_eager, system_user, httpx_mock):
    other = _insert_user_helper(db_eager, username="bob")
    new_id = insert_pending_submission(other, "https://github.com/alice/valid-node")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE node_submissions SET status='rejected' WHERE id=%s", (new_id,))
        conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    result = sync_manager_catalog()
    assert result["added"] == 1  # rejected doesn't block re-import


def test_case_insensitive_dedup(db_eager, system_user, httpx_mock):
    _insert_node_helper(db_eager, "Foo", "Bar")
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/foo/bar"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1


def test_github_url_with_query_and_fragment(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"n1": {"reference": "https://github.com/alice/valid-node?ref=manager#readme"}},
    )
    result = sync_manager_catalog()
    assert result["added"] == 1


def test_malformed_json(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, text="not json {")
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "parse"


def test_json_top_level_is_list(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json=[{"reference": "https://github.com/a/b"}])
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "parse"


def test_empty_json(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={})
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["fetched"] == 0
    assert result["added"] == 0


def test_http_500(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, status_code=503)
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "fetch"


def test_system_user_missing(db_eager, httpx_mock):
    # No system_user fixture — task must fail-fast
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/a/b"}})
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    assert result["stage"] == "system_user"
    assert "system user missing" in result["error"]


def test_idempotent_rerun(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={"n1": {"reference": "https://github.com/alice/valid-node"}})
    first = sync_manager_catalog()
    assert first["added"] == 1
    second = sync_manager_catalog()  # same httpx_mock response
    assert second["added"] == 0
    assert second["skipped_pending"] == 1


def test_partial_insert_failure(db_eager, system_user, httpx_mock, monkeypatch):
    """If INSERT #3 fails (e.g. FK violation), the other 2 should still succeed."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={
            "n1": {"reference": "https://github.com/alice/valid-node"},
            "n2": {"reference": "https://github.com/dave/nested-path"},
            "n3": {"reference": "https://github.com/eve/another"},
        },
    )

    real_insert = insert_pending_submission
    call_count = {"n": 0}

    def flaky_insert(submitter_id, url, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 3:
            raise RuntimeError("simulated DB failure")
        return real_insert(submitter_id, url, **kwargs)

    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.insert_pending_submission", flaky_insert)
    result = sync_manager_catalog()
    assert result["added"] == 2
    assert len(result["errors"]) == 1
    assert result["errors"][0]["entry_id"] == "n3"


def test_mixed_dedup(db_eager, system_user, httpx_mock):
    """1 nodes + 1 pending + 1 fresh entry → added=1, skipped_existing=1, skipped_pending=1."""
    _insert_node_helper(db_eager, "alpha", "node-a")
    other = _insert_user_helper(db_eager, username="bob")
    insert_pending_submission(other, "https://github.com/beta/node-b")
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={
            "a": {"reference": "https://github.com/alpha/node-a"},  # in nodes
            "b": {"reference": "https://github.com/beta/node-b"},  # pending
            "c": {"reference": "https://github.com/gamma/node-c"},  # new
        },
    )
    result = sync_manager_catalog()
    assert result["added"] == 1
    assert result["skipped_existing"] == 1
    assert result["skipped_pending"] == 1


def test_missing_reference_field(db_eager, system_user, httpx_mock):
    """Entry with no `reference` key at all → skipped_invalid_url=1."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"n1": {"author": "x", "title": "Y"}},  # no `reference` key
    )
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["added"] == 0
    assert result["skipped_invalid_url"] == 1


def test_non_github_url(db_eager, system_user, httpx_mock):
    """reference=https://gitlab.com/foo/bar → skipped_invalid_url=1."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"n1": {"reference": "https://gitlab.com/foo/bar"}},
    )
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_invalid_url"] == 1


def test_url_with_nested_path(db_eager, system_user, httpx_mock):
    """https://github.com/foo/bar/tree/main → parses to foo/bar (first 2 segments)."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"n1": {"reference": "https://github.com/foo/bar/tree/main"}},
    )
    result = sync_manager_catalog()
    assert result["added"] == 1
    rows = _pending_submissions()
    assert len(rows) == 1
    assert rows[0]["github_url"] == "https://github.com/foo/bar"


def test_pending_submission_includes_name_and_description(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={"node-a": {"reference": "https://github.com/aa/bb", "title": "Node A Title", "description": "Node A description text"}})
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["added"] == 1
    assert result["updated_nodes"] == 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE github_url='https://github.com/aa/bb'")
            row = cur.fetchone()
    assert row["name"] == "Node A Title"
    assert row["description"] == "Node A description text"


def test_pending_submission_null_name_description_when_missing(db_eager, system_user, httpx_mock):
    httpx_mock.add_response(url=MANAGER_URL, json={"node-b": {"reference": "https://github.com/cc/dd"}})
    result = sync_manager_catalog()
    assert result["added"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, description FROM node_submissions WHERE github_url='https://github.com/cc/dd'")
            row = cur.fetchone()
    assert row["name"] is None
    assert row["description"] is None


def test_existing_node_updated_from_manager(db_eager, system_user, httpx_mock):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) VALUES ('ee', 'ff', 'OldName', 'OldAuthor', 'OldDesc', false, NOW(), NOW())")
            conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"node-c": {"reference": "https://github.com/ee/ff", "title": "NewName", "description": "NewDesc", "author": "NewAuthor"}})
    result = sync_manager_catalog()
    assert result["added"] == 0
    assert result["skipped_existing"] == 1
    assert result["updated_nodes"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='ee' AND github_repo='ff'")
            row = cur.fetchone()
    assert row["name"] == "NewName"
    assert row["author"] == "NewAuthor"
    assert row["description"] == "NewDesc"
    assert row["source_manager"] == 1


def test_existing_node_coalesce_preserves_existing_when_manager_missing(db_eager, system_user, httpx_mock):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) VALUES ('gg', 'hh', 'KeptName', 'KeptAuthor', 'KeptDesc', false, NOW(), NOW())")
            conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"node-d": {"reference": "https://github.com/gg/hh"}})
    result = sync_manager_catalog()
    assert result["updated_nodes"] == 1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, author, description, source_manager FROM nodes WHERE github_owner='gg' AND github_repo='hh'")
            row = cur.fetchone()
    assert row["name"] == "KeptName"
    assert row["author"] == "KeptAuthor"
    assert row["description"] == "KeptDesc"
    assert row["source_manager"] == 1


def test_update_node_failure_appends_to_errors(db_eager, system_user, httpx_mock, monkeypatch):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO nodes (github_owner, github_repo, name, author, description, created_at, updated_at) VALUES ('ii', 'jj', 'n1', 'a1', 'd1', NOW(), NOW()), ('kk', 'll', 'n2', 'a2', 'd2', NOW(), NOW())")
            conn.commit()
    httpx_mock.add_response(url=MANAGER_URL, json={"node-e": {"reference": "https://github.com/ii/jj", "title": "T1", "description": "D1"}, "node-f": {"reference": "https://github.com/kk/ll", "title": "T2", "description": "D2"}})
    call_count = {"n": 0}
    def flaky_update(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated DB blip")
        from scanner.db import update_node_from_manager
        return update_node_from_manager(*args, **kwargs)
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.update_node_from_manager", flaky_update)
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert len(result["errors"]) == 1
    assert "simulated DB blip" in result["errors"][0]["error"]


def test_beat_schedule_contains_sync_manager_catalog_daily():
    schedule = celery_app.conf.beat_schedule
    assert "sync-manager-catalog-daily" in schedule, \
        f"missing daily beat entry; existing keys: {list(schedule)}"
    entry = schedule["sync-manager-catalog-daily"]
    assert entry["task"] == "scanner.tasks.sync_manager_catalog"


def test_beat_schedule_daily_at_05_00_utc():
    from datetime import datetime, timezone
    from celery.schedules import crontab
    entry = celery_app.conf.beat_schedule["sync-manager-catalog-daily"]
    sched = entry["schedule"]
    assert isinstance(sched, crontab)
    # crontab._orig_minute / _orig_hour are the raw cron fields
    assert sched.hour == {5}, f"expected hour=5 UTC, got {sched.hour}"
    assert sched.minute == {0}, f"expected minute=0, got {sched.minute}"


# --- scan_runs row written on every sync_manager_catalog call (Task 2 of Plan 5.1.4) ---


def test_sync_writes_ok_run_on_success(db_eager, system_user, httpx_mock):
    """Sync writes a scan_runs row with status='ok' on success."""
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"node-a": {"reference": "https://github.com/aa/bb", "title": "A"}},
    )
    sync_manager_catalog()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_name, status, counts, error FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row is not None
    assert row["task_name"] == "sync_manager_catalog"
    assert row["status"] == "ok"
    assert row["error"] is None
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert "added" in parsed
    assert "updated_nodes" in parsed


def test_sync_writes_failed_run_on_fetch_error(db_eager, httpx_mock, monkeypatch):
    """Sync writes a scan_runs row with status='failed' when fetch raises."""
    import httpx
    def boom(*args, **kwargs):
        raise httpx.HTTPError("simulated network error")
    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.httpx.get", boom)
    # Function does NOT re-raise (preserves original early-return contract);
    # the scan_runs row still gets written in the finally block.
    result = sync_manager_catalog()
    assert result["status"] == "failed"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, error FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row["status"] == "failed"
    assert row["error"] is not None
    assert "simulated network error" in row["error"]


def test_sync_writes_run_even_when_inner_step_raises(db_eager, system_user, httpx_mock, monkeypatch):
    """If an INSERT step raises mid-loop, the scan_runs row still gets written."""
    call_count = {"n": 0}

    def flaky_insert(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated INSERT blip")
        return insert_pending_submission(*args, **kwargs)

    monkeypatch.setattr(
        "scanner.tasks.sync_manager_catalog.insert_pending_submission", flaky_insert
    )
    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"node-a": {"reference": "https://github.com/aa/bb", "title": "A"}},
    )
    # Should NOT raise; the error is appended to counts.errors and the run still gets recorded
    sync_manager_catalog()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, counts FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY finished_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row["status"] == "ok"  # the function doesn't re-raise (errors are accumulated)
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed["errors_count"] >= 1
