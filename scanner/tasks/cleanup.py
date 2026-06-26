from scanner.celery_app import celery_app
from scanner.db import delete_old_versions, get_active_nodes


@celery_app.task(name="scanner.tasks.cleanup")
def cleanup() -> dict[str, int]:
    """For every active node, delete versions beyond the 5 most recent.
    Returns {owner/repo: deleted_count, ...}."""
    result: dict[str, int] = {}
    for node_id, owner, repo in get_active_nodes():
        deleted = delete_old_versions(node_id, keep=5)
        if deleted > 0:
            result[f"{owner}/{repo}"] = deleted
    return result