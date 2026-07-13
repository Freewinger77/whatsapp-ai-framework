#!/usr/bin/env bash
# Stage 428 conflict auto-reconnect fix on all worker VMs — DISK ONLY, no PM2 reload.
# Live sessions keep running until the next natural reload/restart/self-heal.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IM="$ROOT/app/src/utils/instance-manager.js"

if ! grep -q '_scheduleConflictReconnect' "$IM"; then
  echo "instance-manager.js missing conflict auto-reconnect patch" >&2
  exit 1
fi

HOSTS=(
  "bashir|wasupadmin|20.58.56.114|/opt/wasup-81ccb28431f3/app"
  "mousa|wasupadmin|51.140.7.175|/opt/wasup-59817b593594/app"
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app"
  "wasup2|azureuser|40.112.73.2|/opt/whatsapp-ai/app"
  "wasup3|azureuser|94.245.90.173|/opt/whatsapp-ai/app"
  "wasup4|azureuser|20.166.12.101|/opt/whatsapp-ai/app"
  "wasup5|azureuser|20.13.163.156|/opt/whatsapp-ai/app"
)

ONLY="${ONLY:-}"
SKIP_RELOAD=1  # intentional — never reload in this script

want(){ [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }

echo "Staging conflict auto-reconnect fix (no PM2 reload — zero session disruption)"

for row in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir <<< "$row"
  want "$name" || continue
  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$user@$host" "test -d '$dir/src/utils'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    continue
  fi
  scp -q -o ConnectTimeout=15 "$IM" "$user@$host:/tmp/instance-manager.js" \
    && ssh -o ConnectTimeout=15 "$user@$host" "node --check /tmp/instance-manager.js && sudo cp /tmp/instance-manager.js '$dir/src/utils/instance-manager.js' && grep -c '_scheduleConflictReconnect' '$dir/src/utils/instance-manager.js'" \
    && echo "  staged on disk (live on next reload)" \
    || echo "  FAILED"
done

echo "Done. No PM2 reload was run."
