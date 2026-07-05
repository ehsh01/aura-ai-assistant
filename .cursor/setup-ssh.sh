#!/usr/bin/env bash
set -euo pipefail

KEY="${SSH_PRIVATE_KEY:-${DEPLOY_SSH_KEY:-}}"
HOST="${DEPLOY_HOST:-159.223.130.69}"

if [ -z "$KEY" ]; then
  exit 0
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh

if printf '%s\n' "$KEY" | grep -q 'BEGIN OPENSSH PRIVATE KEY'; then
  KEY_FILE=~/.ssh/id_ed25519
elif printf '%s\n' "$KEY" | grep -q 'BEGIN RSA PRIVATE KEY'; then
  KEY_FILE=~/.ssh/id_rsa
else
  KEY_FILE=~/.ssh/id_ed25519
fi

printf '%s\n' "$KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

ssh-keyscan -H "$HOST" >> ~/.ssh/known_hosts 2>/dev/null || true
