#!/usr/bin/env bash
#
# test-pairing-flow.sh — bulletproof pairing/reconnect flow tester for a Wasup worker.
#
# Verifies: error handling, the disconnect→clear-auth→connect recovery (always reaches a
# pairing code), the <120s reuse guard, connection polling, and that bad keys return 401 (not 500).
#
# Usage:
#   BASE=https://bashir-s-workspace-hlzpr2.wasup.co \
#   ID=51981fe4-d0f6-4801-8060-750deb57fc72 \
#   KEY=<api-key> PHONE=447835156367 \
#   ./deploy/scripts/test-pairing-flow.sh
#
# Optional: PAIR=0 to skip the destructive recovery (read-only checks only).
set -uo pipefail

BASE=${BASE:?set BASE to the worker base url}
ID=${ID:?set ID to the instance id}
KEY=${KEY:?set KEY to an api key}
PHONE=${PHONE:-447835156367}
PAIR=${PAIR:-1}

H=(-H "X-API-Key: $KEY" -H "Content-Type: application/json")
pass=0; fail=0
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }
# reads the field from the last response saved to /tmp/_pf (NOT stdin — avoids blocking)
field(){ python3 -c "import sys,json;print(json.load(open('/tmp/_pf')).get(sys.argv[1]))" "$1" 2>/dev/null; }

echo "### 1. unknown instance id -> 400 not_found"
code=$(curl -sS "${H[@]}" -o /tmp/_pf -w "%{http_code}" -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/wa_nope_$RANDOM/connect")
grep -q "not found" /tmp/_pf && [ "$code" = 400 ] && ok "unknown id => 400 not found" || no "unknown id (http=$code): $(cat /tmp/_pf)"

echo "### 2. bad key -> 401 (must NOT be 500)"
code=$(curl -sS -H "X-API-Key: sk-prod-invalid-$RANDOM" -H "Content-Type: application/json" \
  -o /tmp/_pf -w "%{http_code}" -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/$ID/connect")
[ "$code" = 401 ] && ok "bad key => 401" || no "bad key returned http=$code (expected 401): $(cat /tmp/_pf)"

echo "### 3. GET /connection shape"
curl -sS "${H[@]}" -o /tmp/_pf "$BASE/api/instances/$ID/connection"
[ "$(field success)" = True ] && ok "connection poll ok (status=$(field status))" || no "connection poll: $(cat /tmp/_pf)"

if [ "$PAIR" != 1 ]; then echo "PAIR=0 -> skipping recovery. pass=$pass fail=$fail"; exit $((fail>0)); fi

echo "### 4. recovery: disconnect -> clear-auth -> connect (expect fresh code)"
curl -sS "${H[@]}" -o /dev/null -X POST -d '{}' "$BASE/api/instances/$ID/disconnect"
curl -sS "${H[@]}" -o /dev/null -X POST       "$BASE/api/instances/$ID/clear-auth"
sleep 2
curl -sS "${H[@]}" -o /tmp/_pf -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/$ID/connect"
CODE=$(field pairingCode)
if [ -z "$CODE" ] || [ "$CODE" = None ]; then
  # one self-heal retry on transient Connection Closed
  echo "  (connect returned no code, retrying once after 4s): $(cat /tmp/_pf)"
  sleep 4
  curl -sS "${H[@]}" -o /tmp/_pf -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/$ID/connect"
  CODE=$(field pairingCode)
fi
[ -n "$CODE" ] && [ "$CODE" != None ] && ok "fresh pairing code: $CODE" || no "no pairing code after recovery: $(cat /tmp/_pf)"

echo "### 5. reuse guard: immediate re-connect -> reused=true, same code"
curl -sS "${H[@]}" -o /tmp/_pf -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/$ID/connect"
[ "$(field reused)" = True ] && [ "$(field pairingCode)" = "$CODE" ] \
  && ok "reuse guard returned same code $CODE" \
  || no "reuse guard: reused=$(field reused) code=$(field pairingCode) (expected $CODE)"

echo
echo "==== RESULT: $pass passed, $fail failed ===="
echo "Active pairing code for $ID: ${CODE:-<none>}  (valid ~2 min)"
exit $((fail>0))
