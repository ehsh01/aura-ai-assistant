#!/bin/bash
# Create a least-privilege `recall` deploy user for /var/www/recall-app.
# Safe path: does NOT remove root SSH access.
# Run once on the droplet as root:
#   bash scripts/setup-recall-deploy-user.sh
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/recall-app}"
DEPLOY_USER="${DEPLOY_USER:-recall}"
SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

echo "==> Ensure deploy user exists: $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

echo "==> Ownership for $DEPLOY_PATH"
mkdir -p "$DEPLOY_PATH"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_PATH"

echo "==> Allow limited sudo for deploy operations"
SUDOERS="/etc/sudoers.d/recall-deploy"
cat >"$SUDOERS" <<EOF
# Managed by scripts/setup-recall-deploy-user.sh — keep root SSH intact.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx, /usr/bin/systemctl restart nginx, /usr/sbin/nginx -t, /usr/bin/pm2 *
Defaults:$DEPLOY_USER !requiretty
EOF
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"

if [ -n "$SSH_PUBKEY_FILE" ] && [ -f "$SSH_PUBKEY_FILE" ]; then
  echo "==> Install deploy SSH key for $DEPLOY_USER"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  AUTH="/home/$DEPLOY_USER/.ssh/authorized_keys"
  touch "$AUTH"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
  chmod 600 "$AUTH"
  KEY="$(cat "$SSH_PUBKEY_FILE")"
  grep -qxF "$KEY" "$AUTH" || echo "$KEY" >>"$AUTH"
fi

# Prefer running PM2 as the deploy user (if not already).
if command -v sudo >/dev/null && [ -d "$DEPLOY_PATH/artifacts/api-server" ]; then
  echo "==> Tip: start PM2 as $DEPLOY_USER:"
  echo "    su - $DEPLOY_USER -c 'cd $DEPLOY_PATH && pm2 start artifacts/api-server/ecosystem.config.cjs && pm2 save'"
fi

echo ""
echo "Done. Root SSH was not modified."
echo "Next: set GitHub Action username to '$DEPLOY_USER' (secret DEPLOY_SSH_USER) once the deploy key is on that account."
echo "Keep root access until you confirm deploys work as $DEPLOY_USER."
