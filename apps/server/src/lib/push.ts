import fs from "node:fs";
import { MessageType } from "@prisma/client";
import admin from "firebase-admin";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  channelId?: string;
};

let messagingInstance: admin.messaging.Messaging | null | undefined;

function readServiceAccount(): admin.ServiceAccount | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as admin.ServiceAccount;
    } catch {
      return null;
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    try {
      const raw = fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf-8");
      return JSON.parse(raw) as admin.ServiceAccount;
    } catch {
      return null;
    }
  }

  return null;
}

function getMessaging(): admin.messaging.Messaging | null {
  if (messagingInstance !== undefined) {
    return messagingInstance;
  }

  const serviceAccount = readServiceAccount();
  if (!serviceAccount) {
    messagingInstance = null;
    return messagingInstance;
  }

  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    messagingInstance = admin.messaging();
  } catch {
    messagingInstance = null;
  }

  return messagingInstance;
}

function collectInvalidTokenIndexes(response: admin.messaging.BatchResponse) {
  const indexes: number[] = [];
  response.responses.forEach((item, index) => {
    if (!item.success) {
      const code = item.error?.code ?? "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        indexes.push(index);
      }
    }
  });
  return indexes;
}

export function buildPushPreview(message: {
  type: MessageType;
  text: string | null;
  fileName: string | null;
}) {
  if (message.type === MessageType.TEXT) {
    return (message.text ?? "").trim() || "Yangi xabar";
  }
  if (message.type === MessageType.LOCATION) {
    return "Joylashuv yuborildi";
  }
  if (message.type === MessageType.VOICE) {
    return "Voice xabar yuborildi";
  }
  return message.fileName ? `Fayl: ${message.fileName}` : "Fayl yuborildi";
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const messaging = getMessaging();
  if (!messaging) {
    return;
  }

  const devices = await prisma.userDeviceToken.findMany({
    where: { userId },
    select: { token: true },
    take: 20,
  });

  if (devices.length === 0) {
    return;
  }

  const tokens = devices.map((item) => item.token);

  await sendPushToTokens(tokens, payload);
}

async function sendPushToTokens(tokens: string[], payload: PushPayload) {
  const messaging = getMessaging();
  if (!messaging || tokens.length === 0) {
    return { total: 0, success: 0, failed: 0 };
  }

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: "high",
        notification: {
          channelId: payload.channelId ?? "messages-v1",
        },
      },
    });

    const invalidIndexes = collectInvalidTokenIndexes(response);
    if (invalidIndexes.length > 0) {
      const invalidTokens = invalidIndexes.map((index) => tokens[index]);
      await prisma.userDeviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      }).catch(() => undefined);
    }

    return {
      total: tokens.length,
      success: response.successCount,
      failed: response.failureCount,
    };
  } catch {
    // Keep socket flow stable even if push delivery fails.
    return { total: tokens.length, success: 0, failed: tokens.length };
  }
}

export async function sendPushUpdateAvailableToAndroid(payload: {
  version: string;
  notes?: string;
}) {
  const devices = await prisma.userDeviceToken.findMany({
    where: { platform: "android" },
    select: { token: true },
    distinct: ["token"],
    take: 5000,
  });

  if (devices.length === 0) {
    return { total: 0, success: 0, failed: 0 };
  }

  const title = "New update available";
  const body = payload.notes?.trim() || `Version ${payload.version} is ready to install`;
  const allTokens = devices.map((item) => item.token);
  let success = 0;
  let failed = 0;

  for (let i = 0; i < allTokens.length; i += 500) {
    const chunk = allTokens.slice(i, i + 500);
    const result = await sendPushToTokens(chunk, {
      title,
      body,
      // Use the already-existing message channel for backward compatibility
      // with installed builds that don't create updates-v1 channel yet.
      channelId: "messages-v1",
      data: {
        kind: "update-available",
        version: payload.version,
        notes: payload.notes ?? "",
      },
    });
    success += result.success;
    failed += result.failed;
  }

  return {
    total: allTokens.length,
    success,
    failed,
  };
}
