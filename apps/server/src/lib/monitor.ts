import { prisma } from "./prisma.js";

export type MonitorEvent = {
  id: number;
  ts: number;
  type: string;
  data: Record<string, unknown>;
};

export type MonitorLogLine = {
  id: number;
  ts: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
};

const MAX_LOG_LINES = 2000;
const logLines: MonitorLogLine[] = [];
let nextLogId = 1;
const logListeners = new Set<(line: MonitorLogLine) => void>();

function captureConsole() {
  const levels: Array<"log" | "info" | "warn" | "error"> = ["log", "info", "warn", "error"];
  for (const level of levels) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      original(...args);
      let text = "";
      for (const arg of args) {
        if (typeof arg === "string") {
          text += arg + " ";
        } else if (arg instanceof Error) {
          text += (arg.stack || arg.message) + " ";
        } else {
          try {
            text += JSON.stringify(arg) + " ";
          } catch {
            text += String(arg) + " ";
          }
        }
      }
      const line: MonitorLogLine = {
        id: nextLogId++,
        ts: Date.now(),
        level,
        text: text.trimEnd(),
      };
      logLines.push(line);
      if (logLines.length > MAX_LOG_LINES) {
        logLines.splice(0, logLines.length - MAX_LOG_LINES);
      }
      for (const listener of logListeners) {
        listener(line);
      }
    };
  }
}

captureConsole();

export type OnlineUserInfo = {
  userId: string;
  socketId: string;
  clientType: string;
  clientVersion: string | null;
  connectedAt: number;
};

const MAX_EVENTS = 5000;
const events: MonitorEvent[] = [];
let nextEventId = 1;
const listeners = new Set<(event: MonitorEvent) => void>();

const onlineUsers = new Map<string, OnlineUserInfo>();
const userNameCache = new Map<string, string>();
const userNameCacheTimer = new Map<string, ReturnType<typeof setTimeout>>();
const NAME_CACHE_TTL = 60 * 60 * 1000;

function cacheUserName(userId: string, name: string) {
  userNameCache.set(userId, name);
  clearTimeout(userNameCacheTimer.get(userId));
  const timer = setTimeout(() => {
    userNameCache.delete(userId);
    userNameCacheTimer.delete(userId);
  }, NAME_CACHE_TTL);
  timer.unref?.();
  userNameCacheTimer.set(userId, timer);
}

export async function resolveUserName(userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached) {
    return cached;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true, email: true },
    });
    const name = user?.displayName || user?.username || user?.email || userId;
    cacheUserName(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export function pushEvent(type: string, data: Record<string, unknown>) {
  const event: MonitorEvent = {
    id: nextEventId++,
    ts: Date.now(),
    type,
    data,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  for (const listener of listeners) {
    listener(event);
  }
}

export async function pushEventWithNames(type: string, data: Record<string, unknown>) {
  const withNames: Record<string, unknown> = { ...data };
  if (typeof data.userId === "string") {
    withNames.userName = await resolveUserName(data.userId);
  }
  if (typeof data.fromUserId === "string") {
    withNames.fromName = await resolveUserName(data.fromUserId);
  }
  if (typeof data.toUserId === "string") {
    withNames.toName = await resolveUserName(data.toUserId);
  }
  pushEvent(type, withNames);
}

export function getRecentEvents(limit = 200): MonitorEvent[] {
  return events.slice(-limit);
}

export function subscribeMonitor(listener: (event: MonitorEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function trackOnlineUser(info: OnlineUserInfo) {
  onlineUsers.set(info.userId, info);
}

export function untrackOnlineUser(userId: string, socketId: string) {
  const current = onlineUsers.get(userId);
  if (current && current.socketId === socketId) {
    onlineUsers.delete(userId);
  }
}

export function getOnlineUsers(): OnlineUserInfo[] {
  return [...onlineUsers.values()];
}

export async function getStats() {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const online = getOnlineUsers();
  const today = events.filter((e) => e.ts >= dayStart.getTime());

  const counts: Record<string, number> = {};
  for (const event of today) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  const iceKinds: Record<string, number> = {};
  for (const event of today) {
    if (event.type === "ice") {
      const kind = String(event.data.iceKind ?? "?");
      iceKinds[kind] = (iceKinds[kind] ?? 0) + 1;
    }
  }

  return {
    now,
    uptimeSec: Math.round(process.uptime()),
    totalEvents: events.length,
    online: await Promise.all(
      online.map(async (u) => ({
        ...u,
        userName: await resolveUserName(u.userId),
      }))
    ),
    today: {
      counts,
      iceKinds,
    },
  };
}

export function getRecentLogs(limit = 200): MonitorLogLine[] {
  return logLines.slice(-limit);
}

export function subscribeLogs(listener: (line: MonitorLogLine) => void): () => void {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}
