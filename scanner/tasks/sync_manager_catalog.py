"""One-shot sync: pull ComfyUI Manager's custom-node-list.json, dedup, insert
pending node_submissions for admin review.

Idempotent: re-runs are no-ops for already-known nodes (per spec invariant #1).
"""
from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

import httpx

from scanner.celery_app import celery_app
from scanner.db import (
    _parse_github_url,
    fetch_existing_owner_repo_pairs,
    fetch_system_submitter_id,
    insert_pending_submission,
    update_node_from_manager,
)

logger = logging.getLogger(__name__)

MANAGER_CATALOG_URL = (
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
)
HTTP_TIMEOUT_SECONDS = 30.0


@celery_app.task(name="scanner.tasks.sync_manager_catalog")
def sync_manager_catalog() -> dict:
    """Fetch ComfyUI Manager catalog → dedup → INSERT pending submissions.

    Returns dict with status, fetched, added, skipped_existing, skipped_pending,
    skipped_invalid_url, errors[]. See spec §Data flow step 6.
    """
    counts = {
        "fetched": 0,
        "added": 0,
        "skipped_existing": 0,
        "skipped_pending": 0,
        "skipped_invalid_url": 0,
        "updated_nodes": 0,
        "errors": [],
    }

    # Step 1: Fetch catalog
    try:
        resp = httpx.get(MANAGER_CATALOG_URL, timeout=HTTP_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("manager catalog fetch failed: %s", exc)
        return {"status": "failed", "stage": "fetch", "error": str(exc)}

    # Step 2: Parse JSON
    try:
        catalog = resp.json()
    except json.JSONDecodeError as exc:
        logger.warning("manager catalog not valid JSON: %s", exc)
        return {"status": "failed", "stage": "parse", "error": "malformed JSON"}
    if not isinstance(catalog, dict):
        return {"status": "failed", "stage": "parse", "error": "catalog top-level must be a dict"}

    counts["fetched"] = len(catalog)

    # Step 3: Parse each entry's reference URL
    parsed_entries: list[tuple[str, str, str, str | None, str | None, str | None]] = []  # (entry_id, owner, repo, title, description, author)
    for entry_id, entry in catalog.items():
        ref = entry.get("reference") if isinstance(entry, dict) else None
        parsed = _parse_github_url(ref) if isinstance(ref, str) and ref else None
        if parsed is None:
            counts["skipped_invalid_url"] += 1
            continue
        title = entry.get("title") if isinstance(entry, dict) else None
        description = entry.get("description") if isinstance(entry, dict) else None
        author = entry.get("author") if isinstance(entry, dict) else None
        parsed_entries.append((entry_id, parsed[0], parsed[1], title, description, author))

    # Step 4: Dedup — split between nodes (skipped_existing) and pending submissions (skipped_pending).
    try:
        existing = fetch_existing_owner_repo_pairs()
        from scanner.db import get_connection as _gc
        with _gc() as _conn:
            with _conn.cursor() as _cur:
                _cur.execute("SELECT github_owner, github_repo FROM nodes")
                node_pairs = {(r["github_owner"].lower(), r["github_repo"].lower()) for r in _cur.fetchall()}
    except Exception as exc:
        logger.exception("dedup query failed")
        return {"status": "failed", "stage": "dedup", "error": str(exc)}

    new_entries: list[tuple[str, str, str, str | None, str | None, str | None]] = []
    for entry_id, owner, repo, title, description, author in parsed_entries:
        pair = (owner, repo)
        if pair in existing:
            if pair in node_pairs:
                counts["skipped_existing"] += 1
            else:
                counts["skipped_pending"] += 1
        else:
            new_entries.append((entry_id, owner, repo, title, description, author))

    # Step 5: Look up system user
    submitter_id = fetch_system_submitter_id()
    if submitter_id is None:
        return {
            "status": "failed",
            "stage": "system_user",
            "error": "system user missing; run pnpm prisma:seed",
        }

    # Step 6: INSERT each new entry
    for entry_id, owner, repo, title, description, author in new_entries:
        url = f"https://github.com/{owner}/{repo}"
        try:
            insert_pending_submission(submitter_id, url, name=title, description=description)
            counts["added"] += 1
        except Exception as exc:
            logger.warning("insert failed for %s: %s", entry_id, exc)
            counts["errors"].append({"entry_id": entry_id, "error": str(exc)})

    # Walk the entries again to update existing nodes
    for entry_id, owner, repo, title, description, author in parsed_entries:
        if (owner, repo) in node_pairs:
            try:
                update_node_from_manager(owner, repo, name=title, description=description, author=author)
                counts["updated_nodes"] += 1
            except Exception as exc:
                logger.warning("update failed for %s: %s", entry_id, exc)
                counts["errors"].append({"entry_id": entry_id, "error": str(exc)})

    return {"status": "ok", **counts}
