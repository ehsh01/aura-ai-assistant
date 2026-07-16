#!/bin/bash
# One-shot deploy Recall on DigitalOcean for recall-app.net
# Run on droplet as root: bash scripts/deploy-recall-app.sh
set -euo pipefail

DEPLOY_PATH="/var/www/recall-app"
# GitHub repo slug may still be aura-ai-assistant until renamed in GitHub settings
REPO_URL="https://github.com/ehsh01/aura-ai-assistant.git"
API_PORT="5008"

echo "==> Clone or update repo"
if [ -d "$DEPLOY_PATH/.git" ]; then
  cd "$DEPLOY_PATH"
  # If the workflow already pulled, stay put; otherwise update before build/migrate.
  if [ "${RECALL_DEPLOY_ALREADY_PULLED:-}" != "1" ]; then
    git pull --ff-only
  fi
else
  mkdir -p "$(dirname "$DEPLOY_PATH")"
  git clone "$REPO_URL" "$DEPLOY_PATH"
  cd "$DEPLOY_PATH"
fi

echo "==> Install & build"
command -v pnpm >/dev/null || npm install -g pnpm@9
pnpm install

echo "==> Test gate (api-server unit tests)"
# 2GB droplet: pglite *.db.test.ts OOMs tinypool workers. Fast unit tests still gate
# the deploy; full suite (incl. db) runs in CI / locally.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}" \
  pnpm --filter "./artifacts/api-server" exec vitest run \
    --maxWorkers=1 \
    --no-file-parallelism \
    --exclude '**/*.db.test.ts'
echo "==> Database migrations (idempotent)"
ENV_FILE="artifacts/api-server/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required; refusing to deploy without migrations" >&2
  exit 1
fi
# Migration runner (scripts/db-migrate.mjs) applies every unrecorded
# lib/db/migrations/*.sql via a schema_migrations ledger, so new migration files
# can't be silently skipped. On an already-provisioned DB it baselines the
# existing files as applied. pgvector remains soft-fail inside the runner.
node scripts/db-migrate.mjs

if [ -z "${SECRETS_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: SECRETS_ENCRYPTION_KEY is required before replacing the production API" >&2
  exit 1
fi

# Give esbuild/tsc headroom on the 2GB droplet (earlier deploys OOM'd here).
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" pnpm run build:prod

if [ ! -f "artifacts/api-server/dist/index.mjs" ]; then
  echo "ERROR: API build missing artifacts/api-server/dist/index.mjs" >&2
  exit 1
fi

echo "==> API .env"
ENV_FILE="artifacts/api-server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp artifacts/api-server/.env.example "$ENV_FILE"
fi
if ! grep -q "^API_PORT=" "$ENV_FILE"; then
  echo "API_PORT=$API_PORT" >> "$ENV_FILE"
fi

echo "==> PM2"
pm2 delete aura-api 2>/dev/null || true
# startOrReload brings up both recall-api and recall-worker (creating the worker
# on first deploy) and 0-downtime reloads whatever is already running.
pm2 startOrReload artifacts/api-server/ecosystem.config.cjs --update-env || \
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
# Give PM2 a moment to boot the API before probing readiness (DB + job queue).
for i in 1 2 3 4 5; do
  if curl -sSf "http://127.0.0.1:$API_PORT/api/ready" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sS "http://127.0.0.1:$API_PORT/api/ready" && echo ""
curl -sk -H "Host: recall-app.net" https://127.0.0.1/ | grep -o '<title>[^<]*</title>' || true
echo "Done. Purge Cloudflare cache for recall-app.net if the browser still shows ABA."
