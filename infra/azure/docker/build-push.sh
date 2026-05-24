#!/usr/bin/env bash
# Build and push Wasup worker image to Azure Container Registry.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="${ROOT_DIR}/app"

RESOURCE_GROUP="${WASUP_AZURE_RG:-whatsapp-multi-rg}"
ACR_NAME="${WASUP_ACR_NAME:-wasupworkeracr}"
LOCATION="${WASUP_AZURE_LOCATION:-uksouth}"
IMAGE_NAME="${WASUP_IMAGE_NAME:-wasup-worker}"
IMAGE_TAG="${WASUP_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d)}"

echo "==> Ensuring ACR ${ACR_NAME} in ${RESOURCE_GROUP}"
if ! az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$ACR_NAME" \
    --sku Basic \
    --location "$LOCATION" \
    --admin-enabled true
fi

ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query loginServer -o tsv)"
FULL_IMAGE="${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "==> Building ${FULL_IMAGE}"
docker build -t "${FULL_IMAGE}" -t "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:latest" "${APP_DIR}"

echo "==> Logging into ACR"
az acr login --name "$ACR_NAME"

echo "==> Pushing"
docker push "${FULL_IMAGE}"
docker push "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:latest"

echo ""
echo "Pushed: ${FULL_IMAGE}"
echo "Latest: ${ACR_LOGIN_SERVER}/${IMAGE_NAME}:latest"
