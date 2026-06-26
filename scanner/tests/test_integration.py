"""End-to-end integration test: full Celery chain against the real test DB.

Runs `fetch_pending_nodes` (the Celery entry point) which:
  1. Lists active nodes from the DB
  2. For each node: fetches releases via `fetch_releases` -> upserts `node_versions`
  3. For each version: downloads tarball via `parse_version` -> writes `node_raw_requirements`
  4. Runs `cleanup` to keep the 5 most recent versions per node

GitHub is mocked via pytest_httpx; the DB is the real test DB (`comfyui_nodes_test`).
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile

import pytest
from pytest_httpx import httpx_mock

# Force eager mode BEFORE importing celery_app
os.environ.setdefault("CELERY_TEST_EAGER", "1")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

from scanner.db import get_connection  # noqa: E402
from scanner.tasks.fetch_pending_nodes import fetch_pending_nodes  # noqa: E402


@pytest.fixture
def db_eager():
    """Reset the test DB before the test runs (same proven pattern as Task 4/5/7 fixtures)."""
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        candidate = os.path.join(os.environ.get("APPDATA", ""), "npm", "pnpm.cmd")
        if os.path.isfile(candidate):
            pnpm = candidate
    assert pnpm is not None, "pnpm executable not found in PATH"
    test_db_url = "mysql://root:Admin909217@127.0.0.1:3306/comfyui_nodes_test"
    env = {**os.environ, "DATABASE_URL": test_db_url}
    web_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "web"))
    subprocess.run(
        [pnpm, "exec", "prisma", "db", "push", "--force-reset", "--schema=prisma/schema.prisma"],
        cwd=web_dir,
        check=True,
        capture_output=True,
        env=env,
    )
    yield


def _make_tarball(files: dict[str, str]) -> bytes:
    """Build a tar.gz whose members are named root/<key>."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in files.items():
            data = content.encode("utf-8")
            info = tarfile.TarInfo(name=f"root/{name}")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_full_chain_against_real_db(db_eager, httpx_mock):
    # 1. Insert 2 active nodes (using real schema columns; `nodes` has no `avatar_url`)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES ('alpha', 'one', 'alpha-one', 'x', 'active', NOW(), NOW()),"
                "('beta', 'two', 'beta-two', 'x', 'active', NOW(), NOW())"
            )
        conn.commit()

    # 2. Mock GitHub: each node returns N releases
    httpx_mock.add_response(
        url="https://api.github.com/repos/alpha/one/releases?per_page=5",
        json=[
            {
                "tag_name": "v1.0.0",
                "target_commitish": "a" * 40,
                "published_at": "2026-06-01T00:00:00Z",
                "tarball_url": "https://api.github.com/repos/alpha/one/tarball/v1.0.0",
            },
            {
                "tag_name": "v0.9.0",
                "target_commitish": "b" * 40,
                "published_at": "2026-05-01T00:00:00Z",
                "tarball_url": "https://api.github.com/repos/alpha/one/tarball/v0.9.0",
            },
        ],
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/beta/two/releases?per_page=5",
        json=[
            {
                "tag_name": "v2.0.0",
                "target_commitish": "c" * 40,
                "published_at": "2026-06-15T00:00:00Z",
                "tarball_url": "https://api.github.com/repos/beta/two/tarball/v2.0.0",
            },
        ],
    )

    # 3. Mock tarballs (chain.py reconstructs URL as /repos/{owner}/{repo}/tarball/{tag})
    tarball_alpha_v1 = _make_tarball(
        {
            "pyproject.toml": '[project]\nrequires-python = ">=3.10"\ndependencies = ["torch>=2.0.0"]\n',
            "__init__.py": 'NODE_CLASS_MAPPINGS = {"AlphaNode": X}\n',
        }
    )
    tarball_alpha_v0 = _make_tarball(
        {
            "pyproject.toml": '[project]\nrequires-python = ">=3.9"\ndependencies = []\n',
        }
    )
    tarball_beta_v2 = _make_tarball(
        {
            "pyproject.toml": '[project]\nrequires-python = ">=3.11"\ndependencies = ["transformers==4.30"]\n',
        }
    )

    httpx_mock.add_response(
        url="https://api.github.com/repos/alpha/one/tarball/v1.0.0",
        content=tarball_alpha_v1,
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/alpha/one/tarball/v0.9.0",
        content=tarball_alpha_v0,
    )
    httpx_mock.add_response(
        url="https://api.github.com/repos/beta/two/tarball/v2.0.0",
        content=tarball_beta_v2,
    )

    # 4. Run the full chain end-to-end
    result = fetch_pending_nodes.apply().get()
    assert result is not None  # cleanup callback returns a dict

    # 5. Verify: 2 alpha versions + 1 beta version = 3 node_versions
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM node_versions")
            v_count = cur.fetchone()["c"]
            cur.execute("SELECT COUNT(*) AS c FROM node_raw_requirements")
            rr_count = cur.fetchone()["c"]
            cur.execute(
                "SELECT python_min, python_max FROM node_raw_requirements "
                "WHERE version_id = (SELECT id FROM node_versions WHERE version_tag = 'v2.0.0')"
            )
            row = cur.fetchone()
    assert v_count == 3, f"expected 3 node_versions, got {v_count}"
    assert rr_count == 3, f"expected 3 node_raw_requirements, got {rr_count}"
    assert row is not None
    assert row["python_min"] == "3.11"