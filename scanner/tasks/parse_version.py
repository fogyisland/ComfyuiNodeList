import io
import tarfile

import httpx

from scanner.celery_app import celery_app
from scanner.db import record_scan_failure, upsert_raw_requirements
from scanner.github import GitHubClient
from scanner.parsers import parse_version_files

_FILES_OF_INTEREST = ("pyproject.toml", "requirements.txt", "install.py", "__init__.py", "nodes.py", "README.md")


def _extract_files(tarball_bytes: bytes) -> dict[str, str]:
    """Extract the files we care about from a tarball. Returns {filename: content}."""
    out: dict[str, str] = {}
    with tarfile.open(fileobj=io.BytesIO(tarball_bytes), mode="r:*") as tf:
        for member in tf.getmembers():
            if not member.isfile():
                continue
            base = member.name.split("/")[-1]  # drop directory prefix
            if base in _FILES_OF_INTEREST and base not in out:
                f = tf.extractfile(member)
                if f is None:
                    continue
                try:
                    out[base] = f.read().decode("utf-8", errors="replace")
                except UnicodeDecodeError:
                    out[base] = f.read().decode("latin-1", errors="replace")
    return out


@celery_app.task(
    name="scanner.tasks.parse_version",
    autoretry_for=(httpx.HTTPError, OSError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def parse_version(node_id: int, version_id: int, owner: str, repo: str, tarball_url: str) -> dict | None:
    """Download tarball, extract files of interest, parse them, upsert raw_requirements.
    Returns the parsed dict, or None on terminal failure."""
    try:
        client = GitHubClient()
        tarball_bytes = client.download_tarball(tarball_url)
        files = _extract_files(tarball_bytes)
        parsed = parse_version_files(files)
        upsert_raw_requirements(version_id, parsed)
        return parsed
    except Exception as exc:
        try:
            record_scan_failure(node_id, "parse_version", str(exc), will_retry=False)
        except Exception:
            pass
        return None