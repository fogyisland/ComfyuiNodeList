# Production Deployment Runbook

This runbook covers deploying the ComfyUI Node Wiki system to a production Linux server using **direct Node.js + Python processes** supervised by systemd. **No Docker is used.**

## Architecture overview

```
                            ┌─────────────────────┐
                            │  nginx :443 (HTTPS) │
                            │  certbot / Let's    │
                            │  Encrypt            │
                            └──────────┬──────────┘
                                       │ reverse proxy
                                       ▼
                            ┌─────────────────────┐
                            │ comfyui-web :3000   │
                            │ (Next.js, npm start)│
                            └──────────┬──────────┘
                                       │ fetch (localhost)
                                       ▼
                            ┌─────────────────────┐
                            │ trigger-api :8081   │
                            │ (Flask + gunicorn)  │
                            └──────────┬──────────┘
                                       │ send_task
                                       ▼
        ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
        │ Redis :6379     │◀───┤ celery-worker    │    │ MySQL :3306     │
        │ broker/backend  │    │ (prefork, 4 proc) │───▶│ comfyui_nodes   │
        └─────────────────┘    └──────────────────┘    └─────────────────┘
                                       ▲
                            ┌─────────────────────┐
                            │ celery-beat         │
                            │ (weekly Mon 03:00)  │
                            └─────────────────────┘
```

## 1. Server prerequisites

Tested on **Ubuntu 24.04 LTS**. Other systemd-based Linux distributions work with minor adjustments.

```bash
# System packages
sudo apt update
sudo apt install -y mysql-server-8.0 redis-server nginx certbot python3-certbot-nginx

# Node.js 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Python 3.11+ (system)
sudo apt install -y python3.11 python3.11-venv python3-pip

# Create deploy user
sudo useradd -r -m -d /opt/comfyui-node-wiki -s /bin/bash comfyui
```

Verify:

```bash
node --version    # v20.x
npm --version     # 10.x
python3.11 --version  # 3.11.x
mysql --version
redis-cli --version
nginx -v
```

## 2. Initial bootstrap

```bash
# Clone repo
sudo -u comfyui git clone https://github.com/fogyisland/ComfyuiNodeList.git /opt/comfyui-node-wiki
cd /opt/comfyui-node-wiki

# Build (idempotent — re-running picks up new commits)
sudo -u comfyui bash deploy/scripts/build-prod.sh
```

The script runs `npm ci`, `prisma migrate deploy`, `next build`, and `pip install` for the scanner. Requires `DATABASE_URL` to be exported.

## 3. Environment configuration

```bash
# Copy env templates
sudo cp deploy/web.env.example /etc/comfyui/web.env
sudo cp deploy/scanner.env.example /etc/comfyui/scanner.env
sudo chown root:comfyui /etc/comfyui/*.env
sudo chmod 640 /etc/comfyui/*.env

# Generate NextAuth secret
sudo sed -i 's|^NEXTAUTH_SECRET=$|NEXTAUTH_SECRET='"$(openssl rand -base64 32)"'|' /etc/comfyui/web.env

# Edit both files: set DATABASE_URL, NEXTAUTH_URL, GitHub OAuth, SCANNER_GITHUB_TOKEN
sudo -e /etc/comfyui/web.env
sudo -e /etc/comfyui/scanner.env
```

## 4. systemd installation

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comfyui-web comfyui-celery-worker comfyui-celery-beat comfyui-trigger-api
```

Verify each service is active:

```bash
systemctl status comfyui-web
systemctl status comfyui-celery-worker
systemctl status comfyui-celery-beat
systemctl status comfyui-trigger-api
```

All should show `active (running)`. If any fail, check logs:

```bash
journalctl -u comfyui-web -n 50 --no-pager
```

## 5. nginx installation

```bash
# Edit server_name + TLS paths in deploy/nginx/comfyui-node-wiki.conf
sudo sed -i 's|nodes.example.com|your-domain.com|g' deploy/nginx/comfyui-node-wiki.conf
sudo cp deploy/nginx/comfyui-node-wiki.conf /etc/nginx/sites-enabled/comfyui-node-wiki
sudo nginx -t
sudo systemctl reload nginx
```

## 6. TLS (Let's Encrypt)

```bash
sudo certbot --nginx -d your-domain.com
```

certbot modifies the nginx config to add the `ssl_certificate` paths and HTTP→HTTPS redirect. Re-run annually via the certbot systemd timer (installed automatically).

## 7. Verification

```bash
# Web app responds
curl -fsS http://127.0.0.1:3000/api/v1/nodes | head

# Trigger API is alive
curl -fsS http://127.0.0.1:8081/health
# → {"status":"ok"}

# Public HTTPS endpoint responds
curl -fsS https://your-domain.com/api/v1/nodes | head

# Celery worker is consuming tasks
journalctl -u comfyui-celery-worker -n 20 --no-pager
# Look for: "celery@hostname ready."

# Celery beat is scheduling
journalctl -u comfyui-celery-beat -n 20 --no-pager
# Look for: "Scheduler: Sending due task scan-every-week"
```

Test the full admin-trigger flow (requires an admin user):

```bash
# 1. Log in via browser, capture the NextAuth session cookie
# 2. Use curl with the cookie:
curl -fsS -X POST -H "Cookie: next-auth.session-token=..." \
  https://your-domain.com/api/v1/admin/scans/trigger
# → {"status":"queued","task_id":"abc-123"}

# 3. Verify the task landed in the worker
journalctl -u comfyui-celery-worker -n 20 --no-pager
# Look for: "Received task: scanner.tasks.fetch_pending_nodes"
```

## 8. Monitoring

```bash
# Live tail all 4 services
journalctl -u comfyui-web -u comfyui-celery-worker -u comfyui-celery-beat -u comfyui-trigger-api -f

# nginx access log
sudo tail -f /var/log/nginx/comfyui-node-wiki.access.log

# Disk usage (watch for log/journal growth)
df -h /var/log /var
```

For external monitoring (UptimeRobot, Prometheus, etc.):
- Web liveness: `https://your-domain.com/api/v1/nodes` returns 200 with JSON
- Trigger API liveness: `http://127.0.0.1:8081/health` returns 200 (expose via a separate nginx location if needed)

## 9. Updates

```bash
cd /opt/comfyui-node-wiki
sudo -u comfyui git pull
sudo -u comfyui bash deploy/scripts/build-prod.sh
sudo systemctl restart comfyui-web comfyui-celery-worker comfyui-celery-beat comfyui-trigger-api
```

Zero-downtime updates require a load balancer + 2 servers — out of scope for Plan 5.

## 10. Rollback

```bash
cd /opt/comfyui-node-wiki
sudo -u comfyui git log --oneline -10  # find the last good commit
sudo -u comfyui git reset --hard <last-good-commit>
sudo -u comfyui bash deploy/scripts/build-prod.sh
sudo systemctl restart comfyui-web comfyui-celery-worker comfyui-celery-beat comfyui-trigger-api
```

If the database schema changed, also rollback the migration:
```bash
cd /opt/comfyui-node-wiki/web
sudo -u comfyui DATABASE_URL=... npm run prisma:migrate:rollback
# (Prisma does not have a built-in 'migrate rollback'; the implementer must
#  manually write the DOWN migration if needed. See Task 1 for an example.)
```

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `comfyui-web` fails: "Cannot find module 'next'" | `npm ci` not run, or wrong CWD | `cd /opt/comfyui-node-wiki/web && sudo -u comfyui npm ci` |
| `comfyui-web` returns 500 on every page | `DATABASE_URL` wrong or MySQL down | `mysql -h 127.0.0.1 -u comfyui -p comfyui_nodes -e 'SELECT 1'` |
| `comfyui-celery-worker` fails: "redis.exceptions.ConnectionError" | Redis down or wrong port | `redis-cli ping` (should return `PONG`) |
| `comfyui-trigger-api` returns 503 | Redis unreachable from trigger-api | Same as above |
| nginx returns 502 | Next.js process crashed | `systemctl status comfyui-web` + `journalctl -u comfyui-web -n 50` |
| TLS cert expired | certbot renewal failed | `sudo certbot renew --dry-run` to test, then `sudo certbot renew` |
| Weekly scan not running | Celery beat crashed | `systemctl status comfyui-celery-beat` + journal logs |
| `prisma migrate deploy` fails: "Migration ... failed to apply" | DB schema drift | Run `prisma migrate reset` in dev, regenerate migration, commit |

## See also

- `web/.env.example` — local dev env (used by `pnpm dev`)
- `scanner/requirements.txt` — Python production deps
- Plan 4 final review (3 Important findings — all addressed in Plan 5)
