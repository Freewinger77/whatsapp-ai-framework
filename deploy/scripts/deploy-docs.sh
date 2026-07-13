#!/usr/bin/env bash
#
# deploy-docs.sh — push the regenerated OpenAPI spec (and optionally the
# mtime-aware server.js loader fix) to every Wasup worker VM.
#
# Why this exists: the worker memo-caches openapi.yaml in memory. Older builds
# cache it for the whole process lifetime, so a plain scp does NOT refresh /docs
# until the next restart. The mtime-aware loader in server.js fixes that
# permanently (re-reads when the file changes) so future doc deploys are hot.
#
# This script NEVER restarts a process on its own. Restarting drops WhatsApp
# sockets. Pass RELOAD=1 explicitly to reload a single host you KNOW is safe
# (no live/connected sessions, no active pairing).
#
# Hosts table: name|sshUser|host|appDir
HOSTS=(
  "bashir|wasupadmin|20.58.56.114|/opt/wasup-81ccb28431f3/app"
  "mousa|wasupadmin|51.140.7.175|/opt/wasup-59817b593594/app"
  "wasup|azureuser|20.107.202.157|/opt/whatsapp-ai/app"
  "wasup-dev|azureuser|20.223.209.59|/opt/whatsapp-ai/app"
)

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPENAPI="$ROOT/app/openapi.yaml"
SERVER="$ROOT/app/server.js"

ONLY="${ONLY:-}"          # optional: comma list of host names to target
PUSH_SERVER="${PUSH_SERVER:-0}"  # 1 = also stage server.js (mtime loader fix)
RELOAD="${RELOAD:-0}"     # 1 = pm2 reload AFTER staging (DANGEROUS: drops sessions)

want(){ [ -z "$ONLY" ] && return 0; case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }

for row in "${HOSTS[@]}"; do
  IFS='|' read -r name user host dir <<< "$row"
  want "$name" || continue
  echo "=== $name ($user@$host:$dir) ==="

  scp -q -o ConnectTimeout=15 "$OPENAPI" "$user@$host:/tmp/openapi.new.yaml" \
    && ssh -o ConnectTimeout=15 "$user@$host" "sudo cp /tmp/openapi.new.yaml '$dir/openapi.yaml' && grep -c 'Bulletproof re-pair flow' '$dir/openapi.yaml'" \
    && echo "  openapi.yaml staged on disk" || { echo "  FAILED openapi stage"; continue; }

  if [ "$PUSH_SERVER" = 1 ]; then
    scp -q -o ConnectTimeout=15 "$SERVER" "$user@$host:/tmp/server.new.js" \
      && ssh -o ConnectTimeout=15 "$user@$host" "node --check /tmp/server.new.js && sudo cp /tmp/server.new.js '$dir/server.js' && echo '  server.js staged (syntax ok)'" \
      || echo "  FAILED server.js stage (syntax check or copy)"
  fi

  if [ "$RELOAD" = 1 ]; then
    echo "  RELOAD=1 -> reloading process (this drops any live WhatsApp socket)"
    ssh -o ConnectTimeout=15 "$user@$host" "sudo pm2 reload wasup-worker --update-env 2>/dev/null || sudo pm2 reload whatsapp-api --update-env" \
      && echo "  reloaded" || echo "  FAILED reload"
  fi
done

echo "Done. (RELOAD=$RELOAD PUSH_SERVER=$PUSH_SERVER ONLY=${ONLY:-all})"
