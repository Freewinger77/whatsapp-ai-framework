from pathlib import Path
import sys

p = Path(sys.argv[1])
text = p.read_text()
marker = "    console.log(`[Server] Ready! ${instanceManager.getAllInstances().length} instances loaded.`);"
block = """    if (isControlPlaneRegistryEnabled()) {
        console.log('[Server] Control plane instance registry enabled — worker creates will sync to dev.wasup');
        syncWorkerInstanceCatalog(instanceManager.getAllInstances());
    }

""" + marker

if "syncWorkerInstanceCatalog(instanceManager" in text:
    print("already done")
elif marker not in text:
    print("marker missing")
    sys.exit(1)
else:
    p.write_text(text.replace(marker, block, 1))
    print("ok")
