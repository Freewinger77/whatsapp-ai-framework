#!/usr/bin/env bash
# Bootstrap a shared worker VM (wasup2-style): public dashboard, no API key required.
# Usage: bash deploy/scripts/bootstrap-shared-worker.sh wasup4 [94.x.x.x]
#   If IP omitted, creates Azure VM in WHATSAPP-AI-RG when VM does not exist.
set -euo pipefail

VM_NAME="${1:?Usage: bootstrap-shared-worker.sh <name> [ip>]}"
VM_IP="${2:-}"
RG="${AZURE_RG:-WHATSAPP-AI-RG}"
LOC="${AZURE_LOCATION:-northeurope}"
USER="${VM_USER:-azureuser}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBKEY="$(cat ~/.ssh/id_rsa.pub 2>/dev/null || true)"
DNS_NAME="$VM_NAME"
URL="https://${DNS_NAME}.northeurope.cloudapp.azure.com"

if [[ -z "$PUBKEY" ]]; then
  echo "No ~/.ssh/id_rsa.pub found" >&2
  exit 1
fi

if [[ -z "$VM_IP" ]]; then
  if az vm show -g "$RG" -n "$VM_NAME" -d --query publicIps -o tsv 2>/dev/null | grep -q .; then
    VM_IP="$(az vm show -g "$RG" -n "$VM_NAME" -d --query publicIps -o tsv)"
    echo "VM $VM_NAME already exists: $VM_IP"
  else
    echo "Creating VM $VM_NAME..."
    NSG="${VM_NAME}NSG"
    az network nsg create -g "$RG" -n "$NSG" -l "$LOC" -o none 2>/dev/null || true
    for rule in "default-allow-ssh|1000|22" "open-port-80|1101|80" "open-port-443|1102|443"; do
      IFS='|' read -r name prio port <<< "$rule"
      az network nsg rule create -g "$RG" --nsg-name "$NSG" -n "$name" \
        --priority "$prio" --source-address-prefixes '*' --destination-port-ranges "$port" \
        --access Allow --protocol Tcp -o none 2>/dev/null || true
    done
    az vm create \
      --resource-group "$RG" \
      --name "$VM_NAME" \
      --image Canonical:ubuntu-24_04-lts:server:latest \
      --size Standard_B2s \
      --admin-username "$USER" \
      --vnet-name whatsapp-ai-vmVNET \
      --subnet whatsapp-ai-vmSubnet \
      --nsg "$NSG" \
      --public-ip-sku Standard \
      --public-ip-address-allocation static \
      --public-ip-address-dns-name "$DNS_NAME" \
      --ssh-key-values "$PUBKEY" \
      --location "$LOC" \
      -o none
    VM_IP="$(az vm show -g "$RG" -n "$VM_NAME" -d --query publicIps -o tsv)"
  fi
fi

HOST="${USER}@${VM_IP}"
echo "Bootstrapping $VM_NAME at $HOST ($URL)"

for i in $(seq 1 20); do
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$HOST" 'echo ok' 2>/dev/null && break
  sleep 5
done

# Pull admin password template from wasup2 (same operator access)
ADMIN_PASSWORD="$(ssh -o ConnectTimeout=15 azureuser@40.112.73.2 "grep '^ADMIN_PASSWORD=' /opt/whatsapp-ai/app/.env | cut -d= -f2-" 2>/dev/null || true)"

ssh -o ConnectTimeout=15 "$HOST" 'sudo mkdir -p /opt/whatsapp-ai/logs && sudo chown -R azureuser:azureuser /opt/whatsapp-ai'

rsync -avz \
  --exclude node_modules --exclude instances --exclude logs --exclude .env \
  --exclude auth_info --exclude 'auth_info/**' \
  "$ROOT/app/" "$HOST:/opt/whatsapp-ai/app/"

rsync -avz "$ROOT/deploy/" "$HOST:/opt/whatsapp-ai/deploy/"

ssh -o ConnectTimeout=15 "$HOST" bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw
fi
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm install -g pm2
sudo cp /opt/whatsapp-ai/deploy/nginx.conf /etc/nginx/sites-available/whatsapp-api
sudo ln -sf /etc/nginx/sites-available/whatsapp-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx
sudo ufw allow OpenSSH 2>/dev/null || true
sudo ufw allow 'Nginx Full' 2>/dev/null || true
sudo ufw --force enable 2>/dev/null || true
cd /opt/whatsapp-ai/app
npm install --production --legacy-peer-deps --ignore-scripts
REMOTE

ssh -o ConnectTimeout=15 "$HOST" bash -s <<REMOTE
set -euo pipefail
cat > /opt/whatsapp-ai/app/.env <<EOF
PORT=3000
API_KEY=
ALLOW_PUBLIC_DASHBOARD=true
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
chmod 600 /opt/whatsapp-ai/app/.env
mkdir -p /opt/whatsapp-ai/app/instances
echo '{"instances":[]}' > /opt/whatsapp-ai/app/instances/instances.json
cd /opt/whatsapp-ai
pm2 delete whatsapp-api 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs
pm2 save
sleep 8
curl -sf http://127.0.0.1:3000/api/health
echo
REMOTE

# nginx server_name + SSL
ssh -o ConnectTimeout=15 "$HOST" bash -s <<REMOTE
set -euo pipefail
FQDN="${DNS_NAME}.northeurope.cloudapp.azure.com"
sudo sed -i "s/server_name _;/server_name \${FQDN};/" /etc/nginx/sites-available/whatsapp-api
sudo nginx -t && sudo systemctl reload nginx
if ! sudo test -f "/etc/letsencrypt/live/\${FQDN}/fullchain.pem"; then
  sudo certbot --nginx -d "\${FQDN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi
REMOTE

# smoke cron + log perms
ssh -o ConnectTimeout=15 "$HOST" bash -s <<REMOTE
set -euo pipefail
sudo touch /var/log/${VM_NAME}-smoke.log /var/log/${VM_NAME}-smoke-status.json
sudo chown azureuser:azureuser /var/log/${VM_NAME}-smoke.log /var/log/${VM_NAME}-smoke-status.json
( crontab -l 2>/dev/null | grep -v "${VM_NAME}-smoke" || true
  echo "*/5 * * * * cd /opt/whatsapp-ai/app && WASUP_SMOKE_BASE_URL=${URL} WASUP_SMOKE_STATUS_FILE=/var/log/${VM_NAME}-smoke-status.json node scripts/wasup-smoke.js >> /var/log/${VM_NAME}-smoke.log 2>&1"
) | crontab -
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u azureuser --hp /home/azureuser 2>/dev/null | tail -1 | sudo bash || true
pm2 save
REMOTE

curl -sf "$URL/api/dashboard-config" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d)"
curl -sf "$URL/api/instances" | python3 -c "import sys,json; d=json.load(sys.stdin); print('instances', d.get('count',0))"
echo "Done: $URL ($VM_IP)"
