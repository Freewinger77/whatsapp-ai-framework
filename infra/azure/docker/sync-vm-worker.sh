#!/usr/bin/env bash
# Sync full worker app bundle to a VM and reload PM2.
# Usage: WASUP_VM_HOST=azureuser@40.112.73.2 ./sync-vm-worker.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="${ROOT_DIR}/app"
VM_HOST="${WASUP_VM_HOST:?Set WASUP_VM_HOST e.g. azureuser@20.223.209.59}"
REMOTE_DIR="${WASUP_VM_DIR:-/opt/whatsapp-ai/app}"

echo "==> Syncing to ${VM_HOST}:${REMOTE_DIR}"
rsync -avz --delete \
  --exclude node_modules \
  --exclude instances \
  --exclude logs \
  --exclude .env \
  "${APP_DIR}/" "${VM_HOST}:${REMOTE_DIR}/"

echo "==> Installing deps + PM2 reload"
ssh "${VM_HOST}" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
npm install --ignore-scripts
pm2 reload whatsapp-api || pm2 restart whatsapp-api
sleep 3
curl -sf http://127.0.0.1:3000/api/health | head -c 200 || true
echo
curl -sf -o /dev/null -w "docs:%{http_code}\n" http://127.0.0.1:3000/docs || true
EOF

echo "Done."
