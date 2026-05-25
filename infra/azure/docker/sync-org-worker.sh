#!/usr/bin/env bash
# Sync the canonical worker app (same as wasup2/wasup-dev) onto a provisioned org VM.
#
# Usage:
#   ./sync-org-worker.sh arslan-s-workspace-wczy8o
#   ./sync-org-worker.sh wasupadmin@51.145.95.232
#   WASUP_ORG_SUBDOMAIN=my-org ./sync-org-worker.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="${ROOT_DIR}/app"
TARGET="${1:-${WASUP_ORG_SUBDOMAIN:-}}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <subdomain.wasup.co|user@ip>" >&2
  exit 1
fi

if [[ "$TARGET" == *@* ]]; then
  VM_HOST="$TARGET"
else
  SUBDOMAIN="${TARGET%.wasup.co}"
  SUBDOMAIN="${SUBDOMAIN%.wasup.ai}"
  IP="$(dig +short "${SUBDOMAIN}.wasup.co" A | head -1)"
  if [[ -z "$IP" ]]; then
    echo "Could not resolve ${SUBDOMAIN}.wasup.co" >&2
    exit 1
  fi
  VM_HOST="wasupadmin@${IP}"
fi

echo "==> Target host: ${VM_HOST}"

REMOTE_APP_DIR="$(
  ssh -o BatchMode=yes "$VM_HOST" bash -s <<'EOF'
set -euo pipefail
if [[ -d /opt/whatsapp-ai/app ]]; then
  echo /opt/whatsapp-ai/app
  exit 0
fi
mapfile -t dirs < <(ls -d /opt/wasup-*/app 2>/dev/null || true)
if ((${#dirs[@]} == 0)); then
  echo "No worker app directory found under /opt" >&2
  exit 1
fi
printf '%s\n' "${dirs[0]}"
EOF
)"

PM2_NAME="$(
  ssh -o BatchMode=yes "$VM_HOST" "sudo pm2 jlist 2>/dev/null" | python3 - <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("wasup-worker")
    raise SystemExit
for proc in data:
    name = proc.get("name", "")
    if name in ("wasup-worker", "whatsapp-api"):
        print(name)
        break
else:
    print(data[0]["name"] if data else "wasup-worker")
PY
)"

STAGING="/tmp/wasup-worker-sync-$$"
echo "==> Syncing app bundle to ${VM_HOST}:${REMOTE_APP_DIR} (pm2: ${PM2_NAME})"

rsync -avz \
  --exclude node_modules \
  --exclude auth_info \
  --exclude instances \
  --exclude logs \
  --exclude .env \
  "${APP_DIR}/" "${VM_HOST}:${STAGING}/"

ssh -o BatchMode=yes "$VM_HOST" bash -s <<EOF
set -euo pipefail
sudo rsync -a --delete \
  --exclude node_modules \
  --exclude auth_info \
  --exclude instances \
  --exclude logs \
  --exclude .env \
  "${STAGING}/" "${REMOTE_APP_DIR}/"
rm -rf "${STAGING}"
cd "${REMOTE_APP_DIR}"
sudo npm install --omit=dev --legacy-peer-deps --ignore-scripts
sudo pm2 reload "${PM2_NAME}" || sudo pm2 restart "${PM2_NAME}"
sleep 3
curl -sf http://127.0.0.1:3000/api/health | head -c 200 || true
echo
curl -sf http://127.0.0.1:3000/test | grep -q 'interactive-message-playground' && echo "test:ok" || echo "test:missing-markers"
curl -sf http://127.0.0.1:3000/docs | grep -q 'createApiReference' && echo "docs:ok" || echo "docs:missing-markers"
EOF

echo "==> Done. Public URLs:"
if [[ "$TARGET" == *@* ]]; then
  echo "  /test and /docs on the worker host"
else
  echo "  https://${SUBDOMAIN}.wasup.co/test"
  echo "  https://${SUBDOMAIN}.wasup.co/docs"
fi
