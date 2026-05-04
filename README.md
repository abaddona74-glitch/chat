# Chat Desktop (Electron + React + TypeScript + Node + Socket.IO + PostgreSQL + Prisma)

Telegram uslubidagi shaxsiy desktop chat uchun boshlang'ich loyiha. 1-to-1 chatga yo'naltirilgan va kontakt qo'shishsiz barcha ro'yxatdan o'tgan userlar ko'rinadi.

## Nimalar tayyor

- Gmail orqali register (`@gmail.com`) + email verification code
- Login
- 2FA (`Authenticator`, TOTP QR orqali)
- Forgot password (emailga reset code yuboriladi)
- Online/offline presence
- Socket.IO real-time text chat
- `typing` holati
- File upload va yuborish:
  - audio, video, gif, zip va boshqa fayllar (`200MB` gacha)
  - voice message (`record` yoki audio fayl)
  - location (`latitude/longitude`)
- Electron desktop notification (Telegramdagi toastga o'xshash OS notification)
- `Open on startup` on/off
- Audio call (WebRTC signaling, 1-to-1, beta)

## Arxitektura

- `apps/server`: Express + Socket.IO + Prisma + PostgreSQL
- `apps/desktop`: Electron + React + Vite (TypeScript)
- `docker-compose.yml`: Postgres + MailHog

## 1. Prerequisite

- Node.js `>=20`
- Docker (Postgres/MailHog uchun)

## 2. O'rnatish

```bash
npm install
docker compose up -d
```

## 3. Environment

Server:

```bash
cp apps/server/.env.example apps/server/.env
```

Desktop:

```bash
cp apps/desktop/.env.example apps/desktop/.env
```

Muhim `apps/server/.env` qiymatlar:

- `JWT_SECRET` ni kamida 16 belgili qilib qo'ying
- Email test uchun default `MailHog` ishlaydi (`localhost:1025`)

## 4. Prisma

```bash
npm run prisma:generate -w apps/server
npm run prisma:push -w apps/server
```

## 5. Run (dev)

```bash
npm run dev
```

- Server: `http://localhost:4000`
- Desktop UI (dev): `http://localhost:5173` (Electron shu sahifani ochadi)
- MailHog UI: `http://localhost:8025`

## API qisqa ro'yxat

- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/login`
- `POST /auth/login/2fa`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/2fa/setup`
- `POST /auth/2fa/enable`
- `POST /auth/2fa/disable`
- `GET /auth/me`
- `GET /users`
- `GET /messages/:otherUserId`
- `POST /messages`
- `POST /upload`

## Socket eventlar

- `message:send` -> `message:new`
- `typing:start`, `typing:stop`
- `presence:update`
- `call:offer`, `call:answer`, `call:ice-candidate`, `call:end`

## Eslatma

- Bu birinchi iteratsiya skeleton/MVP.
- Telegram darajasidagi to'liq video-call, push delivery, media compression, E2E encryption hali qo'shilmagan.
