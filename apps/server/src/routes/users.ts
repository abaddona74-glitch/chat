import { Router } from "express";
import { z } from "zod";
import { isUserOnline } from "../lib/presence.js";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

const pushTokenSchema = z.object({
  token: z.string().min(20).max(2048),
  platform: z.string().trim().min(1).max(32).default("android")
});

const hexColorRegex = /^#([\da-fA-F]{6})$/;
const themeColorSchema = z.string().regex(hexColorRegex).transform((v) => v.toLowerCase());

const createThemeProfileSchema = z.object({
  name: z.string().trim().min(2).max(60),
  accentColor: themeColorSchema,
  layoutColor: themeColorSchema,
  textColor: themeColorSchema,
  backgroundColor: themeColorSchema,
  inputColor: themeColorSchema,
  isPublic: z.boolean().optional().default(true),
});

router.get("/", authRequired, async (req, res) => {
  const me = req.user!;
  const users = await prisma.user.findMany({
    where: {
      id: { not: me.id },
      isEmailVerified: true
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      username: true,
      avatarUrl: true,
      statusText: true,
      statusEmoji: true,
      lastSeenAt: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return res.json({
    users: users.map((user) => ({
      ...user,
      isOnline: isUserOnline(user.id)
    }))
  });
});

// ── UPDATE STATUS ──
router.put("/status", authRequired, async (req, res) => {
  const { statusText, statusEmoji } = req.body;
  const me = req.user!;

  const updated = await prisma.user.update({
    where: { id: me.id },
    data: {
      statusText: typeof statusText === "string" ? statusText.slice(0, 100) : null,
      statusEmoji: typeof statusEmoji === "string" ? statusEmoji.slice(0, 8) : null
    }
  });

  return res.json({
    statusText: updated.statusText,
    statusEmoji: updated.statusEmoji
  });
});

router.post("/push-token", authRequired, async (req, res) => {
  const me = req.user!;
  const parsed = pushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Push token formati noto'g'ri." });
  }

  const { token, platform } = parsed.data;
  await prisma.userDeviceToken.upsert({
    where: { token },
    create: {
      userId: me.id,
      token,
      platform,
      lastSeenAt: new Date(),
    },
    update: {
      userId: me.id,
      platform,
      lastSeenAt: new Date(),
    },
  });

  return res.json({ ok: true });
});

router.delete("/push-token", authRequired, async (req, res) => {
  const me = req.user!;
  const parsed = pushTokenSchema.pick({ token: true }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Push token formati noto'g'ri." });
  }

  await prisma.userDeviceToken.deleteMany({
    where: {
      userId: me.id,
      token: parsed.data.token,
    },
  });

  return res.json({ ok: true });
});

router.get("/theme-profiles", authRequired, async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 80;

  const profiles = await prisma.themeProfile.findMany({
    where: { isPublic: true },
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          displayName: true,
          username: true,
        },
      },
    },
  });

  return res.json({ profiles });
});

router.post("/theme-profiles", authRequired, async (req, res) => {
  const me = req.user!;
  const parsed = createThemeProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Theme profile formati noto'g'ri." });
  }

  const data = parsed.data;
  const created = await prisma.themeProfile.create({
    data: {
      name: data.name,
      accentColor: data.accentColor,
      layoutColor: data.layoutColor,
      textColor: data.textColor,
      backgroundColor: data.backgroundColor,
      inputColor: data.inputColor,
      isPublic: data.isPublic,
      authorId: me.id,
    },
    include: {
      author: {
        select: {
          id: true,
          displayName: true,
          username: true,
        },
      },
    },
  });

  return res.status(201).json({ profile: created });
});

export { router as usersRouter };
