#!/usr/bin/env bash
# Deploy PN+LID handoff + blockApiSendsDuringHandoff to shared Wasup workers.
#
# SAFETY:
# - SCP code only; never clear auth / instances
# - pm2 reload (graceful) — never pm2 restart
#
# Usage:
#   bash deploy/scripts/deploy-handoff-pn-lid.sh
#   ONLY=wasup2 bash deploy/scripts/deploy-handoff-pn-lid.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

FILES=(
  "src/utils/instance-manager.js"
  "server.js"
  "public/index.html"
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$APP/$f" ]]; then
    echo "Missing $APP/$f" >&2
    exit 1
  fi
done

node --check "$APP/src/utils/instance-manager.js" || exit 1
node --check "$APP/server.js" || exit 1

HOSTS=(
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup2|azureuser|40.112.73.2|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup3|azureuser|94.245.90.173|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup4|azureuser|20.166.12.101|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup5|azureuser|20.13.163.156|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup01|azureuser|20.234.23.46|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup02|azureuser|20.234.94.178|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup03|azureuser|20.166.63.111|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup04|azureuser|52.236.60.246|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup05|azureuser|20.234.102.144|/opt/whatsapp-ai/app|whatsapp-api"
)

ONLY="${ONLY:-}"

want() {
  [[ -z "$ONLY" ]] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

deploy_host() {
  local name user host dir pm2
  IFS='|' read -r name user host dir pm2 <<< "$1"
  want "$name" || return 0

  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" "test -d '$dir'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    return 1
  fi

  local tmp="/tmp/wasup-handoff-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp/src/utils' '$tmp/public'" || return 1

  scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$user@$host:$tmp/src/utils/instance-manager.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/server.js" "$user@$host:$tmp/server.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/public/index.html" "$user@$host:$tmp/public/index.html" || return 1

  ssh -o ConnectTimeout=90 "$user@$host" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/instance-manager.js" "$dir/src/utils/instance-manager.js"
cp "$tmp/server.js" "$dir/server.js"
cp "$tmp/public/index.html" "$dir/public/index.html"
rm -rf "$tmp"
node --check "$dir/server.js"
node --check "$dir/src/utils/instance-manager.js"
cd "\$(dirname "$dir")"
pm2 reload "$pm2"
echo "  OK $name (pm2 reload)"
EOF
}

fail=0
for entry in "${HOSTS[@]}"; do
  deploy_host "$entry" || fail=1
done

echo
echo "=== post-reload connected check ==="
for entry in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir pm2 <<< "$entry"
  want "$name" || continue
  echo -n "$name: "
  ssh -o ConnectTimeout=20 "$user@$host" \
    "curl -sf http://127.0.0.1:3000/api/instances 2>/dev/null | python3 -c \"
import sys,json
try:
  d=json.load(sys.stdin)
  inst=d.get('instances') or []
  for i in inst:
    print(f\\\"{i.get('name')}:{i.get('status')}\\\", end=' ')
  print()
except Exception as e:
  print('check-failed', e)
\"" || echo "check-failed"
done

exit "$fail"
