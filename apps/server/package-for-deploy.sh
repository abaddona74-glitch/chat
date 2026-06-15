#!/bin/bash
# Chat Server Deployment Packaging Script
# Ishlatish: bash package-for-deploy.sh
# Natija: chat-server-deploy.tar.gz — serverga yuborish uchun tayyor

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCHIVE_NAME="chat-server-deploy.tar.gz"

echo "=== Chat Server Deployment Package ==="
echo "Server papkasi: $SCRIPT_DIR"
echo "Arxiv: $SCRIPT_DIR/../$ARCHIVE_NAME"
echo ""

cd "$SCRIPT_DIR"

# 1. Build qilish
echo "[1/4] Dependencies o'rnatilmoqda..."
npm install --production=false

echo ""
echo "[2/4] Prisma generate qilinmoqda..."
npx prisma generate

echo ""
echo "[3/4] TypeScript build qilinmoqda..."
npm run build

# 2. Arxivga kerakli fayllarni solish (ichidagi fayllarni to'g'ridan-to'g'ri)
echo ""
echo "[4/4] Arxiv yaratilmoqda..."

tar -czf "../$ARCHIVE_NAME" \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='uploads' \
  --exclude='wails-desktop' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='check-urls.js' \
  --exclude='check-urls.mjs' \
  --exclude='deploy.sh' \
  --exclude='setup-turn.sh' \
  --exclude='nginx-mytelegramchat.conf' \
  -C "$SCRIPT_DIR" \
  package.json \
  package-lock.json \
  prisma/ \
  tsconfig.json \
  dist/ \
  .env.example

echo ""
echo "=== TAYYOR! ==="
echo "Arxiv: $SCRIPT_DIR/../$ARCHIVE_NAME"
echo ""
echo "Serverda quyidagilarni bajaring:"
echo "  cd /opt/chat"
echo "  tar -xzf chat-server-deploy.tar.gz -C /opt/chat/server"
echo "  cd /opt/chat/server"
echo "  cp .env.production .env   # yoki .env ni tiklang"
echo "  npm install"
echo "  npx prisma generate"
echo "  pm2 restart chat-server"
echo ""
