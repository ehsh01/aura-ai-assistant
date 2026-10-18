# Manual production deploy

Recall production deploys are intentionally manual. The droplet keeps
`/var/www/recall-app` on a detached HEAD so every deploy and rollback names an
exact commit.

## 1. Record the current release and verify a backup

On the droplet:

```bash
cd /var/www/recall-app
SHA="<full-40-character-commit-sha>"
[[ "$SHA" =~ ^[0-9a-fA-F]{40}$ ]] ||
  { echo "ERROR: SHA must be a full commit SHA" >&2; exit 1; }
git fetch --all --prune
git cat-file -e "${SHA}^{commit}" ||
  { echo "ERROR: commit $SHA does not exist" >&2; exit 1; }

PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "Previous SHA: $PREVIOUS_SHA"

bash scripts/backup-recall-db.sh
BACKUP="$(ls -1t /var/backups/recall/recall-*.sql.gz | head -n 1)"
gzip -t "$BACKUP"
bash scripts/restore-drill-recall-db.sh "$BACKUP"
```

Do not continue unless the backup succeeds and the test restore reports
`Restore drill PASSED`. The restore drill uses an ephemeral PostgreSQL
container and never writes to production.

## 2. Dry-run migrations

Run pending migrations against a second disposable restore of that backup, not
against production:

```bash
cd /var/www/recall-app
: "${SHA:?Set SHA to the verified target commit from step 1}"
: "${BACKUP:?Set BACKUP to the verified dump from step 1}"
DRY_RUN_NAME="recall-migration-dry-run-$$"
DRY_RUN_PASSWORD="$(openssl rand -hex 16)"
DRY_RUN_ROOT="$(mktemp -d)"
DRY_RUN_TREE="$DRY_RUN_ROOT/repo"
git worktree add --detach "$DRY_RUN_TREE" "$SHA"
docker run -d --rm --name "$DRY_RUN_NAME" \
  -e POSTGRES_USER=drill \
  -e POSTGRES_PASSWORD="$DRY_RUN_PASSWORD" \
  -e POSTGRES_DB=recall_drill \
  -p 127.0.0.1::5432 postgres:18
trap 'docker rm -f "$DRY_RUN_NAME" >/dev/null 2>&1 || true; git -C /var/www/recall-app worktree remove --force "$DRY_RUN_TREE" >/dev/null 2>&1 || true; rm -rf "$DRY_RUN_ROOT"' EXIT

until docker exec "$DRY_RUN_NAME" pg_isready -U drill -d recall_drill >/dev/null 2>&1; do
  sleep 1
done
gunzip -c "$BACKUP" | docker exec -i "$DRY_RUN_NAME" \
  psql -v ON_ERROR_STOP=1 -U drill -d recall_drill
DRY_RUN_PORT="$(
  docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' \
    "$DRY_RUN_NAME"
)"
cd "$DRY_RUN_TREE"
pnpm install --frozen-lockfile
DATABASE_URL="postgresql://drill:${DRY_RUN_PASSWORD}@127.0.0.1:${DRY_RUN_PORT}/recall_drill" \
  node scripts/db-migrate.mjs

cd /var/www/recall-app
docker rm -f "$DRY_RUN_NAME"
git -C /var/www/recall-app worktree remove --force "$DRY_RUN_TREE"
rm -rf "$DRY_RUN_ROOT"
trap - EXIT
```

Review the migration runner output and stop on any error. If it says it
baselined every migration, stop: no pending migration was exercised.

Before a voice-cap release, set these explicit production values in
`artifacts/api-server/.env` (the deploy does not change production env):

```dotenv
AI_DAILY_BUDGET_USD=1.00
RECALL_AI_MONTHLY_BUDGET_USD=15.00
AI_BACKGROUND_DAILY_BUDGET_USD_PER_USER=1.00
AI_DAILY_BUDGET_USD_PER_USER=1.00
RECALL_VOICE_ASK_DAILY_LIMIT=100
RECALL_VOICE_TTS_DAILY_CHARS=30000
RECALL_VOICE_SESSION_SILENCE_MS=8000
RECALL_TTS_MODEL=tts-1
RECALL_TTS_VOICE=onyx
```

Missing or invalid budget variables disable paid AI. Do not print the
production env while checking these values.

## 3. Deploy one explicit SHA

Use the **Deploy Recall App** workflow's **Run workflow** button and enter the
full 40-character commit SHA in the required `sha` field.

For a manual SSH deploy, run:

```bash
ssh root@159.223.130.69
cd /var/www/recall-app
SHA="<full-40-character-commit-sha>"

test -n "$SHA" || { echo "ERROR: SHA is required" >&2; exit 1; }
git fetch --all --prune
git cat-file -e "${SHA}^{commit}" ||
  { echo "ERROR: commit $SHA does not exist" >&2; exit 1; }
git checkout --detach "$SHA"
RECALL_DEPLOY_ALREADY_PULLED=1 bash scripts/deploy-recall-app.sh
echo "Deployed SHA: $(git rev-parse HEAD)"
```

The deploy script already reloads PM2. Confirm the desired process definition
and persist it:

```bash
pm2 startOrReload artifacts/api-server/ecosystem.config.cjs --update-env
pm2 save
```

### Map a production stack trace offline

The API build emits `artifacts/api-server/dist/index.mjs.map`, but production
processes intentionally do not load it. The deploy only requires `index.mjs`;
archive the map with its exact release SHA if mapped stack traces are needed.
On a workstation built from that SHA, resolve a bundled frame with:

```bash
pnpm dlx source-map-cli resolve \
  artifacts/api-server/dist/index.mjs.map <line> <column>
```

## 4. Smoke-test production

Capture usage before the unauthenticated checks:

```bash
cd /var/www/recall-app
set -a
source artifacts/api-server/.env
set +a
AI_USAGE_BEFORE="$(
  psql "$DATABASE_URL" -X -Atc \
    "SELECT count(*) || ':' || COALESCE(sum(cost_micros), 0) FROM ai_usage"
)"
```

Then verify the site, both health endpoints, and authentication on Ask and all
Evernote import routes:

```bash
curl -fsS https://recall-app.net/ >/dev/null
curl -fsS https://recall-app.net/api/ready
curl -fsS https://recall-app.net/api/healthz

test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'content-type: application/json' -d '{"question":"smoke test"}' \
  https://recall-app.net/api/ai/query)" = "401"
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'content-type: application/json' -d '{}' \
  https://recall-app.net/api/notes/import/enex)" = "401"
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  https://recall-app.net/api/notes/import/enex-file)" = "401"
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  https://recall-app.net/api/notes/import/enex/chunk)" = "401"
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  https://recall-app.net/api/notes/import/enex/status/smoke)" = "401"
```

Confirm `ai_usage` stayed flat during these unauthenticated smoke tests:

```bash
AI_USAGE_AFTER="$(
  psql "$DATABASE_URL" -X -Atc \
    "SELECT count(*) || ':' || COALESCE(sum(cost_micros), 0) FROM ai_usage"
)"
printf 'ai_usage before=%s after=%s\n' "$AI_USAGE_BEFORE" "$AI_USAGE_AFTER"
test "$AI_USAGE_BEFORE" = "$AI_USAGE_AFTER"
```

## Rollback

Check out the recorded previous SHA, rebuild, and reload:

```bash
cd /var/www/recall-app
PREVIOUS_SHA="<recorded-previous-commit-sha>"
git fetch --all --prune
git cat-file -e "${PREVIOUS_SHA}^{commit}"
git checkout --detach "$PREVIOUS_SHA"
pnpm install
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" pnpm run build:prod
pm2 startOrReload artifacts/api-server/ecosystem.config.cjs --update-env
pm2 save
```

Do not restore the database for an application-only rollback. Restore the
pre-deploy backup only if a migration damaged production data or schema, after
stopping writes; a restore discards changes made after the backup.
