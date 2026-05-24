#!/usr/bin/env bash
# Build the Next.js standalone control plane and deploy it to Azure App Service as a zip.
# App settings stay in Azure; this script does not read or print runtime secrets.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/control-plane"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-${RESOURCE_GROUP:-wasup-control-plane-rg}}"
CONTROL_PLANE_APP_NAME="${CONTROL_PLANE_APP_NAME:-wasup-control-plane}"
PACKAGE_DIR="${APP_DIR}/.deploy"
ZIP_PATH="${APP_DIR}/.deploy/control-plane-standalone.zip"

command -v az >/dev/null || { echo "Azure CLI is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required." >&2; exit 1; }

pushd "$APP_DIR" >/dev/null
echo "Installing/building control plane..."
npm install
npm run build

echo "Packaging standalone Next.js output..."
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/package"
cp -R .next/standalone/. "$PACKAGE_DIR/package/"
mkdir -p "$PACKAGE_DIR/package/.next"
cp -R .next/static "$PACKAGE_DIR/package/.next/static"
if [[ -d public ]]; then
  cp -R public "$PACKAGE_DIR/package/public"
fi

pushd "$PACKAGE_DIR/package" >/dev/null
zip -qr "$ZIP_PATH" .
popd >/dev/null

echo "Deploying zip to App Service '${CONTROL_PLANE_APP_NAME}'..."
az webapp deploy \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CONTROL_PLANE_APP_NAME" \
  --type zip \
  --src-path "$ZIP_PATH" \
  --output table

popd >/dev/null
echo "Control-plane deploy complete."
