"""Tiny HTTP service that exposes Celery's send_task over localhost.

Runs as the comfyui-trigger-api systemd unit on 127.0.0.1:8081.
The Next.js web app calls POST /trigger-scan to enqueue a fetch_pending_nodes
Celery task on demand.

Why a separate service (and not inlined into the worker):
- Celery workers use prefork, which conflicts with Flask's threading model
- A separate unit lets the trigger-api restart independently of the worker
- The HTTP surface is trivial (2 endpoints) — auditable in one file

Endpoints:
- POST /trigger-scan → enqueue fetch_pending_nodes, return 202 with task_id
- GET /health       → return 200 for systemd watchdog
"""
import logging

from flask import Flask, jsonify

from scanner.celery_app import celery_app

logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.post("/trigger-scan")
def trigger_scan():
    """Enqueue the weekly scan task. Returns 202 + task_id on success, 503 on broker failure."""
    try:
        async_result = celery_app.send_task("scanner.tasks.fetch_pending_nodes")
    except Exception as exc:
        logger.exception("send_task failed")
        return jsonify({"error": "broker unavailable", "detail": str(exc)}), 503
    return jsonify({"status": "queued", "task_id": async_result.id}), 202


@app.get("/health")
def health():
    """Liveness probe for systemd watchdog / monitoring."""
    return jsonify({"status": "ok"}), 200
