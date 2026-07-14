#!/bin/bash
# Restore drill for Recall DB backups — does NOT touch production.
#
# Loads the newest (or a specified) .sql.gz dump into an ephemeral
# postgres:18 Docker container, runs sanity checks, then destroys it.
#
# On the droplet:
#   bash scripts/restore-drill-recall-db.sh
#   bash scripts/restore-drill-recall-db.sh /var/backups/recall/recall-….sql.gz
#
# Suggested monthly cron (Sunday 04:00):
#   0 4 * * 0 bash /var/www/recall-app/scripts/restore-drill-recall-db.sh >> /var/log/recall-restore-drill.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/recall}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
DRILL_NAME="recall-restore-drill-$$"
DRILL_PASS="drill-pass-$$"
CONTAINER=""

cleanup() {
  if [ -n "$CONTAINER" ]; then
    echo "==> Stopping drill container $CONTAINER"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required for the restore drill" >&2
  exit 1
fi

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(ls -1t "$BACKUP_DIR"/recall-*.sql.gz 2>/dev/null | head -n 1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "ERROR: no backup dump found (looked in $BACKUP_DIR/recall-*.sql.gz)" >&2
  echo "Run scripts/backup-recall-db.sh first, or pass a dump path." >&2
  exit 1
fi

echo "==> Drill dump: $DUMP ($(du -h "$DUMP" | cut -f1))"
echo "==> Verifying gzip integrity"
gzip -t "$DUMP"

echo "==> Starting ephemeral $PG_IMAGE ($DRILL_NAME)"
CONTAINER="$(
  docker run -d --rm \
    --name "$DRILL_NAME" \
    -e POSTGRES_PASSWORD="$DRILL_PASS" \
    -e POSTGRES_USER=drill \
    -e POSTGRES_DB=recall_drill \
    "$PG_IMAGE"
)"

echo "==> Waiting for Postgres to accept connections"
for _ in $(seq 1 40); do
  if docker exec "$CONTAINER" pg_isready -U drill -d recall_drill >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! docker exec "$CONTAINER" pg_isready -U drill -d recall_drill >/dev/null 2>&1; then
  echo "ERROR: drill database did not become ready" >&2
  exit 1
fi

echo "==> Restoring dump into drill database"
gunzip -c "$DUMP" | docker exec -i "$CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U drill -d recall_drill >/tmp/recall-restore-drill.psql.log

echo "==> Sanity checks"
CHECKS="$(
  docker exec "$CONTAINER" psql -U drill -d recall_drill -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'users=' || count(*)::text FROM users;
SELECT 'tables=' || count(*)::text
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SELECT 'auth_sessions_present=' || CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'auth_sessions'
  ) THEN 'yes' ELSE 'no' END;
SQL
)"
echo "$CHECKS"

USER_COUNT="$(echo "$CHECKS" | sed -n 's/^users=//p' | head -n1)"
TABLE_COUNT="$(echo "$CHECKS" | sed -n 's/^tables=//p' | head -n1)"

if [ -z "${TABLE_COUNT:-}" ] || [ "$TABLE_COUNT" -lt 5 ]; then
  echo "ERROR: expected at least 5 public tables, got '${TABLE_COUNT:-missing}'" >&2
  exit 1
fi
if [ -z "${USER_COUNT:-}" ]; then
  echo "ERROR: users table check failed" >&2
  exit 1
fi

echo "==> Restore drill PASSED (users=$USER_COUNT tables=$TABLE_COUNT)"
echo "Done. Production database was not modified."
