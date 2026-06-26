from scanner.celery_app import celery_app
from scanner.db import get_active_nodes
from scanner.tasks.chain import build_chain


@celery_app.task(name="scanner.tasks.fetch_pending_nodes")
def fetch_pending_nodes() -> dict:
    """Entry point: list active nodes, build the scan chain, and apply it.
    Returns the chain result (a dict from cleanup)."""
    nodes = [
        {"node_id": node_id, "owner": owner, "repo": repo}
        for node_id, owner, repo in get_active_nodes()
    ]
    if not nodes:
        return {}
    sig = build_chain(nodes)
    result = sig.apply().get(disable_sync_subtasks=False)
    return result if isinstance(result, dict) else {}