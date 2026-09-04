#!/usr/bin/env bash
# Deploy PR #2438 cstoken switch to wasup only. Reloads that worker (K1 flaps).
set -euo pipefail
HOST="${1:-20.107.202.157}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

scp \
  "$ROOT/app/src/utils/cs-token.js" \
  "$ROOT/app/src/utils/privacy-token-hardening.js" \
  "$ROOT/app/src/utils/instance-manager.js" \
  "$ROOT/app/server.js" \
  "$ROOT/app/public/index.html" \
  "$ROOT/app/scripts/patch-baileys-cstoken.js" \
  "$ROOT/app/package.json" \
  "azureuser@${HOST}:/tmp/wasup-cstoken/"

ssh "azureuser@${HOST}" 'bash -s' <<'EOF'
set -euo pipefail
APP=/opt/whatsapp-ai/app
mkdir -p /tmp/wasup-cstoken
sudo -u azureuser true
cp /tmp/wasup-cstoken/cs-token.js "$APP/src/utils/cs-token.js"
cp /tmp/wasup-cstoken/privacy-token-hardening.js "$APP/src/utils/privacy-token-hardening.js"
cp /tmp/wasup-cstoken/instance-manager.js "$APP/src/utils/instance-manager.js"
cp /tmp/wasup-cstoken/server.js "$APP/server.js"
cp /tmp/wasup-cstoken/index.html "$APP/public/index.html"
cp /tmp/wasup-cstoken/patch-baileys-cstoken.js "$APP/scripts/patch-baileys-cstoken.js"
cp /tmp/wasup-cstoken/package.json "$APP/package.json"
cd "$APP" && node scripts/patch-baileys-cstoken.js
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/opt/whatsapp-ai/app/instances/instances.json")
rows = json.loads(p.read_text())
changed = False
for row in rows:
    if row.get("id") != "wa_mtk3a64a_ai7z4":
        continue
    beh = dict(row.get("behaviorSettings") or {})
    if beh.get("attachCsToken") is not True:
        beh["attachCsToken"] = True
        row["behaviorSettings"] = beh
        changed = True
    print("contentcrew attachCsToken", beh.get("attachCsToken"))
if changed:
    p.write_text(json.dumps(rows, indent=2) + "\n")
    print("instances.json updated")
else:
    print("instances.json already set")
PY
EOF
