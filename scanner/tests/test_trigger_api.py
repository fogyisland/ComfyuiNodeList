"""Smoke tests for trigger_api endpoints (manager-sync + existing scan)."""
import json
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture
def client():
    from scanner.trigger_api import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_trigger_manager_sync_queues_task(client):
    fake = MagicMock()
    fake.id = "mgr-abc-123"
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.return_value = fake
        res = client.post("/trigger-manager-sync")
    assert res.status_code == 202
    body = json.loads(res.data)
    assert body["status"] == "queued"
    assert body["task_id"] == "mgr-abc-123"
    mock_celery.send_task.assert_called_once_with("scanner.tasks.sync_manager_catalog")


def test_trigger_manager_sync_returns_503_on_broker_failure(client):
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.side_effect = RuntimeError("redis down")
        res = client.post("/trigger-manager-sync")
    assert res.status_code == 503
    body = json.loads(res.data)
    assert body["error"] == "broker unavailable"


def test_trigger_scan_still_works(client):
    """Regression: the existing /trigger-scan endpoint is unchanged."""
    fake = MagicMock()
    fake.id = "scan-xyz"
    with patch("scanner.trigger_api.celery_app") as mock_celery:
        mock_celery.send_task.return_value = fake
        res = client.post("/trigger-scan")
    assert res.status_code == 202
    mock_celery.send_task.assert_called_once_with("scanner.tasks.fetch_pending_nodes")
