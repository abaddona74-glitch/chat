#!/bin/bash
# ============================================
# TURN Server (coturn) Setup Script
# Server: mytelegramchat.ddns.net
# ============================================
set -e

DOMAIN="mytelegramchat.ddns.net"
TURN_SECRET="ChatTurnSecret2026Secure"
TURN_PORT=3478
TURNS_PORT=5349

echo "=== TURN Server (coturn) o'rnatilmoqda ==="

# 1. coturn o'rnatish
echo "[1/5] coturn o'rnatilmoqda..."
sudo apt-get update
sudo apt-get install -y coturn

# 2. coturn ni systemd orqali ishga tushirishga ruxsat
echo "[2/5] coturn systemd sozlanmoqda..."
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

# 3. SSL sertifikatlarni coturn uchun nusxalash
echo "[3/5] SSL sertifikatlar sozlanmoqda..."
sudo mkdir -p /etc/coturn/certs
sudo cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /etc/coturn/certs/turn_cert.pem
sudo cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem /etc/coturn/certs/turn_key.pem
sudo chown turnserver:turnserver /etc/coturn/certs/turn_cert.pem /etc/coturn/certs/turn_key.pem
sudo chmod 600 /etc/coturn/certs/turn_key.pem

# Certbot hook: SSL yangilanganda coturn sertifikatlarni ham yangilash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn-cert-renew.sh > /dev/null << 'HOOK'
#!/bin/bash
cp /etc/letsencrypt/live/mytelegramchat.ddns.net/fullchain.pem /etc/coturn/certs/turn_cert.pem
cp /etc/letsencrypt/live/mytelegramchat.ddns.net/privkey.pem /etc/coturn/certs/turn_key.pem
chown turnserver:turnserver /etc/coturn/certs/turn_cert.pem /etc/coturn/certs/turn_key.pem
chmod 600 /etc/coturn/certs/turn_key.pem
systemctl restart coturn
HOOK
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn-cert-renew.sh

# 4. coturn konfiguratsiyasi
echo "[4/5] coturn konfiguratsiyasi yozilmoqda..."
sudo tee /etc/turnserver.conf > /dev/null << EOF
# === coturn configuration for ${DOMAIN} ===

# Listening ports
listening-port=${TURN_PORT}
tls-listening-port=${TURNS_PORT}

# Use fingerprint for TURN messages
fingerprint

# Long-term credential mechanism
lt-cred-mech

# Static user credentials for the chat app
user=chatuser:ChatTurnPass2026

# Realm
realm=${DOMAIN}

# SSL certificates
cert=/etc/coturn/certs/turn_cert.pem
pkey=/etc/coturn/certs/turn_key.pem

# Server name
server-name=${DOMAIN}

# Log file
log-file=/var/log/coturn/turnserver.log
simple-log

# Disable multicast peers (security)
no-multicast-peers

# Internal network security: prevent relay to private IPs
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255

# Allow loopback for testing
allowed-peer-ip=127.0.0.1

# Relay port range
min-port=49152
max-port=65535

# Max bandwidth per session (bytes/s) — 1MB/s
max-bps=1048576

# Total quota (max sessions)
total-quota=100
user-quota=10

# Verbose logging for debugging (disable later)
verbose

# No CLI
no-cli
EOF

# 5. Firewall portlarini ochish
echo "[5/5] Firewall portlari ochilmoqda..."
sudo ufw allow ${TURN_PORT}/tcp 2>/dev/null || true
sudo ufw allow ${TURN_PORT}/udp 2>/dev/null || true
sudo ufw allow ${TURNS_PORT}/tcp 2>/dev/null || true
sudo ufw allow ${TURNS_PORT}/udp 2>/dev/null || true
sudo ufw allow 49152:65535/udp 2>/dev/null || true

# Log directory
sudo mkdir -p /var/log/coturn
sudo chown turnserver:turnserver /var/log/coturn

# coturn ni ishga tushirish
echo "coturn qayta ishga tushirilmoqda..."
sudo systemctl restart coturn
sudo systemctl enable coturn

echo ""
echo "=== TURN SERVER TAYYOR! ==="
echo ""
echo "STUN:  stun:${DOMAIN}:${TURN_PORT}"
echo "TURN:  turn:${DOMAIN}:${TURN_PORT}  (UDP/TCP)"
echo "TURNS: turns:${DOMAIN}:${TURNS_PORT} (TLS)"
echo ""
echo "Username: chatuser"
echo "Password: ChatTurnPass2026"
echo ""
echo "Status: sudo systemctl status coturn"
echo "Logs:   sudo tail -f /var/log/coturn/turnserver.log"
echo ""
echo "Test: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
echo "  - TURN URI: turn:${DOMAIN}:${TURN_PORT}"
echo "  - Username: chatuser"
echo "  - Password: ChatTurnPass2026"
