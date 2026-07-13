#!/usr/bin/env bash
# Deploy group sender webhook fields to all Wasup worker VMs.
# Uses main-branch instance-manager.js + message-sender-context.js (safe for prod VMs).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTX="$ROOT/app/src/utils/message-sender-context.js"
IM="${DEPLOY_INSTANCE_MANAGER:-/tmp/im-main.js}"

if [[ ! -f "$IM" ]]; then
  echo "Missing patched instance-manager at $IM" >&2
  echo "Run: git show origin/main:app/src/utils/instance-manager.js > /tmp/im-main.js && apply group patch" >&2
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

want(){ [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }

for row in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir <<< "$row"
  want "$name" || continue
  echo "=== $name ($user@$host) ==="
  if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$user@$host" "test -d '$dir/src/utils'" 2>/dev/null; then
    echo "  SKIP — app dir not found: $dir"
    continue
  fi
  scp -q -o ConnectTimeout=15 "$CTX" "$user@$host:/tmp/message-sender-context.js" \
    && scp -q -o ConnectTimeout=15 "$IM" "$user@$host:/tmp/instance-manager.js" \
    &&   ssh -o ConnectTimeout=15 "$user@$host" "node --check /tmp/instance-manager.js && sudo cp /tmp/message-sender-context.js '$dir/src/utils/message-sender-context.js' && sudo cp /tmp/instance-manager.js '$dir/src/utils/instance-manager.js' && echo '  files staged'" \
    || { echo "  FAILED copy/syntax"; continue; }
  if [[ "$user" == "azureuser" ]]; then
    ssh -o ConnectTimeout=15 "$user@$host" "pm2 reload whatsapp-api --update-env && pm2 save" \
      && echo "  reloaded" || echo "  FAILED reload"
  else
    ssh -o ConnectTimeout=15 "$user@$host" "sudo pm2 reload wasup-worker --update-env && sudo pm2 save" \
      && echo "  reloaded" || echo "  FAILED reload"
  fi
done

echo "Done."
