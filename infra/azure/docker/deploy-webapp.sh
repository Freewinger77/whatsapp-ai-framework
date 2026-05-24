#!/usr/bin/env bash
# Deploy Wasup worker container to Azure App Service (Linux container).
set -euo pipefail

RESOURCE_GROUP="${WASUP_AZURE_RG:-whatsapp-multi-rg}"
APP_NAME="${WASUP_WEBAPP_NAME:-wasup-worker-dev}"
PLAN_NAME="${WASUP_APP_PLAN:-wasup-worker-dev-plan}"
LOCATION="${WASUP_AZURE_LOCATION:-uksouth}"
ACR_NAME="${WASUP_ACR_NAME:-wasupworkeracr}"
IMAGE_NAME="${WASUP_IMAGE_NAME:-wasup-worker}"
IMAGE_TAG="${WASUP_IMAGE_TAG:-latest}"

ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query loginServer -o tsv)"
FULL_IMAGE="${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"
ACR_USER="$(az acr credential show --name "$ACR_NAME" --query username -o tsv)"
ACR_PASS="$(az acr credential show --name "$ACR_NAME" --query 'passwords[0].value' -o tsv)"

echo "==> Ensuring App Service plan ${PLAN_NAME}"
if ! az appservice plan show --name "$PLAN_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az appservice plan create \
    --name "$PLAN_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --is-linux \
    --sku B1
fi

echo "==> Ensuring Web App ${APP_NAME}"
if ! az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az webapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$PLAN_NAME" \
    --deployment-container-image-name "$FULL_IMAGE"
fi

echo "==> Configuring container"
az webapp config container set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --container-image-name "$FULL_IMAGE" \
  --container-registry-url "https://${ACR_LOGIN_SERVER}" \
  --container-registry-user "$ACR_USER" \
  --container-registry-password "$ACR_PASS"

echo "==> App settings (merge with your secrets separately)"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBSITES_PORT=3000 \
    WASUP_DATA_DIR=/home/data \
    WASUP_WORKER_MODE="${WASUP_WORKER_MODE:-multi}" \
    REGION_CODE="${REGION_CODE:-dev}" \
    ALLOW_PUBLIC_DASHBOARD="${ALLOW_PUBLIC_DASHBOARD:-true}" \
    PORT=3000 \
  >/dev/null

az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --always-on true \
  >/dev/null

echo "==> Restarting"
az webapp restart --name "$APP_NAME" --resource-group "$RESOURCE_GROUP"

HOST="$(az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv)"
echo ""
echo "Deployed: https://${HOST}"
echo "Health:   https://${HOST}/api/health"
echo ""
echo "Set secrets:"
echo "  az webapp config appsettings set -g ${RESOURCE_GROUP} -n ${APP_NAME} --settings API_KEY=... PROXY_POOL=... WASUP_WORKER_SHARED_SECRET=..."
