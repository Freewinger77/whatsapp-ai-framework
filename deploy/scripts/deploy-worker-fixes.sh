#!/usr/bin/env bash
# Roll out worker fixes to all Wasup worker VMs:
#   - Anti-ban OFF bypasses wrapped socket
#   - Interactive message line breaks
#   - 428 conflict auto-reconnect
#   - Group webhook sender fields
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UTILS="$ROOT/app/src/utils"

FILES=(
  instance-manager.js
  antiban-v2.js
  interactive-payload.js
  message-builder.js
  message-sender-context.js
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$UTILS/$f" ]]; then
    echo "Missing $UTILS/$f" >&2
    exit 1
  fi
  node --check "$UTILS/$f" || exit 1
done

HOSTS=(
  "bashir|wasupadmin|20.58.56.114|/opt/wasup-81ccb28431f3/app|wasup-worker"
  "mousa|wasupadmin|51.140.7.175|/opt/wasup-59817b593594/app|wasup-worker"
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
  if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" "test -d '$dir/src/utils'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    return 1
  fi

  local tmp="/tmp/wasup-fix-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp'" || { echo "  FAILED mkdir"; return 1; }

  for f in "${FILES[@]}"; do
    scp -q -o ConnectTimeout=20 "$UTILS/$f" "$user@$host:$tmp/$f" || { echo "  FAILED scp $f"; return 1; }
  done

  if [[ "$user" == "wasupadmin" ]]; then
    ssh -o ConnectTimeout=20 "$user@$host" bash -s <<EOF
set -euo pipefail
for f in ${FILES[*]}; do
  sudo cp "$tmp/\$f" "$dir/src/utils/\$f"
done
rm -rf "$tmp"
before=\$(sudo pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['pm2_env'].get('created_at',0))")
sudo pm2 reload "$pm2" --update-env
sudo pm2 save
sleep 3
after=\$(sudo pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['pm2_env'].get('created_at',0))")
if [ "\$before" = "\$after" ]; then echo "  WARN: PM2 may not have restarted"; else echo "  PM2 restarted"; fi
EOF
  else
    ssh -o ConnectTimeout=20 "$user@$host" bash -s <<EOF
set -euo pipefail
for f in ${FILES[*]}; do
  cp "$tmp/\$f" "$dir/src/utils/\$f" 2>/dev/null || sudo cp "$tmp/\$f" "$dir/src/utils/\$f"
done
rm -rf "$tmp"
before=\$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['pm2_env'].get('created_at',0))")
cd "$(dirname "$dir")"
pm2 reload "$pm2" --update-env
pm2 save
sleep 3
after=\$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['pm2_env'].get('created_at',0))")
if [ "\$before" = "\$after" ]; then echo "  WARN: PM2 may not have restarted"; else echo "  PM2 restarted"; fi
EOF
  fi

  sleep 8
  local health
  health="$(ssh -o ConnectTimeout=20 "$user@$host" "curl -sf http://127.0.0.1:3000/api/health 2>/dev/null || echo fail")"
  if [[ "$health" == "fail" ]]; then
    echo "  reloaded — health check pending"
  else
    echo "  reloaded — health ok"
  fi
}

for row in "${HOSTS[@]}"; do
  deploy_host "$row" || true
done

echo "Done."
