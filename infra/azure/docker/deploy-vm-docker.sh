#!/usr/bin/env bash
# Deploy Wasup worker via Docker on an Azure VM (wasup-dev style).
set -euo pipefail

VM_HOST="${WASUP_VM_HOST:-azureuser@20.223.209.59}"
REMOTE_DIR="${WASUP_VM_DIR:-/opt/wasup-worker}"
IMAGE="${WASUP_LOCAL_IMAGE:-wasup-worker:local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

echo "==> Building local image ${IMAGE}"
docker build -t "${IMAGE}" "${ROOT_DIR}/app"

echo "==> Saving image"
TMP_TAR="$(mktemp -t wasup-worker.XXXXXX.tar)"
docker save "${IMAGE}" -o "${TMP_TAR}"

echo "==> Uploading to ${VM_HOST}"
ssh "${VM_HOST}" "sudo mkdir -p ${REMOTE_DIR} && sudo chown \$(whoami):\$(whoami) ${REMOTE_DIR}"
scp "${TMP_TAR}" "${VM_HOST}:${REMOTE_DIR}/wasup-worker.tar"
scp "${ROOT_DIR}/docker-compose.yml" "${VM_HOST}:${REMOTE_DIR}/docker-compose.yml"
rm -f "${TMP_TAR}"

echo "==> Loading and starting on VM"
ssh "${VM_HOST}" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
docker load -i wasup-worker.tar
docker compose down || true
docker compose up -d
docker compose ps
curl -sf http://127.0.0.1:3000/api/health | head -c 400 || true
echo
EOF

echo "Done."
