#!/usr/bin/env bash
# ============================================================
# Provision Azure resources for WhatsApp AI Platform
#
# Prerequisites:
#   - Azure CLI installed: brew install azure-cli
#   - Logged in: az login
#
# Usage:
#   bash deploy/provision-azure.sh
#
# Creates:
#   1. Resource Group
#   2. Storage Account + public blob container
#   3. Linux VM (Ubuntu 24.04, Standard_B2s)
#   4. Opens ports 22, 80, 443
# ============================================================
set -euo pipefail

# ---- Configuration (edit these) ----
RESOURCE_GROUP="${AZURE_RG:-whatsapp-ai-rg}"
LOCATION="${AZURE_LOCATION:-northeurope}"
VM_NAME="${AZURE_VM_NAME:-whatsapp-ai-vm}"
VM_SIZE="${AZURE_VM_SIZE:-Standard_B2s}"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-whatsappmediastore}"
STORAGE_CONTAINER="${AZURE_STORAGE_CONTAINER:-whatsapp-media}"
ADMIN_USER="azureuser"

echo "========================================"
echo "  Azure Provisioning"
echo "========================================"
echo "  Resource Group:  $RESOURCE_GROUP"
echo "  Location:        $LOCATION"
echo "  VM:              $VM_NAME ($VM_SIZE)"
echo "  Storage:         $STORAGE_ACCOUNT"
echo "========================================"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 1

# ---- 1. Resource Group ----
echo "[1/5] Creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output table

# ---- 2. Storage Account ----
echo "[2/5] Creating storage account..."
az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --allow-blob-public-access true \
    --output table

echo "  Creating blob container '$STORAGE_CONTAINER' with public access..."
STORAGE_KEY=$(az storage account keys list \
    --account-name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --query '[0].value' -o tsv)

az storage container create \
    --name "$STORAGE_CONTAINER" \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --public-access blob \
    --output table

CONN_STRING=$(az storage account show-connection-string \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --query 'connectionString' -o tsv)

echo ""
echo "  ✅ Storage ready!"
echo "  Connection string (save this for .env):"
echo "  AZURE_STORAGE_CONNECTION_STRING=$CONN_STRING"
echo ""

# ---- 3. VM ----
echo "[3/5] Creating VM..."
az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --image Canonical:ubuntu-24_04-lts:server:latest \
    --size "$VM_SIZE" \
    --admin-username "$ADMIN_USER" \
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --output table

VM_IP=$(az vm show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --show-details \
    --query publicIps -o tsv)

echo "  VM IP: $VM_IP"

# ---- 4. Open ports ----
echo "[4/5] Opening ports 80, 443..."
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 80 --priority 1001 --output table
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 443 --priority 1002 --output table

# ---- 5. Summary ----
echo ""
echo "========================================"
echo "  ✅ Azure resources provisioned!"
echo "========================================"
echo ""
echo "  VM IP Address:  $VM_IP"
echo "  SSH:            ssh $ADMIN_USER@$VM_IP"
echo ""
echo "  Storage Connection String:"
echo "  $CONN_STRING"
echo ""
echo "  Next steps:"
echo "    1. SSH into VM:  ssh $ADMIN_USER@$VM_IP"
echo "    2. Clone your repo or scp files to /opt/whatsapp-ai/"
echo "    3. Run setup:    sudo bash /opt/whatsapp-ai/deploy/setup-vm.sh"
echo "    4. Create .env with the storage connection string above"
echo "    5. Start PM2:    cd /opt/whatsapp-ai && pm2 start deploy/ecosystem.config.cjs"
echo ""

# Save values for easy reference
cat > /tmp/azure-whatsapp-env.txt <<ENVEOF
# Azure WhatsApp AI Platform - Provisioned $(date)
VM_IP=$VM_IP
SSH_CMD=ssh $ADMIN_USER@$VM_IP
AZURE_STORAGE_CONNECTION_STRING=$CONN_STRING
AZURE_STORAGE_CONTAINER=$STORAGE_CONTAINER
ENVEOF

echo "  Saved to /tmp/azure-whatsapp-env.txt for reference."
echo ""
