#!/bin/bash
# Chat Backend Deploy Script
# Serverda birinchi marta ishga tushirish uchun

set -e

echo "=== Chat Backend Deploy ==="

# 1. Node.js tekshirish
if ! command -v node &> /dev/null; then
    echo "Node.js topilmadi. O'rnatilmoqda..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"

# 2. PostgreSQL tekshirish va o'rnatish
if ! command -v psql &> /dev/null; then
    echo "PostgreSQL o'rnatilmoqda..."
    sudo apt-get update
    sudo apt-get install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
fi

# 3. Database yaratish
echo "Database sozlanmoqda..."
sudo -u postgres psql -c "CREATE USER chatuser WITH PASSWORD 'chatpass2026';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE chat_app OWNER chatuser;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE chat_app TO chatuser;" 2>/dev/null || true

# 4. Dependencies o'rnatish
echo "Dependencies o'rnatilmoqda..."
npm install --production=false

# 5. Prisma generate va push
echo "Prisma sozlanmoqda..."
npx prisma generate
npx prisma db push

# 6. TypeScript build
echo "Build qilinmoqda..."
npm run build

# 6.5 Web client build (agar mavjud bo'lsa)
WEB_DIR="../web"
if [ -d "$WEB_DIR" ]; then
    echo "Web client build qilinmoqda..."
    cd "$WEB_DIR"
    npm install
    npm run build
    cd -
    echo "Web client tayyor! Server orqali xizmat ko'rsatiladi."
fi

# 7. pm2 o'rnatish (process manager)
if ! command -v pm2 &> /dev/null; then
    echo "PM2 o'rnatilmoqda..."
    sudo npm install -g pm2
fi

# 8. Server ishga tushirish
echo "Server ishga tushirilmoqda..."
pm2 delete chat-server 2>/dev/null || true
pm2 start dist/index.js --name chat-server
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "=== TAYYOR! ==="
echo "Server API: http://$(hostname -I | awk '{print $1}'):4000"
echo "Web Chat:   http://$(hostname -I | awk '{print $1}'):4000"
echo ""
echo "Telefondan kirish: brauzerda https://mytelegramchat.ddns.net oching"
echo "PM2 status: pm2 status"
echo "Loglar: pm2 logs chat-server"
