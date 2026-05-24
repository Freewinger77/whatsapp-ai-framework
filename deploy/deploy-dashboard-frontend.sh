#!/usr/bin/env bash
# Build and deploy the Vite dashboard to Azure Storage, then optionally purge Azure Front Door.
# Secrets are read from Azure App Service settings and exported only for the local build.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_DIR="${ROOT_DIR}/apps/polymet-wasup"

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-${RESOURCE_GROUP:-wasup-control-plane-rg}}"
CONTROL_PLANE_APP_NAME="${CONTROL_PLANE_APP_NAME:-wasup-control-plane}"
CONTROL_PLANE_API_BASE_URL="${VITE_CONTROL_PLANE_API_BASE_URL:-https://control-plane.wasup.co}"
DASHBOARD_APP_URL="${VITE_WASUP_APP_URL:-${WASUP_DASHBOARD_URL:-https://dev.wasup.co}}"
DASHBOARD_STORAGE_ACCOUNT="${DASHBOARD_STORAGE_ACCOUNT:-}"
FRONTDOOR_RESOURCE_GROUP="${FRONTDOOR_RESOURCE_GROUP:-$RESOURCE_GROUP}"
FRONTDOOR_PROFILE="${FRONTDOOR_PROFILE:-}"
FRONTDOOR_ENDPOINT="${FRONTDOOR_ENDPOINT:-}"

if [[ -z "$DASHBOARD_STORAGE_ACCOUNT" ]]; then
  echo "DASHBOARD_STORAGE_ACCOUNT is required." >&2
  exit 1
fi

command -v az >/dev/null || { echo "Azure CLI is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }

echo "Reading dashboard build settings from App Service '${CONTROL_PLANE_APP_NAME}'..."
CLERK_KEY="$(
  az webapp config appsettings list \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTROL_PLANE_APP_NAME" \
    --query "[?name=='VITE_CLERK_PUBLISHABLE_KEY'].value | [0]" \
    -o tsv
)"

if [[ -z "$CLERK_KEY" || "$CLERK_KEY" == "null" ]]; then
  CLERK_KEY="$(
    az webapp config appsettings list \
      --resource-group "$RESOURCE_GROUP" \
      --name "$CONTROL_PLANE_APP_NAME" \
      --query "[?name=='NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'].value | [0]" \
      -o tsv
  )"
fi

if [[ -z "$CLERK_KEY" || "$CLERK_KEY" == "null" ]]; then
  echo "VITE_CLERK_PUBLISHABLE_KEY was not found in Azure App Service settings." >&2
  exit 1
fi

pushd "$DASHBOARD_DIR" >/dev/null
export VITE_CLERK_PUBLISHABLE_KEY="$CLERK_KEY"
export VITE_CONTROL_PLANE_API_BASE_URL="$CONTROL_PLANE_API_BASE_URL"
export VITE_WASUP_APP_URL="$DASHBOARD_APP_URL"

echo "Building dashboard for ${DASHBOARD_APP_URL} with API ${CONTROL_PLANE_API_BASE_URL}..."
npm run build

echo "Uploading dashboard assets to storage account '${DASHBOARD_STORAGE_ACCOUNT}'..."
az storage blob upload-batch \
  --account-name "$DASHBOARD_STORAGE_ACCOUNT" \
  --auth-mode login \
  --destination '$web' \
  --source dist \
  --overwrite true \
  --output table
popd >/dev/null

if [[ -n "$FRONTDOOR_PROFILE" && -n "$FRONTDOOR_ENDPOINT" ]]; then
  echo "Purging Azure Front Door endpoint '${FRONTDOOR_ENDPOINT}'..."
  az afd endpoint purge \
    --resource-group "$FRONTDOOR_RESOURCE_GROUP" \
    --profile-name "$FRONTDOOR_PROFILE" \
    --endpoint-name "$FRONTDOOR_ENDPOINT" \
    --content-paths '/*' \
    --output table
else
  echo "Skipping Front Door purge. Set FRONTDOOR_PROFILE and FRONTDOOR_ENDPOINT to enable it."
fi

echo "Dashboard deploy complete."
