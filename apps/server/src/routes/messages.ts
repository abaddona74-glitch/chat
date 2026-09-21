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
    fileUrl: z.string().optional(),
    thumbUrl: z.string().optional(),
    replyToId: z.string().optional(),
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

const editMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000)
});

const deleteMessagesSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100),
  forEveryone: z.boolean().default(false)
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
          { senderId: me.id, recipientId: otherUserId, deletedForSender: false },
          { senderId: otherUserId, recipientId: me.id, deletedForRecipient: false }
        ]
      },
      include: {
        replyTo: {
          select: {
            id: true,
            senderId: true,
            text: true,
            type: true,
            fileName: true,
            fileUrl: true,
            thumbUrl: true
          }
        }
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
        thumbUrl: payload.thumbUrl,
        replyToId: payload.replyToId,
        fileName: payload.fileName,
        fileMime: payload.fileMime,
        fileSize: payload.fileSize,
        latitude: payload.latitude,
        longitude: payload.longitude,
        durationSec: payload.durationSec
      },
      include: {
        replyTo: {
          select: {
            id: true,
            senderId: true,
            text: true,
            type: true,
            fileName: true,
            fileUrl: true,
            thumbUrl: true
          }
        }
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

  // ── Edit message (sender only, within 48h) ──
  router.patch("/:id", async (req, res) => {
    const me = req.user!;
    const { id } = req.params;
    const parsed = editMessageSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Xabar matni noto'g'ri." });
    }

    const message = await prisma.message.findUnique({
      where: { id }
    });

    if (!message || message.senderId !== me.id) {
      return res.status(404).json({ message: "Xabar topilmadi yoki sizga tegishli emas." });
    }

    const hoursSinceCreation = (Date.now() - message.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 48) {
      return res.status(400).json({ message: "Xabarni faqat 48 soat ichida tahrirlash mumkin." });
    }

    const updated = await prisma.message.update({
      where: { id },
      data: {
        text: parsed.data.text,
        editedAt: new Date()
      },
      include: {
        replyTo: {
          select: {
            id: true,
            senderId: true,
            text: true,
            type: true,
            fileName: true,
            fileUrl: true,
            thumbUrl: true
          }
        }
      }
    });

    io.to(`user:${message.senderId}`).emit("message:edited", updated);
    io.to(`user:${message.recipientId}`).emit("message:edited", updated);

    return res.json({ message: updated });
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

  // ── Delete messages (for me vs for everyone) ──
  router.delete("/", async (req, res) => {
    const me = req.user!;
    const parsed = deleteMessagesSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    const { messageIds, forEveryone } = parsed.data;

    // Only delete messages that belong to the user (as sender or recipient)
    const messages = await prisma.message.findMany({
      where: {
        id: { in: messageIds },
        OR: [
          { senderId: me.id },
          { recipientId: me.id }
        ]
      },
      select: {
        id: true,
        recipientId: true,
        senderId: true,
        deletedForSender: true,
        deletedForRecipient: true
      }
    });

    if (messages.length === 0) {
      return res.status(404).json({ message: "O'chiriladigan xabar topilmadi." });
    }

    const processedIds: string[] = [];

    if (forEveryone) {
      // Only sender can delete for everyone
      const senderMessages = messages.filter((m) => m.senderId === me.id);
      if (senderMessages.length > 0) {
        const idsToDelete = senderMessages.map((m) => m.id);
        await prisma.message.deleteMany({
          where: { id: { in: idsToDelete } }
        });

        // Notify both parties
        const userIds = new Set<string>([me.id]);
        for (const m of senderMessages) {
          userIds.add(m.senderId);
          userIds.add(m.recipientId);
        }
        for (const uid of userIds) {
          io.to(`user:${uid}`).emit("messages:deleted", { messageIds: idsToDelete });
        }
        processedIds.push(...idsToDelete);
      }

      // If user selected messages where they are only the recipient, those can only be deleted for themselves
      const recipientMessages = messages.filter((m) => m.senderId !== me.id);
      if (recipientMessages.length > 0) {
        for (const m of recipientMessages) {
          if (m.deletedForSender) {
            await prisma.message.delete({ where: { id: m.id } });
          } else {
            await prisma.message.update({
              where: { id: m.id },
              data: { deletedForRecipient: true }
            });
          }
          processedIds.push(m.id);
        }
        io.to(`user:${me.id}`).emit("messages:deleted", {
          messageIds: recipientMessages.map((m) => m.id)
        });
      }
    } else {
      // Delete for ME only
      for (const m of messages) {
        const isSender = m.senderId === me.id;
        const willBeBothDeleted = isSender
          ? m.deletedForRecipient
          : m.deletedForSender;

        if (willBeBothDeleted) {
          await prisma.message.delete({ where: { id: m.id } });
        } else {
          await prisma.message.update({
            where: { id: m.id },
            data: isSender
              ? { deletedForSender: true }
              : { deletedForRecipient: true }
          });
        }
        processedIds.push(m.id);
      }

      // Notify only ME
      io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: processedIds });
    }

    return res.json({ deletedIds: processedIds });
  });

  // ── Delete single message ──
  router.delete("/:id", async (req, res) => {
    const me = req.user!;
    const { id } = req.params;
    const forEveryone = req.query.forEveryone === "true" || req.body?.forEveryone === true;

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

    if (forEveryone && message.senderId === me.id) {
      await prisma.message.delete({ where: { id } });

      const userIds = new Set([message.senderId, message.recipientId]);
      for (const uid of userIds) {
        io.to(`user:${uid}`).emit("messages:deleted", { messageIds: [id] });
      }
    } else {
      const isSender = message.senderId === me.id;
      const willBeBothDeleted = isSender
        ? message.deletedForRecipient
        : message.deletedForSender;

      if (willBeBothDeleted) {
        await prisma.message.delete({ where: { id } });
      } else {
        await prisma.message.update({
          where: { id },
          data: isSender
            ? { deletedForSender: true }
            : { deletedForRecipient: true }
        });
      }

      io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: [id] });
    }

    return res.json({ deletedIds: [id] });
  });

  // ── Clear chat history ──
  router.delete("/clear/:otherUserId", async (req, res) => {
    const me = req.user!;
    const { otherUserId } = req.params;
    const forEveryone = req.query.forEveryone === "true" || req.body?.forEveryone === true;

    if (forEveryone) {
      // 1. Sent by ME -> delete completely
      const myMessages = await prisma.message.findMany({
        where: { senderId: me.id, recipientId: otherUserId },
        select: { id: true }
      });
      const myIds = myMessages.map((m) => m.id);
      if (myIds.length > 0) {
        await prisma.message.deleteMany({ where: { id: { in: myIds } } });
        io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: myIds });
        io.to(`user:${otherUserId}`).emit("messages:deleted", { messageIds: myIds });
      }

      // 2. Sent by OTHER -> delete for ME
      const otherMessages = await prisma.message.findMany({
        where: { senderId: otherUserId, recipientId: me.id, deletedForRecipient: false },
        select: { id: true, deletedForSender: true }
      });
      const otherIds: string[] = [];
      for (const m of otherMessages) {
        if (m.deletedForSender) {
          await prisma.message.delete({ where: { id: m.id } });
        } else {
          await prisma.message.update({ where: { id: m.id }, data: { deletedForRecipient: true } });
        }
        otherIds.push(m.id);
      }
      if (otherIds.length > 0) {
        io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: otherIds });
      }

      return res.json({ deletedIds: [...myIds, ...otherIds] });
    } else {
      // Clear for ME only
      // 1. Where I am sender
      const myMessages = await prisma.message.findMany({
        where: { senderId: me.id, recipientId: otherUserId, deletedForSender: false },
        select: { id: true, deletedForRecipient: true }
      });
      const deletedIds: string[] = [];
      for (const m of myMessages) {
        if (m.deletedForRecipient) {
          await prisma.message.delete({ where: { id: m.id } });
        } else {
          await prisma.message.update({ where: { id: m.id }, data: { deletedForSender: true } });
        }
        deletedIds.push(m.id);
      }

      // 2. Where I am recipient
      const otherMessages = await prisma.message.findMany({
        where: { senderId: otherUserId, recipientId: me.id, deletedForRecipient: false },
        select: { id: true, deletedForSender: true }
      });
      for (const m of otherMessages) {
        if (m.deletedForSender) {
          await prisma.message.delete({ where: { id: m.id } });
        } else {
          await prisma.message.update({ where: { id: m.id }, data: { deletedForRecipient: true } });
        }
        deletedIds.push(m.id);
      }

      io.to(`user:${me.id}`).emit("messages:deleted", { messageIds: deletedIds });
      return res.json({ deletedIds });
    }
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
