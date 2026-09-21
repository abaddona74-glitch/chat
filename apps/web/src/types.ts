export type MessageType = "TEXT" | "FILE" | "LOCATION" | "VOICE";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  isTwoFAEnabled?: boolean;
  isEmailVerified?: boolean;
  statusText?: string | null;
  statusEmoji?: string | null;
  lastSeenAt?: string | null;
  isOnline?: boolean;
  username?: string | null;
  avatarUrl?: string | null;
};

export type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  type: MessageType;
  text?: string | null;
  fileUrl?: string | null;
  thumbUrl?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  durationSec?: number | null;
  replyToId?: string | null;
  replyTo?: Partial<Message> | null;
  editedAt?: string | null;
  readAt?: string | null;
  deletedForSender?: boolean;
  deletedForRecipient?: boolean;
  createdAt: string;
};

export type GroupRole = "OWNER" | "ADMIN" | "MEMBER";

export type Group = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  members?: GroupMember[];
  _count?: { members: number };
};

export type GroupMember = {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
  user?: PublicUser;
};

export type GroupMessage = {
  id: string;
  groupId: string;
  senderId: string;
  type: MessageType;
  text?: string | null;
  fileUrl?: string | null;
  thumbUrl?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  durationSec?: number | null;
  replyToId?: string | null;
  replyTo?: Partial<GroupMessage> | null;
  editedAt?: string | null;
  createdAt: string;
  sender?: PublicUser;
};
