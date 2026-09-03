#!/usr/bin/env bash
# wasup2 only. Never wasup3. Never enable fleet-wide cold-block env.
#
# Auth stays on disk. pm2 reload (not restart). Sockets drop and usually
# come back from creds — WhatsApp can still invalidate; verify connected=6.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"
NAME="wasup2"
USER="azureuser"
HOST="40.112.73.2"
DIR="/opt/whatsapp-ai/app"
PM2="whatsapp-api"

if [[ "$HOST" != "40.112.73.2" ]]; then
  echo "REFUSE — this script is wasup2 only" >&2
  exit 1
fi

for f in \
  src/utils/instance-manager.js \
  src/utils/privacy-token-hardening.js \
  src/utils/outbound-preflight.js \
  src/utils/tyrejobs-cold-opt-in.js \
  server.js
do
  [[ -f "$APP/$f" ]] || { echo "Missing $APP/$f" >&2; exit 1; }
done

node --check "$APP/src/utils/outbound-preflight.js" || exit 1
node --check "$APP/src/utils/privacy-token-hardening.js" || exit 1
node --check "$APP/src/utils/tyrejobs-cold-opt-in.js" || exit 1
node --check "$APP/src/utils/instance-manager.js" || exit 1
node --check "$APP/server.js" || exit 1

echo "=== $NAME ($USER@$HOST) — before ==="
ssh -o BatchMode=yes -o ConnectTimeout=20 "$USER@$HOST" \
  'curl -sS http://127.0.0.1:3000/api/health; echo'

tmp="/tmp/wasup2-outbound-$$"
ssh -o ConnectTimeout=20 "$USER@$HOST" "mkdir -p '$tmp/src/utils'" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/instance-manager.js" "$USER@$HOST:$tmp/src/utils/instance-manager.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/privacy-token-hardening.js" "$USER@$HOST:$tmp/src/utils/privacy-token-hardening.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/outbound-preflight.js" "$USER@$HOST:$tmp/src/utils/outbound-preflight.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/src/utils/tyrejobs-cold-opt-in.js" "$USER@$HOST:$tmp/src/utils/tyrejobs-cold-opt-in.js" || exit 1
scp -q -o ConnectTimeout=20 "$APP/server.js" "$USER@$HOST:$tmp/server.js" || exit 1

ssh -o ConnectTimeout=90 "$USER@$HOST" bash -s <<EOF
set -euo pipefail
cp "$tmp/src/utils/instance-manager.js" "$DIR/src/utils/instance-manager.js"
cp "$tmp/src/utils/privacy-token-hardening.js" "$DIR/src/utils/privacy-token-hardening.js"
cp "$tmp/src/utils/outbound-preflight.js" "$DIR/src/utils/outbound-preflight.js"
cp "$tmp/src/utils/tyrejobs-cold-opt-in.js" "$DIR/src/utils/tyrejobs-cold-opt-in.js"
cp "$tmp/server.js" "$DIR/server.js"
rm -rf "$tmp"
node --check "$DIR/server.js"
node --check "$DIR/src/utils/instance-manager.js"
node --input-type=module -e "await import('file://$DIR/src/utils/outbound-preflight.js'); await import('file://$DIR/src/utils/privacy-token-hardening.js'); console.log('imports-ok')"
# Do NOT turn on WASUP_BLOCK_COLD_WITHOUT_TOKEN / WASUP_OUTBOUND_HARDENING.
# Cold block is the per-instance behavior switch (default off).
cd /opt/whatsapp-ai
pm2 reload "$PM2"
echo "OK $NAME reload"
EOF

echo
echo "=== waiting for 6 connected (auth on disk, no QR expected) ==="
ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  health=$(ssh -o ConnectTimeout=20 "$USER@$HOST" 'curl -sS http://127.0.0.1:3000/api/health' || true)
  echo "  try $i: $health"
  if echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); raise SystemExit(0 if d.get('instances',{}).get('connected')==6 else 1)" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 8
done

if [[ "$ok" != "1" ]]; then
  echo "WARN: wasup2 did not return 6 connected yet" >&2
  exit 2
fi

echo "=== privacy-lookup 447835156367 ==="
ssh -o ConnectTimeout=20 "$USER@$HOST" bash -s <<'REMOTE'
python3 - <<'PY'
import json, subprocess
ids = [
  "wa_mpfew32i_moyjg",
  "wa_mph30kya_ro663",
  "wa_mpmp0368_3eura",
  "wa_mps08uxs_wzc10",
  "wa_mr2dkw7h_5874w",
  "wa_ms4nkrz1_gg1rx",
]
for i in ids:
    raw = subprocess.check_output(
        ["curl", "-sS", f"http://127.0.0.1:3000/api/instances/{i}/privacy-lookup?phone=447835156367"],
        text=True,
    )
    d = json.loads(raw)
    tok = d.get("token") or {}
    print(
        i,
        "lid="+str(d.get("mappedLid")),
        "present="+str(tok.get("present")),
        "expired="+str(tok.get("expired")),
        "storage="+str(tok.get("storageJid")),
        "mirror="+str(tok.get("wouldMirrorTo")),
        "block="+str(d.get("blockColdWithoutToken")),
    )
PY
REMOTE
