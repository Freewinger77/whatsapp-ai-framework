#!/usr/bin/env bash
# Patch an org worker VM so direct POST /api/instances captures to control plane.
set -euo pipefail

VM_HOST="${1:-}"
VM_USER="${VM_USER:-wasupadmin}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -z "$VM_HOST" ]]; then
  echo "Usage: patch-worker-registry.sh <vm-ip-or-host>" >&2
  exit 1
fi

APP_DIR="$(ssh "$VM_USER@$VM_HOST" "ls -d /opt/wasup-*/app 2>/dev/null | head -1")"
if [[ -z "$APP_DIR" ]]; then
  echo "Could not find /opt/wasup-*/app on $VM_HOST" >&2
  exit 1
fi

REMOTE_ROOT="${APP_DIR%/app}"
echo "Patching worker at $REMOTE_ROOT on $VM_HOST"

scp -o StrictHostKeyChecking=no \
  "$ROOT_DIR/app/src/utils/control-plane-registry.js" \
  "$ROOT_DIR/deploy/scripts/patch-startup-sync.py" \
  "$VM_USER@$VM_HOST:/tmp/"

ssh -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" "sudo cp /tmp/control-plane-registry.js '$APP_DIR/src/utils/control-plane-registry.js'"

ssh -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" "sudo python3 - <<'PY'
from pathlib import Path

server = Path('$APP_DIR/server.js')
text = server.read_text()

import_block = '''import {
    isControlPlaneRegistryEnabled,
    registerWorkerInstance,
    syncWorkerInstanceCatalog,
} from './src/utils/control-plane-registry.js';
'''

if 'control-plane-registry.js' not in text:
    anchor = \"} from './src/utils/proxy.js';\"
    if anchor not in text:
        raise SystemExit('import anchor not found')
    text = text.replace(anchor, anchor + '\\n' + import_block, 1)

create_anchor = '''        const instance = await instanceManager.createInstance({
            id,
            name,
            webhookUrl,
            antiBanSettings,
            apiKey,
            generateApiKey: generateApiKey === true || generateApiKey === 'true',
        });
        
        broadcastToAll({'''

create_patch = '''        const instance = await instanceManager.createInstance({
            id,
            name,
            webhookUrl,
            antiBanSettings,
            apiKey,
            generateApiKey: generateApiKey === true || generateApiKey === 'true',
        });

        registerWorkerInstance(instance, { controlPlaneInstanceId: id || null });
        
        broadcastToAll({'''

if 'registerWorkerInstance(instance' not in text:
    if create_anchor not in text:
        raise SystemExit('create anchor not found')
    text = text.replace(create_anchor, create_patch, 1)

server.write_text(text)
print('server.js patched')
PY"

ssh -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" "sudo python3 /tmp/patch-startup-sync.py '$APP_DIR/server.js'"

ssh -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" "sudo pm2 reload wasup-worker --update-env && sudo pm2 save"
echo "Registry patch applied on $VM_HOST"
