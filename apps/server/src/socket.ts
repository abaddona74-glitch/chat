import { MessageType } from "@prisma/client";
import { Server } from "socket.io";
import { z } from "zod";
import { addUserSocket, isUserOnline, removeUserSocket } from "./lib/presence.js";
import { pushEventWithNames, trackOnlineUser, untrackOnlineUser } from "./lib/monitor.js";
import { buildPushPreview, sendPushToUser } from "./lib/push.js";
import { prisma } from "./lib/prisma.js";
import { verifyAccessToken } from "./lib/auth.js";

const sendMessageSchema = z
  .object({
    recipientId: z.string().min(1),
    type: z.nativeEnum(MessageType).default(MessageType.TEXT),
    text: z.string().trim().min(1).max(4000).optional(),
    fileUrl: z.string().min(1).optional(),
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

const groupMessageSchema = z
  .object({
    groupId: z.string().min(1),
    type: z.nativeEnum(MessageType).default(MessageType.TEXT),
    text: z.string().trim().min(1).max(4000).optional(),
    fileUrl: z.string().min(1).optional(),
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

const recipientSchema = z.object({
  recipientId: z.string().min(1)
});

const groupMessageSeenSchema = z.object({
  groupId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).max(200).optional()
});

type AckFn = (payload: { ok: boolean; message?: unknown; error?: string }) => void;
type CallSDP = Record<string, unknown>;
type CallCandidate = Record<string, unknown>;
type DirectCallEndReason =
  | "ended"
  | "declined"
  | "busy"
  | "window-unload"
  | "peer-disconnected"
  | "unknown";

type DirectCallSession = {
  callerId: string;
  calleeId: string;
  callerSocketId: string;
  calleeSocketId?: string;
  startedAt: number;
  answeredAt?: number;
};

const directCallSessions = new Map<string, DirectCallSession>();
const groupCallMembershipBySocket = new Map<string, Set<string>>();
const groupCallMemberSocketCounts = new Map<string, number>();
const groupCallUsersByGroup = new Map<string, Set<string>>();

function getGroupCallMemberKey(groupId: string, userId: string) {
  return `${groupId}:${userId}`;
}

function addGroupCallMember(groupId: string, userId: string) {
  const key = getGroupCallMemberKey(groupId, userId);
  const nextCount = (groupCallMemberSocketCounts.get(key) ?? 0) + 1;
  groupCallMemberSocketCounts.set(key, nextCount);

  const users = groupCallUsersByGroup.get(groupId) ?? new Set<string>();
  const wasPresent = users.has(userId);
  users.add(userId);
  groupCallUsersByGroup.set(groupId, users);

  return !wasPresent;
}

function removeGroupCallMember(groupId: string, userId: string) {
  const key = getGroupCallMemberKey(groupId, userId);
  const currentCount = groupCallMemberSocketCounts.get(key) ?? 0;
  const nextCount = currentCount - 1;

  if (nextCount > 0) {
    groupCallMemberSocketCounts.set(key, nextCount);
    return false;
  }

  groupCallMemberSocketCounts.delete(key);
  const users = groupCallUsersByGroup.get(groupId);
  if (users) {
    users.delete(userId);
    if (users.size === 0) {
      groupCallUsersByGroup.delete(groupId);
    } else {
      groupCallUsersByGroup.set(groupId, users);
    }
  }

  return true;
}

function clearGroupCall(groupId: string) {
  groupCallUsersByGroup.delete(groupId);
  for (const key of [...groupCallMemberSocketCounts.keys()]) {
    if (key.startsWith(`${groupId}:`)) {
      groupCallMemberSocketCounts.delete(key);
    }
  }
  for (const [socketId, joined] of groupCallMembershipBySocket.entries()) {
    if (!joined.has(groupId)) continue;
    joined.delete(groupId);
    if (joined.size === 0) {
      groupCallMembershipBySocket.delete(socketId);
    } else {
      groupCallMembershipBySocket.set(socketId, joined);
    }
  }
}

function getDirectCallSessionKey(callerId: string, calleeId: string) {
  return `${callerId}:${calleeId}`;
}

function findDirectCallSessionsByUser(userId: string) {
  const sessions: DirectCallSession[] = [];
  for (const session of directCallSessions.values()) {
    if (session.callerId === userId || session.calleeId === userId) {
      sessions.push(session);
    }
  }
  return sessions;
}

function findDirectCallSessionsBySocket(socketId: string) {
  const sessions: DirectCallSession[] = [];
  for (const session of directCallSessions.values()) {
    if (session.callerSocketId === socketId || session.calleeSocketId === socketId) {
      sessions.push(session);
    }
  }
  return sessions;
}

function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;

  if (hh > 0) {
    return `${hh}h ${mm}m`;
  }
  if (mm > 0) {
    return `${mm}m ${ss}s`;
  }
  return `${ss}s`;
}

async function createCallLogMessage(io: Server, callerId: string, calleeId: string, text: string) {
  const message = await prisma.message.create({
    data: {
      senderId: callerId,
      recipientId: calleeId,
      type: MessageType.TEXT,
      text,
    },
  });

  io.to(`user:${callerId}`).emit("message:new", message);
  io.to(`user:${calleeId}`).emit("message:new", message);
}

async function closeDirectCallSession(
  io: Server,
  session: DirectCallSession,
  endedByUserId: string,
  reason: DirectCallEndReason = "ended"
) {
  const isAnswered = Boolean(session.answeredAt);
  if (isAnswered) {
    const durationSec = Math.round((Date.now() - (session.answeredAt ?? session.startedAt)) / 1000);
    const summary = `📞 Call ended • ${formatDuration(durationSec)}`;
    await createCallLogMessage(io, session.callerId, session.calleeId, summary).catch(() => undefined);
  } else {
    await createCallLogMessage(io, session.callerId, session.calleeId, "📞 Missed call").catch(() => undefined);
  }

  const peerId = session.callerId === endedByUserId ? session.calleeId : session.callerId;
  io.to(`user:${peerId}`).emit("call:end", {
    fromUserId: endedByUserId,
    reason
  });

  directCallSessions.delete(getDirectCallSessionKey(session.callerId, session.calleeId));
}

export function registerSocketHandlers(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== "string") {
      return next(new Error("Auth token berilmagan"));
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.userId;
      socket.data.email = payload.email;
      socket.data.clientType = socket.handshake.auth?.clientType || "web";
      socket.data.clientVersion = socket.handshake.auth?.clientVersion || null;
      next();
    } catch {
      next(new Error("Auth token noto'g'ri"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = String(socket.data.userId);
    const clientType = String(socket.data.clientType || "web");
    const clientVersion = socket.data.clientVersion ? String(socket.data.clientVersion) : null;
    console.info("[Socket] connect", { userId, socketId: socket.id, clientType });
    addUserSocket(userId, socket.id);
    socket.join(`user:${userId}`);
    trackOnlineUser({ userId, socketId: socket.id, clientType, clientVersion, connectedAt: Date.now() });
    void pushEventWithNames("connect", { userId, clientType, clientVersion });

    await prisma.user
      .update({
        where: { id: userId },
        data: { lastSeenAt: new Date() }
      })
      .catch(() => undefined);

    io.emit("presence:update", {
      userId,
      isOnline: true,
      lastSeenAt: new Date().toISOString(),
      clientType: socket.data.clientType || "web",
      clientVersion: socket.data.clientVersion || null
    });

    socket.on("typing:start", (payload: unknown) => {
      const parsed = recipientSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      io.to(`user:${parsed.data.recipientId}`).emit("typing:start", {
        fromUserId: userId
      });
    });

    socket.on("typing:stop", (payload: unknown) => {
      const parsed = recipientSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      io.to(`user:${parsed.data.recipientId}`).emit("typing:stop", {
        fromUserId: userId
      });
    });

    socket.on("status:update", async (payload: { statusText?: string | null; statusEmoji?: string | null }) => {
      const text = typeof payload?.statusText === "string" ? payload.statusText.slice(0, 100) : null;
      const emoji = typeof payload?.statusEmoji === "string" ? payload.statusEmoji.slice(0, 8) : null;
      await prisma.user.update({
        where: { id: userId },
        data: { statusText: text, statusEmoji: emoji }
      }).catch(() => undefined);
      io.emit("status:changed", { userId, statusText: text, statusEmoji: emoji });
    });

    socket.on("message:send", async (rawPayload: unknown, ack?: AckFn) => {
      const parsed = sendMessageSchema.safeParse(rawPayload);
      if (!parsed.success) {
        ack?.({ ok: false, error: "Xabar formati noto'g'ri." });
        return;
      }

      const payload = parsed.data;
      const recipient = await prisma.user.findFirst({
        where: {
          id: payload.recipientId,
          isEmailVerified: true
        },
        select: { id: true }
      });

      if (!recipient) {
        ack?.({ ok: false, error: "Qabul qiluvchi topilmadi." });
        return;
      }

      const message = await prisma.message.create({
        data: {
          senderId: userId,
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

      io.to(`user:${userId}`).emit("message:new", message);
      io.to(`user:${payload.recipientId}`).emit("message:new", message);
      void pushEventWithNames("message", {
        fromUserId: userId,
        toUserId: payload.recipientId,
        messageType: payload.type,
        preview: payload.type === MessageType.TEXT ? String(payload.text ?? "").slice(0, 80) : null
      });

      if (!isUserOnline(payload.recipientId)) {
        const sender = await prisma.user.findUnique({
          where: { id: userId },
          select: { displayName: true },
        });
        await sendPushToUser(payload.recipientId, {
          title: sender?.displayName ?? "Yangi xabar",
          body: buildPushPreview(message),
          data: {
            kind: "message",
            senderId: userId,
          },
        });
      }

      ack?.({ ok: true, message });
    });

    // ── EDIT MESSAGE REALTIME ──
    socket.on("message:edit", async (payload: { messageId: string; text: string }, ack?: AckFn) => {
      if (!payload?.messageId || typeof payload.text !== "string" || !payload.text.trim()) {
        ack?.({ ok: false, error: "messageId va text kerak." });
        return;
      }

      const message = await prisma.message.findUnique({
        where: { id: payload.messageId }
      });

      if (!message || message.senderId !== userId) {
        ack?.({ ok: false, error: "Xabar topilmadi yoki sizga tegishli emas." });
        return;
      }

      const hoursSince = (Date.now() - message.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince > 48) {
        ack?.({ ok: false, error: "Xabarni faqat 48 soat ichida tahrirlash mumkin." });
        return;
      }

      const updated = await prisma.message.update({
        where: { id: payload.messageId },
        data: {
          text: payload.text.trim(),
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

      ack?.({ ok: true, message: updated });
    });

    // ── READ RECEIPTS ──
    socket.on("message:read", async (payload: { senderId: string }, ack?: AckFn) => {
      if (!payload?.senderId || typeof payload.senderId !== "string") {
        ack?.({ ok: false, error: "senderId kerak." });
        return;
      }

      const now = new Date();
      const result = await prisma.message.updateMany({
        where: {
          senderId: payload.senderId,
          recipientId: userId,
          readAt: null
        },
        data: { readAt: now }
      });

      if (result.count > 0) {
        // Notify the sender that their messages have been read
        io.to(`user:${payload.senderId}`).emit("message:read", {
          readByUserId: userId,
          readAt: now.toISOString()
        });
        // Also notify the reader so their UI updates
        io.to(`user:${userId}`).emit("message:read", {
          readByUserId: userId,
          readAt: now.toISOString(),
          fromSenderId: payload.senderId
        });
      }

      ack?.({ ok: true });
    });

    // ── READ RECEIPT WAS SEEN BY SENDER (3rd checkmark) ──
    socket.on("message:seen", async (payload: { recipientId: string }, ack?: AckFn) => {
      if (!payload?.recipientId || typeof payload.recipientId !== "string") {
        ack?.({ ok: false, error: "recipientId kerak." });
        return;
      }

      const now = new Date();
      const result = await prisma.message.updateMany({
        where: {
          senderId: userId,
          recipientId: payload.recipientId,
          readAt: { not: null },
          seenAt: null,
        },
        data: { seenAt: now },
      });

      if (result.count > 0) {
        const eventPayload = {
          senderId: userId,
          recipientId: payload.recipientId,
          seenAt: now.toISOString(),
        };
        io.to(`user:${userId}`).emit("message:seen", eventPayload);
        io.to(`user:${payload.recipientId}`).emit("message:seen", eventPayload);
      }

      ack?.({ ok: true });
    });

    // ── MESSAGE REACTIONS ──
    socket.on("message:react", (payload: { messageId: string; recipientId?: string; emoji: string }) => {
      if (!payload?.messageId || !payload?.emoji) return;
      io.to(`user:${userId}`).emit("message:react", {
        messageId: payload.messageId,
        userId,
        emoji: payload.emoji
      });
      if (payload.recipientId) {
        io.to(`user:${payload.recipientId}`).emit("message:react", {
          messageId: payload.messageId,
          userId,
          emoji: payload.emoji
        });
      }
    });

    socket.on("group:message:react", async (payload: { messageId: string; groupId: string; emoji: string }) => {
      if (!payload?.messageId || !payload?.groupId || !payload?.emoji) return;
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:message:react", {
          groupId: payload.groupId,
          messageId: payload.messageId,
          userId,
          emoji: payload.emoji
        });
      }
    });

    socket.on("call:offer", (payload: { recipientId: string; sdp: CallSDP }) => {
      if (!payload?.recipientId || !payload?.sdp) {
        return;
      }

      // Drop stale direct sessions for this pair before starting a new one.
      directCallSessions.delete(getDirectCallSessionKey(userId, payload.recipientId));
      directCallSessions.delete(getDirectCallSessionKey(payload.recipientId, userId));

      const sessionKey = getDirectCallSessionKey(userId, payload.recipientId);
      directCallSessions.set(sessionKey, {
        callerId: userId,
        calleeId: payload.recipientId,
        callerSocketId: socket.id,
        startedAt: Date.now(),
      });

      const recipientRoom = io.sockets.adapter.rooms.get(`user:${payload.recipientId}`);
      const recipientSize = recipientRoom?.size ?? 0;
      const audioMline = ((payload.sdp as any)?.sdp || "").split("\n").find((l: string) => l.startsWith("m=audio"));
      console.info("[Call] call:offer", {
        fromUserId: userId,
        toUserId: payload.recipientId,
        recipientOnline: recipientSize > 0,
        recipientSockets: recipientSize,
        sdpType: (payload.sdp as any)?.type,
        audioMline: audioMline?.trim(),
      });
      void pushEventWithNames("call_offer", { fromUserId: userId, toUserId: payload.recipientId });

      io.to(`user:${payload.recipientId}`).emit("call:offer", {
        fromUserId: userId,
        sdp: payload.sdp
      });
    });

    socket.on("call:answer", (payload: { recipientId: string; sdp: CallSDP }) => {
      if (!payload?.recipientId || !payload?.sdp) {
        return;
      }

      const sessionKey = getDirectCallSessionKey(payload.recipientId, userId);
      const existing = directCallSessions.get(sessionKey);
      if (existing) {
        existing.answeredAt = Date.now();
        existing.calleeSocketId = socket.id;
        directCallSessions.set(sessionKey, existing);
      }

      console.info("[Call] call:answer", {
        fromUserId: userId,
        toUserId: payload.recipientId,
        sessionFound: Boolean(existing),
        sdpType: (payload.sdp as any)?.type,
      });
      void pushEventWithNames("call_answer", { fromUserId: userId, toUserId: payload.recipientId });

      io.to(`user:${payload.recipientId}`).emit("call:answer", {
        fromUserId: userId,
        sdp: payload.sdp
      });
    });

    socket.on(
      "call:ice-candidate",
      (payload: { recipientId: string; candidate: CallCandidate }) => {
        if (!payload?.recipientId || !payload?.candidate) {
          return;
        }
        const c = payload.candidate as any;
        const candStr: string = c?.candidate || "";
        // Quick parse: typ host/srflx/relay
        const typMatch = candStr.match(/ typ (\w+)/);
        const protoMatch = candStr.match(/^candidate:\S+ \d+ (\w+)/);
        const iceKind = typMatch?.[1] ?? "unknown";
        console.info("[Call] call:ice-candidate", {
          fromUserId: userId,
          toUserId: payload.recipientId,
          typ: typMatch?.[1],
          proto: protoMatch?.[1],
        });
        void pushEventWithNames("ice", {
          fromUserId: userId,
          toUserId: payload.recipientId,
          iceKind,
          proto: protoMatch?.[1] ?? null
        });
        io.to(`user:${payload.recipientId}`).emit("call:ice-candidate", {
          fromUserId: userId,
          candidate: payload.candidate
        });
      }
    );

    socket.on("call:renegotiate", (payload: { recipientId: string; type: string; sdp: CallSDP }) => {
      if (!payload?.recipientId || !payload?.type || !payload?.sdp) {
        return;
      }
      io.to(`user:${payload.recipientId}`).emit("call:renegotiate", {
        fromUserId: userId,
        type: payload.type,
        sdp: payload.sdp
      });
    });

    socket.on("call:end", async (payload: { recipientId: string; reason?: DirectCallEndReason }) => {
      if (!payload?.recipientId) {
        return;
      }

      const reason = payload.reason ?? "ended";

      const directKey = getDirectCallSessionKey(userId, payload.recipientId);
      const reverseKey = getDirectCallSessionKey(payload.recipientId, userId);
      const session = directCallSessions.get(directKey) ?? directCallSessions.get(reverseKey);
      console.info("[Call] call:end", {
        fromUserId: userId,
        toUserId: payload.recipientId,
        reason,
        hasSession: Boolean(session),
      });
      void pushEventWithNames("call_end", { fromUserId: userId, toUserId: payload.recipientId, reason });

      if (session) {
        await closeDirectCallSession(io, session, userId, reason);
        return;
      }

      io.to(`user:${payload.recipientId}`).emit("call:end", {
        fromUserId: userId,
        reason
      });
    });

    // ── GROUP MESSAGE ──
    socket.on("group:message:send", async (rawPayload: unknown, ack?: AckFn) => {
      const parsed = groupMessageSchema.safeParse(rawPayload);
      if (!parsed.success) {
        ack?.({ ok: false, error: "Xabar formati noto'g'ri." });
        return;
      }

      const payload = parsed.data;

      // Check membership
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: payload.groupId, userId } }
      });

      if (!membership) {
        ack?.({ ok: false, error: "Siz bu guruhda emassiz." });
        return;
      }

      const message = await prisma.groupMessage.create({
        data: {
          groupId: payload.groupId,
          senderId: userId,
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
          },
          sender: {
            select: { id: true, email: true, displayName: true }
          },
          seenBy: {
            include: {
              user: {
                select: { id: true, displayName: true, username: true, avatarUrl: true }
              }
            },
            orderBy: { seenAt: "asc" }
          }
        }
      });

      // Update group timestamp
      await prisma.group.update({
        where: { id: payload.groupId },
        data: { updatedAt: new Date() }
      }).catch(() => undefined);

      // Notify all group members
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true }
      });
      const group = await prisma.group.findUnique({
        where: { id: payload.groupId },
        select: { name: true },
      });

      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:message:new", message);
        if (m.userId !== userId && !isUserOnline(m.userId)) {
          await sendPushToUser(m.userId, {
            title: `Guruh: ${group?.name ?? "Chat"}`,
            body: buildPushPreview(message),
            data: {
              kind: "group-message",
              groupId: payload.groupId,
              senderId: userId,
            },
          });
        }
      }
      void pushEventWithNames("group_message", {
        fromUserId: userId,
        groupId: payload.groupId,
        groupName: group?.name ?? null,
        messageType: payload.type,
        preview: payload.type === MessageType.TEXT ? String(payload.text ?? "").slice(0, 80) : null
      });

      ack?.({ ok: true, message });
    });

    socket.on("group:message:seen", async (rawPayload: unknown, ack?: AckFn) => {
      const parsed = groupMessageSeenSchema.safeParse(rawPayload);
      if (!parsed.success) {
        ack?.({ ok: false, error: "groupId yoki messageIds noto'g'ri." });
        return;
      }

      const payload = parsed.data;

      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: payload.groupId, userId } },
        select: { userId: true }
      });

      if (!membership) {
        ack?.({ ok: false, error: "Siz bu guruhda emassiz." });
        return;
      }

      const requestedIds = (payload.messageIds ?? []).filter((id) => typeof id === "string" && id.trim());
      if (requestedIds.length === 0) {
        ack?.({ ok: true });
        return;
      }

      const messagesToMark = await prisma.groupMessage.findMany({
        where: {
          id: { in: requestedIds },
          groupId: payload.groupId,
          senderId: { not: userId }
        },
        select: { id: true }
      });

      const targetMessageIds = messagesToMark.map((m) => m.id);
      if (targetMessageIds.length === 0) {
        ack?.({ ok: true });
        return;
      }

      const now = new Date();
      await prisma.groupMessageSeen.createMany({
        data: targetMessageIds.map((messageId) => ({
          messageId,
          userId,
          seenAt: now
        })),
        skipDuplicates: true
      });

      const seenRows = await prisma.groupMessageSeen.findMany({
        where: {
          messageId: { in: targetMessageIds },
          userId
        },
        include: {
          user: {
            select: { id: true, displayName: true, username: true, avatarUrl: true }
          }
        }
      });

      if (seenRows.length > 0) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: payload.groupId },
          select: { userId: true }
        });

        const entries = seenRows.map((row) => ({
          messageId: row.messageId,
          userId: row.userId,
          seenAt: row.seenAt.toISOString(),
          user: row.user
        }));

        for (const member of members) {
          io.to(`user:${member.userId}`).emit("group:message:seen", {
            groupId: payload.groupId,
            entries
          });
        }
      }

      ack?.({ ok: true });
    });

    // ── GROUP TYPING ──
    socket.on("group:typing:start", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId, userId: { not: userId } },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:typing:start", {
          groupId: payload.groupId,
          fromUserId: userId
        });
      }
    });

    socket.on("group:typing:stop", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId, userId: { not: userId } },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:typing:stop", {
          groupId: payload.groupId,
          fromUserId: userId
        });
      }
    });

    // ── GROUP CALL ──
    socket.on("group:call:offer", async (payload: { groupId: string; toUserId?: string; sdp: CallSDP }) => {
      if (!payload?.groupId || !payload?.sdp) return;
      if (payload.toUserId) {
        io.to(`user:${payload.toUserId}`).emit("group:call:offer", {
          groupId: payload.groupId,
          fromUserId: userId,
          sdp: payload.sdp
        });
        return;
      }
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId, userId: { not: userId } },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:call:offer", {
          groupId: payload.groupId,
          fromUserId: userId,
          sdp: payload.sdp
        });
      }
    });

    socket.on("group:call:answer", (payload: { groupId: string; toUserId: string; sdp: CallSDP }) => {
      if (!payload?.groupId || !payload?.toUserId || !payload?.sdp) return;
      io.to(`user:${payload.toUserId}`).emit("group:call:answer", {
        groupId: payload.groupId,
        fromUserId: userId,
        sdp: payload.sdp
      });
    });

    socket.on("group:call:ice-candidate", (payload: { groupId: string; toUserId: string; candidate: CallCandidate }) => {
      if (!payload?.groupId || !payload?.toUserId || !payload?.candidate) return;
      io.to(`user:${payload.toUserId}`).emit("group:call:ice-candidate", {
        groupId: payload.groupId,
        fromUserId: userId,
        candidate: payload.candidate
      });
    });

    socket.on("group:call:status", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      const member = await prisma.groupMember.findFirst({
        where: { groupId: payload.groupId, userId },
        select: { id: true }
      });
      if (!member) return;

      const activeUsers = [...(groupCallUsersByGroup.get(payload.groupId) ?? new Set<string>())];
      socket.emit("group:call:status", {
        groupId: payload.groupId,
        userIds: activeUsers
      });
    });

    // ── GROUP CALL PARTICIPANT TRACKING ──
    socket.on("group:call:join", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      socket.join(`group:call:${payload.groupId}`);
      const joined = groupCallMembershipBySocket.get(socket.id) ?? new Set<string>();
      const alreadyJoined = joined.has(payload.groupId);
      joined.add(payload.groupId);
      groupCallMembershipBySocket.set(socket.id, joined);
      if (alreadyJoined) {
        return;
      }
      const becameVisibleMember = addGroupCallMember(payload.groupId, userId);
      if (!becameVisibleMember) {
        return;
      }
      const activeUsers = [...(groupCallUsersByGroup.get(payload.groupId) ?? new Set<string>())];
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:call:join", {
          groupId: payload.groupId,
          userId
        });
        io.to(`user:${m.userId}`).emit("group:call:status", {
          groupId: payload.groupId,
          userIds: activeUsers
        });
      }
    });

    socket.on("group:call:leave", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      socket.leave(`group:call:${payload.groupId}`);
      const joined = groupCallMembershipBySocket.get(socket.id);
      let leftThisGroup = false;
      if (joined) {
        leftThisGroup = joined.delete(payload.groupId);
        if (joined.size === 0) {
          groupCallMembershipBySocket.delete(socket.id);
        } else {
          groupCallMembershipBySocket.set(socket.id, joined);
        }
      }
      if (!leftThisGroup) return;

      const becameFullyAbsent = removeGroupCallMember(payload.groupId, userId);
      if (!becameFullyAbsent) {
        return;
      }
      const activeUsers = [...(groupCallUsersByGroup.get(payload.groupId) ?? new Set<string>())];
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:call:leave", {
          groupId: payload.groupId,
          userId
        });
        io.to(`user:${m.userId}`).emit("group:call:status", {
          groupId: payload.groupId,
          userIds: activeUsers
        });
      }
    });

    socket.on("group:call:speaking", async (payload: { groupId: string; speaking: boolean }) => {
      if (!payload?.groupId || typeof payload.speaking !== "boolean") return;
      // Fast path: emit to socket room in-memory
      socket.to(`group:call:${payload.groupId}`).emit("group:call:speaking", {
        groupId: payload.groupId,
        userId,
        speaking: payload.speaking
      });
    });

    socket.on("group:call:end", async (payload: { groupId: string }) => {
      if (!payload?.groupId) return;
      clearGroupCall(payload.groupId);
      const members = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId, userId: { not: userId } },
        select: { userId: true }
      });
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("group:call:end", {
          groupId: payload.groupId,
          fromUserId: userId
        });
        io.to(`user:${m.userId}`).emit("group:call:status", {
          groupId: payload.groupId,
          userIds: []
        });
      }
    });

    socket.on("disconnect", async (reason: string) => {
      console.info("[Socket] disconnect", { userId, socketId: socket.id, reason });
      const activeCount = removeUserSocket(userId, socket.id);
      untrackOnlineUser(userId, socket.id);
      void pushEventWithNames("disconnect", { userId, reason });

      const joinedGroupIds = [...(groupCallMembershipBySocket.get(socket.id) ?? new Set<string>())];
      groupCallMembershipBySocket.delete(socket.id);
      for (const groupId of joinedGroupIds) {
        const becameFullyAbsent = removeGroupCallMember(groupId, userId);
        if (!becameFullyAbsent) {
          continue;
        }
        const activeUsers = [...(groupCallUsersByGroup.get(groupId) ?? new Set<string>())];
        const members = await prisma.groupMember.findMany({
          where: { groupId },
          select: { userId: true }
        });
        for (const m of members) {
          io.to(`user:${m.userId}`).emit("group:call:leave", {
            groupId,
            userId
          });
          io.to(`user:${m.userId}`).emit("group:call:status", {
            groupId,
            userIds: activeUsers
          });
        }
      }

      const sessions = findDirectCallSessionsBySocket(socket.id);
      for (const session of sessions) {
        await closeDirectCallSession(io, session, userId, "peer-disconnected");
      }

      if (activeCount > 0) {
        return;
      }

      const lastSeenAt = new Date();
      await prisma.user
        .update({
          where: { id: userId },
          data: { lastSeenAt }
        })
        .catch(() => undefined);

      io.emit("presence:update", {
        userId,
        isOnline: false,
        lastSeenAt: lastSeenAt.toISOString()
      });
    });
  });
}
