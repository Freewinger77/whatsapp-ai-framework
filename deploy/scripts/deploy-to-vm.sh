#!/usr/bin/env bash
# ============================================================
# Deploy WhatsApp AI Platform to Azure VM
#
# Usage:
#   bash deploy/deploy-to-vm.sh <VM_IP>
#   bash deploy/deploy-to-vm.sh 20.123.45.67
#
# This script:
#   1. Syncs app code to the VM via rsync
#   2. Runs npm install on the VM
#   3. Restarts PM2
# ============================================================
set -euo pipefail

VM_IP="${1:?Usage: deploy-to-vm.sh <VM_IP>}"
VM_USER="${2:-azureuser}"
REMOTE_DIR="/opt/whatsapp-ai"
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "========================================"
echo "  Deploying to $VM_USER@$VM_IP"
echo "  Local:  $LOCAL_DIR"
echo "  Remote: $REMOTE_DIR"
echo "========================================"

# Ensure remote directory exists
ssh "$VM_USER@$VM_IP" "sudo mkdir -p $REMOTE_DIR && sudo chown $VM_USER:$VM_USER $REMOTE_DIR"

# Sync files (exclude node_modules, instances data, .env, auth)
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude 'app/instances' \
    --exclude 'app/.env' \
    --exclude 'app/logs' \
    --exclude '.git' \
    "$LOCAL_DIR/" "$VM_USER@$VM_IP:$REMOTE_DIR/"

echo ""
echo "[2/3] Installing dependencies on VM..."
ssh "$VM_USER@$VM_IP" "cd $REMOTE_DIR/app && npm install --production"

echo ""
echo "[3/3] Restarting PM2..."
ssh "$VM_USER@$VM_IP" "cd $REMOTE_DIR && if pm2 describe whatsapp-api >/dev/null 2>&1; then pm2 restart whatsapp-api --update-env; else pm2 start deploy/ecosystem.config.cjs; fi"
ssh "$VM_USER@$VM_IP" "pm2 save"

echo ""
echo "========================================"
echo "  ✅ Deployed!"
echo "  http://$VM_IP"
echo "========================================"
