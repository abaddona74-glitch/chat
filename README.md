# Chat App

Telegram uslubidagi chat ilovasi. Server, web va desktop (Wails) ilovalarini o'z ichiga olgan monorepo.

## Arxitektura

```
apps/
├── server/          # Express + Socket.IO + Prisma + PostgreSQL
├── web/             # React + Vite (TypeScript) — web client
└── wails-desktop/   # Wails (Go) + React frontend — desktop client
```

- **Server**: REST API + WebSocket real-time messaging, file upload, auth (email, Google OAuth, 2FA)
- **Web**: React SPA — brauzerda ishlaydi
- **Wails Desktop**: Native desktop app (Windows) — Go backend + React frontend

## Imkoniyatlar

- Email orqali register/login (`@gmail.com`) + email verification code
- Google OAuth login
- 2FA (Authenticator, TOTP QR)
- Forgot password (email reset code)
- Online/offline presence
- Socket.IO real-time text chat
- `typing` holati
- File upload: audio, video, gif, zip va boshqalar (200MB gacha)
- Voice message
- Location (latitude/longitude)
- Desktop notification (Wails)
- Audio call (WebRTC signaling, 1-to-1, beta)
- Mobile deep link (`chatmobile://`)

## Talablar

- Node.js >= 20
- Docker (PostgreSQL + MailHog uchun) yoki to'g'ridan-to'g'ri PostgreSQL
- Go >= 1.21 (Wails desktop build uchun)
- Wails CLI (desktop build uchun): `go install github.com/wailsapp/v2/cmd/wails@latest`

## O'rnatish

```bash
# 1. Reponi clone qilish
git clone <repo-url>
cd chat

# 2. Dependencies o'rnatish
npm install

# 3. PostgreSQL va MailHog ishga tushirish
docker compose up -d
```

## Environment

```bash
# Server
cp apps/server/.env.example apps/server/.env

# Web
cp apps/web/.env.example apps/web/.env   # yoki .env.production dan nusxa oling
```

Muhim `.env` o'zgaruvchilari:

| Variable | Tavsif | Default |
|----------|--------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/chat_app` |
| `JWT_SECRET` | JWT signing secret (kamida 16 belgi) | — |
| `SMTP_HOST` | Email server | `localhost` (MailHog) |
| `SMTP_PORT` | SMTP port | `1025` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |

## Prisma (Database)

```bash
npm run prisma:generate -w apps/server
npm run prisma:push -w apps/server
```

## Development

```bash
# Server + Web client birgalikda
npm run dev

# Alohida
npm run dev:server    # Server: http://localhost:4000
npm run dev:web       # Web: http://localhost:5173

# Wails Desktop (live development)
cd apps/wails-desktop
wails dev
```

- Server API: `http://localhost:4000`
- Web client: `http://localhost:5173`
- MailHog UI: `http://localhost:8025`

## Build

```bash
# Server (TypeScript -> JavaScript)
npm run build -w apps/server

# Web client
npm run build -w apps/web

# Desktop (Wails)
cd apps/wails-desktop
wails build

# Hammasi
npm run build:all
```

## Deploy (Server)

Serverda bir martalik o'rnatish:

```bash
bash apps/server/deploy.sh
```

Yoki package qilib serverga yuborish:

```bash
bash apps/server/package-for-deploy.sh
# chat-server-deploy.tar.gz hosil bo'ladi
# Serverda: tar -xzf chat-server-deploy.tar.gz -C /opt/chat/server
```

## API

### Auth
| Method | Endpoint | Tavsif |
|--------|----------|--------|
| POST | `/auth/register` | Ro'yxatdan o'tish |
| POST | `/auth/verify-email` | Emailni tasdiqlash |
| POST | `/auth/login` | Login |
| POST | `/auth/login/2fa` | 2FA login |
| POST | `/auth/google` | Google OAuth login |
| POST | `/auth/forgot-password` | Parolni unutdim |
| POST | `/auth/reset-password` | Parolni tiklash |
| POST | `/auth/2fa/setup` | 2FA sozlash |
| POST | `/auth/2fa/enable` | 2FA yoqish |
| POST | `/auth/2fa/disable` | 2FA o'chirish |
| GET | `/auth/me` | Profil ma'lumoti |

### Users, Messages, Upload
| Method | Endpoint | Tavsif |
|--------|----------|--------|
| GET | `/users` | Foydalanuvchilar ro'yxati |
| GET | `/messages/:otherUserId` | Xabarlar tarixi |
| POST | `/messages` | Xabar yuborish |
| POST | `/upload` | Fayl yuklash |
| GET | `/update/history` | Desktop yangilanishlar tarixi |
| GET | `/update/download` | Desktop versiya yuklash |

## Socket.IO Events

| Event | Yo'nalish | Tavsif |
|-------|-----------|--------|
| `message:send` | Client -> Server | Xabar yuborish |
| `message:new` | Server -> Client | Yangi xabar |
| `typing:start` | Client -> Server | Yozish boshlangani |
| `typing:stop` | Client -> Server | Yozish to'xtagani |
| `typing:update` | Server -> Client | Yozish holati |
| `presence:update` | Server -> Client | Online/offline |
| `call:offer` | Peer -> Peer | Qo'ng'iroq taklifi |
| `call:answer` | Peer -> Peer | Qo'ng'iroq javobi |
| `call:ice-candidate` | Peer -> Peer | ICE candidate |
| `call:end` | Peer -> Peer | Qo'ng'iroq tugashi |
| `users:online` | Server -> Client | Online userlar |

## Loyiha tuzilmasi

```
.
├── apps/
│   ├── server/
│   │   ├── prisma/          # Database schema + migrations
│   │   ├── src/
│   │   │   ├── config/      # env config
│   │   │   ├── lib/         # utilities (mailer, etc.)
│   │   │   ├── middleware/   # Express middleware
│   │   │   ├── routes/      # API routes
│   │   │   └── types/       # TypeScript types
│   │   ├── dist/            # Build output
│   │   ├── uploads/         # File uploads
│   │   └── updates/         # Desktop update files
│   ├── web/                 # React + Vite web app
│   │   └── src/
│   │       └── lib/         # API client, socket, utils
│   └── wails-desktop/       # Wails (Go) desktop app
│       ├── frontend/        # React UI (Vite)
│       ├── main.go          # Go entry point
│       ├── app.go           # Go app methods
│       └── updater.go       # Auto-update logic
├── docker-compose.yml       # PostgreSQL + MailHog
└── package.json             # Root workspace
```

## Eslatma

- Bu MVP (Minimum Viable Product)
- Telegram darajasidagi to'liq video-call, push delivery, media compression, E2E encryption hali qo'shilmagan
- `.env.production` fayli gitignore qilingan — prod secrets repository'ga tushmaydi
