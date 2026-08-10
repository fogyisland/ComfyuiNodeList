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


def test_parse_cron_string_accepts_5_field_cron():
    """Every-5-minutes and every-Monday-03:00 strings both parse to a crontab."""
    from celery.schedules import crontab as _crontab
    from scanner.celery_app import parse_cron_string

    sched_every_5 = parse_cron_string("*/5 * * * *")
    assert isinstance(sched_every_5, _crontab)
    # crontab._orig_minute is the raw cron field; */5 should be preserved
    assert sched_every_5._orig_minute == "*/5", (
        f"expected _orig_minute='*/5', got {sched_every_5._orig_minute!r}"
    )

    sched_monday = parse_cron_string("0 3 * * 1")
    assert sched_monday._orig_hour == "3"
    assert sched_monday._orig_day_of_week == "1"


def test_parse_cron_string_rejects_wrong_field_count():
    """Both too-few and too-many fields must raise ValueError."""
    from scanner.celery_app import parse_cron_string

    with pytest.raises(ValueError, match="Expected 5 cron fields"):
        parse_cron_string("0 5 * *")  # 4 fields
    with pytest.raises(ValueError, match="Expected 5 cron fields"):
        parse_cron_string("0 5 * * * *")  # 6 fields
    with pytest.raises(ValueError, match="Expected 5 cron fields"):
        parse_cron_string("")  # 0 fields


def test_build_sync_manager_schedule_uses_env_var(monkeypatch):
    """Setting CELERY_SYNC_MANAGER_CATALOG_CRON must override the schedule."""
    from scanner import celery_app as celery_app_module

    monkeypatch.setenv("CELERY_SYNC_MANAGER_CATALOG_CRON", "*/5 * * * *")
    sched = celery_app_module._build_sync_manager_schedule()
    assert sched._orig_minute == "*/5", (
        f"expected env var override to produce */5 minutes, "
        f"got {sched._orig_minute!r}"
    )

    monkeypatch.setenv("CELERY_SYNC_MANAGER_CATALOG_CRON", "0 3 * * 1")
    sched = celery_app_module._build_sync_manager_schedule()
    assert sched._orig_hour == "3"
    assert sched._orig_day_of_week == "1"


def test_build_sync_manager_schedule_falls_back_on_invalid(monkeypatch, caplog):
    """Invalid env var should log a warning and fall back to default 05:00 UTC."""
    from scanner import celery_app as celery_app_module

    monkeypatch.setenv("CELERY_SYNC_MANAGER_CATALOG_CRON", "garbage")
    with caplog.at_level("WARNING", logger="scanner.celery_app"):
        sched = celery_app_module._build_sync_manager_schedule()

    # Default = "0 5 * * *" → crontab(hour=5, minute=0)
    assert sched._orig_hour == "5"
    assert sched._orig_minute == "0"

    # Warning was emitted
    warning_messages = [
        r.message for r in caplog.records if r.levelname == "WARNING"
    ]
    assert any(
        "CELERY_SYNC_MANAGER_CATALOG_CRON" in msg and "garbage" in msg
        for msg in warning_messages
    ), f"expected fallback warning, got: {warning_messages}"


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


# --- Plan 5.1.4 Task 3: running-row-then-completed sentinel flow ---
# Note: brief illustrative symbol names (_fetch_manager_catalog, upsert_nodes_from_catalog)
# do not exist as standalone functions in sync_manager_catalog.py — the fetch is inline
# (httpx.get) and the upsert path goes through db.insert_pending_submission + db.update_node_from_manager.
# Per the ambiguity resolution, these tests monkeypatch httpx.get via httpx_mock to drive a
# benign end-to-end path, or monkeypatch start_scan_run to simulate DB failures on the call site.


def test_sync_writes_running_then_ok_via_start_complete(db_eager, system_user, httpx_mock, monkeypatch):
    """start_scan_run writes a 'running' sentinel at the top, complete_scan_run updates it.

    Verifies the transition: a new run is 'running' while the task is in flight, then becomes
    'ok' once complete_scan_run fires in finally. We assert the *terminal* state here;
    in-flight observation is the responsibility of Task 4's polling endpoint.
    """
    from scanner.tasks import sync_manager_catalog as task_module

    calls = {"start": 0, "complete": 0}

    real_start = task_module.start_scan_run
    real_complete = task_module.complete_scan_run

    def tracking_start(task_name):
        calls["start"] += 1
        return real_start(task_name)

    def tracking_complete(*args, **kwargs):
        calls["complete"] += 1
        return real_complete(*args, **kwargs)

    monkeypatch.setattr(task_module, "start_scan_run", tracking_start)
    monkeypatch.setattr(task_module, "complete_scan_run", tracking_complete)

    httpx_mock.add_response(url=MANAGER_URL, json={})  # benign empty catalog
    sync_manager_catalog()

    # Both helpers must have been invoked exactly once
    assert calls["start"] == 1, f"start_scan_run should be called once, got {calls['start']}"
    assert calls["complete"] == 1, f"complete_scan_run should be called once, got {calls['complete']}"

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, finished_at FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row is not None
    assert row["status"] == "ok"
    assert row["finished_at"] is not None  # terminal row, no longer 'running'


def test_sync_updates_row_to_failed_on_catalog_fetch_exception(db_eager, httpx_mock, monkeypatch):
    """When the catalog fetch raises, the existing fetch-failure branch returns early,
    but the finally still runs complete_scan_run with status='failed' and the error."""
    import httpx

    def boom(*args, **kwargs):
        raise httpx.HTTPError("catalog fetch failed")

    monkeypatch.setattr("scanner.tasks.sync_manager_catalog.httpx.get", boom)

    result = sync_manager_catalog()
    assert result["status"] == "failed"  # original early-return contract preserved

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, error, finished_at FROM scan_runs "
                "WHERE task_name = 'sync_manager_catalog' ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
    assert row is not None
    assert row["status"] == "failed"
    assert row["finished_at"] is not None
    assert "catalog fetch failed" in row["error"]


def test_sync_survives_start_scan_run_failure(db_eager, system_user, httpx_mock, monkeypatch):
    """If start_scan_run itself raises (e.g. DB down), the task must still complete.

    With the new flow: start_scan_run failure → run_id stays None → finally sees run_id is None
    and skips complete_scan_run. The task body continues executing and returns normally.
    No scan_runs row is written.
    """
    from scanner.tasks import sync_manager_catalog as task_module

    def fail_start(_task_name):
        raise RuntimeError("DB down")

    monkeypatch.setattr(task_module, "start_scan_run", fail_start)
    # complete_scan_run should NOT be called when start fails
    complete_called = {"n": 0}

    def tracking_complete(*args, **kwargs):
        complete_called["n"] += 1
        return None

    monkeypatch.setattr(task_module, "complete_scan_run", tracking_complete)

    httpx_mock.add_response(
        url=MANAGER_URL,
        json={"node-a": {"reference": "https://github.com/aa/bb", "title": "A"}},
    )
    # Must not raise
    result = sync_manager_catalog()
    assert result["status"] == "ok"
    assert result["added"] == 1
    assert complete_called["n"] == 0, "complete_scan_run must not be called when start_scan_run fails"

    # Confirm no row was written for this task in this test
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM scan_runs WHERE task_name = 'sync_manager_catalog'"
            )
            row = cur.fetchone()
    # Note: other tests in this file write rows too; but in the db_eager scope, only this
    # function ran (the fixture resets between tests), so the count should be 0.
    assert row["n"] == 0, f"expected no scan_runs rows when start_scan_run fails, got {row['n']}"
