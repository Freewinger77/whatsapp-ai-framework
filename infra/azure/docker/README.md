# Wasup Worker — Docker + Azure Deployment

## Quick local

```bash
docker compose up -d --build
open http://localhost:3000
```

Data persists in Docker volume `wasup-data` at `/data` inside the container.

## Per-instance API keys (Wasup v3)

Create with a scoped key:

```bash
curl -X POST http://localhost:3000/api/instances \
  -H 'Content-Type: application/json' \
  -d '{"name":"customer-a","generateApiKey":true}'
```

Response includes `instance.apiKey.key` once (`wsp_v3_...`). Store it — only a hash is persisted.

Use that key for instance-scoped calls:

```bash
curl http://localhost:3000/api/instances/wa_xxx/proxy \
  -H "X-API-Key: wsp_v3_..."
```

Control plane internal heartbeat:

```bash
curl -X POST http://localhost:3000/api/internal/heartbeat \
  -H "X-Wasup-Worker-Secret: \$WASUP_WORKER_SHARED_SECRET"
```

## Azure — build & push to ACR

```bash
chmod +x infra/azure/docker/*.sh
./infra/azure/docker/build-push.sh
```

Env overrides: `WASUP_AZURE_RG`, `WASUP_ACR_NAME`, `WASUP_IMAGE_TAG`.

## Azure — App Service container (recommended for dev fleet)

```bash
export WASUP_IMAGE_TAG=latest
./infra/azure/docker/deploy-webapp.sh

# Then set secrets
az webapp config appsettings set \
  -g whatsapp-multi-rg -n wasup-worker-dev \
  --settings API_KEY=... PROXY_POOL=... WASUP_WORKER_SHARED_SECRET=...
```

## Azure — VM Docker (wasup-dev)

```bash
./infra/azure/docker/deploy-vm-docker.sh
```

Ensure `app/.env` exists locally — `docker-compose.yml` loads it.

## Single-instance mode (v3 pod)

```yaml
environment:
  WASUP_WORKER_MODE: single-instance
  WASUP_INSTANCE_ID: wa_customer123
  WASUP_ORG_ID: org_abc
  API_KEY: <deployment-admin-key>
```

One instance is auto-created on boot; data lives on the mounted volume.
