#!/usr/bin/env bash
# ============================================================
# WhatsApp AI Platform — Azure VM Setup Script
#
# Run on a fresh Ubuntu 22.04/24.04 VM:
#   curl -fsSL https://raw.githubusercontent.com/your-repo/deploy/setup-vm.sh | bash
#   OR:  bash /opt/whatsapp-ai/deploy/setup-vm.sh
# ============================================================
set -euo pipefail

APP_DIR="/opt/whatsapp-ai"
NODE_MAJOR=20

echo "========================================"
echo "  WhatsApp AI Platform — VM Setup"
echo "========================================"

# ---- 1. System packages ----
echo "[1/7] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx ufw

# ---- 2. Node.js 20 ----
echo "[2/7] Installing Node.js ${NODE_MAJOR}..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

# ---- 3. PM2 ----
echo "[3/7] Installing PM2..."
sudo npm install -g pm2

# ---- 4. Clone / copy app ----
echo "[4/7] Setting up application directory..."
sudo mkdir -p "$APP_DIR/logs"
if [ ! -f "$APP_DIR/app/package.json" ]; then
    echo "  -> Copy your app files to $APP_DIR/ (or git clone)"
    echo "  -> Expected structure: $APP_DIR/app/server.js"
fi

# ---- 5. Install dependencies ----
if [ -f "$APP_DIR/app/package.json" ]; then
    echo "[5/7] Installing npm dependencies..."
    cd "$APP_DIR/app"
    npm install --production
else
    echo "[5/7] Skipping npm install (no package.json found yet)"
fi

# ---- 6. nginx ----
echo "[6/7] Configuring nginx..."
sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/whatsapp-api 2>/dev/null || true
sudo ln -sf /etc/nginx/sites-available/whatsapp-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# ---- 7. Firewall ----
echo "[7/7] Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo ""
echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Copy your app to $APP_DIR/app/ (if not already done)"
echo "  2. Create $APP_DIR/app/.env with your config"
echo "  3. Start with PM2:"
echo "       cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs"
echo "       pm2 save && pm2 startup"
echo ""
echo "  4. (Optional) Add SSL with certbot:"
echo "       sudo certbot --nginx -d your-domain.com"
echo ""
echo "  5. Access the app at http://$(curl -s ifconfig.me)"
echo ""
