#!/usr/bin/env bash
# Smoke-test: health + behavior hot-reload API (no PM2 restart).
# Usage:
#   API_KEY=... ./deploy/smoke-graceful-reload.sh https://wasup.northeurope.cloudapp.azure.com
#   API_KEY=... ./deploy/smoke-graceful-reload.sh http://127.0.0.1:3000
set -euo pipefail
BASE="${1:-http://127.0.0.1:3000}"
HDR=()
if [[ -n "${API_KEY:-}" ]]; then
  HDR=(-H "X-API-Key: ${API_KEY}")
fi

echo "== GET ${BASE}/api/health =="
curl -sS "${BASE}/api/health" "${HDR[@]}" | python3 -m json.tool || true

echo
echo "== POST ${BASE}/api/system/reload-behavior-from-disk =="
curl -sS -X POST "${BASE}/api/system/reload-behavior-from-disk" \
  "${HDR[@]}" \
  -H 'Content-Type: application/json' \
  -d '{}' | python3 -m json.tool || true

echo
echo "Done. Run 3× while changing instances/instances.json behaviorSettings to confirm appliedKeys."
