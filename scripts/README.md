# Deployment scripts

Operational scripts live in [`deploy/scripts/`](../deploy/scripts/).

Run them from the repo root via the stable wrappers:

```bash
bash deploy/deploy-control-plane-appservice.sh
bash deploy/deploy-dashboard-frontend.sh
bash deploy/deploy-to-vm.sh <VM_IP>
bash deploy/hotfix-worker-vm.sh <host> static app/public/index.html
```

Or call the scripts directly:

```bash
bash deploy/scripts/deploy-dashboard-frontend.sh
```

See [`docs/REPO_LAYOUT.md`](../docs/REPO_LAYOUT.md) for the full tree.
