import os

from celery import Celery
from celery.schedules import crontab

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

# Beat schedule: weekly scan every Monday 03:00 UTC (per spec §7.2)
celery_app.conf.beat_schedule = {
    "scan-every-week": {
        "task": "scanner.tasks.fetch_pending_nodes",
        "schedule": crontab(hour=3, minute=0, day_of_week="monday"),
    },
}
celery_app.conf.timezone = "UTC"