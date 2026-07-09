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
command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not found" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/recall-$STAMP.sql.gz"

echo "==> Dumping database to $OUT"
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$OUT"
echo "==> Wrote $(du -h "$OUT" | cut -f1)"

echo "==> Pruning backups older than the newest $RETENTION"
ls -1t "$BACKUP_DIR"/recall-*.sql.gz 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
  echo "    removing $old"
  rm -f "$old"
done

echo "Done."
