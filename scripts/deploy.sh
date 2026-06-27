#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────
SERVER="${SERVER:-root@23.27.96.135}"
SERVER_DIR="/opt/food-delivery"
TAR_FILE="food-delivery-deploy.tar.gz"

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "=== Food Delivery Platform — Deploy ==="
echo "Server: $SERVER"
echo ""

# ── 1. Package ──────────────────────────────────
echo "[1/4] Packaging project..."
tar -czf "$TAR_FILE" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='*.tar.gz' \
  --exclude='.env' \
  --exclude='*.local' \
  .

SIZE=$(du -h "$TAR_FILE" | cut -f1)
echo "  Package: $TAR_FILE ($SIZE)"

# ── 2. Upload ───────────────────────────────────
echo "[2/4] Uploading to server..."
scp "$TAR_FILE" "$SERVER:$SERVER_DIR/"
rm "$TAR_FILE"

# ── 3. Extract ──────────────────────────────────
echo "[3/4] Extracting on server..."
ssh "$SERVER" "cd $SERVER_DIR && tar -xzf $TAR_FILE && rm $TAR_FILE"

# ── 4. Build & Deploy ───────────────────────────
echo "[4/4] Building and starting containers..."
ssh "$SERVER" "cd $SERVER_DIR && \
  docker compose -f docker-compose.prod.yml --env-file .env.production build && \
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans && \
  docker image prune -f"

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Containers:"
ssh "$SERVER" "cd $SERVER_DIR && docker compose -f docker-compose.prod.yml ps"
echo ""
echo "Check: curl http://23.27.96.135/health"
