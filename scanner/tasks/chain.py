from celery import Signature, group
from scanner.celery_app import celery_app

from scanner.tasks.cleanup import cleanup
from scanner.tasks.fetch_releases import fetch_releases
from scanner.tasks.parse_version import parse_version


def build_chain(nodes: list[dict]) -> Signature:
    """Compose the full scan chain: for each node, (fetch_releases → chord of parse_version) → cleanup.
    `nodes` is a list of {node_id, owner, repo} dicts (typically from fetch_pending_nodes)."""
    # For each node, build a sub-chain: fetch_releases → chord of parse_version
    # We use the simpler approach: fetch_releases returns version_ids, but Celery needs static signatures.
    # Workaround: for each (node, expected_version) we fan out, but we don't know versions until fetch_releases runs.
    # Simplest pattern: chain runs in two phases:
    #   1. fetch_releases per node (parallel) — returns version_ids
    #   2. parse_version per (node, version) (parallel) — also needs (owner, repo, tarball_url)
    #
    # Celery's chord handles this via a callback that receives results, but we need a custom
    # implementation because the second phase depends on the first phase's output.
    #
    # For Plan 4 simplicity: we run fetch_releases + parse_version as a per-node chain (one node at a time),
    # and finally cleanup. This is a "group of chains" pattern.
    per_node_signatures = []
    for node in nodes:
        # Per-node chain: fetch_releases → parse_version_per_node
        # fetch_releases returns list[int] (version_ids), which becomes the first arg
        # to parse_version_per_node. Use .s() (partial) so the chain result is prepended
        # to (owner, repo) → final args: (version_ids, owner, repo).
        node_chain = (
            fetch_releases.si(node["node_id"], node["owner"], node["repo"])
            | parse_version_per_node.s(node["owner"], node["repo"])
        )
        per_node_signatures.append(node_chain)

    # Group of per-node chains, with cleanup as the final callback
    return group(per_node_signatures) | cleanup.si()


@celery_app.task(name="scanner.tasks.parse_version_per_node")
def parse_version_per_node(version_ids: list[int], owner: str, repo: str) -> list[dict]:
    """For each version_id returned by fetch_releases, fetch the tarball URL and call parse_version.
    Returns a list of parsed dicts (or None for failures)."""
    if not version_ids:
        return []
    from scanner.db import get_connection
    # Fetch the tarball_url for each version_id
    tarball_urls: dict[int, str] = {}
    with get_connection() as conn:
        with conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(version_ids))
            cur.execute(
                f"SELECT id FROM node_versions WHERE id IN ({placeholders})",
                version_ids,
            )
    # We need to map version_id to its tarball_url. Since node_versions doesn't store tarball_url,
    # we reconstruct it: https://api.github.com/repos/{owner}/{repo}/tarball/{tag}
    # To do this we need the version_tag for each id. Fetch it now.
    tarball_url_by_vid: dict[int, str] = {}
    with get_connection() as conn:
        with conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(version_ids))
            cur.execute(
                f"SELECT id, version_tag FROM node_versions WHERE id IN ({placeholders})",
                version_ids,
            )
            for row in cur.fetchall():
                vid = row["id"]
                tag = row["version_tag"]
                tarball_url_by_vid[vid] = f"https://api.github.com/repos/{owner}/{repo}/tarball/{tag}"

    # Call parse_version for each (version_id, tarball_url) sequentially within this task.
    # (Within a single task, sequential is fine — Celery's parallelism is across tasks.)
    from scanner.tasks.parse_version import parse_version
    results = []
    for vid in version_ids:
        url = tarball_url_by_vid.get(vid)
        if not url:
            continue
        result = parse_version.apply(args=[get_node_id_for_version(vid), vid, owner, repo, url]).get()
        results.append(result)
    return results


def get_node_id_for_version(version_id: int) -> int:
    from scanner.db import get_connection
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT node_id FROM node_versions WHERE id = %s", (version_id,))
            row = cur.fetchone()
    return row["node_id"] if row else 0
