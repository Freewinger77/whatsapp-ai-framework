#!/usr/bin/env bash
# Roll reachout-timelock worker diagnostics to shared Wasup VMs.
# Deploys instance-manager.js + server.js, installs baileys@7.0.0-rc13, pm2 reload.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

FILES=(
  "src/utils/instance-manager.js"
  "server.js"
  "package.json"
  "scripts/patch-baileys.js"
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

  local tmp="/tmp/wasup-reachout-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp/scripts' '$tmp/src/utils'" || { echo "  FAILED mkdir"; return 1; }

  scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$user@$host:$tmp/src/utils/instance-manager.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/server.js" "$user@$host:$tmp/server.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/package.json" "$user@$host:$tmp/package.json" || return 1
  scp -q -o ConnectTimeout=20 "$APP/scripts/patch-baileys.js" "$user@$host:$tmp/scripts/patch-baileys.js" || return 1

  ssh -o ConnectTimeout=60 "$user@$host" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/instance-manager.js" "$dir/src/utils/instance-manager.js"
cp "$tmp/server.js" "$dir/server.js"
cp "$tmp/package.json" "$dir/package.json"
cp "$tmp/scripts/patch-baileys.js" "$dir/scripts/patch-baileys.js"
rm -rf "$tmp"
cd "$dir"
npm install baileys@7.0.0-rc13 --save-exact --ignore-scripts
node scripts/patch-baileys.js || true
node -e "console.log('baileys', require('./node_modules/baileys/package.json').version)"
cd "$(dirname "$dir")"
pm2 reload "$pm2"
echo "  OK $name"
EOF
}

fail=0
for entry in "${HOSTS[@]}"; do
  deploy_host "$entry" || fail=1
done
exit "$fail"
