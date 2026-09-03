#!/usr/bin/env bash
# Seed labeled SE/UK proxy catalog onto shared workers (API only — no PM2 restart).
#
# Usage:
#   PROXY_CATALOG_PASS='...' bash deploy/scripts/seed-proxy-catalog.sh
#   ONLY=wasup3 PROXY_CATALOG_PASS='...' bash deploy/scripts/seed-proxy-catalog.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="${PROXY_CATALOG_FILE:-$ROOT/deploy/proxy-catalog.json}"
PASS="${PROXY_CATALOG_PASS:-}"

if [[ ! -f "$CATALOG" ]]; then
  echo "Missing catalog: $CATALOG" >&2
  exit 1
fi
if [[ -z "$PASS" ]]; then
  echo "Set PROXY_CATALOG_PASS (shared Webshare password for catalog entries)" >&2
  exit 1
fi

HOSTS=(
  "wasup|azureuser|20.107.202.157"
  "wasup-dev|azureuser|20.223.209.59"
  "wasup2|azureuser|40.112.73.2"
  "wasup3|azureuser|94.245.90.173"
  "wasup4|azureuser|20.166.12.101"
  "wasup5|azureuser|20.13.163.156"
  "wasup01|azureuser|20.234.23.46"
  "wasup02|azureuser|20.234.94.178"
  "wasup03|azureuser|20.166.63.111"
  "wasup04|azureuser|52.236.60.246"
  "wasup05|azureuser|20.234.102.144"
)

ONLY="${ONLY:-}"
want() {
  [[ -z "$ONLY" ]] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "$TMP_PAYLOAD"' EXIT

PROXY_CATALOG_PASS="$PASS" python3 - <<PY
import json, os
cat = json.load(open("$CATALOG"))
user = cat.get("username") or "rktwwipc"
pw = os.environ["PROXY_CATALOG_PASS"]
entries = []
for e in cat["entries"]:
    entries.append({
        "host": e["host"],
        "port": int(e["port"]),
        "username": user,
        "password": pw,
        "type": "http",
        "label": e["label"],
        "country": e["country"],
    })
with open("$TMP_PAYLOAD", "w") as f:
    json.dump({"entries": entries, "reconcile": False}, f)
print(f"prepared {len(entries)} entries")
PY

seed_one() {
  local name="$1" user="$2" host="$3"
  echo "=== $name ($host) ==="
  scp -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no \
    "$TMP_PAYLOAD" "$user@$host:/tmp/proxy-catalog-seed.json" >/dev/null
  # shellcheck disable=SC2029
  ssh -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no "$user@$host" \
    "python3 -" <<'PY'
import json, os, urllib.request
from pathlib import Path

def load_api_key():
    for p in (
        Path("/opt/whatsapp-ai/app/.env"),
        Path("/opt/whatsapp-ai/.env"),
        Path.home() / "whatsapp-ai/app/.env",
    ):
        if not p.is_file():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() in ("API_KEY", "WASUP_WORKER_SHARED_SECRET"):
                val = v.strip()
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if val:
                    return val
    return os.environ.get("API_KEY") or os.environ.get("WASUP_WORKER_SHARED_SECRET") or ""

key = load_api_key()
headers = {"Content-Type": "application/json"}
if key:
    headers["X-API-Key"] = key
    headers["Authorization"] = "Bearer " + key

body = json.load(open("/tmp/proxy-catalog-seed.json"))
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/proxy/pool/entries",
    data=json.dumps(body).encode(),
    method="POST",
    headers=headers,
)
with urllib.request.urlopen(req, timeout=90) as r:
    d = json.load(r)
pool = d.get("pool") or {}
print("seeded total=%s free=%s" % (pool.get("total"), pool.get("free")))
try:
    creq = urllib.request.Request("http://127.0.0.1:3000/api/proxy/catalog", headers=headers)
    with urllib.request.urlopen(creq, timeout=20) as r:
        c = json.load(r)
    entries = (c.get("catalog") or {}).get("entries") or []
    labeled = sum(1 for e in entries if e.get("label"))
    print("catalog entries=%s labeled=%s" % (len(entries), labeled))
except Exception as e:
    print("catalog endpoint not live yet:", e)
PY
}

ok=0; fail=0
for entry in "${HOSTS[@]}"; do
  IFS='|' read -r name user host <<<"$entry"
  want "$name" || continue
  if seed_one "$name" "$user" "$host"; then
    ok=$((ok+1))
  else
    fail=$((fail+1))
  fi
done
echo "Done. ok=$ok fail=$fail"
[[ "$fail" -eq 0 ]]
