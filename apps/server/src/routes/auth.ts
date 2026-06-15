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

const router = Router();

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
  lastSeenAt: Date | null;
}) {
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

function renderGoogleMobileCallbackPage(returnToUrl: string) {
  const safeReturnToUrl = JSON.stringify(returnToUrl);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muvaffaqiyatli!</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#111827;color:#f9fafb;padding:24px;}
.card{text-align:center;padding:32px;border-radius:20px;background:#1f2937;box-shadow:0 20px 40px rgba(0,0,0,0.35);max-width:360px;width:100%;}
h1{color:#4ade80;margin:0 0 10px;}p{color:#cbd5e1;line-height:1.5;margin:0 0 16px;}button{border:0;border-radius:12px;padding:14px 18px;font-weight:600;background:#2563eb;color:#fff;cursor:pointer;width:100%;}</style></head>
<body><div class="card"><h1>\u2705 Muvaffaqiyatli!</h1><p>Ilovaga qaytish uchun sahifa avtomatik yo'naltiriladi.</p><button id="return-to-app" type="button">App ga qaytish</button></div>
<script>
const returnToUrl = ${safeReturnToUrl};
const goBackToApp = () => { window.location.replace(returnToUrl); };
document.getElementById("return-to-app")?.addEventListener("click", goBackToApp);
setTimeout(goBackToApp, 150);
</script></body></html>`;
}

router.post("/register", async (req, res) => {
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

router.post("/verify-email", async (req, res) => {
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

  const token = signAccessToken(updated.id, updated.email);

  return res.json({
    token,
    user: toPublicUser(updated)
  });
});

router.post("/login", async (req, res) => {
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

router.post("/login/2fa", async (req, res) => {
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
  } else if (!user.isEmailVerified) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true }
    });
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
      return res.send(renderGoogleMobileCallbackPage(buildDeepLinkUrl(googleAuthRequest.returnTo, state, "success")));
    }

    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Muvaffaqiyatli!</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;}
.card{text-align:center;padding:40px;border-radius:16px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3);}
h1{color:#4ade80;margin-bottom:8px;}p{color:#94a3b8;}</style></head>
<body><div class="card"><h1>\u2705 Muvaffaqiyatli!</h1><p>Desktop ilovaga qayting. Bu oynani yopishingiz mumkin.</p></div></body></html>`);
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

router.post("/forgot-password", async (req, res) => {
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

router.post("/reset-password", async (req, res) => {
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
