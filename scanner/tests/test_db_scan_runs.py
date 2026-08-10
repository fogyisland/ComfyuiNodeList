"""Tests for Task 2 scan_runs helpers: start_scan_run / complete_scan_run / get_latest_scan_run_any_status.

`scanner/conftest.py`'s `db` fixture drops + re-creates all tables per test, so no
per-test truncation of `scan_runs` is needed here.
"""
import json

from scanner.db import (
    complete_scan_run,
    get_connection,
    get_latest_scan_run_any_status,
    start_scan_run,
)


def test_start_scan_run_writes_running_row(db):
    run_id = start_scan_run("sync_manager_catalog")
    assert run_id > 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, finished_at FROM scan_runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
    assert row["status"] == "running"
    assert row["finished_at"] is None


def test_complete_scan_run_updates_to_ok(db):
    run_id = start_scan_run("sync_manager_catalog")
    complete_scan_run(
        run_id,
        "ok",
        {"inserted": 3, "updated": 1, "skipped": 0, "errors": []},
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, finished_at, counts FROM scan_runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
    assert row["status"] == "ok"
    assert row["finished_at"] is not None
    # counts is JSON; PyMySQL returns it as str.
    parsed = json.loads(row["counts"]) if isinstance(row["counts"], str) else row["counts"]
    assert parsed == {"inserted": 3, "updated": 1, "skipped": 0, "errors": []}


def test_complete_scan_run_updates_to_failed_with_error(db):
    run_id = start_scan_run("sync_manager_catalog")
    complete_scan_run(
        run_id,
        "failed",
        {"inserted": 0, "errors": ["boom"]},
        error="boom",
    )
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, error FROM scan_runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
    assert row["status"] == "failed"
    assert row["error"] == "boom"


def test_get_latest_scan_run_any_status_returns_running_row(db):
    run_id = start_scan_run("sync_manager_catalog")
    result = get_latest_scan_run_any_status("sync_manager_catalog")
    assert result is not None
    assert result["id"] == run_id
    assert result["status"] == "running"
    assert result["finished_at"] is None
    assert result["error"] is None


def test_get_latest_scan_run_any_status_returns_none_when_empty(db):
    result = get_latest_scan_run_any_status("never_ran_xxx")
    assert result is None
