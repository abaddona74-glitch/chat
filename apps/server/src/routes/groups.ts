import { GroupRole, MessageType } from "@prisma/client";
import { RequestHandler, Router } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  memberIds: z.array(z.string().min(1)).min(1).max(200)
});

const addMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(200)
});

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z.string().trim().min(1).max(1000).nullable().optional()
  })
  .refine((value) => value.name !== undefined || value.avatarUrl !== undefined, {
    message: "Hech bo'lmasa bitta maydon yuboring."
  });

const updateMemberRoleSchema = z.object({
  role: z
    .nativeEnum(GroupRole)
    .refine((role) => role !== GroupRole.OWNER, { message: "OWNER role qo'lda berilmaydi." })
});

const getMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const createMessageSchema = z
  .object({
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

export function createGroupsRouter(io: Server) {
  const router = Router();
  router.use(authRequired);

  const groupInclude = {
    members: {
      include: {
        user: {
          select: { id: true, email: true, displayName: true, lastSeenAt: true, avatarUrl: true }
        }
      }
    },
    _count: { select: { members: true } }
  } as const;

  const isAdminOrOwner = (role: GroupRole) => role === GroupRole.ADMIN || role === GroupRole.OWNER;

  // Create group
  router.post("/", async (req, res) => {
    const me = req.user!;
    const parsed = createGroupSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    const { name, memberIds } = parsed.data;

    // Ensure all member IDs are valid users
    const validUsers = await prisma.user.findMany({
      where: { id: { in: memberIds }, isEmailVerified: true },
      select: { id: true }
    });
    const validIds = new Set(validUsers.map((u) => u.id));

    // Always include creator
    const allMemberIds = [...new Set([me.id, ...memberIds.filter((id) => validIds.has(id))])];

    const group = await prisma.group.create({
      data: {
        name,
        createdById: me.id,
        members: {
          create: allMemberIds.map((userId) => ({
            userId,
            role: userId === me.id ? GroupRole.OWNER : GroupRole.MEMBER
          }))
        }
      },
      include: groupInclude
    });

    const meUser = await prisma.user.findUnique({
      where: { id: me.id },
      select: { displayName: true }
    });
    const myName = meUser?.displayName || me.email;

    const createMsg = await prisma.groupMessage.create({
      data: {
        groupId: group.id,
        senderId: me.id,
        type: MessageType.TEXT,
        text: `${myName} "${name}" guruhini yaratdi`
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
        }
      }
    });

    // Notify all members about the new group and initial system message
    for (const memberId of allMemberIds) {
      io.to(`user:${memberId}`).emit("group:created", group);
      io.to(`user:${memberId}`).emit("group:message:new", createMsg);
    }

    return res.status(201).json({ group });
  });

  // List user's groups
  router.get("/", async (req, res) => {
    const me = req.user!;

    const groups = await prisma.group.findMany({
      where: {
        members: { some: { userId: me.id } }
      },
      include: groupInclude,
      orderBy: { updatedAt: "desc" }
    });

    return res.json({ groups });
  });

  // Get group details
  router.get("/:groupId", async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;

    const group = await prisma.group.findFirst({
      where: {
        id: groupId,
        members: { some: { userId: me.id } }
      },
      include: groupInclude
    });

    if (!group) {
      return res.status(404).json({ message: "Guruh topilmadi." });
    }

    return res.json({ group });
  });

  // Update group details (admin/owner)
  const updateGroupDetailsHandler: RequestHandler<{ groupId: string }> = async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;
    const parsed = updateGroupSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Noto'g'ri format." });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!membership || !isAdminOrOwner(membership.role)) {
      return res.status(403).json({ message: "Faqat admin yoki owner guruhni tahrirlay oladi." });
    }

    const data: { name?: string; avatarUrl?: string | null } = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name;
    }
    if (parsed.data.avatarUrl !== undefined) {
      data.avatarUrl = parsed.data.avatarUrl;
    }

    await prisma.group.update({
      where: { id: groupId },
      data
    });

    const group = await prisma.group.findUnique({ where: { id: groupId }, include: groupInclude });
    if (!group) {
      return res.status(404).json({ message: "Guruh topilmadi." });
    }

    group.members.forEach((m) => {
      io.to(`user:${m.userId}`).emit("group:updated", group);
    });

    return res.json({ group });
  };

  router.patch("/:groupId", updateGroupDetailsHandler);
  // Compatibility alias for clients/proxies that do not forward PATCH correctly.
  router.put("/:groupId", updateGroupDetailsHandler);

  // Add members to group (admin/owner)
  router.post("/:groupId/members", async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;
    const parsed = addMembersSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    // Check if user is admin/owner
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!membership || !isAdminOrOwner(membership.role)) {
      return res.status(403).json({ message: "Faqat admin yoki owner a'zo qo'sha oladi." });
    }

    const { memberIds } = parsed.data;
    const validUsers = await prisma.user.findMany({
      where: { id: { in: memberIds }, isEmailVerified: true },
      select: { id: true }
    });

    // Filter out already existing members
    const existingMembers = await prisma.groupMember.findMany({
      where: { groupId, userId: { in: validUsers.map((u) => u.id) } },
      select: { userId: true }
    });
    const existingIds = new Set(existingMembers.map((m) => m.userId));
    const newMemberIds = validUsers.map((u) => u.id).filter((id) => !existingIds.has(id));

    if (newMemberIds.length === 0) {
      return res.status(400).json({ message: "Yangi a'zo topilmadi." });
    }

    await prisma.groupMember.createMany({
      data: newMemberIds.map((userId) => ({
        groupId,
        userId,
        role: GroupRole.MEMBER
      }))
    });

    const [meUser, newUsers] = await Promise.all([
      prisma.user.findUnique({ where: { id: me.id }, select: { displayName: true } }),
      prisma.user.findMany({
        where: { id: { in: newMemberIds } },
        select: { id: true, displayName: true }
      })
    ]);
    const myName = meUser?.displayName || me.email;
    const addedNames = newUsers.map((u) => u.displayName).join(", ");
    const systemText = `${myName} ${addedNames} ni guruhga qo'shdi`;

    const systemMsg = await prisma.groupMessage.create({
      data: {
        groupId,
        senderId: me.id,
        type: MessageType.TEXT,
        text: systemText
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
        }
      }
    });

    await prisma.group.update({
      where: { id: groupId },
      data: { updatedAt: new Date() }
    });

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: groupInclude
    });

    // Notify all group members about updated group and new system message
    group?.members.forEach((m) => {
      io.to(`user:${m.userId}`).emit("group:updated", group);
      io.to(`user:${m.userId}`).emit("group:message:new", systemMsg);
    });

    return res.json({ group });
  });

  // Update member role (owner only)
  router.patch("/:groupId/members/:userId/role", async (req, res) => {
    const me = req.user!;
    const { groupId, userId } = req.params;
    const parsed = updateMemberRoleSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Noto'g'ri format." });
    }

    const myMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });
    if (!myMembership || myMembership.role !== GroupRole.OWNER) {
      return res.status(403).json({ message: "Faqat owner admin tayinlay oladi." });
    }

    if (userId === me.id) {
      return res.status(400).json({ message: "Owner o'z rolini bu yerda o'zgartira olmaydi." });
    }

    const targetMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } }
    });
    if (!targetMembership) {
      return res.status(404).json({ message: "A'zo topilmadi." });
    }
    if (targetMembership.role === GroupRole.OWNER) {
      return res.status(400).json({ message: "Owner rolini o'zgartirib bo'lmaydi." });
    }

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role: parsed.data.role }
    });

    const group = await prisma.group.findUnique({ where: { id: groupId }, include: groupInclude });
    if (!group) {
      return res.status(404).json({ message: "Guruh topilmadi." });
    }

    group.members.forEach((m) => {
      io.to(`user:${m.userId}`).emit("group:updated", group);
    });

    return res.json({ group });
  });

  // Delete group (owner only)
  router.delete("/:groupId", async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;

    const myMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!myMembership) {
      return res.status(403).json({ message: "Siz bu guruhda emassiz." });
    }

    if (myMembership.role !== GroupRole.OWNER) {
      return res.status(403).json({ message: "Faqat owner guruhni o'chira oladi." });
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: groupInclude
    });

    if (!group) {
      return res.status(404).json({ message: "Guruh topilmadi." });
    }

    await prisma.group.delete({ where: { id: groupId } });

    group.members.forEach((m) => {
      io.to(`user:${m.userId}`).emit("group:removed", { groupId });
    });

    return res.json({ success: true });
  });

  // Remove member from group (admin or self)
  router.delete("/:groupId/members/:userId", async (req, res) => {
    const me = req.user!;
    const { groupId, userId } = req.params;

    const myMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!myMembership) {
      return res.status(403).json({ message: "Siz bu guruhda emassiz." });
    }

    const targetMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } }
    });
    if (!targetMembership) {
      return res.status(404).json({ message: "A'zo topilmadi." });
    }

    // Self leave
    if (userId === me.id) {
      if (myMembership.role === GroupRole.OWNER) {
        return res.status(400).json({ message: "Owner guruhdan chiqishdan oldin ownerlikni topshirishi kerak." });
      }
    } else if (myMembership.role === GroupRole.OWNER) {
      // Owner can remove anyone except owner
      if (targetMembership.role === GroupRole.OWNER) {
        return res.status(403).json({ message: "Ownerni chiqarib bo'lmaydi." });
      }
    } else if (myMembership.role === GroupRole.ADMIN) {
      // Admin can only remove normal members
      if (targetMembership.role !== GroupRole.MEMBER) {
        return res.status(403).json({ message: "Admin faqat memberni chiqarishi mumkin." });
      }
    } else {
      return res.status(403).json({ message: "Sizda a'zoni chiqarish huquqi yo'q." });
    }

    const [meUser, targetUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: me.id }, select: { displayName: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } })
    ]);
    const myName = meUser?.displayName || me.email;
    const leaveText =
      userId === me.id
        ? `${targetUser?.displayName ?? "Foydalanuvchi"} guruhdan chiqdi`
        : `${myName} ${targetUser?.displayName ?? "foydalanuvchi"}ni guruhdan chiqardi`;

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } }
    }).catch(() => null);

    const systemMsg = await prisma.groupMessage.create({
      data: {
        groupId,
        senderId: me.id,
        type: MessageType.TEXT,
        text: leaveText
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
        }
      }
    });

    await prisma.group.update({
      where: { id: groupId },
      data: { updatedAt: new Date() }
    });

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: groupInclude
    });

    // Notify remaining members and the removed user
    group?.members.forEach((m) => {
      io.to(`user:${m.userId}`).emit("group:updated", group);
      io.to(`user:${m.userId}`).emit("group:message:new", systemMsg);
    });
    io.to(`user:${userId}`).emit("group:removed", { groupId });

    return res.json({ group });
  });

  // Get group messages
  router.get("/:groupId/messages", async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;
    const parsedQuery = getMessagesQuerySchema.safeParse(req.query);

    if (!parsedQuery.success) {
      return res.status(400).json({ message: "Query noto'g'ri." });
    }

    // Check membership
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!membership) {
      return res.status(403).json({ message: "Siz bu guruhda emassiz." });
    }

    const { cursor, limit } = parsedQuery.data;

    const messages = await prisma.groupMessage.findMany({
      where: { groupId },
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

  // Send group message via REST (alternative to socket)
  router.post("/:groupId/messages", async (req, res) => {
    const me = req.user!;
    const { groupId } = req.params;
    const parsed = createMessageSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Xabar formati noto'g'ri." });
    }

    // Check membership
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me.id } }
    });

    if (!membership) {
      return res.status(403).json({ message: "Siz bu guruhda emassiz." });
    }

    const payload = parsed.data;

    const message = await prisma.groupMessage.create({
      data: {
        groupId,
        senderId: me.id,
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
        }
      }
    });

    // Update group timestamp
    await prisma.group.update({
      where: { id: groupId },
      data: { updatedAt: new Date() }
    });

    // Get all group members and notify
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true }
    });

    for (const m of members) {
      io.to(`user:${m.userId}`).emit("group:message:new", message);
    }

    return res.status(201).json({ message });
  });

  // Edit group message
  router.patch("/:groupId/messages/:id", async (req, res) => {
    const me = req.user!;
    const { groupId, id } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!text) {
      return res.status(400).json({ message: "Xabar matni bo'sh bo'lishi mumkin emas." });
    }

    const message = await prisma.groupMessage.findUnique({
      where: { id }
    });

    if (!message || message.groupId !== groupId || message.senderId !== me.id) {
      return res.status(404).json({ message: "Xabar topilmadi yoki sizga tegishli emas." });
    }

    const hoursSince = (Date.now() - message.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > 48) {
      return res.status(400).json({ message: "Xabarni faqat 48 soat ichida tahrirlash mumkin." });
    }

    const updated = await prisma.groupMessage.update({
      where: { id },
      data: {
        text,
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
        },
        sender: {
          select: { id: true, email: true, displayName: true }
        }
      }
    });

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true }
    });

    for (const m of members) {
      io.to(`user:${m.userId}`).emit("group:message:edited", updated);
    }

    return res.json({ message: updated });
  });

  return router;
}
