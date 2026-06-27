#!/usr/bin/env bash
set -euo pipefail

echo "=== Food Delivery Platform — Server Setup ==="
echo "Server: $(hostname)"
echo ""

# ── 1. Install Docker ──────────────────────────
if ! command -v docker &> /dev/null; then
  echo "[1/5] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed."
else
  echo "[1/5] Docker already installed: $(docker --version)"
fi

# ── 2. Docker Compose plugin ────────────────────
if ! docker compose version &> /dev/null; then
  echo "[2/5] Installing Docker Compose plugin..."
  apt-get update -qq && apt-get install -y docker-compose-plugin
  echo "Docker Compose installed."
else
  echo "[2/5] Docker Compose already available: $(docker compose version)"
fi

# ── 3. Create directory ─────────────────────────
echo "[3/5] Creating $SERVER_DIR..."
mkdir -p /opt/food-delivery/nginx
echo "Directory ready."

# ── 4. Generate .env.production ──────────────────
echo "[4/5] Generating .env.production..."
JWT_SECRET=$(openssl rand -base64 64)
DB_PASS=$(openssl rand -hex 16)
MINIO_KEY=$(openssl rand -hex 16)
MINIO_SECRET=$(openssl rand -hex 32)

cat > /opt/food-delivery/.env.production << EOF
# Database
DB_USER=fduser
DB_PASSWORD=$DB_PASS
DB_NAME=food_delivery

# JWT
JWT_SECRET=$JWT_SECRET

# MinIO / Object Storage
MINIO_ACCESS_KEY=$MINIO_KEY
MINIO_SECRET_KEY=$MINIO_SECRET
MINIO_BUCKET=food-delivery
MINIO_PUBLIC_URL=/uploads

# CORS
CORS_ORIGIN=*

# WeChat Mini Program (leave empty for mock mode)
WECHAT_APP_ID=
WECHAT_APP_SECRET=

# WeChat Pay v3 (leave empty for mock mode)
WECHAT_PAY_MCH_ID=
WECHAT_PAY_API_KEY_V3=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=

# Nginx
NGINX_PORT=80
EOF

echo ".env.production created at /opt/food-delivery/.env.production"

# ── 5. Firewall ─────────────────────────────────
echo "[5/5] Configuring firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp  2>/dev/null || true
  ufw allow 80/tcp  2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  echo "Firewall: 22, 80, 443 allowed."
else
  echo "ufw not found, skip."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Ports in use:"
ss -tlnp 2>/dev/null | grep -E ':(80|443|3456)\b' || echo "  No conflicts"
echo ""
echo "Memory:"
free -h
echo ""
echo "Next: run deploy script from your local machine"
echo "  SERVER=root@23.27.96.135 bash scripts/deploy.sh"
