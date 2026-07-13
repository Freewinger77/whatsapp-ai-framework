#!/usr/bin/env python3
"""Deploy control-plane-registry.js and wire worker→CP instance sync on org workers."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

APP = Path(sys.argv[1])
SERVER = APP / "server.js"
IM = APP / "src/utils/instance-manager.js"
REGISTRY_DST = APP / "src/utils/control-plane-registry.js"

IMPORT_BLOCK = """import {
    isControlPlaneRegistryEnabled,
    registerWorkerInstance,
    syncWorkerInstanceCatalog,
} from './src/utils/control-plane-registry.js';
"""

IMPORT_MARKER = "} from './src/utils/control-plane-reporter.js';"
IMPORT_MARKER_FALLBACK = "} from './src/utils/proxy.js';"

HOOK_BLOCK = """    instanceManager.onInstanceCreated = (status, config) => {
        registerWorkerInstance(status, { controlPlaneInstanceId: config?.id || null });
    };

    if (isControlPlaneRegistryEnabled()) {
        console.log('[Server] Control plane instance registry enabled — worker creates will sync to dev.wasup');
        syncWorkerInstanceCatalog(instanceManager.getAllInstances());
    }

"""

READY_MARKER = "    console.log(`[Server] Ready! ${instanceManager.getAllInstances().length} instances loaded.`);"

MIGRATE_HOOK = """        registerWorkerInstance(instance, { controlPlaneInstanceId: newId });
"""

MIGRATE_MARKER = """        const instance = await instanceManager.migrateInstanceId(req.params.id, newId);
        broadcastToAll({"""

ONBOARD_HOOK = """        registerWorkerInstance(status, { controlPlaneInstanceId: instance.id });
        
        res.status(201).json({"""

ONBOARD_MARKER = """        res.status(201).json({
            success: true,
            instanceId: instance.id,"""

IM_HOOK = "        this.onInstanceCreated = null;"
IM_HOOK_FALLBACK = "        this.onLog = null;"
IM_CREATE = """        if (this.onInstanceCreated) {
            try {
                this.onInstanceCreated(status, config);
            } catch (error) {
                console.warn(`[InstanceManager] onInstanceCreated hook failed for ${id}:`, error.message);
            }
        }
        
        return status;"""

IM_CREATE_MARKER = "        console.log(`[InstanceManager] Instances saved to disk`);\n        \n        return instance.getStatus();"
IM_CREATE_MARKER_ALT = "        console.log(`[InstanceManager] Instances saved to disk`);\n        \n        return status;"


def main() -> None:
    if not SERVER.exists():
        raise SystemExit(f"server.js not found: {SERVER}")

    try:
        registry_src = Path(__file__).resolve().parents[2] / "app/src/utils/control-plane-registry.js"
    except IndexError:
        registry_src = Path("/nonexistent")
    if registry_src.exists():
        shutil.copy2(registry_src, REGISTRY_DST)
        print(f"Copied {REGISTRY_DST.name}")
    elif REGISTRY_DST.exists():
        print(f"Using existing {REGISTRY_DST.name}")
    else:
        raise SystemExit(f"Registry file missing: {REGISTRY_DST}")

    text = SERVER.read_text()

    if "control-plane-registry.js" not in text:
        if IMPORT_MARKER in text:
            text = text.replace(IMPORT_MARKER, IMPORT_MARKER + "\n" + IMPORT_BLOCK, 1)
        elif IMPORT_MARKER_FALLBACK in text:
            text = text.replace(IMPORT_MARKER_FALLBACK, IMPORT_MARKER_FALLBACK + "\n" + IMPORT_BLOCK, 1)
        else:
            raise SystemExit("import anchor missing for registry")
        print("Added registry import")

    if "instanceManager.onInstanceCreated" not in text:
        if READY_MARKER not in text:
            raise SystemExit("Ready marker missing")
        text = text.replace(READY_MARKER, HOOK_BLOCK + READY_MARKER, 1)
        print("Added startup registry hooks")

    if MIGRATE_HOOK.strip() not in text and "migrate-id" in text:
        if MIGRATE_MARKER in text:
            text = text.replace(
                MIGRATE_MARKER,
                MIGRATE_MARKER.replace(
                    "        broadcastToAll({",
                    MIGRATE_HOOK + "        broadcastToAll({",
                    1,
                ),
                1,
            )
            print("Added migrate-id registry hook")

    if "registerWorkerInstance(status" not in text and "/api/onboard" in text:
        if ONBOARD_MARKER in text:
            text = text.replace(ONBOARD_MARKER, ONBOARD_HOOK, 1)
            print("Added onboard registry hook")

    SERVER.write_text(text)

    if IM.exists():
        im = IM.read_text()
        if IM_HOOK not in im:
            if IM_HOOK_FALLBACK not in im:
                raise SystemExit("instance-manager hook anchor missing")
            im = im.replace(
                IM_HOOK_FALLBACK,
                IM_HOOK_FALLBACK + "\n        this.onInstanceCreated = null;",
                1,
            )
            print("Added onInstanceCreated field to instance-manager")
        if "this.onInstanceCreated(status, config)" not in im:
            old = """        console.log(`[InstanceManager] Instances saved to disk`);
        
        return instance.getStatus();"""
            new = """        console.log(`[InstanceManager] Instances saved to disk`);

        const status = instance.getStatus();
        if (this.onInstanceCreated) {
            try {
                this.onInstanceCreated(status, config);
            } catch (error) {
                console.warn(`[InstanceManager] onInstanceCreated hook failed for ${id}:`, error.message);
            }
        }

        return status;"""
            if old not in im:
                old2 = old.replace("return instance.getStatus();", "return status;")
                if old2 in im:
                    old = old2
                    new = new.replace("const status = instance.getStatus();", "const status = instance.getStatus();")
                else:
                    raise SystemExit("createInstance save marker missing")
            im = im.replace(old, new, 1)
            IM.write_text(im)
            print("Patched instance-manager createInstance hook")
        else:
            print("instance-manager hook already present")
    else:
        print("WARN: instance-manager.js not found — skip IM patch")

    print("Done")


if __name__ == "__main__":
    main()
