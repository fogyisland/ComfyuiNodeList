#!/usr/bin/env bash
# Production build script — direct Node.js + Python, no Docker.
# Run as a deploy user with sudo for systemd unit installation.
#
# Idempotent: re-running picks up new commits and re-applies migrations.
# Exits non-zero on any failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/5] web: npm ci ==="
cd web
npm ci

echo "=== [2/5] web: prisma generate ==="
npm run prisma:generate

echo "=== [3/5] web: prisma migrate deploy ==="
# Production uses 'migrate deploy' (applies pre-generated SQL, no prompts).
# DATABASE_URL must be exported in the environment.
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL must be exported (see deploy/web.env.example)" >&2
    exit 1
fi
npm run prisma:migrate:deploy

echo "=== [4/5] web: next build ==="
npm run build

echo "=== [5/5] scanner: pip install ==="
cd "$REPO_ROOT/scanner"
pip install --no-cache-dir -r requirements.txt

echo ""
echo "=== Build complete ==="
echo "Next steps:"
echo "  1. Copy deploy/web.env.example to /etc/comfyui/web.env and fill in values"
echo "  2. Copy deploy/scanner.env.example to /etc/comfyui/scanner.env and fill in values"
echo "  3. Copy deploy/systemd/*.service files to /etc/systemd/system/"
echo "  4. sudo systemctl daemon-reload && sudo systemctl enable --now \\"
echo "       comfyui-web comfyui-celery-worker comfyui-celery-beat comfyui-trigger-api"
echo "  5. Copy deploy/nginx/comfyui-node-wiki.conf to /etc/nginx/sites-enabled/ and reload"
echo "  6. Verify: curl -fsS http://127.0.0.1:3000/api/v1/nodes | head"
echo "           curl -fsS http://127.0.0.1:8081/health"
