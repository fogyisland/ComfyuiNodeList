"""One-shot backfill: flip source_manager=true for nodes already imported from
ComfyUI-Manager before Plan 5.1.3 added the source_manager column.

Usage:
  # Dry-run (default): print sample + count, no DB write
  python -m scanner.scripts.backfill_source_manager --limit 10

  # Apply: actually UPDATE the DB
  python -m scanner.scripts.backfill_source_manager --apply

Idempotent: re-running yields 0 candidates after the first apply.
"""

import argparse
import sys
import httpx

from scanner.db import get_connection


CATALOG_URL = (
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
)


def fetch_manager_catalog() -> dict:
    """Fetch live Manager catalog. Returns {key: {reference, title, ...}}."""
    resp = httpx.get(CATALOG_URL, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def parse_node_pairs(catalog: dict | list) -> set[tuple[str, str]]:
    """Return set of (LOWER(owner), LOWER(repo)) pairs from the catalog.

    Accepts both the flat-dict test fixture format and the live catalog
    format ({"custom_nodes": [list of entries]}). Tolerant of list
    values under any key.
    """
    pairs: set[tuple[str, str]] = set()

    entries: list
    if isinstance(catalog, list):
        entries = catalog
    elif isinstance(catalog, dict):
        # Live catalog: {"custom_nodes": [...]}. Flat-dict fixture format
        # has dict values directly. Try the list under "custom_nodes" first;
        # otherwise iterate dict values.
        cn = catalog.get("custom_nodes")
        if isinstance(cn, list):
            entries = cn
        else:
            entries = [v for v in catalog.values() if isinstance(v, (dict, list))]
            # Flatten any nested lists
            flat: list = []
            for v in entries:
                if isinstance(v, list):
                    flat.extend(v)
                else:
                    flat.append(v)
            entries = flat
    else:
        return pairs

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        ref = entry.get("reference") or entry.get("id") or ""
        if "github.com" not in ref:
            continue
        tail = ref.split("github.com/", 1)[-1].strip("/")
        parts = tail.split("/")
        if len(parts) >= 2:
            pairs.add((parts[0].lower(), parts[1].lower()))
    return pairs


def find_candidates() -> list[dict]:
    """Return rows where (LOWER(owner), LOWER(repo)) is in the catalog and source_manager=false."""
    catalog = fetch_manager_catalog()
    pairs = parse_node_pairs(catalog)
    if not pairs:
        return []

    placeholders = ",".join(["(%s, %s)"] * len(pairs))
    flat = [v for pair in pairs for v in pair]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, github_owner, github_repo "
                f"FROM nodes "
                f"WHERE source_manager = false "
                f"AND (LOWER(github_owner), LOWER(github_repo)) IN ({placeholders})",
                flat,
            )
            return list(cur.fetchall())


def apply_update(node_ids: list[int]) -> int:
    """Batch UPDATE source_manager=true. Returns total affected rows."""
    affected = 0
    with get_connection() as conn:
        for i in range(0, len(node_ids), 100):
            batch = node_ids[i : i + 100]
            placeholders = ",".join(["%s"] * len(batch))
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE nodes SET source_manager = true WHERE id IN ({placeholders})",
                    batch,
                )
                affected += cur.rowcount
            conn.commit()
    return affected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill source_manager=true for nodes already imported from Manager before Plan 5.1.3."
    )
    parser.add_argument("--apply", action="store_true", help="Actually update the DB. Default is dry-run.")
    parser.add_argument("--limit", type=int, default=20, help="Sample size to print in dry-run (default 20).")
    args = parser.parse_args(argv)

    print("Fetching live Manager catalog...")
    candidates = find_candidates()
    print(f"Found {len(candidates)} nodes matching the catalog with source_manager=false")

    if not candidates:
        print("0 nodes to backfill. Exiting.")
        return 0

    if not args.apply:
        sample = candidates[: args.limit]
        print(f"\nDry-run. First {len(sample)} of {len(candidates)} candidates:")
        for row in sample:
            print(f"  - {row['github_owner']}/{row['github_repo']} (id={row['id']})")
        print(f"\nRun with --apply to update these {len(candidates)} nodes.")
        return 0

    print(f"Applying UPDATE to {len(candidates)} nodes...")
    node_ids = [c["id"] for c in candidates]
    affected = apply_update(node_ids)
    print(f"Done. {affected} rows updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
