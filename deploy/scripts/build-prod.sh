#!/usr/bin/env bash
# Production build script — direct Node.js + Python, no Docker.
# Run as a deploy user with sudo for systemd unit installation.
#
# Idempotent: re-running picks up new commits and re-applies migrations.
# Exits non-zero on any failure.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Production uses npm (not pnpm) per feedback_deploy_with_npm.md.
# Bootstrap package-lock.json if missing — npm ci requires it (EUSAGE otherwise).
# This only runs once per fresh clone; subsequent deploys use the committed lockfile.
cd web
if [[ ! -f package-lock.json ]]; then
    echo "=== [1/6] web: bootstrap package-lock.json (npm install --package-lock-only) ==="
    npm install --package-lock-only --no-audit --no-fund
fi

echo "=== [2/6] web: npm ci ==="
npm ci

echo "=== [3/6] web: prisma generate ==="
npm run prisma:generate

echo "=== [4/6] web: prisma migrate deploy ==="
# Production uses 'migrate deploy' (applies pre-generated SQL, no prompts).
# DATABASE_URL must be exported in the environment.
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL must be exported (see deploy/web.env.example)" >&2
    exit 1
fi
npm run prisma:migrate:deploy

echo "=== [5/6] web: next build ==="
npm run build

echo "=== [6/6] scanner: pip install ==="
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
