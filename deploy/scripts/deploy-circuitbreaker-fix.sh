#!/usr/bin/env bash
# Fleet-wide fix: baileys-antiban 4.x sendMessage(jid, content) with no 3rd arg
# throws "Cannot read properties of undefined (reading 'circuitBreaker')".
# SAFETY: SCP + patch lib in place + pm2 reload (never restart / clear auth).
#
# Usage:
#   ONLY=wasup2 bash deploy/scripts/deploy-circuitbreaker-fix.sh
#   bash deploy/scripts/deploy-circuitbreaker-fix.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

for f in src/utils/antiban-v2.js src/utils/instance-manager.js; do
  [[ -f "$APP/$f" ]] || { echo "Missing $APP/$f" >&2; exit 1; }
done

node --check "$APP/src/utils/antiban-v2.js" || exit 1
node --check "$APP/src/utils/instance-manager.js" || exit 1

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

deploy_one() {
  local name="$1" user="$2" host="$3" appdir="$4" pm2name="$5"
  local remote_utils="$appdir/src/utils"
  echo "=== $name ($host) ==="

  scp -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no \
    "$APP/src/utils/antiban-v2.js" \
    "$APP/src/utils/instance-manager.js" \
    "$user@$host:$remote_utils/" || { echo "FAIL scp $name"; return 1; }

  ssh -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no "$user@$host" \
    "APPDIR='$appdir' PM2NAME='$pm2name' bash -s" <<'REMOTE' || { echo "FAIL patch/reload $name"; return 1; }
set -euo pipefail
sudo -E python3 - <<PY
from pathlib import Path
import os
root = Path(os.environ["APPDIR"]) / "node_modules" / "baileys-antiban"
for rel in ["dist/wrapper.js", "dist/cjs/wrapper.js"]:
    p = root / rel
    if not p.exists():
        print("missing", rel)
        continue
    t = p.read_text()
    needle = "const wrappedSendMessage = async (jid, content, options) => {"
    patch = "const wrappedSendMessage = async (jid, content, options) => {\n        options = options ?? {};"
    if "options = options ?? {}" in t:
        print("already patched", rel)
    elif needle in t:
        p.write_text(t.replace(needle, patch, 1))
        print("patched", rel)
    else:
        print("WARN no match", rel)
PY
cd "$(dirname "$APPDIR")"
pm2 reload "$PM2NAME"
echo "OK reload done"
REMOTE
}

pids=()
names=()
for entry in "${HOSTS[@]}"; do
  IFS='|' read -r name user host appdir pm2name <<<"$entry"
  want "$name" || continue
  (
    if deploy_one "$name" "$user" "$host" "$appdir" "$pm2name"; then
      echo "RESULT $name OK"
    else
      echo "RESULT $name FAIL"
      exit 1
    fi
  ) >"/tmp/cb-fix-$name.log" 2>&1 &
  pids+=("$!")
  names+=("$name")
done

ok=0
fail=0
for i in "${!pids[@]}"; do
  pid="${pids[$i]}"
  name="${names[$i]}"
  if wait "$pid"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
  echo "----- $name -----"
  cat "/tmp/cb-fix-$name.log" || true
done

echo
echo "Done. ok=$ok fail=$fail"
[[ "$fail" -eq 0 ]]
