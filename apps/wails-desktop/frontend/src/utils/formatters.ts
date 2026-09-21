import { API_URL } from "../lib/api";
import { PublicUser } from "../types";

/** Convert file URLs — make relative URLs absolute for desktop, strip old domains */
export function normalizeFileUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_URL}${url}`;
  try {
    const u = new URL(url);
    return `${API_URL}${u.pathname}`;
  } catch {
    return url;
  }
}

export function getInitialLetter(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

export function hasUsableAvatar(avatarUrl: string | null | undefined): boolean {
  const s = (avatarUrl ?? "").trim().toLowerCase();
  return Boolean(s && s !== "null" && s !== "undefined");
}

export function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionInsertText(user: PublicUser): string {
  const preferred = user.username?.trim() || user.displayName.trim();
  return `@${preferred} `;
}

export function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function normalizeVolumeLevel(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}

export function toMediaElementVolume(value: number, fallback = 1): number {
  return Math.min(normalizeVolumeLevel(value, fallback), 1);
}

export function normalizeHexColor(
  value: string | null | undefined,
  fallback: string,
): string {
  const raw = (value ?? "").trim();
  const fullHex = /^#([\da-fA-F]{6})$/;
  const shortHex = /^#([\da-fA-F]{3})$/;
  if (fullHex.test(raw)) return raw.toLowerCase();
  const short = raw.match(shortHex);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(hex, "#000000");
  const match = normalized.match(
    /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})$/,
  );
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

export function shiftHexColor(hex: string, offset: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r + offset)}${toHex(rgb.g + offset)}${toHex(rgb.b + offset)}`;
}

export function formatCallDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatCallLogDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
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

export function normalizeLegacyCallLogText(text: string): string {
  const match = text.match(/^📞\s*Call ended\s*•\s*(\d+):(\d{2})$/);
  if (!match) {
    return text;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return text;
  }

  const totalSeconds = Math.max(0, minutes * 60 + seconds);
  return `📞 Call ended • ${formatCallLogDuration(totalSeconds)}`;
}

export function formatLastSeen(lastSeenAt?: string | null): string {
  if (!lastSeenAt) {
    return "offline";
  }

  const seenAt = new Date(lastSeenAt);
  if (Number.isNaN(seenAt.getTime())) {
    return "offline";
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seenStart = new Date(
    seenAt.getFullYear(),
    seenAt.getMonth(),
    seenAt.getDate(),
  );
  const dayDiff = Math.round(
    (todayStart.getTime() - seenStart.getTime()) / 86400000,
  );
  const time = seenAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (dayDiff < 0) {
    return time;
  }

  const relativeDay = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
  }).format(-dayDiff, "day");
  return `${relativeDay} ${time}`;
}

export function readAxiosMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } })
      .response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function getAxiosStatus(error: unknown): number | null {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { status?: number } }).response;
    return typeof response?.status === "number" ? response.status : null;
  }
  return null;
}
