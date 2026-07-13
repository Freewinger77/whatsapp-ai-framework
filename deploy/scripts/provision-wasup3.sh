#!/usr/bin/env bash
# Reference: wasup3 worker (clone of wasup2 stack)
# IP: 94.245.90.173
# URL: https://wasup3.northeurope.cloudapp.azure.com
# RG: WHATSAPP-AI-RG | PM2: whatsapp-api | Path: /opt/whatsapp-ai/app
#
# Lean deploy (app + deploy only):
#   WASUP_VM_HOST=azureuser@94.245.90.173 bash infra/azure/docker/sync-vm-worker.sh
#
# Full worker fix rollout:
#   ONLY=wasup3 bash deploy/scripts/deploy-worker-fixes.sh
set -euo pipefail

WASUP3_IP="${WASUP3_IP:-94.245.90.173}"
WASUP3_URL="${WASUP3_URL:-https://wasup3.northeurope.cloudapp.azure.com}"

echo "wasup3: $WASUP3_URL ($WASUP3_IP)"
curl -sf "$WASUP3_URL/api/health" | head -c 200
echo
