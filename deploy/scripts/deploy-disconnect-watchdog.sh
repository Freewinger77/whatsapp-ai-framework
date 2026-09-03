#!/usr/bin/env bash
# Roll out disconnect → WhatsApp alert watchdog across the Wasup fleet.
# Alerts 447835156367 when any paired instance stays disconnected >10 minutes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

node --check "$APP/src/utils/disconnect-watchdog.js" || exit 1
node --check "$APP/server.js" || exit 1

# Public worker bases used as cross-worker send relays when a host has no
# connected sender of its own. Keep shared workers that usually have live sessions.
RELAYS_DEFAULT="https://wasup2.northeurope.cloudapp.azure.com,https://wasup.northeurope.cloudapp.azure.com,https://wasup3.northeurope.cloudapp.azure.com,https://wasup01.northeurope.cloudapp.azure.com"

HOSTS=(
  "bashir|wasupadmin|20.58.56.114|/opt/wasup-81ccb28431f3/app|wasup-worker|bashir"
  "mousa|wasupadmin|51.140.7.175|/opt/wasup-59817b593594/app|wasup-worker|mousa"
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app|whatsapp-api|wasup"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app|whatsapp-api|wasup-dev"
  "wasup2|azureuser|40.112.73.2|/opt/whatsapp-ai/app|whatsapp-api|wasup2"
  "wasup3|azureuser|94.245.90.173|/opt/whatsapp-ai/app|whatsapp-api|wasup3"
  "wasup4|azureuser|20.166.12.101|/opt/whatsapp-ai/app|whatsapp-api|wasup4"
  "wasup5|azureuser|20.13.163.156|/opt/whatsapp-ai/app|whatsapp-api|wasup5"
  "wasup01|azureuser|20.234.23.46|/opt/whatsapp-ai/app|whatsapp-api|wasup01"
  "wasup02|azureuser|20.234.94.178|/opt/whatsapp-ai/app|whatsapp-api|wasup02"
  "wasup03|azureuser|20.166.63.111|/opt/whatsapp-ai/app|whatsapp-api|wasup03"
  "wasup04|azureuser|52.236.60.246|/opt/whatsapp-ai/app|whatsapp-api|wasup04"
  "wasup05|azureuser|20.234.102.144|/opt/whatsapp-ai/app|whatsapp-api|wasup05"
)

ONLY="${ONLY:-}"

want() {
  [[ -z "$ONLY" ]] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

ensure_env() {
  local user="$1" host="$2" dir="$3" worker_id="$4"
  # Append watchdog env knobs if missing (do not clobber existing values).
  ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" bash -s <<EOF
set -euo pipefail
ENV="$dir/.env"
if [[ ! -f "\$ENV" ]]; then
  if [[ "$user" == "wasupadmin" ]]; then
    sudo touch "\$ENV"
    sudo chown root:root "\$ENV" 2>/dev/null || true
  else
    touch "\$ENV"
  fi
fi
ensure_kv() {
  local key="\$1" val="\$2"
  if [[ "$user" == "wasupadmin" ]]; then
    if ! sudo grep -qE "^#{0,1}\${key}=" "\$ENV" 2>/dev/null; then
      echo "\${key}=\${val}" | sudo tee -a "\$ENV" >/dev/null
      echo "  + \${key}"
    fi
  else
    if ! grep -qE "^#{0,1}\${key}=" "\$ENV" 2>/dev/null; then
      echo "\${key}=\${val}" >> "\$ENV"
      echo "  + \${key}"
    fi
  fi
}
ensure_kv WASUP_DISCONNECT_ALERT_ENABLED 1
ensure_kv WASUP_DISCONNECT_ALERT_TO 447835156367
ensure_kv WASUP_DISCONNECT_ALERT_AFTER_MS 600000
ensure_kv WASUP_DISCONNECT_ALERT_POLL_MS 60000
ensure_kv WASUP_DISCONNECT_ALERT_CONTACT_COOLDOWN_MS 600000
ensure_kv WASUP_DISCONNECT_ALERT_RELAYS "$RELAYS_DEFAULT"
ensure_kv WASUP_WORKER_ID "$worker_id"
EOF
}

deploy_host() {
  local name user host dir pm2 worker_id
  IFS='|' read -r name user host dir pm2 worker_id <<< "$1"
  want "$name" || return 0

  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" "test -d '$dir'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    return 1
  fi

  local tmp="/tmp/wasup-disconnect-wd-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp'" || { echo "  FAILED mkdir"; return 1; }

  scp -q -o ConnectTimeout=20 \
    "$APP/src/utils/disconnect-watchdog.js" \
    "$APP/server.js" \
    "$user@$host:$tmp/" || { echo "  FAILED scp"; return 1; }

  ensure_env "$user" "$host" "$dir" "$worker_id" || echo "  WARN: env ensure failed"

  if [[ "$user" == "wasupadmin" ]]; then
    ssh -o ConnectTimeout=20 "$user@$host" bash -s <<EOF
set -euo pipefail
sudo mkdir -p "$dir/src/utils"
sudo cp "$tmp/disconnect-watchdog.js" "$dir/src/utils/disconnect-watchdog.js"
sudo cp "$tmp/server.js" "$dir/server.js"
rm -rf "$tmp"
sudo pm2 reload "$pm2" --update-env
sudo pm2 save
sleep 4
curl -sf http://127.0.0.1:3000/api/health >/dev/null && echo "  health ok" || echo "  health pending"
EOF
  else
    ssh -o ConnectTimeout=20 "$user@$host" bash -s <<EOF
set -euo pipefail
mkdir -p "$dir/src/utils"
cp "$tmp/disconnect-watchdog.js" "$dir/src/utils/disconnect-watchdog.js"
cp "$tmp/server.js" "$dir/server.js"
rm -rf "$tmp"
# Prefer azureuser pm2 daemon (not root empty daemon)
pm2 reload "$pm2" --update-env || sudo -u azureuser pm2 reload "$pm2" --update-env
pm2 save 2>/dev/null || true
sleep 4
curl -sf http://127.0.0.1:3000/api/health >/dev/null && echo "  health ok" || echo "  health pending"
EOF
  fi
}

for row in "${HOSTS[@]}"; do
  deploy_host "$row" || true
done

echo ""
echo "Done. Watchdog alerts 447835156367 after 10m disconnect."
echo "Status: GET /api/system/disconnect-watchdog (API key required)"
echo "Limit rollout: ONLY=wasup2,wasup01 bash deploy/scripts/deploy-disconnect-watchdog.sh"
