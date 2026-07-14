"""Shared pytest fixtures for the scanner test suite."""

from __future__ import annotations

import os

import pytest

from scanner._db_fixtures import _reset_database

# Test DB URL is shared by every fixture in this module and in
# scanner/tests/test_*.py — keep it in one place to avoid drift.
TEST_DB_URL = "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test"


@pytest.fixture
def db():
    """Provide a clean test DB: drop all tables, then re-apply migrations, then yield.

    Drops all tables in the test database (`comfyui_nodes_test`) so each test starts
    with empty tables, then runs `prisma migrate deploy` to re-create the schema
    from migrations. Using `migrate deploy` (rather than `db push --force-reset`)
    avoids the prisma-engine's strict-mode DATETIME default issue on MySQL 5.7.
    """
    web_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web"))
    _reset_database(TEST_DB_URL, web_dir)
    yield


@pytest.fixture
def db_eager():
    """Alias for the `db` fixture — same setup, but a name that's clearer
    when used in celery-eager-mode tests (`test_tasks.py`) and `test_github.py`."""
    web_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web"))
    _reset_database(TEST_DB_URL, web_dir)
    yield
