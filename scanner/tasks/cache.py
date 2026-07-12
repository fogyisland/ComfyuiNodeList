import logging

from scanner.celery_app import celery_app
from scanner.db import prune_expired_resolutions

logger = logging.getLogger(__name__)


@celery_app.task(name="scanner.tasks.prune_expired_resolutions")
def prune_expired_resolutions_task() -> int:
    """Daily Celery task to clean stale `gitsha_resolutions` cache entries.

    Invoked by the Celery beat schedule entry "prune-expired-resolutions"
    (daily at 04:00 UTC). Returns the number of entries deleted. Logs an
    info line when the count is > 0 and an exception line if the DB call
    fails (so the next day's run can retry).
    """
    try:
        deleted = prune_expired_resolutions()
    except Exception:
        logger.exception("prune_expired_resolutions failed")
        return 0
    if deleted:
        logger.info("pruned %d expired gitsha_resolutions entries", deleted)
    return deleted
