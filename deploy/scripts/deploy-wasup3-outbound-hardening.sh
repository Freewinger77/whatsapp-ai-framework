#!/usr/bin/env bash
# wasup3 only. Never enable fleet-wide cold-block env.
# Same package as wasup2. Auth stays on disk. pm2 reload only.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"
NAME="wasup3"
USER="azureuser"
HOST="94.245.90.173"
DIR="/opt/whatsapp-ai/app"
PM2="whatsapp-api"
EXPECT_CONNECTED=6
# ATK2 (wa_mt7k88um_46lo7) is logged out / QR required. Bump back to 7 after it is re-paired.

if [[ "$HOST" != "94.245.90.173" ]]; then
  echo "REFUSE — this script is wasup3 only" >&2
  exit 1
fi

for f in \
  src/utils/instance-manager.js \
  src/utils/privacy-token-hardening.js \
  src/utils/outbound-preflight.js \
  src/utils/tyrejobs-cold-opt-in.js \
  src/utils/atk2-opt-in-cta.js \
  server.js
do
  [[ -f "$APP/$f" ]] || { echo "Missing $APP/$f" >&2; exit 1; }
done

node --check "$APP/src/utils/outbound-preflight.js" || exit 1
node --check "$APP/src/utils/privacy-token-hardening.js" || exit 1
node --check "$APP/src/utils/tyrejobs-cold-opt-in.js" || exit 1
node --check "$APP/src/utils/atk2-opt-in-cta.js" || exit 1
node --check "$APP/src/utils/instance-manager.js" || exit 1
node --check "$APP/server.js" || exit 1

echo "=== $NAME ($USER@$HOST) — before ==="
ssh -o BatchMode=yes -o ConnectTimeout=20 "$USER@$HOST" \
  'curl -sS http://127.0.0.1:3000/api/health; echo'

tmp="/tmp/wasup3-outbound-$$"
ssh -o ConnectTimeout=20 "$USER@$HOST" "mkdir -p '$tmp/src/utils'" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$USER@$HOST:$tmp/src/utils/instance-manager.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/privacy-token-hardening.js" "$USER@$HOST:$tmp/src/utils/privacy-token-hardening.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/outbound-preflight.js" "$USER@$HOST:$tmp/src/utils/outbound-preflight.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/tyrejobs-cold-opt-in.js" "$USER@$HOST:$tmp/src/utils/tyrejobs-cold-opt-in.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/atk2-opt-in-cta.js" "$USER@$HOST:$tmp/src/utils/atk2-opt-in-cta.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/server.js" "$USER@$HOST:$tmp/server.js" || exit 1

ssh -o ConnectTimeout=90 "$USER@$HOST" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/instance-manager.js" "$DIR/src/utils/instance-manager.js"
cp "$tmp/src/utils/privacy-token-hardening.js" "$DIR/src/utils/privacy-token-hardening.js"
cp "$tmp/src/utils/outbound-preflight.js" "$DIR/src/utils/outbound-preflight.js"
cp "$tmp/src/utils/tyrejobs-cold-opt-in.js" "$DIR/src/utils/tyrejobs-cold-opt-in.js"
cp "$tmp/src/utils/atk2-opt-in-cta.js" "$DIR/src/utils/atk2-opt-in-cta.js"
cp "$tmp/server.js" "$DIR/server.js"
rm -rf "$tmp"
node --check "$DIR/server.js"
node --check "$DIR/src/utils/instance-manager.js"
node --check "$DIR/src/utils/atk2-opt-in-cta.js"
node --input-type=module -e "await import('file://$DIR/src/utils/atk2-opt-in-cta.js'); await import('file://$DIR/src/utils/outbound-preflight.js'); await import('file://$DIR/src/utils/privacy-token-hardening.js'); console.log('imports-ok')"
# Do NOT turn on WASUP_BLOCK_COLD_WITHOUT_TOKEN / WASUP_OUTBOUND_HARDENING.
cd /opt/whatsapp-ai
pm2 reload "$PM2"
echo "OK $NAME reload"
EOF

echo
echo "=== waiting for $EXPECT_CONNECTED connected ==="
ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  health=$(ssh -o ConnectTimeout=20 "$USER@$HOST" 'curl -sS http://127.0.0.1:3000/api/health' || true)
  echo "  try $i: $health"
  if echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); raise SystemExit(0 if d.get('instances',{}).get('connected')==$EXPECT_CONNECTED else 1)" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 8
done

if [[ "$ok" != "1" ]]; then
  echo "WARN: wasup3 did not return $EXPECT_CONNECTED connected yet" >&2
  ssh -o ConnectTimeout=20 "$USER@$HOST" \
    'curl -sS http://127.0.0.1:3000/api/instances | python3 -c "import sys,json; d=json.load(sys.stdin); [print(i.get(\"name\"), i.get(\"status\"), i.get(\"connectedPhone\")) for i in d.get(\"instances\") or []]"'
  exit 2
fi

echo "=== instances ==="
ssh -o ConnectTimeout=20 "$USER@$HOST" \
  'curl -sS http://127.0.0.1:3000/api/instances | python3 -c "import sys,json; d=json.load(sys.stdin); [print(i.get(\"name\"), i.get(\"status\"), i.get(\"connectedPhone\")) for i in d.get(\"instances\") or []]"'

echo "=== privacy-lookup 447835156367 ==="
ssh -o ConnectTimeout=20 "$USER@$HOST" bash -s <<'REMOTE'
python3 - <<'PY'
import json, subprocess
raw = subprocess.check_output(["curl", "-sS", "http://127.0.0.1:3000/api/instances"], text=True)
inst = json.loads(raw).get("instances") or []
for i in inst:
    iid = i.get("id")
    look = json.loads(subprocess.check_output(
        ["curl", "-sS", f"http://127.0.0.1:3000/api/instances/{iid}/privacy-lookup?phone=447835156367"],
        text=True,
    ))
    tok = look.get("token") or {}
    print(
        i.get("name"),
        "lid="+str(look.get("mappedLid")),
        "present="+str(tok.get("present")),
        "expired="+str(tok.get("expired")),
        "storage="+str(tok.get("storageJid")),
        "block="+str(look.get("blockColdWithoutToken")),
    )
PY
REMOTE
