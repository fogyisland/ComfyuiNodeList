import json
import pytest
from unittest.mock import MagicMock, patch

from scanner.db import get_connection
from scanner.scripts import backfill_source_manager as bsm


SAMPLE_CATALOG = {
    "node-a": {"reference": "https://github.com/OwnerA/RepoA"},
    "node-b": {"reference": "https://github.com/ownerb/repob"},
    "node-c": {"reference": "https://github.com/OwnerC/RepoC"},
}


def _seed_node(owner: str, repo: str, source_manager: bool = False) -> int:
    """Insert a node and return its id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO nodes (github_owner, github_repo, name, author, description, source_manager, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, NOW(3), NOW(3))",
                (owner, repo, f"Name-{repo}", "alice", "desc", source_manager),
            )
            new_id = cur.lastrowid
        conn.commit()
    return new_id


@pytest.fixture
def fake_catalog():
    with patch.object(bsm, "fetch_manager_catalog", return_value=SAMPLE_CATALOG) as m:
        yield m


def test_dry_run_prints_sample_no_db_update(db, fake_catalog, capsys):
    """Default mode: print sample + count, no UPDATE."""
    _seed_node("OwnerA", "RepoA")  # in catalog, source_manager=false → candidate
    _seed_node("OwnerB", "RepoB")  # in catalog, source_manager=false → candidate
    _seed_node("Unrelated", "RepoX")  # NOT in catalog → not touched

    rc = bsm.main(argv=["--limit", "10"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "Found 2 nodes" in captured.out
    assert "Dry-run" in captured.out
    assert "Run with --apply" in captured.out

    # Verify no UPDATE happened
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM nodes WHERE source_manager = true")
            row = cur.fetchone()
    assert row["cnt"] == 0


def test_apply_mode_updates_source_manager(db, fake_catalog, capsys):
    """--apply flips source_manager=true for catalog matches."""
    a = _seed_node("OwnerA", "RepoA")
    b = _seed_node("OwnerB", "RepoB")
    x = _seed_node("Unrelated", "RepoX")

    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "Done." in captured.out
    assert "2 rows updated" in captured.out

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, source_manager FROM nodes WHERE id IN (%s, %s, %s)", (a, b, x))
            rows = {r["id"]: r["source_manager"] for r in cur.fetchall()}
    assert rows[a] == 1
    assert rows[b] == 1
    assert rows[x] == 0  # unrelated node untouched


def test_apply_is_idempotent(db, fake_catalog, capsys):
    """Second run after --apply finds 0 candidates."""
    _seed_node("OwnerA", "RepoA")

    bsm.main(argv=["--apply"])
    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "0 nodes to backfill" in captured.out


def test_unknown_node_not_touched(db, fake_catalog, capsys):
    """Node whose (owner, repo) is NOT in the catalog is not affected."""
    x = _seed_node("UnrelatedX", "RepoY")

    rc = bsm.main(argv=["--apply"])
    assert rc == 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT source_manager FROM nodes WHERE id = %s", (x,))
            row = cur.fetchone()
    assert row["source_manager"] == 0


def test_zero_candidates_exits_clean(db, fake_catalog, capsys):
    """Empty catalog of matches → exit 0 with friendly message."""
    _seed_node("Unrelated", "RepoX")

    rc = bsm.main(argv=["--limit", "5"])
    assert rc == 0

    captured = capsys.readouterr()
    assert "0 nodes to backfill" in captured.out
    assert "Run with --apply" not in captured.out
