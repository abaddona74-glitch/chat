import { MessageType } from "@prisma/client";
import { Router } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { isUserOnline } from "../lib/presence.js";
import { buildPushPreview, sendPushToUser } from "../lib/push.js";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const getMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const createMessageSchema = z
  .object({
    recipientId: z.string().min(1),
    type: z.nativeEnum(MessageType).default(MessageType.TEXT),
    text: z.string().trim().min(1).max(4000).optional(),
    fileUrl: z.string().url().optional(),
    fileName: z.string().max(255).optional(),
    fileMime: z.string().max(120).optional(),
    fileSize: z.number().int().positive().max(200 * 1024 * 1024).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    durationSec: z.number().int().positive().max(36000).optional()
  })
  .superRefine((value, ctx) => {
    if (value.type === MessageType.TEXT && !value.text) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TEXT uchun text kerak." });
    }
    if (value.type === MessageType.FILE && !value.fileUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "FILE uchun fileUrl kerak." });
    }
    if (value.type === MessageType.VOICE && !value.fileUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VOICE uchun fileUrl kerak." });
    }
    if (
      value.type === MessageType.LOCATION &&
      (typeof value.latitude !== "number" || typeof value.longitude !== "number")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LOCATION uchun latitude va longitude kerak."
      });
    }
  });

const deleteMessagesSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100)
});

const forwardMessagesSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100),
  recipientId: z.string().min(1)
});

export function createMessagesRouter(io: Server) {
  const router = Router();
  router.use(authRequired);

  router.get("/:otherUserId", async (req, res) => {
    const me = req.user!;
    const { otherUserId } = req.params;
    const parsedQuery = getMessagesQuerySchema.safeParse(req.query);

    if (!parsedQuery.success) {
      return res.status(400).json({ message: "Query noto'g'ri." });
    }

    const { cursor, limit } = parsedQuery.data;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: me.id, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: me.id }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : null;

    return res.json({
      messages: [...messages].reverse(),
      nextCursor
    });
  });

  router.post("/", async (req, res) => {
    const me = req.user!;
    const parsed = createMessageSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Xabar formati noto'g'ri." });
    }

    const payload = parsed.data;
    const recipient = await prisma.user.findFirst({
      where: {
        id: payload.recipientId,
        isEmailVerified: true
      }
    });

    if (!recipient) {
      return res.status(404).json({ message: "Qabul qiluvchi topilmadi." });
    }

    const message = await prisma.message.create({
      data: {
        senderId: me.id,
        recipientId: payload.recipientId,
        type: payload.type,
        text: payload.text,
        fileUrl: payload.fileUrl,
        fileName: payload.fileName,
        fileMime: payload.fileMime,
        fileSize: payload.fileSize,
        latitude: payload.latitude,
        longitude: payload.longitude,
        durationSec: payload.durationSec
      }
    });

    io.to(`user:${me.id}`).emit("message:new", message);
    io.to(`user:${payload.recipientId}`).emit("message:new", message);

    if (!isUserOnline(payload.recipientId)) {
      await sendPushToUser(payload.recipientId, {
        title: me.email,
        body: buildPushPreview(message),
        data: {
          kind: "message",
          senderId: me.id,
        },
      });
    }

    return res.status(201).json({ message });
  });

  // ── Mark messages as read ──
  router.post("/read/:senderId", async (req, res) => {
    const me = req.user!;
    const { senderId } = req.params;

    const now = new Date();
    const result = await prisma.message.updateMany({
      where: {
        senderId,
        recipientId: me.id,
        readAt: null
      },
      data: { readAt: now }
    });

    if (result.count > 0) {
      // Notify the sender that their messages have been read
      io.to(`user:${senderId}`).emit("message:read", {
        readByUserId: me.id,
        readAt: now.toISOString()
      });
    }

    return res.json({ readCount: result.count });
  });

  // ── Delete messages (sender can delete own messages) ──
  router.delete("/", async (req, res) => {
    const me = req.user!;
    const parsed = deleteMessagesSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    const { messageIds } = parsed.data;

    // Only delete messages that belong to the user (as sender or recipient)
    const messagesToDelete = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
        OR: [
          { senderId: me.id },
          { recipientId: me.id }
        ]
      },
      select: { id: true, recipientId: true, senderId: true }
    });

    if (messagesToDelete.length === 0) {
      return res.status(404).json({ message: "O'chiriladigan xabar topilmadi." });
    }

    const deletedIds = messagesToDelete.map((m) => m.id);

    await prisma.message.deleteMany({
      where: { id: { in: deletedIds } }
    });

    // Notify all involved parties
    const userIds = new Set<string>([me.id]);
    for (const m of messagesToDelete) {
      userIds.add(m.senderId);
      userIds.add(m.recipientId);
    }
    
    for (const uid of userIds) {
      io.to(`user:${uid}`).emit("messages:deleted", { messageIds: deletedIds });
    }

    return res.json({ deletedIds });
  });

  // ── Delete single message ──
  router.delete("/:id", async (req, res) => {
    const me = req.user!;
    const { id } = req.params;

    const message = await prisma.message.findFirst({
      where: {
        id,
        OR: [
          { senderId: me.id },
          { recipientId: me.id }
        ]
      }
    });

    if (!message) {
      return res.status(404).json({ message: "O'chiriladigan xabar topilmadi." });
    }

    await prisma.message.delete({ where: { id } });

    const userIds = new Set([message.senderId, message.recipientId]);
    for (const uid of userIds) {
      io.to(`user:${uid}`).emit("messages:deleted", { messageIds: [id] });
    }

    return res.json({ deletedIds: [id] });
  });

  // ── Clear chat history ──
  router.delete("/clear/:otherUserId", async (req, res) => {
    const me = req.user!;
    const { otherUserId } = req.params;

    const messagesToDelete = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: me.id, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: me.id }
        ]
      },
      select: { id: true }
    });

    if (messagesToDelete.length === 0) {
      return res.json({ deletedIds: [] });
    }

    const deletedIds = messagesToDelete.map(m => m.id);

    await prisma.message.deleteMany({
      where: { id: { in: deletedIds } }
    });

    io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: deletedIds });
    io.to(`user:${otherUserId}`).emit("messages:deleted", { messageIds: deletedIds });

    return res.json({ deletedIds });
  });

  // ── Forward messages to another user ──
  router.post("/forward", async (req, res) => {
    const me = req.user!;
    const parsed = forwardMessagesSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    const { messageIds, recipientId } = parsed.data;

    const recipient = await prisma.user.findFirst({
      where: { id: recipientId, isEmailVerified: true }
    });

    if (!recipient) {
      return res.status(404).json({ message: "Qabul qiluvchi topilmadi." });
    }

    // Get original messages (user must be sender or recipient)
    const originals = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
        OR: [
          { senderId: me.id },
          { recipientId: me.id }
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    if (originals.length === 0) {
      return res.status(404).json({ message: "Forward qilinadigan xabar topilmadi." });
    }

    // Create forwarded copies
    const forwarded = [];
    for (const orig of originals) {
      const msg = await prisma.message.create({
        data: {
          senderId: me.id,
          recipientId,
          type: orig.type,
          text: orig.text ? `⤳ ${orig.text}` : orig.text,
          fileUrl: orig.fileUrl,
          fileName: orig.fileName,
          fileMime: orig.fileMime,
          fileSize: orig.fileSize,
          latitude: orig.latitude,
          longitude: orig.longitude,
          durationSec: orig.durationSec
        }
      });
      forwarded.push(msg);

      io.to(`user:${me.id}`).emit("message:new", msg);
      io.to(`user:${recipientId}`).emit("message:new", msg);
    }

    return res.status(201).json({ messages: forwarded });
  });

  return router;
}
