import { MessageType } from "@prisma/client";
import { Server } from "socket.io";
import { prisma } from "./prisma.js";
import { isUserOnline } from "./presence.js";
import { pushEventWithNames } from "./monitor.js";
import { buildPushPreview, sendPushToUser } from "./push.js";

let schedulerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startMessageScheduler(io: Server) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.info("[Scheduler] Server-side message scheduler started (1s interval)");

  schedulerInterval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const now = new Date();
      const dueMessages = await prisma.scheduledMessage.findMany({
        where: {
          status: "PENDING",
          sendAt: { lte: now }
        },
        take: 30,
        orderBy: { sendAt: "asc" }
      });

      if (dueMessages.length === 0) {
        isProcessing = false;
        return;
      }

      for (const item of dueMessages) {
        // Atomically claim the message
        const claimed = await prisma.scheduledMessage.updateMany({
          where: { id: item.id, status: "PENDING" },
          data: { status: "PROCESSING" }
        });
        if (claimed.count === 0) continue;

        try {
          if (item.groupId) {
            // Group message
            const message = await prisma.groupMessage.create({
              data: {
                groupId: item.groupId,
                senderId: item.senderId,
                type: item.type,
                text: item.text,
                fileUrl: item.fileUrl,
                thumbUrl: item.thumbUrl,
                fileName: item.fileName,
                fileMime: item.fileMime,
                fileSize: item.fileSize,
                latitude: item.latitude,
                longitude: item.longitude,
                durationSec: item.durationSec,
                replyToId: item.replyToId,
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

            await prisma.group.update({
              where: { id: item.groupId },
              data: { updatedAt: new Date() }
            }).catch(() => undefined);

            const members = await prisma.groupMember.findMany({
              where: { groupId: item.groupId },
              select: { userId: true }
            });
            const group = await prisma.group.findUnique({
              where: { id: item.groupId },
              select: { name: true },
            });

            for (const m of members) {
              io.to(`user:${m.userId}`).emit("group:message:new", message);
              if (m.userId !== item.senderId && !isUserOnline(m.userId)) {
                await sendPushToUser(m.userId, {
                  title: `Guruh: ${group?.name ?? "Chat"}`,
                  body: buildPushPreview(message),
                  data: {
                    kind: "group-message",
                    groupId: item.groupId,
                    senderId: item.senderId,
                  },
                }).catch(() => undefined);
              }
            }

            void pushEventWithNames("group_message", {
              fromUserId: item.senderId,
              groupId: item.groupId,
              groupName: group?.name ?? null,
              messageType: item.type,
              preview: item.type === MessageType.TEXT ? String(item.text ?? "").slice(0, 80) : null
            });

            await prisma.scheduledMessage.update({
              where: { id: item.id },
              data: { status: "SENT", sentAt: new Date() }
            });

            io.to(`user:${item.senderId}`).emit("scheduled:sent", {
              id: item.id,
              messageId: message.id,
              chatMode: "group",
              targetId: item.groupId
            });
          } else if (item.recipientId) {
            // Direct message
            const recipient = await prisma.user.findFirst({
              where: { id: item.recipientId, isEmailVerified: true },
              select: { id: true }
            });

            if (!recipient) {
              await prisma.scheduledMessage.update({
                where: { id: item.id },
                data: { status: "FAILED", error: "Qabul qiluvchi topilmadi" }
              });
              continue;
            }

            const message = await prisma.message.create({
              data: {
                senderId: item.senderId,
                recipientId: item.recipientId,
                type: item.type,
                text: item.text,
                fileUrl: item.fileUrl,
                thumbUrl: item.thumbUrl,
                replyToId: item.replyToId,
                fileName: item.fileName,
                fileMime: item.fileMime,
                fileSize: item.fileSize,
                latitude: item.latitude,
                longitude: item.longitude,
                durationSec: item.durationSec
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

            io.to(`user:${item.senderId}`).emit("message:new", message);
            io.to(`user:${item.recipientId}`).emit("message:new", message);

            void pushEventWithNames("message", {
              fromUserId: item.senderId,
              toUserId: item.recipientId,
              messageType: item.type,
              preview: item.type === MessageType.TEXT ? String(item.text ?? "").slice(0, 80) : null
            });

            if (!isUserOnline(item.recipientId)) {
              const sender = await prisma.user.findUnique({
                where: { id: item.senderId },
                select: { displayName: true },
              });
              await sendPushToUser(item.recipientId, {
                title: sender?.displayName ?? "Yangi xabar",
                body: buildPushPreview(message),
                data: {
                  kind: "message",
                  senderId: item.senderId,
                },
              }).catch(() => undefined);
            }

            await prisma.scheduledMessage.update({
              where: { id: item.id },
              data: { status: "SENT", sentAt: new Date() }
            });

            io.to(`user:${item.senderId}`).emit("scheduled:sent", {
              id: item.id,
              messageId: message.id,
              chatMode: "user",
              targetId: item.recipientId
            });
          }
        } catch (msgErr: any) {
          console.error(`[Scheduler] Failed sending scheduled message ${item.id}:`, msgErr);
          await prisma.scheduledMessage.update({
            where: { id: item.id },
            data: { status: "FAILED", error: msgErr?.message || "Unknown error" }
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      console.error("[Scheduler] Error in scheduler loop:", err);
    } finally {
      isProcessing = false;
    }
  }, 1000);
}
