# Deploy Recall to DigitalOcean (recall-app.net)

**Droplet:** `ssh root@159.223.130.69`  
**Domain:** https://recall-app.net  
**App path on server:** `/var/www/recall-app`  
**API port:** `5008` (PM2 `recall-api` + nginx `proxy_pass`)

## Current situation

`recall-app.net` serves the Recall SPA + API on port **5008**. DNS goes through **Cloudflare**; origin is droplet IP `159.223.130.69`.

## Port map on this droplet (avoid conflicts)

| Port | App |
|------|-----|
| 5000 | ReviewKeeper |
| 5001 | abaworkspace |
| 5002 | ABA Note Assistant (production API) |
| 5003 | IT Ops Dashboard (production) |
| 5004 | abaworkspace staging |
| 5005 / 5007 | ABA staging |
| 5006 | IT Ops staging |
| **5008** | **Recall / recall-app.net (this app)** |

## Migrate from old path (`/var/www/aura-ai-assistant`)

If the app was previously cloned to `aura-ai-assistant`, run once on the droplet:

```bash
ssh root@159.223.130.69

# Stop legacy PM2 name if present
pm2 delete aura-api 2>/dev/null || true

# Move deploy directory (or re-clone — see below)
if [ -d /var/www/aura-ai-assistant ] && [ ! -d /var/www/recall-app ]; then
  mv /var/www/aura-ai-assistant /var/www/recall-app
fi

cd /var/www/recall-app
git pull
pnpm install
pnpm run build:prod

# Update nginx root path, then reload
cp nginx-recall-app.conf /etc/nginx/sites-available/recall-app
ln -sf /etc/nginx/sites-available/recall-app /etc/nginx/sites-enabled/recall-app
nginx -t && systemctl reload nginx

pm2 delete recall-api 2>/dev/null || true
pm2 start artifacts/api-server/ecosystem.config.cjs
pm2 save
```

## One-time server setup (fresh install)

```bash
ssh root@159.223.130.69

git clone https://github.com/ehsh01/aura-ai-assistant.git /var/www/recall-app
cd /var/www/recall-app

cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit .env — at minimum PORT/API_PORT=5008; add DATABASE_URL when schema exists

pnpm install
pnpm run build:prod

pm2 start artifacts/api-server/ecosystem.config.cjs
pm2 save

cp nginx-recall-app.conf /etc/nginx/sites-available/recall-app
ln -sf /etc/nginx/sites-available/recall-app /etc/nginx/sites-enabled/recall-app
nginx -t && systemctl reload nginx
```

> **GitHub:** The remote repo may still be named `aura-ai-assistant`. You can rename it to `recall-app` in GitHub Settings → General; update `origin` with `git remote set-url` if you do.

### Fix recall-app.net routing (critical)

On the server, find what currently owns `recall-app.net`:

```bash
grep -r "recall-app" /etc/nginx/sites-enabled/
ss -tlnp | grep -E '5002|5008'
curl -sI -H "Host: recall-app.net" http://127.0.0.1/ | head -5
```

- If `recall-app.net` appears in `/etc/nginx/sites-enabled/abanoteassistant` (or similar), **remove it** from that `server_name` line so only Recall’s config answers for that host.
- Reload nginx after edits.

### SSL

```bash
certbot --nginx -d recall-app.net -d www.recall-app.net
```

## Day-to-day deploy

```bash
ssh root@159.223.130.69
cd /var/www/recall-app
git pull
pnpm install
pnpm run build:prod
pm2 restart recall-api --update-env
```

Or run the bundled script from the repo root on the server:

```bash
cd /var/www/recall-app && bash scripts/deploy-recall-app.sh
```

## Verify

```bash
curl -sS http://127.0.0.1:5008/api/healthz
curl -sI -H "Host: recall-app.net" http://127.0.0.1/ | head -10
```

Browser: https://recall-app.net — title should be **Recall — AI Personal Assistant**.

## Architecture

```
recall-app.net (Cloudflare)
    → nginx :80/:443
        /api/*  → 127.0.0.1:5008  (PM2: recall-api)
        /*      → /var/www/recall-app/artifacts/recall-app/dist/public
```

Frontend uses same-origin `/api/...` (no `VITE_API_BASE_URL` needed when nginx proxies as above).

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main` and gates changes on:

- `pnpm run typecheck` (all packages)
- `pnpm --filter "./artifacts/api-server" run test` (Vitest unit tests)

`scripts/deploy-recall-app.sh` also runs the api-server test suite as a gate before building, so a broken build never reaches production.

## Auto-deploy on push

`.github/workflows/deploy-recall-app.yml` deploys automatically when `main` changes under `artifacts/**`, `lib/**`, or the deploy script (and still supports manual `workflow_dispatch`).

**Required GitHub secret:** `DEPLOY_SSH_KEY` — a private key whose public half is in the droplet's `~/.ssh/authorized_keys`. Without it the job safely no-ops. Add it under **Settings → Secrets and variables → Actions**. The matching public key is `~/.ssh/id_recall_deploy.pub` locally.

## Database backups

`scripts/backup-recall-db.sh` writes a compressed, timestamped `pg_dump` to `/var/backups/recall/` and keeps the newest 14. Schedule it via cron on the droplet:

```bash
15 3 * * * bash /var/www/recall-app/scripts/backup-recall-db.sh >> /var/log/recall-backup.log 2>&1
```

Restore with:

```bash
gunzip -c /var/backups/recall/recall-YYYYmmdd-HHMMSS.sql.gz | psql "$DATABASE_URL"
```
