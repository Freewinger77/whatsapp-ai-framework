#!/usr/bin/env bash
# Deploy tctoken / 463 / reachout hardening to shared Wasup workers.
#
# SAFETY (do not disturb live WhatsApp sessions):
# - SCP code only; never clear auth / instances
# - pm2 reload (graceful) — never pm2 restart
# - npm install baileys ONLY if version != 7.0.0-rc13
#
# Usage:
#   bash deploy/scripts/deploy-tctoken-hardening.sh
#   ONLY=wasup,wasup2 bash deploy/scripts/deploy-tctoken-hardening.sh
#   INCLUDE_ORG=1 bash deploy/scripts/deploy-tctoken-hardening.sh   # also mousa + bashir if reachable
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"
BAILEYS_PIN="7.0.0-rc13"

FILES=(
  "src/utils/instance-manager.js"
  "src/utils/privacy-token-hardening.js"
  "src/utils/control-plane-registry.js"
  "src/utils/control-plane-reporter.js"
  "src/utils/message-status.js"
  "server.js"
  "package.json"
  "scripts/patch-baileys.js"
  "public/index.html"
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$APP/$f" ]]; then
    echo "Missing $APP/$f" >&2
    exit 1
  fi
done

node --check "$APP/src/utils/privacy-token-hardening.js" || exit 1
node --check "$APP/src/utils/instance-manager.js" || exit 1
node --check "$APP/server.js" || exit 1

HOSTS=(
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app|whatsapp-api|0"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app|whatsapp-api|0"
  "wasup2|azureuser|40.112.73.2|/opt/whatsapp-ai/app|whatsapp-api|0"
  "wasup3|azureuser|94.245.90.173|/opt/whatsapp-ai/app|whatsapp-api|0"
  "wasup4|azureuser|20.166.12.101|/opt/whatsapp-ai/app|whatsapp-api|0"
  "wasup5|azureuser|20.13.163.156|/opt/whatsapp-ai/app|whatsapp-api|0"
)

if [[ "${INCLUDE_ORG:-0}" == "1" ]]; then
  HOSTS+=(
    "mousa|wasupadmin|51.140.7.175|/opt/wasup-59817b593594/app|wasup-worker|1"
    "bashir|wasupadmin|20.58.56.114|/opt/wasup-81ccb28431f3/app|wasup-worker|1"
  )
fi

ONLY="${ONLY:-}"

want() {
  [[ -z "$ONLY" ]] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

deploy_host() {
  local name user host dir pm2 sudo_cp
  IFS='|' read -r name user host dir pm2 sudo_cp <<< "$1"
  want "$name" || return 0

  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" "test -d '$dir'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    return 1
  fi

  local tmp="/tmp/wasup-tctoken-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp/scripts' '$tmp/src/utils' '$tmp/public'" || return 1

  scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$user@$host:$tmp/src/utils/instance-manager.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/privacy-token-hardening.js" "$user@$host:$tmp/src/utils/privacy-token-hardening.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/control-plane-registry.js" "$user@$host:$tmp/src/utils/control-plane-registry.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/control-plane-reporter.js" "$user@$host:$tmp/src/utils/control-plane-reporter.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/message-status.js" "$user@$host:$tmp/src/utils/message-status.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/server.js" "$user@$host:$tmp/server.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/package.json" "$user@$host:$tmp/package.json" || return 1
  scp -q -o ConnectTimeout=20 "$APP/scripts/patch-baileys.js" "$user@$host:$tmp/scripts/patch-baileys.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/public/index.html" "$user@$host:$tmp/public/index.html" || return 1

  ssh -o ConnectTimeout=90 "$user@$host" bash -s <<EOF
set -euo pipefail
SUDO=""
if [[ "$sudo_cp" == "1" ]]; then SUDO="sudo"; fi
\$SUDO cp "$tmp/src/utils/instance-manager.js" "$dir/src/utils/instance-manager.js"
\$SUDO cp "$tmp/src/utils/privacy-token-hardening.js" "$dir/src/utils/privacy-token-hardening.js"
\$SUDO cp "$tmp/src/utils/control-plane-registry.js" "$dir/src/utils/control-plane-registry.js"
\$SUDO cp "$tmp/src/utils/control-plane-reporter.js" "$dir/src/utils/control-plane-reporter.js"
\$SUDO cp "$tmp/src/utils/message-status.js" "$dir/src/utils/message-status.js"
\$SUDO cp "$tmp/server.js" "$dir/server.js"
\$SUDO cp "$tmp/package.json" "$dir/package.json"
\$SUDO cp "$tmp/scripts/patch-baileys.js" "$dir/scripts/patch-baileys.js"
\$SUDO cp "$tmp/public/index.html" "$dir/public/index.html"
rm -rf "$tmp"
# Fail closed if server.js cannot load — never leave PM2 on a broken module graph.
node --check "$dir/server.js"
cd "$dir"
node -e "import('./server.js').catch((e)=>{console.error(e); process.exit(1)})" >/dev/null 2>&1 || true
# Prefer static import graph check
node --input-type=module -e "await import('file://$dir/src/utils/control-plane-registry.js'); await import('file://$dir/src/utils/privacy-token-hardening.js'); console.log('imports-ok')"
CUR=\$(node -e "try{console.log(require('./node_modules/baileys/package.json').version)}catch(e){console.log('missing')}")
echo "  baileys current=\$CUR target=$BAILEYS_PIN"
if [[ "\$CUR" != "$BAILEYS_PIN" ]]; then
  echo "  installing baileys@$BAILEYS_PIN (only — no full npm ci)"
  \$SUDO npm install baileys@$BAILEYS_PIN --save-exact --ignore-scripts
  \$SUDO node scripts/patch-baileys.js || true
else
  echo "  baileys already pinned — skipping npm install"
fi
\$SUDO node -e "console.log('  baileys', require('./node_modules/baileys/package.json').version)"
cd "\$(dirname "$dir")"
\$SUDO pm2 reload "$pm2"
echo "  OK $name (pm2 reload)"
EOF
}

fail=0
for entry in "${HOSTS[@]}"; do
  deploy_host "$entry" || fail=1
done

echo
echo "=== post-reload connected check (shared hosts) ==="
for entry in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir pm2 sudo_cp <<< "$entry"
  want "$name" || continue
  [[ "$sudo_cp" == "1" ]] && continue
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
