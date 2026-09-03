#!/usr/bin/env bash
# Roll out 463 / reach-out outbound hardening to a fixed allowlist.
#
# ENABLED (this script only):
#   wasup (northeurope / northzone), wasup-dev, wasup02, wasup03, wasup04, wasup05
#
# NEVER TOUCHED:
#   wasup2, wasup3  (and wasup4 / wasup5 / wasup01 unless we add them later)
#
# SAFETY:
#   SCP + pm2 reload only. Never pm2 restart. Never clear auth.
#
# Usage:
#   bash deploy/scripts/deploy-outbound-hardening.sh
#   ONLY=wasup-dev,wasup02 bash deploy/scripts/deploy-outbound-hardening.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

FILES=(
  "src/utils/instance-manager.js"
  "src/utils/privacy-token-hardening.js"
  "src/utils/outbound-preflight.js"
  "src/utils/tyrejobs-cold-opt-in.js"
  "server.js"
)

FORBIDDEN_HOSTS='40.112.73.2 94.245.90.173'
FORBIDDEN_NAMES='wasup2 wasup3'

HOSTS=(
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup02|azureuser|20.234.94.178|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup03|azureuser|20.166.63.111|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup04|azureuser|52.236.60.246|/opt/whatsapp-ai/app|whatsapp-api"
  "wasup05|azureuser|20.234.102.144|/opt/whatsapp-ai/app|whatsapp-api"
)

for f in "${FILES[@]}"; do
  if [[ ! -f "$APP/$f" ]]; then
    echo "Missing $APP/$f" >&2
    exit 1
  fi
done

node --check "$APP/src/utils/outbound-preflight.js" || exit 1
node --check "$APP/src/utils/tyrejobs-cold-opt-in.js" || exit 1
node --check "$APP/src/utils/privacy-token-hardening.js" || exit 1
node --check "$APP/src/utils/instance-manager.js" || exit 1
node --check "$APP/server.js" || exit 1

ONLY="${ONLY:-}"

want() {
  [[ -z "$ONLY" ]] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

upsert_env_remote() {
  cat <<'ENVSH'
set -euo pipefail
ENV_FILE="/opt/whatsapp-ai/app/.env"
touch "$ENV_FILE"
for key in WASUP_OUTBOUND_HARDENING WASUP_BLOCK_COLD_WITHOUT_TOKEN WASUP_ONWHATSAPP_PREFLIGHT; do
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=true|" "$ENV_FILE"
  else
    printf '\n%s=true\n' "$key" >> "$ENV_FILE"
  fi
done
grep -E '^WASUP_(OUTBOUND_HARDENING|BLOCK_COLD_WITHOUT_TOKEN|ONWHATSAPP_PREFLIGHT)=' "$ENV_FILE"
ENVSH
}

deploy_host() {
  local name user host dir pm2
  IFS='|' read -r name user host dir pm2 <<< "$1"
  want "$name" || return 0

  case " $FORBIDDEN_NAMES " in *" $name "*)
    echo "REFUSE $name — wasup2/wasup3 stay untouched" >&2
    return 1
    ;;
  esac
  case " $FORBIDDEN_HOSTS " in *" $host "*)
    echo "REFUSE $host — wasup2/wasup3 stay untouched" >&2
    return 1
    ;;
  esac

  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$user@$host" "test -d '$dir'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    return 1
  fi

  local tmp="/tmp/wasup-outbound-hardening-$$"
  ssh -o ConnectTimeout=20 "$user@$host" "mkdir -p '$tmp/src/utils'" || return 1

  scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$user@$host:$tmp/src/utils/instance-manager.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/privacy-token-hardening.js" "$user@$host:$tmp/src/utils/privacy-token-hardening.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/outbound-preflight.js" "$user@$host:$tmp/src/utils/outbound-preflight.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/src/utils/tyrejobs-cold-opt-in.js" "$user@$host:$tmp/src/utils/tyrejobs-cold-opt-in.js" || return 1
  scp -q -o ConnectTimeout=20 "$APP/server.js" "$user@$host:$tmp/server.js" || return 1

  ssh -o ConnectTimeout=90 "$user@$host" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/instance-manager.js" "$dir/src/utils/instance-manager.js"
cp "$tmp/src/utils/privacy-token-hardening.js" "$dir/src/utils/privacy-token-hardening.js"
cp "$tmp/src/utils/outbound-preflight.js" "$dir/src/utils/outbound-preflight.js"
cp "$tmp/src/utils/tyrejobs-cold-opt-in.js" "$dir/src/utils/tyrejobs-cold-opt-in.js"
cp "$tmp/server.js" "$dir/server.js"
rm -rf "$tmp"
node --check "$dir/server.js"
node --check "$dir/src/utils/instance-manager.js"
node --check "$dir/src/utils/privacy-token-hardening.js"
node --check "$dir/src/utils/outbound-preflight.js"
node --check "$dir/src/utils/tyrejobs-cold-opt-in.js"
node --input-type=module -e "await import('file://$dir/src/utils/outbound-preflight.js'); await import('file://$dir/src/utils/privacy-token-hardening.js'); await import('file://$dir/src/utils/tyrejobs-cold-opt-in.js'); console.log('imports-ok')"
$(upsert_env_remote)
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
echo "=== post-reload connected + hardening check ==="
for entry in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir pm2 <<< "$entry"
  want "$name" || continue
  echo -n "$name: "
  ssh -o ConnectTimeout=20 "$user@$host" bash -s <<'CHECK'
python3 - <<'PY'
import json, subprocess, sys
try:
    raw = subprocess.check_output(["curl", "-sf", "http://127.0.0.1:3000/api/instances"], text=True)
    data = json.loads(raw)
    inst = data.get("instances") or []
    bits = []
    for i in inst:
        bits.append(f"{i.get('name')}:{i.get('status')}")
    print(" ".join(bits) if bits else "(no instances)")
except Exception as e:
    print("check-failed", e)
    sys.exit(0)
PY
grep -E '^WASUP_(OUTBOUND_HARDENING|BLOCK_COLD_WITHOUT_TOKEN|ONWHATSAPP_PREFLIGHT)=' /opt/whatsapp-ai/app/.env | sed 's/^/  /'
CHECK
done

exit "$fail"
