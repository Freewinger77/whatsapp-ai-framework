#!/usr/bin/env bash
# Apply a targeted hotfix to a worker VM without a full rebuild.
# Use for small file patches only; it never copies .env, auth, logs, or instance data.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  deploy/hotfix-worker-vm.sh <vm-host> <mode> [path ...]

Modes:
  static           Copy static files only. No PM2 reload.
  server           Copy server/source files and run pm2 reload.
  behavior-reload  Call the live behavior reload endpoint. Requires BASE_URL and optional API_KEY.

Examples:
  deploy/hotfix-worker-vm.sh 20.107.202.157 static app/public/index.html app/public/openapi.yaml
  deploy/hotfix-worker-vm.sh 20.107.202.157 server app/server.js app/src/utils/settings.js
  BASE_URL=https://customer.wasup.co API_KEY=... deploy/hotfix-worker-vm.sh ignored behavior-reload
EOF
}

VM_HOST="${1:-}"
MODE="${2:-}"
shift 2 || true

VM_USER="${VM_USER:-azureuser}"
REMOTE_DIR="${REMOTE_DIR:-/opt/whatsapp-ai}"
PM2_APP="${PM2_APP:-whatsapp-api}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$VM_HOST" || -z "$MODE" ]]; then
  usage >&2
  exit 1
fi

case "$MODE" in
  static)
    if [[ "$#" -eq 0 ]]; then
      echo "static mode requires at least one path." >&2
      exit 1
    fi
    for path in "$@"; do
      case "$path" in
        app/public/*|app/openapi.yaml|app/public/openapi.yaml) ;;
        *) echo "Refusing non-static path in static mode: $path" >&2; exit 1 ;;
      esac
      ssh "$VM_USER@$VM_HOST" "mkdir -p '$REMOTE_DIR/$(dirname "$path")'"
      rsync -az "$ROOT_DIR/$path" "$VM_USER@$VM_HOST:$REMOTE_DIR/$path"
    done
    echo "Static hotfix copied. No PM2 reload was run."
    ;;
  server)
    if [[ "$#" -eq 0 ]]; then
      echo "server mode requires at least one path." >&2
      exit 1
    fi
    for path in "$@"; do
      case "$path" in
        app/server.js|app/src/*.js|app/src/**/*.js|app/package.json|app/package-lock.json|deploy/ecosystem.config.cjs) ;;
        *) echo "Refusing path outside server hotfix allowlist: $path" >&2; exit 1 ;;
      esac
      ssh "$VM_USER@$VM_HOST" "mkdir -p '$REMOTE_DIR/$(dirname "$path")'"
      rsync -az "$ROOT_DIR/$path" "$VM_USER@$VM_HOST:$REMOTE_DIR/$path"
    done
    ssh "$VM_USER@$VM_HOST" "cd '$REMOTE_DIR' && pm2 reload '$PM2_APP' --update-env && pm2 save"
    echo "Server hotfix copied and PM2 reloaded."
    ;;
  behavior-reload)
    BASE_URL="${BASE_URL:-}"
    if [[ -z "$BASE_URL" ]]; then
      echo "BASE_URL is required for behavior-reload mode." >&2
      exit 1
    fi
    HDR=()
    if [[ -n "${API_KEY:-}" ]]; then
      HDR=(-H "X-API-Key: ${API_KEY}")
    fi
    curl -fsS -X POST "${BASE_URL%/}/api/system/reload-behavior-from-disk" \
      "${HDR[@]}" \
      -H 'Content-Type: application/json' \
      -d '{}'
    echo
    echo "Behavior reload requested."
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
