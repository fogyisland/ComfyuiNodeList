"""Shared pytest fixtures for the scanner test suite."""

from __future__ import annotations

import os
import shutil
import subprocess

import pytest

from scanner._db_fixtures import _drop_all_tables, _ensure_scan_failures


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