import crypto from "node:crypto";
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  comparePassword,
  hashPassword,
  signAccessToken,
  signTwoFATempToken,
  verifyTwoFATempToken
} from "../lib/auth.js";
import { addMinutes, generateSixDigitCode } from "../lib/codes.js";
import { sendResetPasswordEmail, sendVerificationEmail } from "../lib/mailer.js";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiters for security against brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: 30, // 15 daqiqada ko'pi bilan 30 ta so'rov
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Juda ko'p urinishlar qilindi. Iltimos, 15 daqiqadan so'ng qayta urinib ko'ring." }
});

const codeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 daqiqa
  max: 10, // 5 daqiqada ko'pi bilan 10 ta urinish
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Xavfsizlik: Tasdiqlash kodi uchun juda ko'p urinishlar qilindi. 5 daqiqadan so'ng qayta urinib ko'ring." }
});

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(64),
  displayName: z.string().min(2).max(40)
});

const verifyEmailSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().length(6)
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(64)
});

const twoFALoginSchema = z.object({
  tempToken: z.string().min(10),
  code: z.string().length(6)
});

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase()
});

const resetPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().length(6),
  newPassword: z.string().min(6).max(64)
});

const setup2FASchema = z.object({
  code: z.string().length(6)
});

const DEFAULT_MOBILE_DEEP_LINK_URL = "chatmobile://auth/google";

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  isTwoFAEnabled: boolean;
  isEmailVerified: boolean;
  statusText?: string | null;
  statusEmoji?: string | null;
  zerotierInfo?: string | null;
  lastSeenAt: Date | null;
}) {
  let zerotierNetworks: any[] = [];
  if (user.zerotierInfo) {
    try {
      zerotierNetworks = JSON.parse(user.zerotierInfo);
    } catch {}
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    username: user.username ?? null,
    avatarUrl: user.avatarUrl ?? null,
    isTwoFAEnabled: user.isTwoFAEnabled,
    isEmailVerified: user.isEmailVerified,
    statusText: user.statusText ?? null,
    statusEmoji: user.statusEmoji ?? null,
    zerotierNetworks,
    lastSeenAt: user.lastSeenAt
  };
}

function getGoogleReturnToUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const allowedReturnTo = [env.MOBILE_DEEP_LINK_URL, DEFAULT_MOBILE_DEEP_LINK_URL].filter(
    (item): item is string => Boolean(item)
  );
  return allowedReturnTo.find((item) => item === value);
}

function buildDeepLinkUrl(baseUrl: string, state: string, status: "success" | "error") {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}state=${encodeURIComponent(state)}&status=${status}`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderAuthSuccessPage(options: {
  displayName?: string;
  returnToUrl?: string;
}) {
  const safeReturnToUrl = options.returnToUrl ? JSON.stringify(options.returnToUrl) : "null";
  const safeName = options.displayName ? escapeHtml(options.displayName) : "";

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Muvaffaqiyatli kirish | Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0b0e17;
      color: #f1f5f9;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    .glow-1 {
      position: absolute;
      top: 20%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 520px;
      height: 520px;
      background: radial-gradient(circle, rgba(59, 130, 246, 0.16) 0%, rgba(16, 185, 129, 0.08) 50%, transparent 70%);
      filter: blur(50px);
      pointer-events: none;
      z-index: 0;
    }
    .glow-2 {
      position: absolute;
      bottom: 10%;
      right: 15%;
      width: 360px;
      height: 360px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.14) 0%, transparent 70%);
      filter: blur(60px);
      pointer-events: none;
      z-index: 0;
    }
    .card {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 440px;
      background: rgba(18, 24, 38, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 24px;
      padding: 40px 32px 32px;
      text-align: center;
      box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.75), 0 0 40px rgba(16, 185, 129, 0.08);
      animation: cardAppear 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes cardAppear {
      0% { opacity: 0; transform: translateY(18px) scale(0.97); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    .app-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .app-badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
    }
    .icon-wrapper {
      position: relative;
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-bg {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(5, 150, 105, 0.35));
      border: 1px solid rgba(16, 185, 129, 0.4);
      box-shadow: 0 0 32px rgba(16, 185, 129, 0.32);
      animation: pulse 2.4s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.88; }
    }
    .check-svg {
      position: relative;
      z-index: 2;
      width: 44px;
      height: 44px;
      color: #34d399;
    }
    .check-circle {
      stroke-dasharray: 166;
      stroke-dashoffset: 166;
      stroke-width: 2.5;
      stroke-miterlimit: 10;
      stroke: #34d399;
      animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
    }
    .check-path {
      transform-origin: 50% 50%;
      stroke-dasharray: 48;
      stroke-dashoffset: 48;
      animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.45s forwards;
    }
    @keyframes stroke {
      100% { stroke-dashoffset: 0; }
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    .user-welcome {
      font-size: 15px;
      color: #94a3b8;
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .user-name {
      color: #60a5fa;
      font-weight: 600;
    }
    .description {
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
      margin-bottom: 28px;
    }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 24px;
      border-radius: 14px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      border: none;
      cursor: pointer;
      box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4);
      transition: all 0.2s ease;
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      transform: translateY(-2px);
      box-shadow: 0 14px 30px -5px rgba(37, 99, 235, 0.5);
    }
    .btn-primary:active {
      transform: translateY(0);
    }
    .footer-note {
      margin-top: 20px;
      font-size: 13px;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .timer-badge {
      display: inline-block;
      font-variant-numeric: tabular-nums;
      color: #94a3b8;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="glow-1"></div>
  <div class="glow-2"></div>

  <div class="card">
    <div class="app-badge">
      <div class="app-badge-dot"></div>
      <span>Chat Desktop Application</span>
    </div>

    <div class="icon-wrapper">
      <div class="icon-bg"></div>
      <svg class="check-svg" viewBox="0 0 52 52" fill="none">
        <circle class="check-circle" cx="26" cy="26" r="24" stroke="currentColor" stroke-width="3" />
        <path class="check-path" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16" />
      </svg>
    </div>

    <h1>Muvaffaqiyatli!</h1>
    ${
      safeName
        ? `<p class="user-welcome">Xush kelibsiz, <span class="user-name">${safeName}</span>!</p>`
        : `<p class="user-welcome">Hisobingiz muvaffaqiyatli tasdiqlandi.</p>`
    }
    <p class="description">
      Desktop ilovangizga qaytib suhbatni bemalol davom ettirishingiz mumkin.
    </p>

    <button id="return-btn" class="btn-primary" type="button">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 10 4 15 9 20"></polyline>
        <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
      </svg>
      <span id="btn-text">Ilovaga qaytish</span>
    </button>

    <div id="desktop-notice" style="display: none; margin-top: 14px; font-size: 13px; color: #34d399; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.28); border-radius: 12px; padding: 12px 14px; line-height: 1.45; text-align: left;">
      🎉 <strong>Kirish muvaffaqiyatli yakunlandi!</strong><br />
      Desktop ilovangizda profilingiz ochildi. Pastdagi Taskbar (topshiriqlar paneli) orqali <strong>Chat Desktop</strong> oynasiga o'tishingiz va bu brauzer oynasini yopishingiz mumkin.
    </div>

    <div class="footer-note" style="margin-top: 18px;">
      <span>Ushbu oynani yopishingiz mumkin</span>
      <span class="timer-badge" id="countdown-badge">(4s)</span>
    </div>
  </div>

  <script>
    const returnToUrl = ${safeReturnToUrl};
    const returnBtn = document.getElementById("return-btn");
    const btnText = document.getElementById("btn-text");
    const badge = document.getElementById("countdown-badge");
    const notice = document.getElementById("desktop-notice");

    let seconds = 4;
    const updateCountdown = () => {
      if (badge) badge.textContent = "(" + seconds + "s)";
      if (seconds <= 0) {
        tryClose();
        return;
      }
      seconds--;
      setTimeout(updateCountdown, 1000);
    };

    function tryClose() {
      if (returnToUrl) {
        window.location.replace(returnToUrl);
      } else {
        // 1. Try invoking registered Windows protocol to focus Chat Desktop
        try {
          window.location.href = "chatdesktop://auth?status=success";
        } catch (e) {}

        // 2. Try closing the browser tab
        setTimeout(() => {
          try {
            window.open('', '_self', '');
            window.close();
          } catch (e) {}
        }, 200);

        // 3. Show clear feedback on screen
        if (notice) notice.style.display = "block";
        if (btnText) btnText.textContent = "✓ Desktop ilovasiga o'ting";
        if (returnBtn) {
          returnBtn.style.background = "linear-gradient(135deg, #059669, #10b981)";
        }
      }
    }

    if (returnBtn) {
      returnBtn.addEventListener("click", () => {
        tryClose();
      });
    }

    if (returnToUrl) {
      setTimeout(() => {
        window.location.replace(returnToUrl);
      }, 200);
    } else {
      setTimeout(updateCountdown, 1000);
    }
  </script>
</body>
</html>`;
}

router.post("/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const { email, password, displayName } = parsed.data;

  if (!email.endsWith("@gmail.com")) {
    return res
      .status(400)
      .json({ message: "Ro'yxatdan o'tish uchun Gmail manzil ishlating." });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.isEmailVerified) {
    return res.status(409).json({ message: "Bu email allaqachon ro'yxatdan o'tgan." });
  }

  const passwordHash = await hashPassword(password);
  const emailVerifyCode = generateSixDigitCode();
  const emailVerifyExpiresAt = addMinutes(new Date(), env.EMAIL_CODE_TTL_MINUTES);

  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        emailVerifyCode,
        emailVerifyExpiresAt
      }
    });
  } else {
    await prisma.user.update({
      where: { email },
      data: {
        displayName,
        passwordHash,
        emailVerifyCode,
        emailVerifyExpiresAt,
        isEmailVerified: false
      }
    });
  }

  await sendVerificationEmail(email, emailVerifyCode);

  return res.json({ message: "Tasdiqlash kodi emailingizga yuborildi." });
});

router.post("/verify-email", codeLimiter, async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }
  const { email, code } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.emailVerifyCode || !user.emailVerifyExpiresAt) {
    return res.status(400).json({ message: "Kod noto'g'ri yoki muddati o'tgan." });
  }

  const isExpired = user.emailVerifyExpiresAt.getTime() < Date.now();
  if (user.emailVerifyCode !== code || isExpired) {
    return res.status(400).json({ message: "Kod noto'g'ri yoki muddati o'tgan." });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      isEmailVerified: true,
      emailVerifyCode: null,
      emailVerifyExpiresAt: null
    }
  });

  const io = req.app.get("io");
  if (io) {
    io.emit("presence:update", {
      userId: updated.id,
      isOnline: false,
      lastSeenAt: new Date().toISOString()
    });
  }

  const token = signAccessToken(updated.id, updated.email);

  return res.json({
    token,
    user: toPublicUser(updated)
  });
});

router.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ message: "Email yoki parol noto'g'ri." });
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash);
  if (!isPasswordValid) {
    return res.status(401).json({ message: "Email yoki parol noto'g'ri." });
  }

  if (!user.isEmailVerified) {
    return res.status(403).json({ message: "Email tasdiqlanmagan." });
  }

  if (user.isTwoFAEnabled) {
    const tempToken = signTwoFATempToken(user.id, user.email);
    return res.json({
      requiresTwoFA: true,
      tempToken
    });
  }

  const token = signAccessToken(user.id, user.email);
  return res.json({
    token,
    user: toPublicUser(user)
  });
});

router.post("/login/2fa", codeLimiter, async (req, res) => {
  const parsed = twoFALoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }
  const { tempToken, code } = parsed.data;

  let payload: { userId: string; email: string };
  try {
    payload = verifyTwoFATempToken(tempToken);
  } catch {
    return res.status(401).json({ message: "2FA sessiyasi eskirgan." });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.twoFASecret || !user.isTwoFAEnabled) {
    return res.status(400).json({ message: "2FA yoqilmagan." });
  }

  const ok = speakeasy.totp.verify({
    secret: user.twoFASecret,
    encoding: "base32",
    token: code,
    window: 1
  });

  if (!ok) {
    return res.status(401).json({ message: "2FA kod noto'g'ri." });
  }

  const token = signAccessToken(user.id, user.email);
  return res.json({
    token,
    user: toPublicUser(user)
  });
});

// ── GOOGLE SIGN-IN ──
const googleLoginSchema = z.object({
  credential: z.string().min(1)
});

router.post("/google", async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ message: "Google login sozlanmagan." });
  }

  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const { credential } = parsed.data;

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  let googlePayload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    googlePayload = ticket.getPayload();
  } catch {
    return res.status(401).json({ message: "Google token noto'g'ri." });
  }

  if (!googlePayload || !googlePayload.email) {
    return res.status(401).json({ message: "Google token noto'g'ri." });
  }

  const email = googlePayload.email.toLowerCase();
  const displayName = googlePayload.name || email.split("@")[0];

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const passwordHash = await hashPassword(crypto.randomUUID());
    user = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        isEmailVerified: true,
        avatarUrl: googlePayload.picture || null,
      }
    });
    const io = req.app.get("io");
    if (io) {
      io.emit("presence:update", {
        userId: user.id,
        isOnline: false,
        lastSeenAt: new Date().toISOString()
      });
    }
  } else if (!user.isEmailVerified) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true }
    });
    const io = req.app.get("io");
    if (io) {
      io.emit("presence:update", {
        userId: user.id,
        isOnline: false,
        lastSeenAt: new Date().toISOString()
      });
    }
  }

  const token = signAccessToken(user.id, user.email);
  return res.json({
    token,
    user: toPublicUser(user)
  });
});

// ── Desktop Google Auth (browser-based OAuth2 authorization code flow) ──
const pendingDesktopAuth = new Map<string, { token: string; user: object; expiresAt: number }>();
const pendingGoogleAuthRequests = new Map<string, { returnTo?: string; expiresAt: number }>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingDesktopAuth) {
    if (val.expiresAt < now) pendingDesktopAuth.delete(key);
  }
  for (const [key, val] of pendingGoogleAuthRequests) {
    if (val.expiresAt < now) pendingGoogleAuthRequests.delete(key);
  }
}, 60_000);

router.get("/google/desktop", (req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ message: "Google not configured." });
  }
  const state = crypto.randomUUID();
  pendingGoogleAuthRequests.set(state, {
    returnTo: getGoogleReturnToUrl(req.query.returnTo),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const redirectUri = `${env.PUBLIC_BASE_URL}/auth/google/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(env.GOOGLE_CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent("openid email profile")}&` +
    `state=${state}&` +
    `prompt=select_account`;
  return res.json({ url, state });
});

router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    return res.status(400).send("<h2>\u274c Xatolik: code yoki state topilmadi.</h2>");
  }
  const googleAuthRequest = pendingGoogleAuthRequests.get(state);
  if (!googleAuthRequest || googleAuthRequest.expiresAt < Date.now()) {
    pendingGoogleAuthRequests.delete(state);
    return res.status(400).send("<h2>\u274c Google sessiyasi eskirgan. Qayta urinib ko'ring.</h2>");
  }
  pendingGoogleAuthRequests.delete(state);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send("<h2>\u274c Google sozlanmagan.</h2>");
  }

  try {
    const redirectUri = `${env.PUBLIC_BASE_URL}/auth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json() as { id_token?: string; error?: string; error_description?: string };
    if (!tokenData.id_token) {
      console.error("[Google Auth] Token exchange failed:", JSON.stringify(tokenData));
      const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const errorMsg = escapeHtml(tokenData.error_description || tokenData.error || "Token olishda xatolik");
      const errorHint = tokenData.error ? `<p style="color:#94a3b8;font-size:14px;margin-top:12px;">Error code: ${escapeHtml(tokenData.error)}</p>` : "";
      return res.status(400).send(`<h2>\u274c ${errorMsg}</h2>${errorHint}<p style="color:#64748b;font-size:13px;">Iltimos, keyinroq qayta urinib ko'ring yoki admin bilan bog'laning.</p>`);
    }

    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: tokenData.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const googlePayload = ticket.getPayload();
    if (!googlePayload?.email) {
      return res.status(401).send("<h2>\u274c Google token noto\u2018g\u2018ri.</h2>");
    }

    const email = googlePayload.email.toLowerCase();
    const displayName = googlePayload.name || email.split("@")[0];

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const passwordHash = await hashPassword(crypto.randomUUID());
      user = await prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          isEmailVerified: true,
          avatarUrl: googlePayload.picture || null,
        }
      });
    } else if (!user.isEmailVerified) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { isEmailVerified: true }
      });
    }

    const jwt = signAccessToken(user.id, user.email);
    pendingDesktopAuth.set(state, {
      token: jwt,
      user: toPublicUser(user),
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    if (googleAuthRequest.returnTo) {
      return res.send(renderAuthSuccessPage({
        displayName: user.displayName || undefined,
        returnToUrl: buildDeepLinkUrl(googleAuthRequest.returnTo, state, "success"),
      }));
    }

    return res.send(renderAuthSuccessPage({
      displayName: user.displayName || undefined,
    }));
  } catch (err) {
    console.error("Google callback error:", err);
    return res.status(500).send("<h2>\u274c Serverda xatolik yuz berdi.</h2>");
  }
});

router.get("/google/poll", (req, res) => {
  const { state } = req.query;
  if (!state || typeof state !== "string") {
    return res.status(400).json({ message: "Missing state." });
  }
  const result = pendingDesktopAuth.get(state);
  if (!result) {
    return res.json({ ready: false });
  }
  if (result.expiresAt < Date.now()) {
    pendingDesktopAuth.delete(state);
    return res.json({ ready: false, expired: true });
  }
  pendingDesktopAuth.delete(state);
  return res.json({ ready: true, token: result.token, user: result.user });
});

router.post("/forgot-password", authLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const resetCode = generateSixDigitCode();
    const resetExpiresAt = addMinutes(new Date(), env.RESET_CODE_TTL_MINUTES);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetCode, resetExpiresAt }
    });

    await sendResetPasswordEmail(email, resetCode);
  }

  return res.json({
    message: "Agar email mavjud bo'lsa, parol tiklash kodi yuborildi."
  });
});

router.post("/reset-password", codeLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const { email, code, newPassword } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.resetCode || !user.resetExpiresAt) {
    return res.status(400).json({ message: "Kod noto'g'ri yoki muddati o'tgan." });
  }

  const isExpired = user.resetExpiresAt.getTime() < Date.now();
  if (user.resetCode !== code || isExpired) {
    return res.status(400).json({ message: "Kod noto'g'ri yoki muddati o'tgan." });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetCode: null,
      resetExpiresAt: null
    }
  });

  return res.json({ message: "Parol yangilandi." });
});

router.get("/me", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }
  });

  if (!user) {
    return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
  }

  return res.json({ user: toPublicUser(user) });
});

router.post("/2fa/setup", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }
  });
  if (!user) {
    return res.status(404).json({ message: "Foydalanuvchi topilmadi." });
  }

  const secret = speakeasy.generateSecret({
    name: `Chat Desktop (${user.email})`
  });

  if (!secret.otpauth_url) {
    return res.status(500).json({ message: "2FA secret yaratilmadi." });
  }

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFATempSecret: secret.base32 }
  });

  return res.json({
    qrDataUrl
  });
});

router.post("/2fa/enable", authRequired, async (req, res) => {
  const parsed = setup2FASchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }
  });

  if (!user || !user.twoFATempSecret) {
    return res.status(400).json({ message: "Avval 2FA setup qiling." });
  }

  const ok = speakeasy.totp.verify({
    secret: user.twoFATempSecret,
    encoding: "base32",
    token: parsed.data.code,
    window: 1
  });

  if (!ok) {
    return res.status(400).json({ message: "2FA kod noto'g'ri." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFASecret: user.twoFATempSecret,
      twoFATempSecret: null,
      isTwoFAEnabled: true
    }
  });

  return res.json({ message: "2FA yoqildi." });
});

router.post("/2fa/disable", authRequired, async (req, res) => {
  const parsed = setup2FASchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Noto'g'ri so'rov ma'lumotlari." });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }
  });

  if (!user || !user.twoFASecret || !user.isTwoFAEnabled) {
    return res.status(400).json({ message: "2FA yoqilmagan." });
  }

  const ok = speakeasy.totp.verify({
    secret: user.twoFASecret,
    encoding: "base32",
    token: parsed.data.code,
    window: 1
  });

  if (!ok) {
    return res.status(400).json({ message: "2FA kod noto'g'ri." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFASecret: null,
      twoFATempSecret: null,
      isTwoFAEnabled: false
    }
  });

  return res.json({ message: "2FA o'chirildi." });
});

// ── PROFILE UPDATE ──
const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(40).optional(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Username faqat harflar, raqamlar va _ bo'lishi mumkin").optional().nullable(),
  avatarUrl: z.string().max(500).optional().nullable()
});

router.put("/profile", authRequired, async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Noto'g'ri ma'lumotlar." });
  }

  const { displayName, username, avatarUrl } = parsed.data;
  const me = req.user!;

  // Check username uniqueness if provided
  if (username) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== me.id) {
      return res.status(409).json({ message: "Bu username allaqachon band." });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (username !== undefined) updateData.username = username;
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

  const updated = await prisma.user.update({
    where: { id: me.id },
    data: updateData
  });

  // Broadcast profile change to all connected clients
  const io = req.app.get("io");
  if (io) {
    io.emit("user:profile-updated", {
      userId: me.id,
      displayName: updated.displayName,
      username: updated.username ?? null,
      avatarUrl: updated.avatarUrl ?? null,
    });
  }

  return res.json({ user: toPublicUser(updated) });
});

export { router as authRouter };
