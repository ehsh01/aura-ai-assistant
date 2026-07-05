#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-159.223.130.69}"
USER="${DEPLOY_USER:-root}"

bash "$ROOT/.cursor/setup-ssh.sh"

KEY_FILE=""
for candidate in ~/.ssh/id_ed25519 ~/.ssh/id_rsa; do
  if [ -f "$candidate" ]; then
    KEY_FILE="$candidate"
    break
  fi
done

if [ -z "$KEY_FILE" ]; then
  echo "No SSH key available." >&2
  echo "Add your Mac deploy key as SSH_PRIVATE_KEY (Runtime Secret) at:" >&2
  echo "  https://cursor.com/dashboard/cloud-agents" >&2
  echo "Then restart the cloud agent and run: bash scripts/remote-deploy.sh" >&2
  exit 1
fi

echo "==> Deploying to ${USER}@${HOST}"
ssh -i "$KEY_FILE" -o BatchMode=yes "${USER}@${HOST}" \
  'cd /var/www/recall-app && bash scripts/deploy-recall-app.sh'

echo "==> Done. Purge Cloudflare cache for recall-app.net if needed."
