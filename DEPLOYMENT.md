# Deploy Recall to DigitalOcean (recall-app.net)

**Droplet:** `ssh root@159.223.130.69`  
**Domain:** https://recall-app.net  
**App path on server:** `/var/www/aura-ai-assistant`  
**API port:** `5008` (PM2 + nginx `proxy_pass`)

## Current situation

`recall-app.net` currently serves **ABA Note Assistant** (same stack as `abanoteassistant.com` — static SPA + API on port **5002**). To host Recall there, you must:

1. Deploy this repo on the droplet.
2. Point **nginx** for `recall-app.net` at Recall’s static build + port **5008**.
3. **Remove** `recall-app.net` from any other nginx `server_name` (likely the ABA config).

DNS goes through **Cloudflare**; origin should remain the droplet IP `159.223.130.69` (orange cloud proxy is fine).

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

## One-time server setup

```bash
ssh root@159.223.130.69

# Clone
git clone https://github.com/ehsh01/aura-ai-assistant.git /var/www/aura-ai-assistant
cd /var/www/aura-ai-assistant

# Env
cp artifacts/api-server/.env.example artifacts/api-server/.env
# Edit .env — at minimum PORT/API_PORT=5008; add DATABASE_URL when schema exists

pnpm install
PORT=20991 BASE_PATH=/ pnpm --filter @workspace/aura-app run build
pnpm --filter @workspace/api-server run build

# PM2
pm2 start artifacts/api-server/ecosystem.config.cjs
pm2 save

# Nginx
cp nginx-recall-app.conf /etc/nginx/sites-available/recall-app
ln -sf /etc/nginx/sites-available/recall-app /etc/nginx/sites-enabled/recall-app
nginx -t && systemctl reload nginx
```

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

If HTTPS is terminated on the droplet:

```bash
certbot --nginx -d recall-app.net -d www.recall-app.net
```

If Cloudflare handles SSL (Flexible/Full), port 80 on the origin may be enough.

## Day-to-day deploy

```bash
ssh root@159.223.130.69
cd /var/www/aura-ai-assistant
git pull
pnpm install
PORT=20991 BASE_PATH=/ pnpm --filter @workspace/aura-app run build
pnpm --filter @workspace/api-server run build
pm2 restart recall-api --update-env
```

## Verify

```bash
curl -sS http://127.0.0.1:5008/api/healthz
curl -sI -H "Host: recall-app.net" http://127.0.0.1/ | head -10
```

Browser: https://recall-app.net — title should be **Recall — AI Personal Assistant**, not ABA Note Assistant.

## Architecture

```
recall-app.net (Cloudflare)
    → nginx :80/:443
        /api/*  → 127.0.0.1:5008  (PM2: recall-api)
        /*      → /var/www/aura-ai-assistant/artifacts/aura-app/dist/public
```

Frontend uses same-origin `/api/...` (no `VITE_API_BASE_URL` needed when nginx proxies as above).
