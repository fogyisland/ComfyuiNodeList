import os

from celery import Celery

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