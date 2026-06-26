import io
import os
import shutil
import subprocess
import tarfile
from datetime import datetime, timezone

import pytest
from pytest_httpx import httpx_mock

# Force eager mode BEFORE importing celery_app
os.environ.setdefault("CELERY_TEST_EAGER", "1")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

from scanner.celery_app import celery_app
from scanner.db import get_active_nodes, get_connection, upsert_version
from scanner.tasks.fetch_releases import fetch_releases
from scanner.tasks.parse_version import parse_version


@pytest.fixture
def db_eager():
    """Same as Task 4 fixture: reset DB before each test."""
    # Locate pnpm explicitly (Windows subprocess doesn't inherit Git Bash's PATH)
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        candidate = os.path.join(os.environ.get("APPDATA", ""), "npm", "pnpm.cmd")
        if os.path.isfile(candidate):
            pnpm = candidate
    assert pnpm is not None, "pnpm executable not found in PATH"
    test_db_url = "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test"
    env = {**os.environ, "DATABASE_URL": test_db_url}
    # Run from web/ — pnpm exec requires being inside the workspace
    web_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "web"))
    subprocess.run(
        [pnpm, "exec", "prisma", "db", "push", "--force-reset", "--schema=prisma/schema.prisma"],
        cwd=web_dir,
        check=True,
        capture_output=True,
        env=env,
    )
    yield


def _insert_node(db_eager, owner="foo", repo="bar"):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, 'active', NOW(), NOW())",
                (owner, repo, owner, "x"),
            )
            node_id = cur.lastrowid
        conn.commit()
        return node_id


def test_fetch_releases_inserts_node_versions(db_eager, httpx_mock):
    node_id = _insert_node(db_eager, "foo", "bar")
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[
            {"tag_name": "v1.0.0", "target_commitish": "a" * 40, "published_at": "2026-06-01T00:00:00Z", "tarball_url": "https://example.com/v1.0.0.tar.gz"},
            {"tag_name": "v0.9.0", "target_commitish": "b" * 40, "published_at": "2026-05-01T00:00:00Z", "tarball_url": "https://example.com/v0.9.0.tar.gz"},
        ],
    )
    result = fetch_releases(node_id, "foo", "bar")
    assert sorted(result) == sorted([1, 2])  # two version_ids
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_tag FROM node_versions WHERE node_id = %s ORDER BY version_tag", (node_id,))
            tags = [row["version_tag"] for row in cur.fetchall()]
    assert tags == ["v0.9.0", "v1.0.0"]


def test_fetch_releases_records_failure_on_404(db_eager, httpx_mock):
    node_id = _insert_node(db_eager, "missing", "repo")
    httpx_mock.add_response(
        url="https://api.github.com/repos/missing/repo/releases?per_page=5",
        status_code=404,
    )
    # Eager mode + autoretry: 4 calls (1 + 3 retries) all 404
    httpx_mock.add_response(
        url="https://api.github.com/repos/missing/repo/releases?per_page=5",
        status_code=404,
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/missing/repo/releases?per_page=5",
        status_code=404,
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/missing/repo/releases?per_page=5",
        status_code=404,
    )
    result = fetch_releases(node_id, "missing", "repo")
    assert result == []
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT task_name, will_retry FROM scan_failures WHERE node_id = %s", (node_id,))
            rows = cur.fetchall()
    assert len(rows) >= 1
    assert rows[0]["task_name"] == "fetch_releases"
    assert rows[0]["will_retry"] == 0  # 0 = False in MySQL boolean


def test_fetch_releases_uses_token_when_provided(db_eager, httpx_mock, monkeypatch):
    monkeypatch.setenv("SCANNER_GITHUB_TOKEN", "ghp_test_token")
    node_id = _insert_node(db_eager, "foo", "bar")
    httpx_mock.add_response(
        url="https://api.github.com/repos/foo/bar/releases?per_page=5",
        json=[],
    )
    fetch_releases(node_id, "foo", "bar")
    request = httpx_mock.get_request()
    assert request.headers.get("authorization") == "Bearer ghp_test_token"


def _make_tarball(files: dict) -> bytes:
    """Create an in-memory tar.gz containing the given files."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in files.items():
            data = content.encode("utf-8")
            info = tarfile.TarInfo(name=f"repo-root/{name}")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_parse_version_extracts_and_upserts(db_eager, httpx_mock):
    node_id = _insert_node(db_eager, "foo", "bar")
    version_id = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    tarball = _make_tarball({
        "pyproject.toml": '[project]\nrequires-python = ">=3.10"\ndependencies = ["torch>=2.0.0"]\n',
        "__init__.py": 'NODE_CLASS_MAPPINGS = {"Foo": X}\n',
        "README.md": "Incompatible with: bad-node\n",
    })
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", content=tarball)
    result = parse_version(node_id, version_id, "foo", "bar", "https://example.com/v1.0.0.tar.gz")
    assert result is not None
    assert result["python_min"] == "3.10"
    assert "Foo" in result["node_class_mappings"]
    assert "bad-node" in result["incompatibilities"]
    # Verify DB
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT python_min FROM node_raw_requirements WHERE version_id = %s", (version_id,))
            row = cur.fetchone()
    assert row["python_min"] == "3.10"


def test_parse_version_returns_none_on_404(db_eager, httpx_mock):
    node_id = _insert_node(db_eager, "missing", "repo")
    version_id = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    # Eager mode + autoretry: 4 calls (1 + 3 retries) all 404
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", status_code=404)
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", status_code=404)
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", status_code=404)
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", status_code=404)
    result = parse_version(node_id, version_id, "missing", "repo", "https://example.com/v1.0.0.tar.gz")
    assert result is None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM scan_failures WHERE node_id = %s AND task_name = 'parse_version'", (node_id,))
            row = cur.fetchone()
    assert row["c"] >= 1


def test_parse_version_handles_tarball_with_no_known_files(db_eager, httpx_mock):
    node_id = _insert_node(db_eager, "foo", "bar")
    version_id = upsert_version(node_id, "v1.0.0", "a" * 40, datetime(2026, 6, 1, tzinfo=timezone.utc))
    tarball = _make_tarball({"some_other_file.txt": "hi"})
    httpx_mock.add_response(url="https://example.com/v1.0.0.tar.gz", content=tarball)
    result = parse_version(node_id, version_id, "foo", "bar", "https://example.com/v1.0.0.tar.gz")
    assert result is not None
    assert result["dependencies"] == []
    assert result["python_min"] is None