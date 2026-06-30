#!/bin/bash
# One-shot deploy Recall on DigitalOcean for recall-app.net
# Run on droplet as root: bash scripts/deploy-recall-app.sh
set -euo pipefail

DEPLOY_PATH="/var/www/aura-ai-assistant"
REPO_URL="https://github.com/ehsh01/aura-ai-assistant.git"
API_PORT="5008"

echo "==> Clone or update repo"
if [ -d "$DEPLOY_PATH/.git" ]; then
  cd "$DEPLOY_PATH"
  git pull --ff-only
else
  mkdir -p "$(dirname "$DEPLOY_PATH")"
  git clone "$REPO_URL" "$DEPLOY_PATH"
  cd "$DEPLOY_PATH"
fi

echo "==> Install & build"
command -v pnpm >/dev/null || npm install -g pnpm@9
pnpm install
pnpm run build:prod

echo "==> API .env"
ENV_FILE="artifacts/api-server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp artifacts/api-server/.env.example "$ENV_FILE"
fi
if ! grep -q "^API_PORT=" "$ENV_FILE"; then
  echo "API_PORT=$API_PORT" >> "$ENV_FILE"
fi

echo "==> PM2"
pm2 delete recall-api 2>/dev/null || true
pm2 start artifacts/api-server/ecosystem.config.cjs
pm2 save

echo "==> Nginx"
cp nginx-recall-app.conf /etc/nginx/sites-available/recall-app
ln -sf /etc/nginx/sites-available/recall-app /etc/nginx/sites-enabled/recall-app
nginx -t
systemctl reload nginx

if [ ! -d "/etc/letsencrypt/live/recall-app.net" ]; then
  echo "==> SSL (certbot)"
  certbot --nginx -d recall-app.net -d www.recall-app.net --non-interactive --agree-tos -m admin@recall-app.net || \
    echo "Run certbot manually if this failed"
fi

echo "==> Verify"
curl -sS "http://127.0.0.1:$API_PORT/api/healthz" && echo ""
curl -sk -H "Host: recall-app.net" https://127.0.0.1/ | grep -o '<title>[^<]*</title>' || true
echo "Done. Purge Cloudflare cache for recall-app.net if the browser still shows ABA."
