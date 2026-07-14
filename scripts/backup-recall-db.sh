#!/bin/bash
# Back up the Recall PostgreSQL database to a compressed, timestamped dump.
# Run on the droplet (cron-friendly): bash scripts/backup-recall-db.sh
#
# Suggested cron (daily at 03:15):
#   15 3 * * * bash /var/www/recall-app/scripts/backup-recall-db.sh >> /var/log/recall-backup.log 2>&1
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/recall-app}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/recall}"
RETENTION="${RETENTION:-14}"
# Used when the host pg_dump is older than the managed Postgres major version.
PG_DUMP_IMAGE="${PG_DUMP_IMAGE:-postgres:18}"

ENV_FILE="$DEPLOY_PATH/artifacts/api-server/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set (checked $ENV_FILE)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/recall-$STAMP.sql.gz"

run_pg_dump() {
  if command -v docker >/dev/null 2>&1; then
    # Prefer Docker so the client major matches DigitalOcean managed Postgres 18
    # even when the host only has older postgresql-client packages.
    # Progress messages must go to stderr — stdout is the SQL dump.
    echo "==> Dumping via docker $PG_DUMP_IMAGE" >&2
    docker run --rm "$PG_DUMP_IMAGE" \
      pg_dump "$DATABASE_URL" --no-owner --no-privileges
    return
  fi
  if command -v pg_dump >/dev/null 2>&1; then
    echo "==> Dumping via host pg_dump" >&2
    pg_dump "$DATABASE_URL" --no-owner --no-privileges
    return
  fi
  echo "ERROR: neither docker nor pg_dump is available" >&2
  exit 1
}

echo "==> Dumping database to $OUT"
run_pg_dump | gzip -9 > "$OUT"
echo "==> Wrote $(du -h "$OUT" | cut -f1)"

echo "==> Pruning backups older than the newest $RETENTION"
ls -1t "$BACKUP_DIR"/recall-*.sql.gz 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
  echo "    removing $old"
  rm -f "$old"
done

echo "Done."
