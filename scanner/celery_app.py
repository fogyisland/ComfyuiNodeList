import logging
import os

from celery import Celery
from celery.schedules import crontab

logger = logging.getLogger(__name__)

_DEFAULT_SYNC_MANAGER_CRON = "0 5 * * *"


def parse_cron_string(spec: str) -> crontab:
    """Parse a 5-field cron string into a Celery crontab.

    Format: 'minute hour day_of_month month day_of_week'.
    Field semantics match Celery's crontab() kwargs.
    """
    parts = spec.split()
    if len(parts) != 5:
        raise ValueError(f"Expected 5 cron fields, got {len(parts)}: {spec!r}")
    minute, hour, day, month, day_of_week = parts
    return crontab(
        minute=minute,
        hour=hour,
        day_of_month=day,
        month_of_year=month,
        day_of_week=day_of_week,
    )


def _build_sync_manager_schedule() -> crontab:
    """Build the sync_manager_catalog schedule from env var, falling back to default."""
    spec = os.environ.get(
        "CELERY_SYNC_MANAGER_CATALOG_CRON", _DEFAULT_SYNC_MANAGER_CRON
    )
    try:
        return parse_cron_string(spec)
    except ValueError as exc:
        logger.warning(
            "Invalid CELERY_SYNC_MANAGER_CATALOG_CRON=%r (%s); falling back to %r",
            spec,
            exc,
            _DEFAULT_SYNC_MANAGER_CRON,
        )
        return parse_cron_string(_DEFAULT_SYNC_MANAGER_CRON)


celery_app = Celery("scanner")

# Broker + result backend
celery_app.conf.broker_url = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
celery_app.conf.result_backend = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

# JSON serialization (no pickle — safer across trust boundaries)
celery_app.conf.task_serializer = "json"
celery_app.conf.accept_content = ["json"]
celery_app.conf.result_serializer = "json"

# Test mode: run tasks synchronously in the calling process
if os.environ.get("CELERY_TEST_EAGER") == "1":
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True

# Auto-discover tasks
celery_app.autodiscover_tasks(["scanner.tasks"])

# Beat schedule: weekly scan every Monday 03:00 UTC (per spec §7.2),
# plus daily prune at 04:00 UTC for gitsha_resolutions cache TTL,
# plus daily sync of ComfyUI-Manager catalog at 05:00 UTC.
celery_app.conf.beat_schedule = {
    "scan-every-week": {
        "task": "scanner.tasks.fetch_pending_nodes",
        "schedule": crontab(hour=3, minute=0, day_of_week="monday"),
    },
    "prune-expired-resolutions": {
        "task": "scanner.tasks.prune_expired_resolutions",
        "schedule": crontab(hour=4, minute=0),
    },
    "sync-manager-catalog-daily": {
        "task": "scanner.tasks.sync_manager_catalog",
        "schedule": _build_sync_manager_schedule(),
    },
}
celery_app.conf.timezone = "UTC"
