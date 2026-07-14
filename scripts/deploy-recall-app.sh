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
# 2GB droplet: keep Vitest workers low so pglite/db tests don't OOM the host.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}" \
  pnpm --filter "./artifacts/api-server" exec vitest run --maxWorkers=1 --no-file-parallelism
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
if ! command -v psql >/dev/null; then
  echo "ERROR: psql is required; refusing to deploy without migrations" >&2
  exit 1
fi
for mig in \
  lib/db/migrations/0002_capture_layer.sql \
  lib/db/migrations/0003_evidence_and_platform.sql \
  lib/db/migrations/0004_entity_embeddings.sql \
  lib/db/migrations/0005_note_knowledge_person.sql \
  lib/db/migrations/0006_life_memories.sql \
  lib/db/migrations/0007_ask_threads.sql \
  lib/db/migrations/0008_note_attachment_text.sql \
  lib/db/migrations/0009_extension_tokens.sql \
  lib/db/migrations/0010_entity_links.sql \
  lib/db/migrations/0011_vehicles_warranties.sql \
  lib/db/migrations/0012_homes.sql \
  lib/db/migrations/0013_organizations_invoices.sql \
  lib/db/migrations/0014_auth_sessions.sql \
  lib/db/migrations/0015_jobs.sql \
  lib/db/migrations/0016_notes_fts.sql \
  lib/db/migrations/0017_life_memory_lifecycle.sql \
  lib/db/migrations/0018_entity_embeddings_pgvector.sql
do
  echo "--> Applying $mig"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$mig" || {
    if [[ "$mig" == *pgvector* ]]; then
      echo "WARN: pgvector migration failed (extension may be unavailable); continuing with jsonb embeddings" >&2
    else
      exit 1
    fi
  }
done

if [ -z "${SECRETS_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: SECRETS_ENCRYPTION_KEY is required before replacing the production API" >&2
  exit 1
fi

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
pm2 delete aura-api 2>/dev/null || true
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
# Give PM2 a moment to boot the API before probing health.
for i in 1 2 3 4 5; do
  if curl -sSf "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sS "http://127.0.0.1:$API_PORT/api/healthz" && echo ""
curl -sk -H "Host: recall-app.net" https://127.0.0.1/ | grep -o '<title>[^<]*</title>' || true
echo "Done. Purge Cloudflare cache for recall-app.net if the browser still shows ABA."
