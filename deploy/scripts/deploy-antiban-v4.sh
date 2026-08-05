#!/usr/bin/env bash
# Deploy baileys-antiban 4.10 + enhancedMode toggle.
# SAFETY: SCP + npm install antiban only + pm2 reload (never restart / clear auth).
#
# Usage:
#   ONLY=wasup3 bash deploy/scripts/deploy-antiban-v4.sh
#   bash deploy/scripts/deploy-antiban-v4.sh   # full shared fleet
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"
ANTIBAN_PIN="4.10.0"

for f in \
  src/utils/antiban-v2.js \
  src/utils/antiban-modules.js \
  src/utils/instance-manager.js \
  server.js \
  public/index.html \
  package.json \
  package-lock.json
do
  [[ -f "$APP/$f" ]] || { echo "Missing $APP/$f" >&2; exit 1; }
done

node --check "$APP/src/utils/antiban-v2.js" || exit 1
node --check "$APP/src/utils/antiban-modules.js" || exit 1
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

  local tmp="/tmp/wasup-antiban-v4-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp/src/utils' '$tmp/public'" || return 1

  scp -q -o ConnectTimeout=20 \
    "$APP/src/utils/antiban-v2.js" \
    "$APP/src/utils/antiban-modules.js" \
    "$APP/src/utils/instance-manager.js" \
    "$user@$host:$tmp/src/utils/" || return 1
  scp -q -o ConnectTimeout=20 "$APP/server.js" "$user@$host:$tmp/server.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/public/index.html" "$user@$host:$tmp/public/index.html" || return 1
  scp -q -o ConnectTimeout=20 "$APP/package.json" "$user@$host:$tmp/package.json" || return 1
  scp -q -o ConnectTimeout=20 "$APP/package-lock.json" "$user@$host:$tmp/package-lock.json" || return 1

  ssh -o ConnectTimeout=180 "$user@$host" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/antiban-v2.js" "$dir/src/utils/antiban-v2.js"
cp "$tmp/src/utils/antiban-modules.js" "$dir/src/utils/antiban-modules.js"
cp "$tmp/src/utils/instance-manager.js" "$dir/src/utils/instance-manager.js"
cp "$tmp/server.js" "$dir/server.js"
cp "$tmp/public/index.html" "$dir/public/index.html"
cp "$tmp/package.json" "$dir/package.json"
cp "$tmp/package-lock.json" "$dir/package-lock.json"
rm -rf "$tmp"
node --check "$dir/server.js"
node --check "$dir/src/utils/antiban-v2.js"
node --check "$dir/src/utils/antiban-modules.js"
node --check "$dir/src/utils/instance-manager.js"
cd "$dir"
CUR=\$(node -e "try{const p=require('path');const r=require.resolve('baileys-antiban');console.log(JSON.parse(require('fs').readFileSync(p.join(p.dirname(r),'../../package.json'),'utf8')).version)}catch(e){console.log('missing')}")
echo "  baileys-antiban current=\$CUR target=$ANTIBAN_PIN"
if [[ "\$CUR" != "$ANTIBAN_PIN" ]]; then
  echo "  installing baileys-antiban@$ANTIBAN_PIN (only — no full npm ci)"
  if npm install baileys-antiban@$ANTIBAN_PIN --save-exact --ignore-scripts; then
    echo "  npm install ok"
  else
    echo "  npm install retry with sudo"
    sudo npm install baileys-antiban@$ANTIBAN_PIN --save-exact --ignore-scripts
  fi
else
  echo "  baileys-antiban already pinned — skipping npm install"
fi
node --input-type=module -e "import { wrapSocket, InstanceCoordinator } from 'baileys-antiban'; console.log('  imports-ok', typeof wrapSocket, typeof InstanceCoordinator)"
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
echo "=== post-reload check ==="
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
    v2=i.get('antibanV2') or {}
    print(f\\\"{i.get('name')}:{i.get('status')}:enh={bool(v2.get('enhancedMode'))}:lib={v2.get('libraryVersion') or '?'}\\\", end=' ')
  print()
except Exception as e:
  print('check-failed', e)
\"" || echo "check-failed"
done

exit "$fail"
