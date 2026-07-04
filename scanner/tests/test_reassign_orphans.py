"""Test the FK migration logic that reassigns wiki_revisions to surviving versions.

These tests use the real MySQL test DB (configured via DATABASE_URL).
Each test inserts nodes / versions / wiki_revisions fixtures, calls the
migration helper, and asserts the expected end state.
"""
from datetime import datetime, timezone

import pytest

from scanner.db import get_connection, reassign_orphan_revisions


@pytest.fixture
def fixtures():
    """Create 1 node with 3 versions and 2 wiki_revisions on the oldest version."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Clean slate (test DB is shared)
            cur.execute("DELETE FROM wiki_revisions")
            cur.execute("DELETE FROM node_raw_requirements")
            cur.execute("DELETE FROM node_versions")
            cur.execute("DELETE FROM nodes")
            # 1 node
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, status, created_at, updated_at) "
                "VALUES ('a', 'b', 'a-b', 'x', 'active', NOW(), NOW())"
            )
            cur.execute("SELECT id FROM nodes WHERE github_owner='a' AND github_repo='b'")
            node_id = cur.fetchone()["id"]
            # 3 versions: v1 (oldest), v2, v3 (newest)
            for tag, sha in [("v1.0.0", "1" * 40), ("v2.0.0", "2" * 40), ("v3.0.0", "3" * 40)]:
                cur.execute(
                    "INSERT INTO node_versions (node_id, version_tag, git_sha, release_date) "
                    "VALUES (%s, %s, %s, %s)",
                    (node_id, tag, sha, datetime(2026, 6, 1, tzinfo=timezone.utc)),
                )
            cur.execute(
                "SELECT id, version_tag FROM node_versions WHERE node_id=%s ORDER BY release_date DESC", node_id
            )
            versions = {row["version_tag"]: row["id"] for row in cur.fetchall()}
            # Author user
            cur.execute(
                "INSERT INTO users (github_id, username, avatar_url, role) VALUES (1, 'u', '', 'user') "
                "ON DUPLICATE KEY UPDATE username=VALUES(username)"
            )
            cur.execute("SELECT id FROM users WHERE github_id=1")
            user_id = cur.fetchone()["id"]
            # 2 wiki_revisions on v1
            cur.execute(
                "INSERT INTO wiki_revisions (version_id, author_id, dependencies, node_class_mappings, "
                "incompatibilities, notes_md, edit_summary) VALUES (%s, %s, '[]', '[]', '[]', '', 'edit1')",
                (versions["v1.0.0"], user_id),
            )
            cur.execute(
                "INSERT INTO wiki_revisions (version_id, author_id, dependencies, node_class_mappings, "
                "incompatibilities, notes_md, edit_summary) VALUES (%s, %s, '[]', '[]', '[]', '', 'edit2')",
                (versions["v1.0.0"], user_id),
            )
        conn.commit()
    yield {
        "node_id": node_id,
        "v1_id": versions["v1.0.0"],
        "v2_id": versions["v2.0.0"],
        "v3_id": versions["v3.0.0"],
    }
    # Teardown
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM wiki_revisions")
            cur.execute("DELETE FROM node_raw_requirements")
            cur.execute("DELETE FROM node_versions")
            cur.execute("DELETE FROM nodes")
        conn.commit()


def test_reassign_orphan_revisions_moves_to_most_recent(fixtures):
    """When v1 is deleted, its 2 wiki_revisions should point to v3 (newest surviving)."""
    # Act: reassign wiki_revisions whose version_id == v1 to the most-recent surviving version (v3)
    count = reassign_orphan_revisions(
        node_id=fixtures["node_id"],
        deleted_version_ids=[fixtures["v1_id"]],
        canonical_version_ids=[fixtures["v3_id"], fixtures["v2_id"]],  # newest first
    )
    # Assert: 2 wiki_revisions reassigned
    assert count == 2
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_id, COUNT(*) AS n FROM wiki_revisions GROUP BY version_id")
            rows = {row["version_id"]: row["n"] for row in cur.fetchall()}
    assert rows == {fixtures["v3_id"]: 2}


def test_reassign_orphan_revisions_no_op_when_no_orphans(fixtures):
    """If no wiki_revisions point to deleted_version_ids, count is 0 and no rows change."""
    count = reassign_orphan_revisions(
        node_id=fixtures["node_id"],
        deleted_version_ids=[fixtures["v1_id"]],
        canonical_version_ids=[fixtures["v3_id"], fixtures["v2_id"]],
    )
    # First call: 2 rows reassigned (baseline)
    assert count == 2
    # Second call: nothing to do
    count2 = reassign_orphan_revisions(
        node_id=fixtures["node_id"],
        deleted_version_ids=[fixtures["v1_id"]],
        canonical_version_ids=[fixtures["v3_id"], fixtures["v2_id"]],
    )
    assert count2 == 0


def test_reassign_orphan_revisions_skips_when_no_canonical(fixtures):
    """If canonical_version_ids is empty, no rows are reassigned (count=0)."""
    count = reassign_orphan_revisions(
        node_id=fixtures["node_id"],
        deleted_version_ids=[fixtures["v1_id"]],
        canonical_version_ids=[],
    )
    assert count == 0
    # Original 2 wiki_revisions still point to v1
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version_id FROM wiki_revisions ORDER BY id")
            rows = [row["version_id"] for row in cur.fetchall()]
    assert rows == [fixtures["v1_id"], fixtures["v1_id"]]
