import { FormEvent, MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { PluginListenerHandle } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { api, API_URL, persistToken, readPersistedToken } from "./lib/api";
import { DEFAULT_RINGTONE_URL, getRingtoneSourceInfo, resetRingtoneSource, setRingtoneSource, startRingtone, startDialTone, stopAllCallSounds, playEndCallSound, playMessageSentSound } from "./lib/callSounds";
import { createSocket } from "./lib/socket";
import { Message, MessageType, PublicUser, Group, GroupMessage, GroupRole } from "./types";
import { RNNoiseNode } from "simple-rnnoise-wasm";
// @ts-ignore
import rnnoiseWasmUrl from "simple-rnnoise-wasm/rnnoise.wasm?url";
import {
  GetStartupEnabled,
  SetStartupEnabled,
  MinimizeToTray,
  ShowWindow,
  SetCloseToTray,
  ShowCallNotif,
  HideCallNotif,
  CallNotifRespond,
  GetToastPosition,
  SetToastPosition,
  ShowCustomToast,
  ShowOSNotification,
  CheckForUpdate,
  DownloadAndUpdate,
  GetAppVersionInfo,
  ShowInExplorer,
  SaveFileFromURL,
  FileExistsInDownloads,
  GetDownloadPath,
  GetGeoLocation,
  RestoreNormalWindow,
  GetProxyConfig,
  SaveProxyConfig,
  RestartApp,
  FetchPublicIp,
  GetAppliedProxy,
  EventsOn,
  EventsOff,
  BrowserOpenURL,
  ConsumePendingNotificationTarget,
  SetWindowCaptionTheme,
  isWailsRuntime,
  isNativeMobileRuntime,
  OpenDevTools,
} from "./platform/bridge";

const RNNOISE_WORKLET_PUBLIC_URL = "/rnnoise.worklet.js";

type AuthStep = "login" | "register" | "verify" | "forgot" | "reset" | "login2fa";
type CallStatus = "idle" | "calling" | "ringing" | "in-call";
type ChatMode = "user" | "group" | "saved";
type SidebarTab = "contacts" | "groups" | "saved";
type MobileBottomTab = "chats" | "groups" | "settings" | "profile";

type UploadResponse = {
  url: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

type ThemePalette = {
  accentColor: string;
  layoutColor: string;
  textColor: string;
  backgroundColor: string;
  inputColor: string;
};

type LocalThemeProfile = {
  id: string;
  name: string;
  palette: ThemePalette;
  createdAt: string;
};

type CommunityThemeProfile = {
  id: string;
  name: string;
  accentColor: string;
  layoutColor: string;
  textColor: string;
  backgroundColor: string;
  inputColor: string;
  createdAt: string;
  author: {
    id: string;
    displayName: string;
    username?: string | null;
  };
};

const DEFAULT_THEME_PALETTE: ThemePalette = {
  accentColor: "#0e7c66",
  layoutColor: "#1e2c3a",
  textColor: "#e1e8ef",
  backgroundColor: "#17212b",
  inputColor: "#17212b",
};

const THEME_PROFILES_STORAGE_KEY = "theme_profiles_local_v1";
const THEME_PROFILES_FILE_VERSION = 1;

function createThemeProfileId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `theme_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeThemePalette(raw: Partial<ThemePalette> | null | undefined): ThemePalette {
  return {
    accentColor: normalizeHexColor(raw?.accentColor, DEFAULT_THEME_PALETTE.accentColor),
    layoutColor: normalizeHexColor(raw?.layoutColor, DEFAULT_THEME_PALETTE.layoutColor),
    textColor: normalizeHexColor(raw?.textColor, DEFAULT_THEME_PALETTE.textColor),
    backgroundColor: normalizeHexColor(raw?.backgroundColor, DEFAULT_THEME_PALETTE.backgroundColor),
    inputColor: normalizeHexColor(raw?.inputColor, DEFAULT_THEME_PALETTE.inputColor),
  };
}

function parseThemeProfileFromUnknown(raw: unknown): LocalThemeProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const paletteCandidate = source.palette && typeof source.palette === "object"
    ? source.palette as Partial<ThemePalette>
    : source as Partial<ThemePalette>;
  const palette = normalizeThemePalette(paletteCandidate);

  const name = typeof source.name === "string" && source.name.trim()
    ? source.name.trim().slice(0, 60)
    : "Imported theme";

  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id : createThemeProfileId(),
    name,
    palette,
    createdAt: typeof source.createdAt === "string" && source.createdAt
      ? source.createdAt
      : new Date().toISOString(),
  };
}

function readLocalThemeProfiles(): LocalThemeProfile[] {
  try {
    const raw = localStorage.getItem(THEME_PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseThemeProfileFromUnknown)
      .filter((v): v is LocalThemeProfile => Boolean(v));
  } catch {
    return [];
  }
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

/** Convert file URLs — make relative URLs absolute for desktop, strip old domains */
function normalizeFileUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_URL}${url}`;
  // Already absolute — check if it has the right host
  try {
    const u = new URL(url);
    return `${API_URL}${u.pathname}`;
  } catch {
    return url;
  }
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionInsertText(user: PublicUser): string {
  const preferred = user.username?.trim() || user.displayName.trim();
  return `@${preferred} `;
}

function getInitialLetter(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function hasUsableAvatar(avatarUrl: string | null | undefined): boolean {
  const s = (avatarUrl ?? "").trim().toLowerCase();
  return Boolean(s && s !== "null" && s !== "undefined");
}

function normalizeVolumeLevel(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}

function toMediaElementVolume(value: number, fallback = 1): number {
  return Math.min(normalizeVolumeLevel(value, fallback), 1);
}

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(hex, "#000000");
  const match = normalized.match(/^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})$/);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function shiftHexColor(hex: string, offset: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r + offset)}${toHex(rgb.g + offset)}${toHex(rgb.b + offset)}`;
}

const ACCENT_COLOR_PRESETS = ["#0e7c66", "#3b82f6", "#f97316", "#ef4444", "#a855f7", "#22c55e"];
const LAYOUT_COLOR_PRESETS = ["#1e2c3a", "#22313f", "#2a2438", "#1f2937", "#14213d", "#102a43"];
const TEXT_COLOR_PRESETS = ["#e1e8ef", "#f1f5f9", "#fde68a", "#d1fae5", "#e9d5ff", "#fbcfe8"];

const WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:mytelegramchat.ddns.net:3478" },
  {
    urls: "turn:mytelegramchat.ddns.net:3478",
    username: "chatturn",
    credential: "9Fzi61Srx5OU9isIoJ8vwJ7N"
  },
  {
    urls: "turn:mytelegramchat.ddns.net:3478?transport=tcp",
    username: "chatturn",
    credential: "9Fzi61Srx5OU9isIoJ8vwJ7N"
  }
];

const FORCE_WEBRTC_RELAY = (() => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("webrtc_force_relay") === "true";
  } catch {
    return false;
  }
})();

// ── ICE server probe results (saved in localStorage) ──
type IceProbeResult = {
  url: string;
  ok: boolean;
  candidateTypes: string[]; // host/srflx/relay
  rttMs: number; // gather time
  error?: string;
};

const ICE_PROBE_LS_KEY = "ice_probe_results_v1";

// ── Active-call persistence (auto-resume after restart/update) ──
const ACTIVE_CALL_LS_KEY = "active_call_state_v1";
const ACTIVE_CALL_RESUME_WINDOW_MS = 60_000; // resume only if call was active in the last 60s

type ActiveCallState = {
  peerId: string;        // userId for direct, groupId for group
  type: "direct" | "group";
  startedAt: number;
  lastTickAt: number;    // updated periodically while in-call
};

function loadActiveCallState(): ActiveCallState | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_CALL_LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ActiveCallState;
    if (!v?.peerId || !v?.type) return null;
    return v;
  } catch { return null; }
}

function saveActiveCallState(state: ActiveCallState): void {
  try { window.localStorage.setItem(ACTIVE_CALL_LS_KEY, JSON.stringify(state)); }
  catch { /* ignore */ }
}

function clearActiveCallState(): void {
  try { window.localStorage.removeItem(ACTIVE_CALL_LS_KEY); }
  catch { /* ignore */ }
}

function loadIceProbeResults(): IceProbeResult[] {
  try {
    const raw = window.localStorage.getItem(ICE_PROBE_LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as IceProbeResult[];
  } catch {
    return [];
  }
}

function saveIceProbeResults(results: IceProbeResult[]): void {
  try {
    window.localStorage.setItem(ICE_PROBE_LS_KEY, JSON.stringify(results));
  } catch {
    // ignore
  }
}

async function probeIceServer(server: RTCIceServer, timeoutMs = 5000): Promise<IceProbeResult> {
  const url = Array.isArray(server.urls) ? server.urls[0] : (server.urls as string);
  const start = Date.now();
  const types = new Set<string>();
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection({ iceServers: [server], iceCandidatePoolSize: 0 });
    pc.createDataChannel("probe");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, timeoutMs);
      pc!.onicegatheringstatechange = () => {
        if (pc!.iceGatheringState === "complete") {
          window.clearTimeout(timer);
          resolve();
        }
      };
      pc!.onicecandidate = (e) => {
        if (!e.candidate) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        const m = (e.candidate.candidate || "").match(/ typ (\w+)/);
        if (m) types.add(m[1]);
      };
    });

    const isStun = url.startsWith("stun:");
    const isTurn = url.startsWith("turn:") || url.startsWith("turns:");
    const ok = isStun ? types.has("srflx") : (isTurn ? types.has("relay") : types.size > 0);
    return { url, ok, candidateTypes: Array.from(types), rttMs: Date.now() - start };
  } catch (err: any) {
    return { url, ok: false, candidateTypes: Array.from(types), rttMs: Date.now() - start, error: String(err?.message || err) };
  } finally {
    try { pc?.close(); } catch { /* ignore */ }
  }
}

async function probeAllIceServers(): Promise<IceProbeResult[]> {
  console.info(`[ICE-Probe] Boshlandi (${WEBRTC_ICE_SERVERS.length} ta server)`);
  const results = await Promise.all(WEBRTC_ICE_SERVERS.map((s) => probeIceServer(s)));
  results.forEach((r) => {
    console.info(`[ICE-Probe] ${r.ok ? "✅" : "❌"} ${r.url} types=[${r.candidateTypes.join(",")}] ${r.rttMs}ms${r.error ? ` err=${r.error}` : ""}`);
  });
  saveIceProbeResults(results);
  return results;
}

function getRtcConfiguration(): RTCConfiguration {
  // Reorder: working servers first, dead ones last (still kept as fallback)
  const probeResults = loadIceProbeResults();
  const okUrls = new Set(probeResults.filter((r) => r.ok).map((r) => r.url));
  const sorted = [...WEBRTC_ICE_SERVERS].sort((a, b) => {
    const au = Array.isArray(a.urls) ? a.urls[0] : (a.urls as string);
    const bu = Array.isArray(b.urls) ? b.urls[0] : (b.urls as string);
    const aOk = okUrls.has(au) ? 1 : 0;
    const bOk = okUrls.has(bu) ? 1 : 0;
    return bOk - aOk;
  });
  // Auto-force relay: ONLY if user explicitly requested via localStorage or env flag.
  // Default = "all" → ICE will try host/srflx (P2P) first, fallback to relay automatically.
  // P2P gives 30-100ms RTT vs TURN 150-300ms. ICE handles fallback transparently.
  const turnWorks = probeResults.some((r) => r.ok && (r.url.startsWith("turn:") || r.url.startsWith("turns:")));
  const lsOverride = (() => {
    try {
      const v = window.localStorage.getItem("webrtc_force_relay");
      if (v === "true") return true;
      if (v === "false") return false;
      return null;
    } catch { return null; }
  })();
  // Priority: explicit user setting > env flag > default (all = prefer P2P)
  const useRelay = lsOverride !== null ? lsOverride : FORCE_WEBRTC_RELAY;
  if (useRelay) {
    console.info(`[RTC] iceTransportPolicy=relay (forceFlag=${FORCE_WEBRTC_RELAY} ls=${lsOverride})`);
  } else {
    console.info(`[RTC] iceTransportPolicy=all — prefer P2P, TURN as fallback (turnWorks=${turnWorks})`);
  }
  return {
    iceServers: sorted,
    iceCandidatePoolSize: 10,
    ...(useRelay ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {})
  };
}

function messageMentionsUser(messageText: string, me: PublicUser | null): boolean {
  if (!messageText || !me) return false;

  const legacyRegex = new RegExp(`@\\[[^\\]]+\\]\\(${escapeForRegex(me.id)}\\)`);
  if (legacyRegex.test(messageText)) return true;

  const candidates = [me.username?.trim(), me.displayName?.trim()].filter(
    (v): v is string => Boolean(v)
  );
  for (const candidate of candidates) {
    const tokenRegex = new RegExp(`(^|\\s)@${escapeForRegex(candidate)}(?=$|\\s|[.,!?;:])`, "i");
    if (tokenRegex.test(messageText)) return true;
  }

  return false;
}

type PresencePayload = {
  userId: string;
  isOnline: boolean;
  lastSeenAt?: string;
  clientType?: string;
  clientVersion?: string;
};

type IncomingCallPayload = {
  fromUserId: string;
  sdp: RTCSessionDescriptionInit;
};

type DirectCallEndReason =
  | "ended"
  | "declined"
  | "busy"
  | "window-unload"
  | "peer-disconnected"
  | "unknown";

type DirectCallEndPayload = {
  fromUserId?: string;
  reason?: DirectCallEndReason | string;
};

function getCallEndToastText(reason?: string) {
  switch (reason) {
    case "declined":
      return "Call declined.";
    case "busy":
      return "User is busy in another call.";
    case "window-unload":
      return "Call ended (app closed).";
    case "peer-disconnected":
      return "Call ended (peer disconnected).";
    default:
      return "Call ended.";
  }
}

type DesktopInlineNotification = {
  id: string;
  title: string;
  body: string;
  target?: NotificationTarget;
};

type NotificationTarget =
  | { chatMode: "user"; userId: string; kind?: "incoming-call" }
  | { chatMode: "group"; groupId: string; kind?: "incoming-call" };

function readNotificationTarget(extra: unknown): NotificationTarget | undefined {
  if (!extra || typeof extra !== "object") {
    return undefined;
  }

  const data = extra as Record<string, unknown>;
  if (data.chatMode === "user" && typeof data.userId === "string" && data.userId.trim()) {
    return { chatMode: "user", userId: data.userId };
  }
  if (data.chatMode === "group" && typeof data.groupId === "string" && data.groupId.trim()) {
    return { chatMode: "group", groupId: data.groupId };
  }

  return undefined;
}

const MOBILE_GOOGLE_AUTH_RETURN_TO = import.meta.env.VITE_MOBILE_DEEP_LINK_URL ?? "chatmobile://auth/google";
const GOOGLE_AUTH_STATE_STARTED_AT_KEY = "pending_google_auth_started_at";
const GOOGLE_AUTH_STATE_TTL_MS = 2 * 60 * 1000;
const MOBILE_CALL_NOTIFICATION_ID = 7001;
const MOBILE_CALL_ACTION_TYPE_ID = "incoming-call-actions-v1";
const MOBILE_CALL_ACCEPT_ACTION_ID = "accept-call";
const MOBILE_CALL_DECLINE_ACTION_ID = "decline-call";
const MOBILE_CALL_CHANNEL_ID = "incoming-calls-v1";
const MOBILE_MESSAGE_CHANNEL_ID = "messages-v1";
const MOBILE_UPDATE_CHANNEL_ID = "updates-v1";
const MOBILE_PUSH_TOKEN_KEY = "mobile_push_token_v1";
const MAX_LOCATION_ACCURACY_M = 500;
const PASSCODE_MAX_LENGTH = 12;

function sanitizePasscodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PASSCODE_MAX_LENGTH);
}

function sanitizeUnlockInput(value: string, mode: "numeric" | "text"): string {
  if (mode === "numeric") {
    return sanitizePasscodeInput(value);
  }
  return value.slice(0, PASSCODE_MAX_LENGTH);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl: string, maxSide = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(dataUrl);
          return;
        }

        const scale = Math.min(1, maxSide / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function formatCallDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function App() {
  const [token, setToken] = useState<string | null>(() => readPersistedToken());
  const [isSessionBootstrapping, setIsSessionBootstrapping] = useState(() => Boolean(readPersistedToken()));
  const [sessionBootstrapError, setSessionBootstrapError] = useState<string | null>(null);
  const [sessionBootstrapNonce, setSessionBootstrapNonce] = useState(0);
  const [authStep, setAuthStep] = useState<AuthStep>("login");
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [tempTwoFAToken, setTempTwoFAToken] = useState("");
  const [twoFALoginCode, setTwoFALoginCode] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [messageType, setMessageType] = useState<MessageType>("TEXT");
  const [messageText, setMessageText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [locationLat, setLocationLat] = useState("");
  const [locationLng, setLocationLng] = useState("");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [typingFromUserId, setTypingFromUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // ── APP LOCK / PASSCODE ──
  const [appLockEnabled, setAppLockEnabled] = useState(() => !!localStorage.getItem("app_lock_hash"));
  const [appLocked, setAppLocked] = useState(() => !!localStorage.getItem("app_lock_hash"));
  const [lockPasscodeInput, setLockPasscodeInput] = useState("");
  const [unlockKeyboardMode, setUnlockKeyboardMode] = useState<"numeric" | "text">("numeric");
  const [showSetPasscode, setShowSetPasscode] = useState(false);
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [autoLockEnabled, setAutoLockEnabled] = useState(() => localStorage.getItem("auto_lock") === "true");
  const [autoLockMinutes, setAutoLockMinutes] = useState(() => parseInt(localStorage.getItem("auto_lock_minutes") ?? "5", 10));
  const autoLockTimerRef = useRef<number | null>(null);
  const lockPasscodeInputRef = useRef<HTMLInputElement | null>(null);

  // ── SETTINGS / NIGHT MODE ──
  const [showSettings, setShowSettings] = useState(false);
  const [publicIp, setPublicIp] = useState<string>("");
  const [ipLoading, setIpLoading] = useState(false);
  const fetchPublicIp = async () => {
    setIpLoading(true);
    try {
      if (isWails) {
        // Use Go HTTP client which respects proxy config
        const result: any = await FetchPublicIp();
        if (result.error) {
          setPublicIp("Error: " + result.error);
        } else {
          setPublicIp(result.ip || "Unknown");
        }
      } else {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setPublicIp(data.ip || "Unknown");
      }
    } catch {
      setPublicIp("Failed to detect");
    }
    setIpLoading(false);
  };

  // ── PROXY SETTINGS ──
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<string>("socks5");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxyLoaded, setProxyLoaded] = useState(false);
  const [nightMode] = useState(true);
  const [themeAccentColor, setThemeAccentColor] = useState(() => normalizeHexColor(localStorage.getItem("theme_accent_color"), "#0e7c66"));
  const [themeLayoutColor, setThemeLayoutColor] = useState(() => normalizeHexColor(localStorage.getItem("theme_layout_color"), "#1e2c3a"));
  const [themeTextColor, setThemeTextColor] = useState(() => normalizeHexColor(localStorage.getItem("theme_text_color"), "#e1e8ef"));
  const [themeBackgroundColor, setThemeBackgroundColor] = useState(() => normalizeHexColor(localStorage.getItem("theme_background_color"), "#17212b"));
  const [themeInputColor, setThemeInputColor] = useState(() => normalizeHexColor(localStorage.getItem("theme_input_color"), "#17212b"));
  const [themeProfileName, setThemeProfileName] = useState("");
  const [localThemeProfiles, setLocalThemeProfiles] = useState<LocalThemeProfile[]>(() => readLocalThemeProfiles());
  const [communityThemeProfiles, setCommunityThemeProfiles] = useState<CommunityThemeProfile[]>([]);
  const [themeProfilesLoading, setThemeProfilesLoading] = useState(false);
  const [themeProfilesSharing, setThemeProfilesSharing] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<"general" | "call" | "design" | "security" | "developer">("general");
  const [developerUnlocked, setDeveloperUnlocked] = useState(() => localStorage.getItem("developer_unlocked") === "true");
  const [developerTapCount, setDeveloperTapCount] = useState(0);
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<Record<string, true>>({});
  const [startupEnabled, setStartupEnabledState] = useState(false);
  const [closeToTray, setCloseToTray] = useState(() => localStorage.getItem("close_to_tray") !== "false");
  const [toastPosition, setToastPositionState] = useState<"bottom-left" | "bottom-right">("bottom-right");
  const [chatBackgroundImage, setChatBackgroundImage] = useState(() => localStorage.getItem("chat_bg_image") ?? "");
  const [ringtoneUrl, setRingtoneUrl] = useState(() => getRingtoneSourceInfo().url);
  const [ringtoneLabel, setRingtoneLabel] = useState(() => getRingtoneSourceInfo().label);
  const [ringtoneUploading, setRingtoneUploading] = useState(false);

  // ── CURSOR SETTINGS ──
  const [smoothCaret, setSmoothCaret] = useState(() => localStorage.getItem("smooth_caret") === "true");
  const [cursorBlink, setCursorBlink] = useState(() => localStorage.getItem("cursor_blink") !== "false");
  const [sendSound, setSendSound] = useState(() => localStorage.getItem("send_sound") !== "false");

  // ── SAVED MESSAGES (now handled via self-chat) ──

  // ── CHAT ORDER & PIN/ARCHIVE ──
  const [chatOrder, setChatOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("chat_order") ?? "[]"); } catch { return []; }
  });
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pinned_chats") ?? "[]")); } catch { return new Set(); }
  });
  const [archivedChats, setArchivedChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("archived_chats") ?? "[]")); } catch { return new Set(); }
  });
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId: string; type: "user" | "group" } | null>(null);
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});
  const [showMyProfile, setShowMyProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editStatusText, setEditStatusText] = useState("");
  const [editStatusEmoji, setEditStatusEmoji] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // ── CHAT SEARCH ──
  const [chatSearch, setChatSearch] = useState("");

  // ── MENTION STATE ──
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const ringtoneFileInputRef = useRef<HTMLInputElement>(null);

  // ── USER PROFILE VIEW (popup for any user) ──
  const [profileViewUser, setProfileViewUser] = useState<PublicUser | null>(null);

  // ── SHIFT+CLICK SELECTION ──
  const lastSelectedIndexRef = useRef<number | null>(null);

  const [twoFAQrDataUrl, setTwoFAQrDataUrl] = useState("");
  const [twoFASetupCode, setTwoFASetupCode] = useState("");
  const [twoFADisableCode, setTwoFADisableCode] = useState("");

  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number | null>(null);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>([]);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showForwardModal, setShowForwardModal] = useState(false);

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callPeerId, setCallPeerId] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [screenFullscreen, setScreenFullscreen] = useState(false);
  const [localScreenFullscreen, setLocalScreenFullscreen] = useState(false);
  const [callMinimized, setCallMinimized] = useState(false);
  const [callMicMuted, setCallMicMuted] = useState(false);
  const [iceProbeResults, setIceProbeResults] = useState<IceProbeResult[]>(() => loadIceProbeResults());
  const [iceProbing, setIceProbing] = useState(false);
  const [callStats, setCallStats] = useState<{
    upKbps: number;
    downKbps: number;
    rttMs: number | null;
    lossPct: number | null;
    durationSec: number;
    jitterMs: number | null;
    codec: string | null;
    iceState: string;
    connState: string;
    bytesSentTotal: number;
    bytesRecvTotal: number;
  }>({ upKbps: 0, downKbps: 0, rttMs: null, lossPct: null, durationSec: 0, jitterMs: null, codec: null, iceState: "new", connState: "new", bytesSentTotal: 0, bytesRecvTotal: 0 });
  const [callEvents, setCallEvents] = useState<{ t: number; msg: string; level: "info" | "warn" | "ok" | "err" }[]>([]);
  const callEventsRef = useRef<{ t: number; msg: string; level: "info" | "warn" | "ok" | "err" }[]>([]);
  const pushCallEvent = useCallback((msg: string, level: "info" | "warn" | "ok" | "err" = "info") => {
    const next = [...callEventsRef.current, { t: Date.now(), msg, level }].slice(-40);
    callEventsRef.current = next;
    setCallEvents(next);
    console.info(`[CallEvent][${level}] ${msg}`);
  }, []);
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [desktopInlineNotifications, setDesktopInlineNotifications] = useState<DesktopInlineNotification[]>([]);

  // ── AUDIO DEVICE SELECTION ──
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(() => localStorage.getItem("audio_input") ?? "");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(() => localStorage.getItem("audio_output") ?? "");
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [noiseReduction, setNoiseReduction] = useState<boolean>(() => {
    const saved = localStorage.getItem("noise_reduction");
    return saved ? saved === "true" : true;
  });
  const [micVolume, setMicVolume] = useState<number>(() =>
    normalizeVolumeLevel(parseFloat(localStorage.getItem("mic_volume") ?? "1"))
  );
  const [speakerVolume, setSpeakerVolume] = useState<number>(() =>
    normalizeVolumeLevel(parseFloat(localStorage.getItem("speaker_volume") ?? "1"))
  );
  const [isMicTesting, setIsMicTesting] = useState(false);
  const rnnoiseAssetsRef = useRef<any>(null);

  useEffect(() => {
    const initPurify = async () => {
      try {
        const response = await fetch(rnnoiseWasmUrl);
        const buffer = await response.arrayBuffer();
        const wasmModule = await WebAssembly.compile(buffer);
        rnnoiseAssetsRef.current = [RNNOISE_WORKLET_PUBLIC_URL, Promise.resolve(wasmModule)];
        console.log("RNNoise (WASM Wrapper) Initialized!");
      } catch (err: any) {
        console.error("RNNoise init error:", err);
        toast.error("AI Noise Filter ishlashda xatolik: " + err.message);
      }
    };
    initPurify();
  }, []);

  // ── GROUP STATE ──
  const [chatMode, setChatMode] = useState<ChatMode>("user");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("contacts");
  const [mobileBottomTab, setMobileBottomTab] = useState<MobileBottomTab>("chats");
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [isLoadingGroupMessages, setIsLoadingGroupMessages] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [showAddGroupMembers, setShowAddGroupMembers] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState("");
  const [groupTypingUserId, setGroupTypingUserId] = useState<string | null>(null);

  // ── GROUP CALL PARTICIPANTS ──
  const [groupCallParticipants, setGroupCallParticipants] = useState<{ userId: string; speaking: boolean }[]>([]);
  const [groupActiveCallUsers, setGroupActiveCallUsers] = useState<Record<string, string[]>>({});
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("participant_volumes") ?? "{}"); } catch { return {}; }
  });
  const [participantLatencyMs, setParticipantLatencyMs] = useState<Record<string, number>>({});
  const vadIntervalRef = useRef<number | null>(null);
  const wasSpeakingRef = useRef(false);

  // ── AUTO-UPDATE STATE ──
  const [updateAvailable, setUpdateAvailable] = useState<{ newVersion: string; notes: string } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSpeedMbps, setUpdateSpeedMbps] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState("...");
  const appVersionRef = useRef("...");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(() => localStorage.getItem("auto_update") !== "false");

  // ── RESIZABLE SIDEBAR ──
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => parseInt(localStorage.getItem("sidebar_width") ?? "340", 10));
  const sidebarDragging = useRef(false);

  const socketRef = useRef<Socket | null>(null);
  const selectedUserIdRef = useRef("");
  const currentUserIdRef = useRef("");
  const selectedGroupIdRef = useRef("");
  const usersRef = useRef<PublicUser[]>([]);
  const typingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordStartedAtRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformAnimRef = useRef<number>(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callAnswerTimeoutRef = useRef<number | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioCtxRef = useRef<AudioContext | null>(null);
  const callStatusRef = useRef<CallStatus>("idle");
  const callMicMutedRef = useRef(false);
  const callPeerIdRef = useRef<string | null>(null);
  const callGroupIdRef = useRef<string | null>(null);
  const groupPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const groupPeerStatsTimersRef = useRef<Map<string, number>>(new Map());
  const groupRemoteDescriptionSetRef = useRef<Map<string, boolean>>(new Map());
  const groupRemoteIceCandidatesBufferRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const groupRemoteAudioTracksRef = useRef<Map<string, MediaStreamTrack>>(new Map());
  const groupRemoteAudioStreamRef = useRef<MediaStream | null>(null);
  const callDisconnectedTimerRef = useRef<number | null>(null);
  const callStartTsRef = useRef<number>(0);
  const startCallRef = useRef<((overridePeerId?: string) => Promise<void>) | null>(null);
  const autoResumeAttemptedRef = useRef<boolean>(false);
  const defaultThemeAppliedRef = useRef<boolean>(false);
  const callStatsPrevRef = useRef<{ ts: number; bytesSent: number; bytesRecv: number; packetsLost: number; packetsRecv: number } | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteIceCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const googleAuthStateRef = useRef<string | null>(localStorage.getItem("pending_google_auth_state"));
  const themeProfileImportInputRef = useRef<HTMLInputElement | null>(null);
  const googleAuthPollIntervalRef = useRef<number | null>(null);
  const googleAuthTimeoutRef = useRef<number | null>(null);
  const googleAuthPollInFlightRef = useRef(false);
  const stopGoogleLoginPollingFnRef = useRef<(clearState?: boolean) => void>(() => {});
  const startGoogleLoginPollingFnRef = useRef<(state: string) => void>(() => {});
  const pollGoogleLoginOnceFnRef = useRef<(stateOverride?: string) => Promise<boolean>>(async () => false);
  const isAppActiveRef = useRef(true);
  const mobileCallNotificationsReadyRef = useRef(false);
  const mobileMessageNotificationIdRef = useRef(300000);
  const mobileUpdateNotificationIdRef = useRef(910000);
  const autoUpdateTriggeredVersionRef = useRef<string | null>(null);
  const scrollHideTimerRef = useRef<number | null>(null);
  const notificationAudioCtxRef = useRef<AudioContext | null>(null);
  const lastDesktopNotifSoundAtRef = useRef(0);
  const desktopNotifTimersRef = useRef<number[]>([]);
  const pendingCallActionHandlerRef = useRef<(action: "accept" | "decline", userId?: string) => void>(() => {});

  selectedUserIdRef.current = selectedUserId;
  currentUserIdRef.current = currentUser?.id ?? "";
  callMicMutedRef.current = callMicMuted;
  selectedGroupIdRef.current = selectedGroupId;
  usersRef.current = users;
  callStatusRef.current = callStatus;
  callPeerIdRef.current = callPeerId;

  // ── Enumerate audio devices ──
  const enumerateAudioDevices = useCallback(async () => {
    try {
      // Request permission first so labels are visible
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);

      // Selected output can become stale (USB/Bluetooth unplugged). Reset to default when missing.
      if (selectedAudioOutput && !outputs.some((d) => d.deviceId === selectedAudioOutput)) {
        setSelectedAudioOutput("");
        localStorage.removeItem("audio_output");
      }

      // Set defaults if not yet selected
      if (!selectedAudioInput && inputs.length > 0) {
        setSelectedAudioInput(inputs[0].deviceId);
      }
      if (!selectedAudioOutput && outputs.length > 0) {
        setSelectedAudioOutput(outputs[0].deviceId);
      }
    } catch (err) {
      console.error("Cannot enumerate audio devices:", err);
    }
  }, [selectedAudioInput, selectedAudioOutput]);

  // Listen for device changes
  useEffect(() => {
    navigator.mediaDevices.addEventListener("devicechange", enumerateAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateAudioDevices);
    };
  }, [enumerateAudioDevices]);

  // Apply output device to <audio> element
  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (audio && selectedAudioOutput && typeof (audio as any).setSinkId === "function") {
      (audio as any).setSinkId(selectedAudioOutput).catch((err: Error) => {
        console.error("Cannot set audio output device:", err);
        setSelectedAudioOutput("");
        localStorage.removeItem("audio_output");
      });
    }
  }, [selectedAudioOutput]);

  // Apply speaker volume to remote audio element
  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (audio) audio.volume = toMediaElementVolume(speakerVolume);
  }, [speakerVolume]);

  // ── Sidebar resize handler ──
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragging.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    let lastW = startW;
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragging.current) return;
      lastW = Math.max(200, Math.min(600, startW + (ev.clientX - startX)));
      setSidebarWidth(lastW);
    };
    const onUp = () => {
      sidebarDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("sidebar_width", String(lastW));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // Play call sounds based on status
  useEffect(() => {
    if (callStatus === "ringing") {
      startRingtone();
    } else if (callStatus === "calling") {
      startDialTone();
    } else {
      stopAllCallSounds();
    }
    return () => { stopAllCallSounds(); };
  }, [callStatus]);

  // ── Call stats polling: bitrate up/down, RTT, packet loss, duration ──
  useEffect(() => {
    if (callStatus !== "in-call") {
      callStartTsRef.current = 0;
      callStatsPrevRef.current = null;
      setCallStats({ upKbps: 0, downKbps: 0, rttMs: null, lossPct: null, durationSec: 0, jitterMs: null, codec: null, iceState: "new", connState: "new", bytesSentTotal: 0, bytesRecvTotal: 0 });
      return;
    }
    if (!callStartTsRef.current) callStartTsRef.current = Date.now();

    const tick = async () => {
      try {
        const peers: RTCPeerConnection[] = [];
        if (peerConnectionRef.current) peers.push(peerConnectionRef.current);
        groupPeerConnectionsRef.current.forEach((pc) => peers.push(pc));
        if (peers.length === 0) return;

        let bytesSent = 0;
        let bytesRecv = 0;
        let packetsLost = 0;
        let packetsRecv = 0;
        let rttSec: number | null = null;
        let jitterSec: number | null = null;
        const codecHolder: { mime: string | null } = { mime: null };
        const codecMap = new Map<string, string>();

        for (const pc of peers) {
          const stats = await pc.getStats();
          stats.forEach((r: any) => {
            if (r.type === "codec" && r.mimeType) codecMap.set(r.id, r.mimeType);
          });
          stats.forEach((r: any) => {
            if (r.type === "outbound-rtp" && r.kind === "audio") {
              if (typeof r.bytesSent === "number") bytesSent += r.bytesSent;
            }
            if (r.type === "inbound-rtp" && r.kind === "audio") {
              if (typeof r.bytesReceived === "number") bytesRecv += r.bytesReceived;
              if (typeof r.packetsLost === "number") packetsLost += r.packetsLost;
              if (typeof r.packetsReceived === "number") packetsRecv += r.packetsReceived;
              if (typeof r.jitter === "number" && (jitterSec == null || r.jitter > jitterSec)) jitterSec = r.jitter;
              if (!codecHolder.mime && r.codecId && codecMap.has(r.codecId)) codecHolder.mime = codecMap.get(r.codecId) ?? null;
            }
            if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
              if (typeof r.currentRoundTripTime === "number") rttSec = r.currentRoundTripTime;
            }
            if (rttSec == null && r.type === "remote-inbound-rtp" && typeof r.roundTripTime === "number") {
              rttSec = r.roundTripTime;
            }
          });
        }

        const now = Date.now();
        const prev = callStatsPrevRef.current;
        let upKbps = 0;
        let downKbps = 0;
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          if (dt > 0) {
            upKbps = Math.max(0, ((bytesSent - prev.bytesSent) * 8) / 1000 / dt);
            downKbps = Math.max(0, ((bytesRecv - prev.bytesRecv) * 8) / 1000 / dt);
          }
        }
        callStatsPrevRef.current = { ts: now, bytesSent, bytesRecv, packetsLost, packetsRecv };

        const totalRecv = packetsRecv + packetsLost;
        const lossPct = totalRecv > 0 ? (packetsLost / totalRecv) * 100 : null;
        const durationSec = Math.floor((now - callStartTsRef.current) / 1000);

        setCallStats({
          upKbps: Math.round(upKbps * 10) / 10,
          downKbps: Math.round(downKbps * 10) / 10,
          rttMs: rttSec != null ? Math.round(rttSec * 1000) : null,
          lossPct: lossPct != null ? Math.round(lossPct * 100) / 100 : null,
          durationSec,
          jitterMs: jitterSec != null ? Math.round((jitterSec as number) * 1000) : null,
          codec: codecHolder.mime ? codecHolder.mime.replace(/^audio\//, "") : null,
          iceState: peers[0]?.iceConnectionState ?? "new",
          connState: peers[0]?.connectionState ?? "new",
          bytesSentTotal: bytesSent,
          bytesRecvTotal: bytesRecv,
        });
      } catch {
        // ignore transient getStats errors
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [callStatus]);

  // ── Auto ICE probe on app start (once per session, cached in localStorage) ──
  useEffect(() => {
    const cached = loadIceProbeResults();
    const cachedAt = Number(localStorage.getItem("ice_probe_at") || "0");
    const ageMs = Date.now() - cachedAt;
    if (cached.length > 0 && ageMs < 6 * 60 * 60 * 1000) {
      console.info(`[ICE-Probe] Cached natija ishlatildi (${Math.round(ageMs / 60000)}m oldin)`, cached);
      return;
    }
    setIceProbing(true);
    probeAllIceServers().then((res) => {
      setIceProbeResults(res);
      localStorage.setItem("ice_probe_at", String(Date.now()));
      const okCount = res.filter((r) => r.ok).length;
      if (okCount === 0) {
        toast.error("Hech qaysi ICE server ishlamadi! Internet/firewall tekshiring.");
      } else {
        console.info(`[ICE-Probe] ${okCount}/${res.length} server ishlaydi`);
      }
    }).finally(() => setIceProbing(false));
  }, []);

  const activeUser = useMemo(
    () => (users ?? []).find((item) => item.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const activeGroup = useMemo(
    () => (groups ?? []).find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const activeUsersInSelectedGroupCall = useMemo(() => {
    if (!selectedGroupId) return [] as string[];
    return groupActiveCallUsers[selectedGroupId] ?? [];
  }, [groupActiveCallUsers, selectedGroupId]);

  const joinableActiveGroupUserIds = useMemo(() => {
    const me = currentUser?.id;
    return activeUsersInSelectedGroupCall.filter((userId) => userId !== me);
  }, [activeUsersInSelectedGroupCall, currentUser?.id]);

  const myGroupRole = useMemo<GroupRole | null>(() => {
    if (!activeGroup || !currentUser) return null;
    return activeGroup.members?.find((member) => member.userId === currentUser.id)?.role ?? null;
  }, [activeGroup, currentUser]);

  const canManageGroupMembers = myGroupRole === "OWNER" || myGroupRole === "ADMIN";
  const canAssignGroupAdmins = myGroupRole === "OWNER";

  useEffect(() => {
    setEditGroupName(activeGroup?.name ?? "");
  }, [activeGroup?.id, activeGroup?.name]);

  const isWails = isWailsRuntime;
  const updateActionLabel = isNativeMobileRuntime ? "Download APK" : "Update";

  // ── AUTO-SCROLL TO BOTTOM ──
  const scrollToBottom = useCallback((smooth = false) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView(smooth ? { behavior: "smooth" } : undefined);
    }, 50);
  }, []);

  // Scroll when messages change (new message received/sent)
  useEffect(() => {
    if (messages.length > 0) scrollToBottom(true);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (groupMessages.length > 0) scrollToBottom(true);
  }, [groupMessages, scrollToBottom]);

  // Scroll when switching to a different chat
  useEffect(() => { scrollToBottom(); }, [selectedUserId, scrollToBottom]);
  useEffect(() => { scrollToBottom(); }, [selectedGroupId, scrollToBottom]);

  // Desktop UX: focus composer after chat selection.
  useEffect(() => {
    if (isMobileViewport || !token || appLocked) return;
    const hasSelectedChat = chatMode === "group" ? Boolean(selectedGroupId) : Boolean(selectedUserId);
    if (!hasSelectedChat) return;

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [selectedUserId, selectedGroupId, chatMode, isMobileViewport, token, appLocked]);

  useEffect(() => {
    let browserFinishedHandle: PluginListenerHandle | undefined;
    let appResumeHandle: PluginListenerHandle | undefined;
    let appUrlOpenHandle: PluginListenerHandle | undefined;

    const resumeGoogleAuth = (stateOverride?: string | null) => {
      const nextState = stateOverride ?? googleAuthStateRef.current;
      if (nextState) {
        const startedAtRaw = localStorage.getItem(GOOGLE_AUTH_STATE_STARTED_AT_KEY);
        const startedAt = startedAtRaw ? Number(startedAtRaw) : NaN;
        if (!Number.isFinite(startedAt) || Date.now() - startedAt > GOOGLE_AUTH_STATE_TTL_MS) {
          stopGoogleLoginPollingFnRef.current();
          setGoogleAuthLoading(false);
          return;
        }
        if (stateOverride && stateOverride !== googleAuthStateRef.current) {
          startGoogleLoginPollingFnRef.current(stateOverride);
        }
        setGoogleAuthLoading(true);
        void pollGoogleLoginOnceFnRef.current(nextState);
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        resumeGoogleAuth();
      }
    };

    if (googleAuthStateRef.current && !token && !currentUser) {
      const startedAtRaw = localStorage.getItem(GOOGLE_AUTH_STATE_STARTED_AT_KEY);
      const startedAt = startedAtRaw ? Number(startedAtRaw) : NaN;
      if (!Number.isFinite(startedAt) || Date.now() - startedAt > GOOGLE_AUTH_STATE_TTL_MS) {
        stopGoogleLoginPollingFnRef.current();
        setGoogleAuthLoading(false);
      } else {
        setGoogleAuthLoading(true);
        startGoogleLoginPollingFnRef.current(googleAuthStateRef.current);
        void pollGoogleLoginOnceFnRef.current(googleAuthStateRef.current);
      }
    }

    if (isNativeMobileRuntime) {
      Browser.addListener("browserFinished", resumeGoogleAuth).then((handle) => {
        browserFinishedHandle = handle;
      }).catch(() => {});

      CapacitorApp.addListener("resume", resumeGoogleAuth).then((handle) => {
        appResumeHandle = handle;
      }).catch(() => {});

      CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        if (!url || !url.toLowerCase().startsWith(MOBILE_GOOGLE_AUTH_RETURN_TO.toLowerCase())) {
          return;
        }
        try {
          const deepLinkUrl = new URL(url);
          resumeGoogleAuth(deepLinkUrl.searchParams.get("state"));
        } catch {
          resumeGoogleAuth();
        }
      }).then((handle) => {
        appUrlOpenHandle = handle;
      }).catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopGoogleLoginPollingFnRef.current(false);
      void browserFinishedHandle?.remove();
      void appResumeHandle?.remove();
      void appUrlOpenHandle?.remove();
    };
  }, [currentUser, token]);

  // ── NIGHT MODE EFFECT ──
  useEffect(() => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("night_mode", "true");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const accent = normalizeHexColor(themeAccentColor, "#0e7c66");
    const layout = normalizeHexColor(themeLayoutColor, "#1e2c3a");
    const text = normalizeHexColor(themeTextColor, "#e1e8ef");
    const bg = normalizeHexColor(themeBackgroundColor, "#17212b");
    const input = normalizeHexColor(themeInputColor, "#17212b");

    const accentRgb = hexToRgb(accent);
    const textRgb = hexToRgb(text);

    root.style.setProperty("--custom-accent", accent);
    root.style.setProperty("--custom-accent-strong", shiftHexColor(accent, -24));
    root.style.setProperty(
      "--custom-accent-light",
      accentRgb ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.15)` : "rgba(14, 124, 102, 0.15)"
    );

    root.style.setProperty("--custom-dark-bg", bg);
    root.style.setProperty("--custom-dark-panel", layout);
    root.style.setProperty("--custom-dark-panel-hover", shiftHexColor(layout, 12));
    root.style.setProperty("--custom-dark-line", shiftHexColor(layout, 20));
    root.style.setProperty("--custom-dark-text", text);
    root.style.setProperty(
      "--custom-dark-muted",
      textRgb ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.65)` : "#8899a6"
    );
    root.style.setProperty("--custom-dark-bubble-theirs", shiftHexColor(layout, 14));

    root.style.setProperty("--custom-light-bg", bg);
    root.style.setProperty("--custom-light-panel", layout);
    root.style.setProperty("--custom-light-panel-hover", shiftHexColor(layout, 10));
    root.style.setProperty("--custom-light-line", shiftHexColor(layout, -12));
    root.style.setProperty("--custom-light-text", text);
    root.style.setProperty(
      "--custom-light-muted",
      textRgb ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.68)` : "#65676b"
    );
    root.style.setProperty("--custom-light-bubble-theirs", shiftHexColor(layout, -8));
    root.style.setProperty("--custom-light-bubble-theirs-text", text);
    root.style.setProperty("--custom-dark-input-bg", input);
    root.style.setProperty("--custom-light-input-bg", input);

    const captionColor = nightMode ? layout : shiftHexColor(layout, 6);
    const captionTextColor = nightMode ? text : shiftHexColor(text, -36);
    SetWindowCaptionTheme(captionColor, captionTextColor, nightMode).catch(() => {});

    localStorage.setItem("theme_accent_color", accent);
    localStorage.setItem("theme_layout_color", layout);
    localStorage.setItem("theme_text_color", text);
    localStorage.setItem("theme_background_color", bg);
    localStorage.setItem("theme_input_color", input);
  }, [themeAccentColor, themeLayoutColor, themeTextColor, themeBackgroundColor, themeInputColor, nightMode]);

  const getCurrentThemePalette = useCallback((): ThemePalette => ({
    accentColor: normalizeHexColor(themeAccentColor, DEFAULT_THEME_PALETTE.accentColor),
    layoutColor: normalizeHexColor(themeLayoutColor, DEFAULT_THEME_PALETTE.layoutColor),
    textColor: normalizeHexColor(themeTextColor, DEFAULT_THEME_PALETTE.textColor),
    backgroundColor: normalizeHexColor(themeBackgroundColor, DEFAULT_THEME_PALETTE.backgroundColor),
    inputColor: normalizeHexColor(themeInputColor, DEFAULT_THEME_PALETTE.inputColor),
  }), [themeAccentColor, themeLayoutColor, themeTextColor, themeBackgroundColor, themeInputColor]);

  const applyThemePalette = useCallback((palette: Partial<ThemePalette>) => {
    const next = normalizeThemePalette(palette);
    setThemeAccentColor(next.accentColor);
    setThemeLayoutColor(next.layoutColor);
    setThemeTextColor(next.textColor);
    setThemeBackgroundColor(next.backgroundColor);
    setThemeInputColor(next.inputColor);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_PROFILES_STORAGE_KEY, JSON.stringify(localThemeProfiles));
    } catch {
      // ignore quota/storage errors
    }
  }, [localThemeProfiles]);

  useEffect(() => {
    if (!showSettings || !token) return;
    let cancelled = false;

    const loadCommunityProfiles = async (silent = false) => {
      if (!silent) setThemeProfilesLoading(true);
      try {
        const res = await api.get<{ profiles: CommunityThemeProfile[] }>("/users/theme-profiles", {
          params: { limit: 80 },
        });
        if (!cancelled) {
          setCommunityThemeProfiles(Array.isArray(res.data?.profiles) ? res.data.profiles : []);
        }
      } catch {
        if (!cancelled && !silent) {
          toast.error("Community colorlar yuklanmadi");
        }
      } finally {
        if (!cancelled && !silent) {
          setThemeProfilesLoading(false);
        }
      }
    };

    void loadCommunityProfiles();
    const intervalId = window.setInterval(() => {
      void loadCommunityProfiles(true);
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showSettings, token]);

  useEffect(() => {
    if (!token || !currentUser || defaultThemeAppliedRef.current) return;

    const hasSavedTheme = [
      "theme_accent_color",
      "theme_layout_color",
      "theme_text_color",
      "theme_background_color",
      "theme_input_color",
    ].some((key) => Boolean(localStorage.getItem(key)));

    if (hasSavedTheme) {
      defaultThemeAppliedRef.current = true;
      return;
    }

    let cancelled = false;
    const loadDefaultTheme = async () => {
      try {
        const res = await api.get<{ profiles: CommunityThemeProfile[] }>("/users/theme-profiles", {
          params: { limit: 1 },
        });
        const profile = Array.isArray(res.data?.profiles) ? res.data.profiles[0] : null;
        if (!cancelled && profile) {
          applyThemePalette({
            accentColor: profile.accentColor,
            layoutColor: profile.layoutColor,
            textColor: profile.textColor,
            backgroundColor: profile.backgroundColor,
            inputColor: profile.inputColor,
          });
        }
      } catch {
        // ignore: keep fallback palette
      } finally {
        defaultThemeAppliedRef.current = true;
      }
    };

    void loadDefaultTheme();
    return () => {
      cancelled = true;
    };
  }, [token, currentUser, applyThemePalette]);

  const updateSpeedLabel = useMemo(() => {
    if (updateSpeedMbps === null) return "";
    const mbps = Math.max(0, updateSpeedMbps);
    const mbyte = mbps / 8;
    return ` · ${mbps.toFixed(2)} Mbit/s (${mbyte.toFixed(2)} MB/s)`;
  }, [updateSpeedMbps]);

  const handleDeveloperTap = useCallback(() => {
    if (developerUnlocked) {
      setSettingsCategory("developer");
      return;
    }
    setDeveloperTapCount((prev) => {
      const next = prev + 1;
      if (next >= 3) {
        setDeveloperUnlocked(true);
        localStorage.setItem("developer_unlocked", "true");
        setSettingsCategory("developer");
        toast.success("Developer mode enabled");
        return 0;
      }
      return next;
    });
  }, [developerUnlocked]);

  const saveCurrentThemeProfileLocally = useCallback(() => {
    const name = themeProfileName.trim() || `Theme ${localThemeProfiles.length + 1}`;
    const profile: LocalThemeProfile = {
      id: createThemeProfileId(),
      name: name.slice(0, 60),
      palette: getCurrentThemePalette(),
      createdAt: new Date().toISOString(),
    };
    setLocalThemeProfiles((prev) => [profile, ...prev].slice(0, 300));
    setThemeProfileName("");
    toast.success("Theme local saqlandi");
  }, [getCurrentThemePalette, localThemeProfiles.length, themeProfileName]);

  const exportThemeProfilesToFile = useCallback(() => {
    const payload = {
      version: THEME_PROFILES_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: localThemeProfiles,
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    downloadJsonFile(`theme-profiles-${stamp}.json`, payload);
    toast.success("Theme profilelar JSON ga export qilindi");
  }, [localThemeProfiles]);

  const importThemeProfilesFromFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const incomingRaw = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === "object" && Array.isArray((parsed as { profiles?: unknown[] }).profiles)
          ? (parsed as { profiles: unknown[] }).profiles
          : [parsed]);

      const imported = incomingRaw
        .map(parseThemeProfileFromUnknown)
        .filter((p): p is LocalThemeProfile => Boolean(p))
        .map((p) => ({ ...p, id: createThemeProfileId(), createdAt: new Date().toISOString() }));

      if (!imported.length) {
        toast.error("Import faylda profile topilmadi");
        return;
      }

      setLocalThemeProfiles((prev) => [...imported, ...prev].slice(0, 300));
      toast.success(`${imported.length} ta profile import qilindi`);
    } catch {
      toast.error("Import fayl noto'g'ri");
    }
  }, []);

  const shareCurrentThemeProfile = useCallback(async () => {
    const name = themeProfileName.trim();
    if (!name) {
      toast.error("Share qilish uchun nom kiriting");
      return;
    }
    setThemeProfilesSharing(true);
    try {
      const payload = {
        name: name.slice(0, 60),
        ...getCurrentThemePalette(),
        isPublic: true,
      };
      const res = await api.post<{ profile: CommunityThemeProfile }>("/users/theme-profiles", payload);
      const created = res.data?.profile;
      if (created) {
        setCommunityThemeProfiles((prev) => [created, ...prev]);
      }
      setThemeProfileName("");
      toast.success("Theme community ga joylandi");
    } catch {
      toast.error("Share bo'lmadi");
    } finally {
      setThemeProfilesSharing(false);
    }
  }, [getCurrentThemePalette, themeProfileName]);

  useEffect(() => {
    const root = document.documentElement;
    if (chatBackgroundImage) {
      const escaped = chatBackgroundImage.replace(/"/g, "\\\"");
      root.style.setProperty("--chat-bg-image", `url("${escaped}")`);
      localStorage.setItem("chat_bg_image", chatBackgroundImage);
    } else {
      root.style.removeProperty("--chat-bg-image");
      localStorage.removeItem("chat_bg_image");
    }
  }, [chatBackgroundImage]);

  useEffect(() => {
    const root = document.documentElement;
    const markScrolling = () => {
      root.classList.add("scroll-active");
      if (scrollHideTimerRef.current) {
        window.clearTimeout(scrollHideTimerRef.current);
      }
      scrollHideTimerRef.current = window.setTimeout(() => {
        root.classList.remove("scroll-active");
      }, 900);
    };

    const passiveCapture: AddEventListenerOptions = { passive: true, capture: true };
    const capture: AddEventListenerOptions = { capture: true };
    document.addEventListener("scroll", markScrolling, passiveCapture);
    document.addEventListener("wheel", markScrolling, passiveCapture);
    document.addEventListener("touchmove", markScrolling, passiveCapture);
    document.addEventListener("keydown", markScrolling, capture);
    document.addEventListener("mousedown", markScrolling, capture);

    return () => {
      if (scrollHideTimerRef.current) {
        window.clearTimeout(scrollHideTimerRef.current);
        scrollHideTimerRef.current = null;
      }
      root.classList.remove("scroll-active");
      document.removeEventListener("scroll", markScrolling, true);
      document.removeEventListener("wheel", markScrolling, true);
      document.removeEventListener("touchmove", markScrolling, true);
      document.removeEventListener("keydown", markScrolling, true);
      document.removeEventListener("mousedown", markScrolling, true);
    };
  }, []);

  useEffect(() => {
    GetAppVersionInfo().then((v: string) => {
      setAppVersion(v);
      appVersionRef.current = v;
    }).catch(() => {});

    const runUpdateCheck = () => {
      if (localStorage.getItem("auto_update") !== "false") {
        CheckForUpdate().then((result: any) => {
          if (result?.available) {
            setUpdateAvailable({ newVersion: result.newVersion, notes: result.notes || "" });
          }
        }).catch(() => {});
      }
    };

    runUpdateCheck();

    const handleVisibility = () => {
      if (!document.hidden) runUpdateCheck();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ── LOAD STARTUP STATE & SYNC CLOSE-TO-TRAY ──
  useEffect(() => {
    if (isWails) {
      GetStartupEnabled().then(setStartupEnabledState).catch(() => { });
      // Sync close-to-tray setting with Wails backend
      const savedCloseToTray = localStorage.getItem("close_to_tray") !== "false";
      SetCloseToTray(savedCloseToTray).catch(() => { });

      // ── AUTO-UPDATE CHECK ──
      GetAppVersionInfo().then((v: string) => { setAppVersion(v); appVersionRef.current = v; }).catch(() => {});
      const runUpdateCheck = () => {
        if (localStorage.getItem("auto_update") !== "false") {
          CheckForUpdate().then((result: any) => {
            if (result?.available) {
              setUpdateAvailable({ newVersion: result.newVersion, notes: result.notes || "" });
            }
          }).catch(() => { });
        }
      };
      runUpdateCheck();

      // Re-check update when window is restored from tray
      const handleVisibility = () => {
        if (!document.hidden) runUpdateCheck();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      return () => document.removeEventListener("visibilitychange", handleVisibility);
    }
  }, [isWails]);

  // ── CLEANUP CALL ON WINDOW CLOSE ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (callStatusRef.current !== "idle" && socketRef.current && callPeerIdRef.current) {
        socketRef.current.emit("call:end", { recipientId: callPeerIdRef.current, reason: "window-unload" });
      }
      silentCallCleanup(peerConnectionRef, localCallStreamRef, localScreenStreamRef);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ── SIMPLE PASSCODE HASH ──
  const hashPasscode = (code: string) => {
    let h = 0;
    for (let i = 0; i < code.length; i++) {
      h = ((h << 5) - h + code.charCodeAt(i)) | 0;
    }
    return String(h);
  };

  const handleUnlock = () => {
    const stored = localStorage.getItem("app_lock_hash");
    if (stored && hashPasscode(lockPasscodeInput) === stored) {
      setAppLocked(false);
      setLockPasscodeInput("");
    } else {
      toast.error("Incorrect password!");
      setLockPasscodeInput("");
    }
  };

  const handleSetPasscode = () => {
    if (newPasscode.length < 4) {
      toast.error("Password must be at least 4 characters.");
      return;
    }
    if (newPasscode !== confirmPasscode) {
      toast.error("Passwords do not match.");
      return;
    }
    localStorage.setItem("app_lock_hash", hashPasscode(newPasscode));
    setAppLockEnabled(true);
    setShowSetPasscode(false);
    setNewPasscode("");
    setConfirmPasscode("");
    toast.success("App passcode set!");
  };

  const handleRemovePasscode = () => {
    localStorage.removeItem("app_lock_hash");
    setAppLockEnabled(false);
    setAppLocked(false);
    toast.success("App passcode removed.");
  };

  const toggleStartup = async () => {
    if (!isWails) return;
    const next = !startupEnabled;
    try {
      const result = await SetStartupEnabled(next);
      setStartupEnabledState(result);
      toast.success(next ? "Launch at startup enabled" : "Launch at startup disabled");
    } catch {
      toast.error("Settings error");
    }
  };

  // saveMessage = forward to self-chat (handled inline in save button)
  // isMessageSaved / unsaveMessage no longer needed (old localStorage approach)

  const applySession = useCallback((nextToken: string, user: PublicUser) => {
    persistToken(nextToken);
    setToken(nextToken);
    setCurrentUser(user);
    setIsSessionBootstrapping(false);
    setSessionBootstrapError(null);
    setAuthStep("login");
    setTempTwoFAToken("");
    setTwoFALoginCode("");
  }, []);

  const clearSession = useCallback(() => {
    if (isNativeMobileRuntime) {
      const savedPushToken = localStorage.getItem(MOBILE_PUSH_TOKEN_KEY);
      if (savedPushToken) {
        api.delete("/users/push-token", { data: { token: savedPushToken } }).catch(() => {});
        localStorage.removeItem(MOBILE_PUSH_TOKEN_KEY);
      }
    }

    persistToken(null);
    setToken(null);
    setCurrentUser(null);
    setIsSessionBootstrapping(false);
    setSessionBootstrapError(null);
    setUsers([]);
    setSelectedUserId("");
    setMessages([]);
    setGroups([]);
    setSelectedGroupId("");
    setGroupMessages([]);
    setChatMode("user");
    setSidebarTab("contacts");
    setTwoFAQrDataUrl("");
    setTwoFASetupCode("");
    setTwoFADisableCode("");
    disconnectSocket(socketRef);
  }, []);

  useEffect(() => {
    if (!token) {
      setIsSessionBootstrapping(false);
      setSessionBootstrapError(null);
      return;
    }

    setIsSessionBootstrapping(true);
    setSessionBootstrapError(null);
  }, [token]);

  // ── GOOGLE SIGN-IN (Browser-based OAuth2 flow) ──
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);

  const clearPendingGoogleAuthState = useCallback(() => {
    googleAuthStateRef.current = null;
    localStorage.removeItem("pending_google_auth_state");
    localStorage.removeItem(GOOGLE_AUTH_STATE_STARTED_AT_KEY);
  }, []);

  const stopGoogleLoginPolling = useCallback((clearState = true) => {
    if (googleAuthPollIntervalRef.current) {
      window.clearInterval(googleAuthPollIntervalRef.current);
      googleAuthPollIntervalRef.current = null;
    }
    if (googleAuthTimeoutRef.current) {
      window.clearTimeout(googleAuthTimeoutRef.current);
      googleAuthTimeoutRef.current = null;
    }
    googleAuthPollInFlightRef.current = false;
    if (clearState) {
      clearPendingGoogleAuthState();
    }
  }, [clearPendingGoogleAuthState]);

  const completeGoogleLogin = useCallback((nextToken: string, user: PublicUser) => {
    stopGoogleLoginPolling();
    applySession(nextToken, user);
    toast.success("Google orqali kirildi!");
    setGoogleAuthLoading(false);
  }, [applySession, stopGoogleLoginPolling]);

  const pollGoogleLoginOnce = useCallback(async (stateOverride?: string) => {
    const state = stateOverride ?? googleAuthStateRef.current;
    if (!state || googleAuthPollInFlightRef.current) {
      return false;
    }

    googleAuthPollInFlightRef.current = true;
    try {
      const pollResp = await api.get<{ ready: boolean; token?: string; user?: PublicUser; expired?: boolean }>(`/auth/google/poll?state=${state}`);
      if (pollResp.data.ready && pollResp.data.token && pollResp.data.user) {
        completeGoogleLogin(pollResp.data.token, pollResp.data.user);
        return true;
      }
      if (pollResp.data.expired) {
        stopGoogleLoginPolling();
        setGoogleAuthLoading(false);
        toast.error("Vaqt tugadi. Qayta urinib ko'ring.");
      }
      return false;
    } catch {
      return false;
    } finally {
      googleAuthPollInFlightRef.current = false;
    }
  }, [completeGoogleLogin, stopGoogleLoginPolling]);

  const startGoogleLoginPolling = useCallback((state: string) => {
    googleAuthStateRef.current = state;
    localStorage.setItem("pending_google_auth_state", state);
    localStorage.setItem(GOOGLE_AUTH_STATE_STARTED_AT_KEY, String(Date.now()));

    if (googleAuthPollIntervalRef.current) {
      window.clearInterval(googleAuthPollIntervalRef.current);
    }
    googleAuthPollIntervalRef.current = window.setInterval(() => {
      void pollGoogleLoginOnce(state);
    }, 1500);

    if (googleAuthTimeoutRef.current) {
      window.clearTimeout(googleAuthTimeoutRef.current);
    }
    googleAuthTimeoutRef.current = window.setTimeout(() => {
      if (googleAuthStateRef.current === state) {
        stopGoogleLoginPolling();
        setGoogleAuthLoading(false);
        toast.error("Google login vaqti tugadi.");
      }
    }, 2 * 60 * 1000);
  }, [pollGoogleLoginOnce, stopGoogleLoginPolling]);

  const startGoogleLogin = useCallback(async () => {
    setGoogleAuthLoading(true);
    stopGoogleLoginPolling();
    try {
      const resp = await api.get<{ url: string; state: string }>("/auth/google/desktop", {
        params: isNativeMobileRuntime ? { returnTo: MOBILE_GOOGLE_AUTH_RETURN_TO } : undefined,
      });
      const { url, state } = resp.data;
      startGoogleLoginPolling(state);
      BrowserOpenURL(url);
      void pollGoogleLoginOnce(state);
    } catch (error) {
      toast.error(readAxiosMessage(error, "Google login xatolik."));
      setGoogleAuthLoading(false);
      stopGoogleLoginPolling();
    }
  }, [pollGoogleLoginOnce, startGoogleLoginPolling, stopGoogleLoginPolling]);

  const handleUpdateInstall = useCallback(async () => {
    if (callStatusRef.current !== "idle") {
      if (socketRef.current && callPeerIdRef.current) {
        socketRef.current.emit("call:end", { recipientId: callPeerIdRef.current, reason: "ended" });
      }
    }
    setIsUpdating(true);
    setUpdateProgress(0);
    setUpdateSpeedMbps(null);
    try {
      const result: any = await DownloadAndUpdate();
      if (result?.external) {
        setIsUpdating(false);
        setUpdateProgress(0);
        setUpdateSpeedMbps(null);
        setUpdateAvailable(null);
        toast.success("APK yuklab olish ochildi. O'rnatib yangilang.");
        return;
      }
      if (!result?.success) {
        toast.error("Update error: " + (result?.error || "Unknown error"));
        setIsUpdating(false);
        setUpdateProgress(0);
        setUpdateSpeedMbps(null);
      }
    } catch {
      toast.error("Update error");
      setIsUpdating(false);
      setUpdateProgress(0);
      setUpdateSpeedMbps(null);
    }
  }, []);

  useEffect(() => {
    if (!updateAvailable) {
      autoUpdateTriggeredVersionRef.current = null;
      return;
    }

    if (!isNativeMobileRuntime || !autoUpdateEnabled || isUpdating) {
      return;
    }

    if (autoUpdateTriggeredVersionRef.current === updateAvailable.newVersion) {
      return;
    }

    autoUpdateTriggeredVersionRef.current = updateAvailable.newVersion;
    toast("Yangi versiya topildi. Yuklab olish boshlandi...");
    void handleUpdateInstall();
  }, [updateAvailable, autoUpdateEnabled, isUpdating, handleUpdateInstall]);

  stopGoogleLoginPollingFnRef.current = stopGoogleLoginPolling;
  startGoogleLoginPollingFnRef.current = startGoogleLoginPolling;
  pollGoogleLoginOnceFnRef.current = pollGoogleLoginOnce;

  const ensureMobileCallNotificationsReady = useCallback(async () => {
    if (!isNativeMobileRuntime) {
      return false;
    }

    if (mobileCallNotificationsReadyRef.current) {
      return true;
    }

    try {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display === "prompt") {
        const requested = await LocalNotifications.requestPermissions();
        if (requested.display !== "granted") {
          return false;
        }
      } else if (permission.display !== "granted") {
        return false;
      }

      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: MOBILE_CALL_ACTION_TYPE_ID,
            actions: [
              { id: MOBILE_CALL_ACCEPT_ACTION_ID, title: "Accept" },
              { id: MOBILE_CALL_DECLINE_ACTION_ID, title: "Deny" },
            ],
          },
        ],
      });

      await LocalNotifications.createChannel({
        id: MOBILE_CALL_CHANNEL_ID,
        name: "Incoming Calls",
        description: "Incoming call alerts",
        importance: 5,
        visibility: 1,
        vibration: true,
        sound: "incoming_call.wav",
      });

      await LocalNotifications.createChannel({
        id: MOBILE_MESSAGE_CHANNEL_ID,
        name: "Messages",
        description: "New message alerts",
        importance: 4,
        visibility: 1,
        vibration: true,
      });

      await LocalNotifications.createChannel({
        id: MOBILE_UPDATE_CHANNEL_ID,
        name: "Updates",
        description: "App update alerts",
        importance: 5,
        visibility: 1,
        vibration: true,
      });

      mobileCallNotificationsReadyRef.current = true;
      return true;
    } catch (error) {
      console.warn("[Mobile] notification setup failed:", error);
      return false;
    }
  }, []);

  const clearMobileCallNotification = useCallback(async () => {
    if (!isNativeMobileRuntime) {
      return;
    }

    try {
      await LocalNotifications.cancel({
        notifications: [{ id: MOBILE_CALL_NOTIFICATION_ID }],
      });
      const delivered = await LocalNotifications.getDeliveredNotifications();
      const activeNotifications = delivered.notifications
        .filter((item) => item.id === MOBILE_CALL_NOTIFICATION_ID);
      if (activeNotifications.length > 0) {
        await LocalNotifications.removeDeliveredNotifications({
          notifications: activeNotifications,
        });
      }
    } catch (error) {
      console.warn("[Mobile] notification cleanup failed:", error);
    }
  }, []);

  const showMobileIncomingCallNotification = useCallback(async (title: string, body: string, callerName: string) => {
    if (!isNativeMobileRuntime) {
      return;
    }

    const isReady = await ensureMobileCallNotificationsReady();
    if (!isReady) {
      return;
    }

    try {
      await clearMobileCallNotification();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: MOBILE_CALL_NOTIFICATION_ID,
            title,
            body,
            largeBody: body,
            summaryText: callerName,
            channelId: MOBILE_CALL_CHANNEL_ID,
            actionTypeId: MOBILE_CALL_ACTION_TYPE_ID,
            ongoing: true,
            autoCancel: false,
            smallIcon: "ic_stat_call",
            iconColor: "#22c55e",
            extra: {
              kind: "incoming-call",
            },
          },
        ],
      });
    } catch (error) {
      console.warn("[Mobile] incoming call notification failed:", error);
    }
  }, [clearMobileCallNotification, ensureMobileCallNotificationsReady]);

  const showMobileMessageNotification = useCallback(async (title: string, body: string, target?: NotificationTarget) => {
    if (!isNativeMobileRuntime) {
      return;
    }

    // Show local notification during active call even when app is foregrounded.
    if (isAppActiveRef.current && callStatusRef.current === "idle") {
      return;
    }

    const isReady = await ensureMobileCallNotificationsReady();
    if (!isReady) {
      return;
    }

    try {
      mobileMessageNotificationIdRef.current += 1;
      if (mobileMessageNotificationIdRef.current > 900000) {
        mobileMessageNotificationIdRef.current = 300000;
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: mobileMessageNotificationIdRef.current,
            title,
            body,
            largeBody: body,
            channelId: MOBILE_MESSAGE_CHANNEL_ID,
            smallIcon: "ic_stat_call",
            iconColor: "#22c55e",
            extra: {
              kind: "incoming-message",
              ...(target?.chatMode === "user"
                ? { chatMode: "user", userId: target.userId }
                : target?.chatMode === "group"
                  ? { chatMode: "group", groupId: target.groupId }
                  : {}),
            },
          },
        ],
      });
    } catch (error) {
      console.warn("[Mobile] message notification failed:", error);
    }
  }, [ensureMobileCallNotificationsReady]);

  const showMobileUpdateNotification = useCallback(async (title: string, body: string) => {
    if (!isNativeMobileRuntime) {
      return;
    }

    const isReady = await ensureMobileCallNotificationsReady();
    if (!isReady) {
      return;
    }

    try {
      mobileUpdateNotificationIdRef.current += 1;
      if (mobileUpdateNotificationIdRef.current > 980000) {
        mobileUpdateNotificationIdRef.current = 910000;
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: mobileUpdateNotificationIdRef.current,
            title,
            body,
            largeBody: body,
            channelId: MOBILE_UPDATE_CHANNEL_ID,
            smallIcon: "ic_stat_call",
            iconColor: "#22c55e",
            extra: {
              kind: "update-available",
            },
          },
        ],
      });
    } catch (error) {
      console.warn("[Mobile] update notification failed:", error);
    }
  }, [ensureMobileCallNotificationsReady]);

  useEffect(() => {
    if (isNativeMobileRuntime) {
      void ensureMobileCallNotificationsReady();
    }
  }, [ensureMobileCallNotificationsReady]);

  useEffect(() => {
    if (!isNativeMobileRuntime || !token || !currentUser) {
      return;
    }

    let registrationHandle: PluginListenerHandle | undefined;
    let registrationErrorHandle: PluginListenerHandle | undefined;
    let pushReceivedHandle: PluginListenerHandle | undefined;
    let pushActionHandle: PluginListenerHandle | undefined;

    const setupPush = async () => {
      try {
        const permission = await PushNotifications.checkPermissions();
        const status = permission.receive === "prompt"
          ? await PushNotifications.requestPermissions()
          : permission;

        if (status.receive !== "granted") {
          return;
        }

        registrationHandle = await PushNotifications.addListener("registration", (tokenInfo) => {
          const nextToken = tokenInfo?.value;
          if (!nextToken) return;
          api.post("/users/push-token", { token: nextToken, platform: "android" }).then(() => {
            localStorage.setItem(MOBILE_PUSH_TOKEN_KEY, nextToken);
          }).catch(() => {});
        });

        registrationErrorHandle = await PushNotifications.addListener("registrationError", () => {
          // Keep app usable even if push registration fails.
        });

        pushReceivedHandle = await PushNotifications.addListener("pushNotificationReceived", async (notification) => {
          const kind = notification?.data?.kind;
          if (kind !== "update-available") {
            return;
          }

          const version = typeof notification.data?.version === "string" ? notification.data.version : "";
          const notes = typeof notification.data?.notes === "string"
            ? notification.data.notes
            : (notification.body ?? "");

          if (version) {
            setUpdateAvailable((prev) => {
              if (prev?.newVersion === version) {
                return prev;
              }
              return { newVersion: version, notes };
            });
          } else {
            const result = await CheckForUpdate();
            if (result?.available && result?.newVersion) {
              setUpdateAvailable({ newVersion: result.newVersion, notes: result.notes || "" });
            }
          }

          const title = notification.title || "New update available";
          const body = notification.body || (version ? `Version ${version} is ready to install` : "A newer app version is ready.");
          await showMobileUpdateNotification(title, body);
        });

        pushActionHandle = await PushNotifications.addListener("pushNotificationActionPerformed", async (event) => {
          if (event.notification?.data?.kind !== "update-available") {
            return;
          }

          const version = typeof event.notification?.data?.version === "string" ? event.notification.data.version : "";
          if (version) {
            const notes = typeof event.notification?.data?.notes === "string" ? event.notification.data.notes : "";
            setUpdateAvailable({ newVersion: version, notes });
            return;
          }

          const result = await CheckForUpdate();
          if (result?.available && result?.newVersion) {
            setUpdateAvailable({ newVersion: result.newVersion, notes: result.notes || "" });
          }
        });

        await PushNotifications.register();
      } catch {
        // Ignore push setup errors on unsupported runtimes.
      }
    };

    void setupPush();

    return () => {
      void registrationHandle?.remove();
      void registrationErrorHandle?.remove();
      void pushReceivedHandle?.remove();
      void pushActionHandle?.remove();
    };
  }, [token, currentUser, showMobileUpdateNotification]);

  const fetchUsers = useCallback(async () => {
    const response = await api.get<{ users: PublicUser[] }>("/users");
    const fetchedUsers = response.data.users ?? [];
    setUsers(fetchedUsers);
    if (!selectedUserIdRef.current && fetchedUsers.length > 0) {
      setSelectedUserId(fetchedUsers[0].id);
    }
  }, []);

  const fetchMessages = useCallback(async (otherUserId: string) => {
    if (!otherUserId) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    try {
      const response = await api.get<{ messages: Message[] }>(`/messages/${otherUserId}?limit=50`);
      setMessages(response.data.messages);
      // Mark messages from the other user as read
      api.post(`/messages/read/${otherUserId}`).catch(() => {});
      if (socketRef.current) {
        socketRef.current.emit("message:read", { senderId: otherUserId });
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await api.get<{ groups: Group[] }>("/groups");
      setGroups(response.data.groups ?? []);
    } catch {
      // silent
    }
  }, []);

  const markGroupMessagesSeen = useCallback((groupId: string, messagesToCheck: GroupMessage[]) => {
    const socket = socketRef.current;
    const me = currentUserIdRef.current;

    const canEmitSeen =
      chatMode === "group" &&
      selectedGroupIdRef.current === groupId &&
      document.hasFocus() &&
      (!isNativeMobileRuntime || (isAppActiveRef.current && isMobileChatOpen));

    if (!socket || !groupId || !canEmitSeen || !messagesToCheck.length) {
      return;
    }

    const unseenMessageIds = messagesToCheck
      .filter((msg) => msg.senderId !== me)
      .filter((msg) => !(msg.seenBy ?? []).some((seen) => seen.userId === me))
      .map((msg) => msg.id);

    if (unseenMessageIds.length > 0) {
      socket.emit("group:message:seen", { groupId, messageIds: unseenMessageIds });
    }
  }, [chatMode, isMobileChatOpen]);

  const fetchGroupMessages = useCallback(async (groupId: string) => {
    if (!groupId) {
      setGroupMessages([]);
      return;
    }
    setIsLoadingGroupMessages(true);
    try {
      const response = await api.get<{ messages: GroupMessage[] }>(`/groups/${groupId}/messages?limit=50`);
      const fetchedMessages = response.data.messages ?? [];
      setGroupMessages(fetchedMessages);
      markGroupMessagesSeen(groupId, fetchedMessages);
    } finally {
      setIsLoadingGroupMessages(false);
    }
  }, [markGroupMessagesSeen]);

  const fetchMe = useCallback(async () => {
    const response = await api.get<{ user: PublicUser }>("/auth/me");
    setCurrentUser(response.data.user);
  }, []);

  const withSocketAck = useCallback(
    <T,>(event: string, payload: unknown) => {
      const socket = socketRef.current;
      if (!socket) {
        return Promise.reject(new Error("Socket not connected."));
      }
      return new Promise<T>((resolve, reject) => {
        socket.emit(event, payload, (ack: { ok: boolean; message?: T; error?: string }) => {
          if (!ack?.ok) {
            reject(new Error(ack?.error ?? "Socket error."));
            return;
          }
          resolve(ack.message as T);
        });
      });
    },
    []
  );

  const openNotificationTarget = useCallback((target?: NotificationTarget) => {
    if (target?.chatMode === "user") {
      setChatMode("user");
      setSelectedUserId(target.userId);
      setSelectedGroupId("");
      setMobileBottomTab("chats");
      if (isMobileViewport) setIsMobileChatOpen(true);
      return;
    }

    if (target?.chatMode === "group") {
      setChatMode("group");
      setSelectedGroupId(target.groupId);
      setSelectedUserId("");
      setMobileBottomTab("chats");
      if (isMobileViewport) setIsMobileChatOpen(true);
    }
  }, [isMobileViewport]);

  const syncActiveChatSnapshot = useCallback(() => {
    if (!token || appLocked) {
      return;
    }

    if (chatMode === "user" && selectedUserIdRef.current) {
      fetchMessages(selectedUserIdRef.current).catch(() => undefined);
      return;
    }

    if (chatMode === "group" && selectedGroupIdRef.current) {
      fetchGroupMessages(selectedGroupIdRef.current).catch(() => undefined);
    }
  }, [appLocked, chatMode, fetchGroupMessages, fetchMessages, token]);

  useEffect(() => {
    if (!isWails) {
      return;
    }

    const timer = window.setInterval(() => {
      void ConsumePendingNotificationTarget().then((raw) => {
        if (!raw) {
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.kind === "call-action") {
            const action = parsed?.action === "accept" ? "accept" : "decline";
            const userId = typeof parsed?.userId === "string" ? parsed.userId : undefined;
            pendingCallActionHandlerRef.current(action, userId);
            return;
          }
          openNotificationTarget(readNotificationTarget(parsed));
        } catch {
          // Ignore malformed target payload and continue polling.
        }
      });
    }, 750);

    return () => {
      window.clearInterval(timer);
    };
  }, [isWails, openNotificationTarget]);

  const dismissDesktopInlineNotification = useCallback((id: string) => {
    setDesktopInlineNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushDesktopInlineNotification = useCallback(
    (title: string, body: string, target?: DesktopInlineNotification["target"]) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setDesktopInlineNotifications((prev) => [{ id, title, body, target }, ...prev].slice(0, 4));

      const timer = window.setTimeout(() => {
        dismissDesktopInlineNotification(id);
        desktopNotifTimersRef.current = desktopNotifTimersRef.current.filter((item) => item !== timer);
      }, 9000);
      desktopNotifTimersRef.current.push(timer);
    },
    [dismissDesktopInlineNotification]
  );

  const openDesktopInlineNotification = useCallback(
    (notification: DesktopInlineNotification) => {
      openNotificationTarget(notification.target);
      dismissDesktopInlineNotification(notification.id);
    },
    [dismissDesktopInlineNotification, openNotificationTarget]
  );

  const notifyIncoming = useCallback(
    async (title: string, body: string, target?: DesktopInlineNotification["target"]) => {
      if (isWails) {
        pushDesktopInlineNotification(title, body, target);
        // Play a single soft custom chime (Discord-like) and avoid duplicate dings.
        const now = Date.now();
        if (now - lastDesktopNotifSoundAtRef.current > 900) {
          lastDesktopNotifSoundAtRef.current = now;
          try {
            if (!notificationAudioCtxRef.current || notificationAudioCtxRef.current.state === "closed") {
              notificationAudioCtxRef.current = new AudioContext();
            }
            const ctx = notificationAudioCtxRef.current;
            if (ctx.state === "suspended") {
              await ctx.resume();
            }
            const t0 = ctx.currentTime;
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            filter.type = "lowpass";
            filter.frequency.value = 2600;
            osc.type = "triangle";
            osc.frequency.setValueAtTime(980, t0);
            osc.frequency.exponentialRampToValueAtTime(740, t0 + 0.11);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(0.055, t0 + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.18);
          } catch {
            // Keep notifications visible even if audio context fails.
          }
        }
        ShowCustomToast(title, body, target).catch(() => {
          ShowOSNotification(title, body).catch(() => { });
        });
        return;
      }

      if (isNativeMobileRuntime) {
        await showMobileMessageNotification(title, body, target);
      }
    },
    [isWails, pushDesktopInlineNotification, showMobileMessageNotification]
  );

  useEffect(() => {
    return () => {
      notificationAudioCtxRef.current?.close().catch(() => { });
      notificationAudioCtxRef.current = null;
      desktopNotifTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      desktopNotifTimersRef.current = [];
    };
  }, []);

  const stopCall = useCallback((keepRemoteState = false) => {
    if (callDisconnectedTimerRef.current) {
      window.clearTimeout(callDisconnectedTimerRef.current);
      callDisconnectedTimerRef.current = null;
    }
    if (callAnswerTimeoutRef.current) {
      window.clearTimeout(callAnswerTimeoutRef.current);
      callAnswerTimeoutRef.current = null;
    }
    callEventsRef.current = [];
    setCallEvents([]);
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop());
    localCallStreamRef.current = null;
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Stop mic test if running
    micTestStreamRef.current?.getTracks().forEach(t => t.stop());
    micTestStreamRef.current = null;
    micTestAudioCtxRef.current?.close().catch(() => {});
    micTestAudioCtxRef.current = null;
    localScreenStreamRef.current = null;
    // Clean up mic audio context & gain
    micAudioContextRef.current?.close().catch(() => {});
    micAudioContextRef.current = null;
    micGainNodeRef.current = null;
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    setScreenFullscreen(false);
    setLocalScreenFullscreen(false);
    setCallMinimized(false);
    setCallMicMuted(false);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    groupPeerConnectionsRef.current.forEach((peer) => {
      peer.close();
    });
    groupPeerConnectionsRef.current.clear();
    groupPeerStatsTimersRef.current.forEach((timer) => {
      window.clearInterval(timer);
    });
    groupPeerStatsTimersRef.current.clear();
    setParticipantLatencyMs({});
    groupRemoteDescriptionSetRef.current.clear();
    groupRemoteIceCandidatesBufferRef.current.clear();
    groupRemoteAudioTracksRef.current.clear();
    groupRemoteAudioStreamRef.current = null;

    if (!keepRemoteState && socketRef.current) {
      if (callGroupIdRef.current) {
        socketRef.current.emit("group:call:leave", { groupId: callGroupIdRef.current });
      } else if (callPeerIdRef.current) {
        socketRef.current.emit("call:end", { recipientId: callPeerIdRef.current, reason: "ended" });
      }
    }
    // Clear persistent active-call state (graceful end → no auto-resume)
    clearActiveCallState();
    callGroupIdRef.current = null;
    pendingIceCandidatesRef.current = [];
    remoteIceCandidatesBufferRef.current = [];
    remoteDescriptionSetRef.current = false;
    // Stop VAD
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    wasSpeakingRef.current = false;
    setGroupCallParticipants([]);
    playEndCallSound();
    // Hide floating call notification
    HideCallNotif().catch(() => { });
    void clearMobileCallNotification();
    // Restore normal window (remove always-on-top)
    RestoreNormalWindow().catch(() => { });
    setCallStatus("idle");
    setCallPeerId(null);
    setIncomingCall(null);
  }, [clearMobileCallNotification]);

  const toggleCallMicMute = useCallback(() => {
    if (callStatusRef.current === "idle") return;

    const nextMuted = !callMicMutedRef.current;
    setCallMicMuted(nextMuted);

    const localStream = localCallStreamRef.current;
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio") {
          sender.track.enabled = !nextMuted;
        }
      });
    }

    if (callGroupIdRef.current) {
      if (nextMuted) {
        socketRef.current?.emit("group:call:speaking", { groupId: callGroupIdRef.current, speaking: false });
      }
      const myId = currentUserIdRef.current;
      if (myId) {
        setGroupCallParticipants((prev) => prev.map((p) => (p.userId === myId ? { ...p, speaking: false } : p)));
      }
    }

    toast(nextMuted ? "Mic muted" : "Mic unmuted");
  }, []);

  /** Start Voice Activity Detection — emits group:call:speaking events */
  const startVAD = useCallback((stream: MediaStream, groupId: string) => {
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
    try {
      const actx = new AudioContext();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      vadIntervalRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const isSpeaking = avg > 12;
        if (isSpeaking !== wasSpeakingRef.current) {
          wasSpeakingRef.current = isSpeaking;
          const myUserId = currentUserIdRef.current;
          setGroupCallParticipants((prev) =>
            prev.map((item) => (item.userId === myUserId ? { ...item, speaking: isSpeaking } : item))
          );
          socketRef.current?.emit("group:call:speaking", { groupId, speaking: isSpeaking });
        }
      }, 150);
    } catch (e) {
      console.warn("[VAD] failed:", e);
    }
  }, []);

  const requestGroupCallStatus = useCallback((groupId: string) => {
    if (!groupId || !socketRef.current) return;
    socketRef.current.emit("group:call:status", { groupId });
  }, []);

  const stopGroupPeerStats = useCallback((targetUserId: string) => {
    const timer = groupPeerStatsTimersRef.current.get(targetUserId);
    if (typeof timer === "number") {
      window.clearInterval(timer);
      groupPeerStatsTimersRef.current.delete(targetUserId);
    }
    setParticipantLatencyMs((prev) => {
      if (!(targetUserId in prev)) return prev;
      const next = { ...prev };
      delete next[targetUserId];
      return next;
    });
  }, []);

  const updateGroupPeerLatency = useCallback(async (targetUserId: string, peer: RTCPeerConnection) => {
    try {
      const stats = await peer.getStats();
      let rttSec: number | null = null;

      stats.forEach((report) => {
        if (
          report.type === "candidate-pair" &&
          (report as RTCStats & { state?: string }).state === "succeeded"
        ) {
          const pair = report as RTCStats & {
            currentRoundTripTime?: number;
            nominated?: boolean;
            selected?: boolean;
          };
          const candidateRtt = pair.currentRoundTripTime;
          const selected = Boolean(pair.nominated || pair.selected);
          if (typeof candidateRtt === "number" && Number.isFinite(candidateRtt) && selected) {
            rttSec = candidateRtt;
          }
        }

        if (rttSec == null && report.type === "remote-inbound-rtp") {
          const inbound = report as RTCStats & { roundTripTime?: number };
          if (typeof inbound.roundTripTime === "number" && Number.isFinite(inbound.roundTripTime)) {
            rttSec = inbound.roundTripTime;
          }
        }
      });

      if (rttSec == null) return;
      const latencyMs = Math.max(0, Math.round(rttSec * 1000));
      setParticipantLatencyMs((prev) => (prev[targetUserId] === latencyMs ? prev : { ...prev, [targetUserId]: latencyMs }));
    } catch {
      // Ignore transient getStats errors while renegotiating.
    }
  }, []);

  const logSelectedIceRoute = useCallback(async (peer: RTCPeerConnection, scope: string) => {
    try {
      const stats = await peer.getStats();
      let selectedPair: any = null;
      const localCandidates = new Map<string, { candidateType?: string; protocol?: string; relayProtocol?: string }>();
      const remoteCandidates = new Map<string, { candidateType?: string; protocol?: string; relayProtocol?: string }>();

      stats.forEach((report) => {
        if (report.type === "local-candidate") {
          localCandidates.set(report.id, report as { candidateType?: string; protocol?: string; relayProtocol?: string });
          return;
        }
        if (report.type === "remote-candidate") {
          remoteCandidates.set(report.id, report as { candidateType?: string; protocol?: string; relayProtocol?: string });
          return;
        }
        if (report.type === "candidate-pair") {
          const pair = report as any;
          if (pair.state === "succeeded" && (pair.nominated || pair.selected)) {
            selectedPair = pair;
          }
        }
      });

      if (!selectedPair) {
        console.warn(`[WebRTC][${scope}] selected candidate pair topilmadi`);
        return;
      }

      const pair: any = selectedPair;

      const local = pair.localCandidateId ? localCandidates.get(pair.localCandidateId) : undefined;
      const remote = pair.remoteCandidateId ? remoteCandidates.get(pair.remoteCandidateId) : undefined;

      console.log(`[WebRTC][${scope}] selected route`, {
        forceRelay: FORCE_WEBRTC_RELAY,
        localType: local?.candidateType,
        localProtocol: local?.protocol,
        localRelayProtocol: local?.relayProtocol,
        remoteType: remote?.candidateType,
        remoteProtocol: remote?.protocol,
        remoteRelayProtocol: remote?.relayProtocol,
        rttSec: pair.currentRoundTripTime
      });
      // Surface in overlay event log
      const lt = local?.candidateType ?? "?";
      const rt = remote?.candidateType ?? "?";
      const rttMs = pair.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : null;
      const isP2P = lt !== "relay" && rt !== "relay";
      pushCallEvent(
        `route ${lt}↔${rt}${rttMs !== null ? ` (${rttMs}ms)` : ""} ${isP2P ? "P2P" : "TURN"}`,
        isP2P ? "ok" : "info"
      );
    } catch (err) {
      console.warn(`[WebRTC][${scope}] getStats route log xato:`, err);
    }
  }, [pushCallEvent]);

  const syncGroupRemoteAudio = useCallback(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;
    if (!groupRemoteAudioStreamRef.current) {
      groupRemoteAudioStreamRef.current = new MediaStream();
    }
    audio.srcObject = groupRemoteAudioStreamRef.current;
    audio.muted = false;
    audio.volume = toMediaElementVolume(speakerVolume);
    if (selectedAudioOutput && typeof (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId === "function") {
      (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
        .setSinkId(selectedAudioOutput)
        .catch((err) => {
          console.warn("[WebRTC] group setSinkId failed:", err);
        });
    }
    audio.play().catch(() => {});
  }, [selectedAudioOutput, speakerVolume]);

  const removeGroupPeerConnection = useCallback((targetUserId: string) => {
    stopGroupPeerStats(targetUserId);
    const peer = groupPeerConnectionsRef.current.get(targetUserId);
    if (peer) {
      peer.close();
      groupPeerConnectionsRef.current.delete(targetUserId);
    }
    groupRemoteDescriptionSetRef.current.delete(targetUserId);
    groupRemoteIceCandidatesBufferRef.current.delete(targetUserId);
    const track = groupRemoteAudioTracksRef.current.get(targetUserId);
    if (track) {
      groupRemoteAudioStreamRef.current?.removeTrack(track);
      groupRemoteAudioTracksRef.current.delete(targetUserId);
      syncGroupRemoteAudio();
    }
  }, [stopGroupPeerStats, syncGroupRemoteAudio]);

  const setupGroupPeerConnection = useCallback((targetUserId: string) => {
    removeGroupPeerConnection(targetUserId);

    const peer = new RTCPeerConnection(getRtcConfiguration());

    const localStream = localCallStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
    }

    groupRemoteDescriptionSetRef.current.set(targetUserId, false);
    // ⚠️ DO NOT reset buffer if it already has candidates buffered during ringing.
    // Only initialize if not present.
    if (!groupRemoteIceCandidatesBufferRef.current.has(targetUserId)) {
      groupRemoteIceCandidatesBufferRef.current.set(targetUserId, []);
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current || !callGroupIdRef.current) {
        return;
      }
      socketRef.current.emit("group:call:ice-candidate", {
        groupId: callGroupIdRef.current,
        toUserId: targetUserId,
        candidate: event.candidate.toJSON()
      });
    };

    peer.ontrack = (event) => {
      if (event.track.kind !== "audio") {
        return;
      }
      if (!groupRemoteAudioStreamRef.current) {
        groupRemoteAudioStreamRef.current = new MediaStream();
      }
      const prevTrack = groupRemoteAudioTracksRef.current.get(targetUserId);
      if (prevTrack && prevTrack.id !== event.track.id) {
        groupRemoteAudioStreamRef.current.removeTrack(prevTrack);
      }
      if (prevTrack?.id !== event.track.id) {
        groupRemoteAudioTracksRef.current.set(targetUserId, event.track);
        groupRemoteAudioStreamRef.current.addTrack(event.track);
      }
      event.track.onended = () => {
        const active = groupRemoteAudioTracksRef.current.get(targetUserId);
        if (active?.id === event.track.id) {
          groupRemoteAudioStreamRef.current?.removeTrack(event.track);
          groupRemoteAudioTracksRef.current.delete(targetUserId);
          syncGroupRemoteAudio();
        }
      };
      syncGroupRemoteAudio();
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        void updateGroupPeerLatency(targetUserId, peer);
        void logSelectedIceRoute(peer, `group:${targetUserId}`);
      }
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        removeGroupPeerConnection(targetUserId);
      }
    };

    const existingTimer = groupPeerStatsTimersRef.current.get(targetUserId);
    if (typeof existingTimer === "number") {
      window.clearInterval(existingTimer);
      groupPeerStatsTimersRef.current.delete(targetUserId);
    }
    void updateGroupPeerLatency(targetUserId, peer);
    const timer = window.setInterval(() => {
      void updateGroupPeerLatency(targetUserId, peer);
    }, 2000);
    groupPeerStatsTimersRef.current.set(targetUserId, timer);

    groupPeerConnectionsRef.current.set(targetUserId, peer);
    return peer;
  }, [logSelectedIceRoute, removeGroupPeerConnection, syncGroupRemoteAudio, updateGroupPeerLatency]);

  const attachCallHandlers = useCallback(
    (socket: Socket) => {
      socket.on("call:offer", async (payload: IncomingCallPayload) => {
        if (!payload?.fromUserId || !payload?.sdp) {
          return;
        }
        // If we have a stale "in-call" or "calling" state with the SAME peer,
        // it means the other side restarted/reconnected (e.g. after app update).
        // Clean up our side so the new offer can be accepted instead of replying "busy".
        let stalePeerCleanup = false;
        if (
          callStatusRef.current !== "idle" &&
          callPeerIdRef.current === payload.fromUserId &&
          !callGroupIdRef.current
        ) {
          console.info("[Call] Stale state with same peer — cleaning up before accepting new offer");
          stopCall(true);
          stalePeerCleanup = true;
          // stopCall queues setCallStatus("idle"); ref updates on next render.
          // Manually align so the busy-check below passes immediately.
          callStatusRef.current = "idle";
        }
        if (callStatusRef.current !== "idle" && !stalePeerCleanup) {
          socket.emit("call:end", { recipientId: payload.fromUserId, reason: "busy" });
          return;
        }
        setIncomingCall(payload);
        setCallPeerId(payload.fromUserId);
        setCallStatus("ringing");
        const callerUser = usersRef.current.find(u => u.id === payload.fromUserId);
        const callerName = callerUser?.displayName ?? payload.fromUserId;
        await notifyIncoming("Incoming call", `${callerName} is calling you.`, { chatMode: "user", userId: payload.fromUserId, kind: "incoming-call" });
        // Show call notification via Wails
        ShowCallNotif(callerName).catch(() => { });
        if (isNativeMobileRuntime) {
          await showMobileIncomingCallNotification("Incoming call", `${callerName} is calling you.`, callerName);
        }
      });

      socket.on("call:answer", async (payload: { fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (callAnswerTimeoutRef.current) {
          window.clearTimeout(callAnswerTimeoutRef.current);
          callAnswerTimeoutRef.current = null;
        }
        if (!peerConnectionRef.current || !payload?.sdp) {
          console.warn("[Call] call:answer received but no peer or sdp");
          return;
        }
        console.log("[Call] call:answer received, setting remote description");
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        remoteDescriptionSetRef.current = true;
        // Flush any ICE candidates that arrived before remote description was set
        const buffered = remoteIceCandidatesBufferRef.current;
        remoteIceCandidatesBufferRef.current = [];
        for (const c of buffered) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        setCallStatus("in-call");
        setCallMinimized(true);
        if (payload.fromUserId) {
          callPeerIdRef.current = payload.fromUserId;
          setCallPeerId(payload.fromUserId);
          const queued = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];
          for (const c of queued) {
            socketRef.current?.emit("call:ice-candidate", { recipientId: payload.fromUserId, candidate: c });
          }
        }
      });

      socket.on(
        "call:ice-candidate",
        async (payload: { fromUserId: string; candidate: RTCIceCandidateInit }) => {
          if (!payload?.candidate) {
            return;
          }
          if (!peerConnectionRef.current || !remoteDescriptionSetRef.current) {
            remoteIceCandidatesBufferRef.current.push(payload.candidate);
            return;
          }
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch((err) => {
            console.warn("[WebRTC] addIceCandidate failed:", err);
          });
        }
      );

      socket.on("call:renegotiate", async (payload: { fromUserId: string; type: string; sdp: any }) => {
        if (!peerConnectionRef.current) return;
        try {
          if (payload.type === "offer") {
            // Handle glare: if we're already in have-local-offer, rollback first
            if (peerConnectionRef.current.signalingState === "have-local-offer") {
              await peerConnectionRef.current.setLocalDescription({ type: "rollback" });
            }
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);
            socketRef.current?.emit("call:renegotiate", { recipientId: payload.fromUserId, type: "answer", sdp: answer });
            // Check if remote started/stopped screenshare
            const hasVideo = peerConnectionRef.current.getReceivers().some(r => r.track && r.track.kind === "video" && r.track.readyState === "live" && !r.track.muted);
            if (hasVideo) {
              setIsRemoteScreenSharing(true);
            } else {
              setIsRemoteScreenSharing(false);
              setScreenFullscreen(false);
            }
          } else if (payload.type === "answer") {
            if (peerConnectionRef.current.signalingState === "have-local-offer") {
              await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            }
          }
        } catch (e) {
          console.warn("[WebRTC] call:renegotiate error:", e);
        }
      });

      socket.on("call:end", (payload?: DirectCallEndPayload) => {
        if (callStatusRef.current !== "idle") {
          stopCall(true);
          playEndCallSound();
          toast(getCallEndToastText(payload?.reason));
        }
      });

        socket.on("disconnect", () => {
          if (callStatusRef.current !== "idle") {
            stopCall(true);
            toast.error("Internet uzildi. Call tugatildi.");
          }
        });
    },
    [notifyIncoming, stopCall]
  );

  const attachChatHandlers = useCallback(
    (socket: Socket) => {
      socket.on("presence:update", (payload: PresencePayload) => {
        let knownUser = true;
        setUsers((prev) => {
          const exists = prev.some((user) => user.id === payload.userId);
          knownUser = exists;
          if (!exists) {
            return prev;
          }
          return prev.map((user) =>
            user.id === payload.userId
              ? {
                ...user,
                isOnline: payload.isOnline,
                lastSeenAt: payload.lastSeenAt ?? user.lastSeenAt,
                clientType: payload.clientType ?? user.clientType,
                clientVersion: payload.clientVersion ?? user.clientVersion
              }
              : user
          );
        });
        if (!knownUser) {
          fetchUsers().catch(() => undefined);
        }
      });

      socket.on("status:changed", (payload: { userId: string; statusText: string | null; statusEmoji: string | null }) => {
        setUsers((prev) =>
          prev.map((user) =>
            user.id === payload.userId
              ? { ...user, statusText: payload.statusText, statusEmoji: payload.statusEmoji }
              : user
          )
        );
        setCurrentUser((prev) =>
          prev && prev.id === payload.userId
            ? { ...prev, statusText: payload.statusText, statusEmoji: payload.statusEmoji }
            : prev
        );
      });

      socket.on("user:profile-updated", (payload: { userId: string; displayName: string; username: string | null; avatarUrl: string | null }) => {
        let knownUser = true;
        setUsers((prev) => {
          const exists = prev.some((user) => user.id === payload.userId);
          knownUser = exists;
          if (!exists) {
            return prev;
          }
          return prev.map((user) =>
            user.id === payload.userId
              ? { ...user, displayName: payload.displayName, username: payload.username, avatarUrl: payload.avatarUrl }
              : user
          );
        });
        if (!knownUser) {
          fetchUsers().catch(() => undefined);
        }
        // Also update currentUser if it's me
        setCurrentUser((prev) =>
          prev && prev.id === payload.userId
            ? { ...prev, displayName: payload.displayName, username: payload.username, avatarUrl: payload.avatarUrl }
            : prev
        );
        setProfileViewUser((prev) =>
          prev && prev.id === payload.userId
            ? { ...prev, displayName: payload.displayName, username: payload.username, avatarUrl: payload.avatarUrl }
            : prev
        );
      });

      socket.on("typing:start", (payload: { fromUserId: string }) => {
        setTypingFromUserId(payload.fromUserId);
      });

      socket.on("typing:stop", (payload: { fromUserId: string }) => {
        setTypingFromUserId((prev) => (prev === payload.fromUserId ? null : prev));
      });

      socket.on("message:new", async (message: Message) => {
        const me = currentUserIdRef.current;
        const meUser = usersRef.current.find((u) => u.id === me) ?? currentUser;
        const selected = selectedUserIdRef.current;
        const isActiveConversation =
          selected &&
          ((message.senderId === selected && message.recipientId === me) ||
            (message.senderId === me && message.recipientId === selected));

        if (isActiveConversation) {
          setMessages((prev) => {
            if (prev.some((item) => item.id === message.id)) {
              return prev;
            }
            return [...prev, message];
          });
          // If the incoming message is from the other user, mark it as read immediately
          if (message.senderId === selected && message.recipientId === me) {
            socket.emit("message:read", { senderId: selected });
          }
        }

        if (message.senderId !== me) {
          if (!isActiveConversation) {
            setUnreadCounts(prev => ({ ...prev, [message.senderId]: (prev[message.senderId] || 0) + 1 }));
            // Check for @mention of current user
            if (message.text && messageMentionsUser(message.text, meUser)) {
              setMentionCounts(prev => ({ ...prev, [message.senderId]: (prev[message.senderId] || 0) + 1 }));
            }
          }
          const senderName =
            usersRef.current.find((item) => item.id === message.senderId)?.displayName ?? "New message";
          const body = buildMessagePreview(message);
          await notifyIncoming(senderName, body, { chatMode: "user", userId: message.senderId });
        }
      });

      socket.on("messages:deleted", (payload: { messageIds: string[] }) => {
        const deletedSet = new Set(payload.messageIds);
        setMessages((prev) => prev.filter((m) => !deletedSet.has(m.id)));
      });

      socket.on("message:read", (payload: { readByUserId: string; readAt: string; fromSenderId?: string }) => {
        setMessages((prev) =>
          prev.map((m) => {
            // If I sent it and the recipient read it
            if (m.senderId === currentUserIdRef.current && m.recipientId === payload.readByUserId && !m.readAt) {
              return { ...m, readAt: payload.readAt };
            }
            // If someone else sent it and I read it (fromSenderId present)
            if (payload.fromSenderId && m.senderId === payload.fromSenderId && m.recipientId === payload.readByUserId && !m.readAt) {
              return { ...m, readAt: payload.readAt };
            }
            return m;
          })
        );

        // If I'm currently in this conversation as sender, mark read receipts as seen.
        const isChatOpenAndFocused =
          selectedUserIdRef.current === payload.readByUserId &&
          payload.readByUserId !== currentUserIdRef.current &&
          document.hasFocus() &&
          (!isNativeMobileRuntime || (isAppActiveRef.current && isMobileChatOpen));

        if (isChatOpenAndFocused) {
          socket.emit("message:seen", { recipientId: payload.readByUserId });
        }
      });

      socket.on("message:seen", (payload: { senderId: string; recipientId: string; seenAt: string }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (
              m.senderId === payload.senderId &&
              m.recipientId === payload.recipientId &&
              m.readAt &&
              !m.seenAt
            ) {
              return { ...m, seenAt: payload.seenAt };
            }
            return m;
          })
        );
      });
    },
    [fetchUsers, isMobileChatOpen, notifyIncoming]
  );

  const attachGroupHandlers = useCallback(
    (socket: Socket) => {
      socket.on("group:created", (group: Group) => {
        setGroups((prev) => {
          if (prev.some((g) => g.id === group.id)) return prev;
          return [group, ...prev];
        });
      });

      socket.on("group:updated", (group: Group) => {
        setGroups((prev) => prev.map((g) => (g.id === group.id ? group : g)));
      });

      socket.on("group:removed", (payload: { groupId: string }) => {
        setGroups((prev) => prev.filter((g) => g.id !== payload.groupId));
        if (selectedGroupIdRef.current === payload.groupId) {
          setSelectedGroupId("");
          setGroupMessages([]);
        }
      });

      socket.on("group:message:new", async (message: GroupMessage) => {
        const me = currentUserIdRef.current;
        const meUser = usersRef.current.find((u) => u.id === me) ?? currentUser;
        const selectedGrp = selectedGroupIdRef.current;

        if (message.groupId === selectedGrp) {
          setGroupMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          markGroupMessagesSeen(message.groupId, [message]);
        }

        if (message.senderId !== me) {
          if (message.groupId !== selectedGrp) {
            setUnreadCounts(prev => ({ ...prev, [message.groupId]: (prev[message.groupId] || 0) + 1 }));
            // Check for @mention of current user
            if (message.text && messageMentionsUser(message.text, meUser)) {
              setMentionCounts(prev => ({ ...prev, [message.groupId]: (prev[message.groupId] || 0) + 1 }));
            }
          }
          const senderName = message.sender?.displayName ?? "Group message";
          const body = buildMessagePreview(message as unknown as Message);
          await notifyIncoming(senderName, body, { chatMode: "group", groupId: message.groupId });
        }
      });

      socket.on("group:message:seen", (payload: {
        groupId: string;
        entries: Array<{ messageId: string; userId: string; seenAt: string; user?: PublicUser }>;
      }) => {
        if (!payload?.groupId || !Array.isArray(payload.entries) || payload.entries.length === 0) {
          return;
        }

        setGroupMessages((prev) =>
          prev.map((msg) => {
            if (msg.groupId !== payload.groupId) {
              return msg;
            }

            const matched = payload.entries.filter((entry) => entry.messageId === msg.id);
            if (matched.length === 0) {
              return msg;
            }

            const seenMap = new Map((msg.seenBy ?? []).map((row) => [row.userId, row]));
            for (const row of matched) {
              if (!seenMap.has(row.userId)) {
                seenMap.set(row.userId, {
                  id: `${row.messageId}:${row.userId}`,
                  messageId: row.messageId,
                  userId: row.userId,
                  seenAt: row.seenAt,
                  user: row.user,
                });
              }
            }

            const mergedSeenBy = [...seenMap.values()].sort((a, b) => {
              return new Date(a.seenAt).getTime() - new Date(b.seenAt).getTime();
            });

            return { ...msg, seenBy: mergedSeenBy };
          })
        );
      });

      socket.on("group:typing:start", (payload: { groupId: string; fromUserId: string }) => {
        if (payload.groupId === selectedGroupIdRef.current) {
          setGroupTypingUserId(payload.fromUserId);
        }
      });

      socket.on("group:typing:stop", (payload: { groupId: string; fromUserId: string }) => {
        setGroupTypingUserId((prev) => (prev === payload.fromUserId ? null : prev));
      });

      // Group call handlers
      socket.on("group:call:status", (payload: { groupId: string; userIds: string[] }) => {
        if (!payload?.groupId || !Array.isArray(payload.userIds)) return;
        const deduped = [...new Set(payload.userIds.filter((id) => typeof id === "string" && id.length > 0))];
        setGroupActiveCallUsers((prev) => {
          if (deduped.length === 0) {
            if (!(payload.groupId in prev)) return prev;
            const next = { ...prev };
            delete next[payload.groupId];
            return next;
          }
          const current = prev[payload.groupId] ?? [];
          if (current.length === deduped.length && current.every((id, idx) => id === deduped[idx])) {
            return prev;
          }
          return { ...prev, [payload.groupId]: deduped };
        });
      });

      socket.on("group:call:offer", async (payload: { groupId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (!payload?.groupId || !payload?.fromUserId || !payload?.sdp) return;

        setGroupActiveCallUsers((prev) => {
          const existing = new Set(prev[payload.groupId] ?? []);
          existing.add(payload.fromUserId);
          return { ...prev, [payload.groupId]: [...existing] };
        });

        if (callStatusRef.current === "idle") {
          callGroupIdRef.current = payload.groupId;
          setIncomingCall({ fromUserId: payload.fromUserId, sdp: payload.sdp });
          setCallPeerId(payload.fromUserId);
          setCallStatus("ringing");
          const callerUser = usersRef.current.find(u => u.id === payload.fromUserId);
          const callerName = callerUser?.displayName ?? "Group call";
          await notifyIncoming("Group Call", `${callerName} - Incoming group call.`, { chatMode: "group", groupId: payload.groupId });
          ShowCallNotif(callerName).catch(() => { });
          if (isNativeMobileRuntime) {
            await showMobileIncomingCallNotification("Group call", `${callerName} started a group call.`, callerName);
          }
          return;
        }

        if (callStatusRef.current !== "in-call" || callGroupIdRef.current !== payload.groupId || !localCallStreamRef.current) {
          return;
        }

        const peer = setupGroupPeerConnection(payload.fromUserId);
        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        groupRemoteDescriptionSetRef.current.set(payload.fromUserId, true);

        const buffered = groupRemoteIceCandidatesBufferRef.current.get(payload.fromUserId) ?? [];
        groupRemoteIceCandidatesBufferRef.current.set(payload.fromUserId, []);
        for (const candidate of buffered) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current?.emit("group:call:answer", {
          groupId: payload.groupId,
          toUserId: payload.fromUserId,
          sdp: answer
        });
      });

      socket.on("group:call:answer", async (payload: { groupId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (!payload?.fromUserId || !payload?.sdp) return;
        const peer = groupPeerConnectionsRef.current.get(payload.fromUserId);
        if (!peer) return;
        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        groupRemoteDescriptionSetRef.current.set(payload.fromUserId, true);
        const buffered = groupRemoteIceCandidatesBufferRef.current.get(payload.fromUserId) ?? [];
        groupRemoteIceCandidatesBufferRef.current.set(payload.fromUserId, []);
        for (const candidate of buffered) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        setCallStatus("in-call");
        setCallMinimized(true);
      });

      socket.on("group:call:ice-candidate", async (payload: { groupId: string; fromUserId: string; candidate: RTCIceCandidateInit }) => {
        if (!payload?.fromUserId || !payload?.candidate) return;
        const peer = groupPeerConnectionsRef.current.get(payload.fromUserId);
        // ⚠️ Even if peer not yet created (incoming during ringing), buffer the candidate.
        // It will be flushed once setRemoteDescription is called in acceptCall().
        if (!peer || !groupRemoteDescriptionSetRef.current.get(payload.fromUserId)) {
          const existing = groupRemoteIceCandidatesBufferRef.current.get(payload.fromUserId) ?? [];
          existing.push(payload.candidate);
          groupRemoteIceCandidatesBufferRef.current.set(payload.fromUserId, existing);
          return;
        }
        await peer.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch((err) => {
          console.warn("[WebRTC] group addIceCandidate failed:", err);
        });
      });

      socket.on("group:call:end", (payload: { groupId: string }) => {
        if (!payload?.groupId) return;
        setGroupActiveCallUsers((prev) => {
          if (!(payload.groupId in prev)) return prev;
          const next = { ...prev };
          delete next[payload.groupId];
          return next;
        });

        if (payload.groupId !== callGroupIdRef.current) return;
        stopCall(true);
        playEndCallSound();
        toast("Group call ended.");
      });

      // ── GROUP CALL PARTICIPANT TRACKING ──
      socket.on("group:call:join", (payload: { groupId: string; userId: string }) => {
        if (!payload?.groupId || !payload?.userId || payload.groupId !== callGroupIdRef.current) {
          if (!payload?.groupId || !payload?.userId) {
            return;
          }
        }

        setGroupActiveCallUsers((prev) => {
          const existing = new Set(prev[payload.groupId] ?? []);
          existing.add(payload.userId);
          return { ...prev, [payload.groupId]: [...existing] };
        });

        if (payload.groupId !== callGroupIdRef.current) {
          return;
        }
        setGroupCallParticipants(prev => {
          if (prev.some(p => p.userId === payload.userId)) return prev;
          return [...prev, { userId: payload.userId, speaking: false }];
        });

        if (
          payload.userId === currentUserIdRef.current ||
          callStatusRef.current !== "in-call" ||
          !localCallStreamRef.current
        ) {
          return;
        }

        const existingPeer = groupPeerConnectionsRef.current.get(payload.userId);
        if (existingPeer) {
          const state = existingPeer.connectionState;
          if (state === "connected" || state === "connecting" || state === "new") {
            return;
          }
          removeGroupPeerConnection(payload.userId);
        }

        void (async () => {
          try {
            const peer = setupGroupPeerConnection(payload.userId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socketRef.current?.emit("group:call:offer", {
              groupId: payload.groupId,
              toUserId: payload.userId,
              sdp: offer
            });
          } catch (err) {
            console.warn("[WebRTC] group offer on join failed:", err);
          }
        })();
      });

      socket.on("group:call:leave", (payload: { groupId: string; userId: string }) => {
        if (!payload?.groupId || !payload?.userId) return;

        setGroupActiveCallUsers((prev) => {
          const existing = prev[payload.groupId] ?? [];
          if (existing.length === 0) return prev;
          const nextUsers = existing.filter((id) => id !== payload.userId);
          const next = { ...prev };
          if (nextUsers.length === 0) {
            delete next[payload.groupId];
          } else {
            next[payload.groupId] = nextUsers;
          }
          return next;
        });

        if (payload.groupId !== callGroupIdRef.current) return;
        removeGroupPeerConnection(payload.userId);
        setGroupCallParticipants(prev => prev.filter(p => p.userId !== payload.userId));
      });

      socket.on("group:call:speaking", (payload: { groupId: string; userId: string; speaking: boolean }) => {
        if (!payload?.groupId || payload.groupId !== callGroupIdRef.current) return;
        setGroupCallParticipants(prev => prev.map(p => p.userId === payload.userId ? { ...p, speaking: payload.speaking } : p));

        // If speaking events arrive but we have no remote track for this user,
        // recover by re-negotiating a direct group peer link.
        if (
          payload.speaking &&
          payload.userId !== currentUserIdRef.current &&
          callStatusRef.current === "in-call" &&
          !!localCallStreamRef.current &&
          !groupRemoteAudioTracksRef.current.has(payload.userId)
        ) {
          const existingPeer = groupPeerConnectionsRef.current.get(payload.userId);
          const state = existingPeer?.connectionState;
          const shouldReconnect = !existingPeer || state === "failed" || state === "closed" || state === "disconnected";
          if (!shouldReconnect) {
            return;
          }

          if (existingPeer) {
            removeGroupPeerConnection(payload.userId);
          }

          void (async () => {
            try {
              const peer = setupGroupPeerConnection(payload.userId);
              const offer = await peer.createOffer();
              await peer.setLocalDescription(offer);
              socketRef.current?.emit("group:call:offer", {
                groupId: payload.groupId,
                toUserId: payload.userId,
                sdp: offer
              });
            } catch (err) {
              console.warn("[WebRTC] group offer on speaking recovery failed:", err);
            }
          })();
        }
      });

    },
    [markGroupMessagesSeen, notifyIncoming, removeGroupPeerConnection, setupGroupPeerConnection, showMobileIncomingCallNotification, stopCall]
  );

  useEffect(() => {
    if (!token || (appLocked && appLockEnabled)) {
      return;
    }

    setIsSessionBootstrapping(true);
    setSessionBootstrapError(null);

    let cancelled = false;
    const run = async (attempt = 1): Promise<void> => {
      try {
        await fetchMe();
        await fetchUsers();
        await fetchGroups();
        if (cancelled) {
          return;
        }
        setIsSessionBootstrapping(false);
        setSessionBootstrapError(null);
        const socket = createSocket(token, appVersionRef.current);
        socketRef.current = socket;
        setIsSocketConnected(socket.connected);
        socket.on("connect", () => {
          setIsSocketConnected(true);
          if (selectedGroupIdRef.current) {
            requestGroupCallStatus(selectedGroupIdRef.current);
          }
        });
        socket.on("disconnect", () => {
          setIsSocketConnected(false);
        });
        socket.on("connect_error", () => {
          setIsSocketConnected(false);
        });
        attachChatHandlers(socket);
        attachCallHandlers(socket);
        attachGroupHandlers(socket);
      } catch (error: any) {
        if (cancelled) return;
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          setIsSessionBootstrapping(false);
          toast.error("Session expired. Please log in again.");
          clearSession();
        } else if (attempt < 5) {
          await new Promise(r => setTimeout(r, 2000));
          if (!cancelled) return run(attempt + 1);
        } else {
          setIsSessionBootstrapping(false);
          setSessionBootstrapError("Serverga ulanib bo'lmadi. Session saqlandi, qayta urinib ko'ring.");
          toast.error("Serverga ulanib bo'lmadi. Internetni tekshiring.");
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      setIsSocketConnected(false);
      disconnectSocket(socketRef);
    };
  }, [attachCallHandlers, attachChatHandlers, attachGroupHandlers, clearSession, fetchMe, fetchGroups, fetchUsers, token, appLocked, appLockEnabled, sessionBootstrapNonce, requestGroupCallStatus]);

  useEffect(() => {
    const onOnline = () => {
      setNetworkOnline(true);
    };
    const onOffline = () => {
      setNetworkOnline(false);
      if (callStatusRef.current !== "idle") {
        stopCall(true);
        toast.error("Internet uzildi. Call avtomatik tugatildi.");
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [stopCall]);

  useEffect(() => {
    if (!selectedUserId || !token || chatMode !== "user") {
      return;
    }
    fetchMessages(selectedUserId).catch((error) => {
      console.error(error);
      toast.error("Failed to load messages.");
    });
  }, [fetchMessages, selectedUserId, token, chatMode]);

  useEffect(() => {
    if (!selectedGroupId || !token || chatMode !== "group") {
      return;
    }
    requestGroupCallStatus(selectedGroupId);
    fetchGroupMessages(selectedGroupId).catch((error) => {
      console.error(error);
      toast.error("Failed to load group messages.");
    });
  }, [fetchGroupMessages, selectedGroupId, token, chatMode, requestGroupCallStatus]);

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/register", {
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
        displayName: registerDisplayName.trim()
      });
      setVerifyEmail(registerEmail.trim().toLowerCase());
      setAuthStep("verify");
      toast.success("Verification code sent to your email.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Registration error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleVerifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>("/auth/verify-email", {
        email: verifyEmail.trim().toLowerCase(),
        code: verifyCode.trim()
      });
      applySession(response.data.token, response.data.user);
      toast.success("Email verified.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Verification failed."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<
        | { token: string; user: PublicUser; requiresTwoFA?: false }
        | { requiresTwoFA: true; tempToken: string }
      >("/auth/login", {
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword
      });

      if ("requiresTwoFA" in response.data && response.data.requiresTwoFA) {
        setTempTwoFAToken(response.data.tempToken);
        setAuthStep("login2fa");
        toast("Enter 2FA code.");
        return;
      }

      applySession(response.data.token, response.data.user);
      toast.success("Welcome.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Login error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handle2FALogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>("/auth/login/2fa", {
        tempToken: tempTwoFAToken,
        code: twoFALoginCode.trim()
      });
      applySession(response.data.token, response.data.user);
      toast.success("2FA verified.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA login error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/forgot-password", {
        email: forgotEmail.trim().toLowerCase()
      });
      setVerifyEmail(forgotEmail.trim().toLowerCase());
      setAuthStep("reset");
      toast.success("Password reset code sent.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Forgot password error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/reset-password", {
        email: verifyEmail.trim().toLowerCase(),
        code: resetCode.trim(),
        newPassword: resetPassword
      });
      setAuthStep("login");
      toast.success("Password updated.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Password update error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const startTwoFASetup = async () => {
    try {
      const response = await api.post<{ qrDataUrl: string }>("/auth/2fa/setup");
      setTwoFAQrDataUrl(response.data.qrDataUrl);
      setTwoFASetupCode("");
      toast("Scan the QR code in your Authenticator app.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA setup error."));
    }
  };

  const enableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/enable", { code: twoFASetupCode.trim() });
      setTwoFAQrDataUrl("");
      setTwoFASetupCode("");
      await fetchMe();
      toast.success("2FA enabled.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to enable 2FA."));
    }
  };

  const disableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/disable", { code: twoFADisableCode.trim() });
      setTwoFADisableCode("");
      await fetchMe();
      toast.success("2FA disabled.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to disable 2FA."));
    }
  };

  const sendTypingSignal = useCallback(
    (isTyping: boolean) => {
      if (!selectedUserId || !socketRef.current) {
        return;
      }
      socketRef.current.emit(isTyping ? "typing:start" : "typing:stop", {
        recipientId: selectedUserId
      });
    },
    [selectedUserId]
  );

  const handleGetLocation = () => {
    setMessageType("LOCATION");
    setLocationAccuracy(null);
    toast("Detecting location...");

    const applyDetectedLocation = (lat: number, lng: number, accuracy?: number) => {
      if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > MAX_LOCATION_ACCURACY_M) {
        toast.error(`Location accuracy is too low (~${Math.round(accuracy)}m). Move to open area and try again.`);
        return false;
      }

      setLocationLat(String(lat));
      setLocationLng(String(lng));
      setLocationAccuracy(typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null);
      const accuracyText = typeof accuracy === "number" && Number.isFinite(accuracy)
        ? ` (accuracy: ~${Math.round(accuracy)}m)`
        : "";
      toast.success(`Location detected!${accuracyText}`);
      return true;
    };

    // 1) Try native Windows Location API via Go backend (Wi-Fi triangulation, GPS — same as Chrome)
    const tryNativeGeo = async () => {
      try {
        const res = await GetGeoLocation();
        if (res && res.latitude && res.longitude && !res.error) {
          if (applyDetectedLocation(Number(res.latitude), Number(res.longitude), Number(res.accuracy))) {
            return;
          }
        }
      } catch {}
      // Fallback to browser geolocation API
      tryBrowserGeo();
    };

    // 2) Try navigator.geolocation (WebView2)
    const tryBrowserGeo = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (!applyDetectedLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy)) {
              toast.error("Could not detect precise location. Check GPS/location settings and try again.");
            }
          },
          () => {
            toast.error("Location not detected. Enable device location and try again.");
            setMessageType("TEXT");
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } else {
        toast.error("Geolocation is not available on this device.");
        setMessageType("TEXT");
      }
    };

    tryNativeGeo();
  };

  const handleTextChange = (value: string) => {
    setMessageText(value);
    sendTypingSignal(true);
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      sendTypingSignal(false);
    }, 800);

    // ── Mention detection ──
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    if (atMatch) {
      setShowMentionDropdown(true);
      setMentionQuery(atMatch[1].toLowerCase());
      setMentionStartIndex(cursorPos - atMatch[0].length);
      setMentionSelectedIdx(0);
    } else {
      setShowMentionDropdown(false);
      setMentionQuery("");
      setMentionStartIndex(-1);
      setMentionSelectedIdx(0);
    }
  };

  const syncComposerHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const minHeight = 40;
    const maxHeight = 120;
    ta.style.height = `${minHeight}px`;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, ta.scrollHeight));
    ta.style.height = `${nextHeight}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    syncComposerHeight();
  }, [messageText, syncComposerHeight]);

  useEffect(() => {
    syncComposerHeight();
  }, [chatMode, selectedUserId, selectedGroupId, syncComposerHeight]);

  const mentionCandidates = useMemo(() => {
    if (!showMentionDropdown) return [];
    const memberList = chatMode === "group" && activeGroup?.members
      ? activeGroup.members.map((m) => m.user).filter(Boolean) as PublicUser[]
      : users;
    return memberList
      .filter((u) => u.id !== currentUser?.id)
      .filter((u) =>
        u.displayName.toLowerCase().includes(mentionQuery) ||
        (u.username && u.username.toLowerCase().includes(mentionQuery))
      )
      .slice(0, 8);
  }, [showMentionDropdown, mentionQuery, chatMode, activeGroup, users, currentUser]);

  const insertMention = (user: PublicUser) => {
    const before = messageText.slice(0, mentionStartIndex);
    const after = messageText.slice(textareaRef.current?.selectionStart ?? messageText.length);
    const mentionText = mentionInsertText(user);
    const newText = before + mentionText + after;
    setMessageText(newText);
    setShowMentionDropdown(false);
    setMentionQuery("");
    setMentionStartIndex(-1);
    // Focus back on textarea
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = before.length + mentionText.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  /** Open profile popup for a mentioned user */
  const handleMentionClick = useCallback((userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (user) {
      setProfileViewUser(user);
    }
  }, [users]);

  const applyRNNoiseFilter = async (rawStream: MediaStream): Promise<MediaStream> => {
    if (!noiseReduction || !rnnoiseAssetsRef.current) return rawStream;
    try {
      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      await RNNoiseNode.register(audioCtx, rnnoiseAssetsRef.current);
      const source = audioCtx.createMediaStreamSource(rawStream);
      const rnnoise = new RNNoiseNode(audioCtx);
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 90;
      highpass.Q.value = 0.707;
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -28;
      compressor.knee.value = 20;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      const outputGain = audioCtx.createGain();
      outputGain.gain.value = normalizeVolumeLevel(micVolume);
      micGainNodeRef.current = outputGain;
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(highpass);
      highpass.connect(rnnoise);
      rnnoise.connect(compressor);
      // Direct path: no gate. RNNoise already removes noise; gate caused mic muting bugs.
      compressor.connect(outputGain);
      outputGain.connect(destination);

      // Force Web Audio graph to tick by connecting to a silent hardware sink
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      outputGain.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      // Keep RNNoise worklet ticking for VAD telemetry (no gating)
      const tickTimer = window.setInterval(() => {
        try { rnnoise.update(true); } catch {}
      }, 40);

      const processedStream = destination.stream;
      const originalTracks = rawStream.getTracks();

      // Sanity check: processed stream MUST contain a live audio track. Fall back to raw if not.
      const processedAudio = processedStream.getAudioTracks()[0];
      if (!processedAudio || processedAudio.readyState !== "live") {
        console.warn("[RNNoise] Processed stream has no live audio track, falling back to raw mic");
        window.clearInterval(tickTimer);
        try { audioCtx.close(); } catch {}
        return rawStream;
      }

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        window.clearInterval(tickTimer);
        rnnoise.onstatus = null;
        originalTracks.forEach((ot) => ot.stop());
        if (micGainNodeRef.current === outputGain) {
          micGainNodeRef.current = null;
        }
        audioCtx.close().catch(() => {});
      };

      processedStream.getTracks().forEach(t => {
        const oldStop = t.stop.bind(t);
        t.stop = () => {
          oldStop();
          cleanup();
        };
      });

      return processedStream;
    } catch (e: any) {
      console.error("RNNoise fallback:", e);
      toast.error("WASM Shovqin filtr yuklanmadi: " + e.message);
      return rawStream;
    }
  };

  const startVoiceRecording = async () => {
    try {
      const audioConstraints: any = {
        noiseSuppression: noiseReduction,
        echoCancellation: noiseReduction,
        autoGainControl: noiseReduction,
        googEchoCancellation: noiseReduction,
        googAutoGainControl: noiseReduction,
        googNoiseSuppression: noiseReduction,
        googHighpassFilter: noiseReduction,
        googTypingNoiseDetection: noiseReduction,
        ...(selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : {})
      };
      let stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      stream = await applyRNNoiseFilter(stream);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      // Setup AnalyserNode for live waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      setRecordingWaveform([]);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tickWaveform = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        // Sample 32 bars from frequency data
        const bars: number[] = [];
        const step = Math.floor(dataArray.length / 32);
        for (let i = 0; i < 32; i++) {
          bars.push(dataArray[i * step] / 255);
        }
        setRecordingWaveform(bars);
        waveformAnimRef.current = requestAnimationFrame(tickWaveform);
      };
      waveformAnimRef.current = requestAnimationFrame(tickWaveform);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setVoiceBlob(blob);
        const duration = Math.max(1, Math.round((Date.now() - recordStartedAtRef.current) / 1000));
        setVoiceDurationSec(duration);
        audioCtx.close();
      };

      recordStartedAtRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      recorder.start();
      setMessageType("VOICE");
      setIsRecordingVoice(true);
      toast("Recording started.");
    } catch {
      toast.error("Could not access microphone.");
    }
  };

  const stopVoiceRecording = () => {
    cancelAnimationFrame(waveformAnimRef.current);
    analyserRef.current = null;
    setRecordingWaveform([]);
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    setIsRecordingVoice(false);
    toast.success("Voice recording ready.");
  };

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const queueComposerFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => file.size > 0);
    if (validFiles.length === 0) {
      return;
    }

    setPendingAttachments((prev) => {
      const next = [...prev];
      validFiles.forEach((file, index) => {
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`,
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null
        });
      });
      return next;
    });

    setSelectedFile(null);
    setVoiceBlob(null);
    setVoiceDurationSec(null);
    setLocationLat("");
    setLocationLng("");
    setLocationAccuracy(null);
    setMessageType("FILE");
  }, []);

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((item) => item.id !== attachmentId);
      if (next.length === 0 && messageType === "FILE") {
        setMessageType("TEXT");
      }
      return next;
    });
  };

  const clearPendingAttachments = () => {
    setPendingAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  };

  const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setComposerDragActive(true);
    }
  };

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setComposerDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      queueComposerFiles(files);
    }
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    setUploadProgress(0);
    const response = await api.post<UploadResponse>("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      }
    });
    setUploadProgress(0);
    return response.data;
  };

  const applyRingtoneSource = useCallback((sourceUrl: string, label: string) => {
    const safeUrl = setRingtoneSource(sourceUrl, label);
    setRingtoneUrl(safeUrl);
    setRingtoneLabel(label);
    toast.success("Ringtone applied");
  }, []);

  const useServerRingtone = useCallback(async () => {
    await SaveFileFromURL(DEFAULT_RINGTONE_URL, "ringtone.mp3");
    applyRingtoneSource(DEFAULT_RINGTONE_URL, "Server ringtone");
  }, [applyRingtoneSource]);

  const resetCustomRingtone = useCallback(() => {
    resetRingtoneSource();
    setRingtoneUrl(DEFAULT_RINGTONE_URL);
    setRingtoneLabel("Server ringtone");
    toast.success("Server ringtone restored");
  }, []);

  const handleRingtoneUpload = async (file: File) => {
    if (!file.type.startsWith("audio/")) {
      toast.error("Audio file tanlang");
      return;
    }
    setRingtoneUploading(true);
    try {
      const uploaded = await uploadFile(file);
      applyRingtoneSource(uploaded.url, uploaded.fileName || file.name);
    } catch (error) {
      console.error("Ringtone upload failed:", error);
      toast.error("Ringtone upload bo'lmadi");
    } finally {
      setRingtoneUploading(false);
    }
  };

  const previewRingtone = useCallback(() => {
    startRingtone();
    window.setTimeout(() => stopAllCallSounds(), 5000);
  }, []);

  const sendMessage = async () => {
    if (chatMode === "user" && !selectedUserId) {
      toast("Select a user first.");
      return;
    }
    if (chatMode === "group" && !selectedGroupId) {
      toast("Select a group first.");
      return;
    }
    if (!networkOnline || !socketRef.current?.connected) {
      toast.error("Internet yoki socket ulanishi yo'q. Qayta urinib ko'ring.");
      return;
    }
    if (isSending) return;

    setIsSending(true);
    try {
      if (chatMode === "group") {
        // ── GROUP MESSAGE ──
        let groupPayload: Record<string, unknown> = {
          groupId: selectedGroupId,
          type: messageType
        };

        if (messageType === "TEXT") {
          const text = messageText.trim();
          if (!text) { toast.error("Message is empty."); return; }
          groupPayload.text = text;
        } else if (messageType === "LOCATION") {
          if (locationAccuracy !== null && locationAccuracy > MAX_LOCATION_ACCURACY_M) {
            toast.error(`Location is too approximate (~${Math.round(locationAccuracy)}m). Try again.`);
            return;
          }
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) { toast.error("Invalid location values."); return; }
          groupPayload.latitude = latitude;
          groupPayload.longitude = longitude;
        } else {
          if (messageType === "FILE") {
            const files = pendingAttachments.length > 0
              ? pendingAttachments.map((item) => item.file)
              : (selectedFile ? [selectedFile] : []);
            if (files.length === 0) { toast.error("No file selected."); return; }

            for (const file of files) {
              const uploaded = await uploadFile(file);
              await withSocketAck<GroupMessage>("group:message:send", {
                groupId: selectedGroupId,
                type: "FILE",
                fileUrl: uploaded.url,
                fileName: uploaded.fileName,
                fileMime: uploaded.fileMime,
                fileSize: uploaded.fileSize
              });
            }
            groupPayload = null as any;
          } else {
            let file = selectedFile;
            if (!file && messageType === "VOICE" && voiceBlob) {
              file = new File([voiceBlob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
            }
            if (!file) { toast.error("No file selected."); return; }
            const uploaded = await uploadFile(file);
            groupPayload = {
              ...groupPayload,
              fileUrl: uploaded.url,
              fileName: uploaded.fileName,
              fileMime: uploaded.fileMime,
              fileSize: uploaded.fileSize,
              durationSec: messageType === "VOICE" ? voiceDurationSec ?? undefined : undefined
            };
          }
        }

        if (groupPayload) {
          await withSocketAck<GroupMessage>("group:message:send", groupPayload);
        }
      } else {
        // ── USER MESSAGE ──
        let payload:
          | { recipientId: string; type: MessageType; text: string }
          | { recipientId: string; type: MessageType; fileUrl: string; fileName: string; fileMime: string; fileSize: number; durationSec?: number }
          | { recipientId: string; type: MessageType; latitude: number; longitude: number };

        if (messageType === "TEXT") {
          const text = messageText.trim();
          if (!text) { toast.error("Message is empty."); return; }
          payload = { recipientId: selectedUserId, type: "TEXT", text };
        } else if (messageType === "LOCATION") {
          if (locationAccuracy !== null && locationAccuracy > MAX_LOCATION_ACCURACY_M) {
            toast.error(`Location is too approximate (~${Math.round(locationAccuracy)}m). Try again.`);
            return;
          }
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) { toast.error("Invalid location values."); return; }
          payload = { recipientId: selectedUserId, type: "LOCATION", latitude, longitude };
        } else {
          if (messageType === "FILE") {
            const files = pendingAttachments.length > 0
              ? pendingAttachments.map((item) => item.file)
              : (selectedFile ? [selectedFile] : []);
            if (files.length === 0) { toast.error("No file selected."); return; }

            for (const file of files) {
              const uploaded = await uploadFile(file);
              await withSocketAck<Message>("message:send", {
                recipientId: selectedUserId,
                type: "FILE",
                fileUrl: uploaded.url,
                fileName: uploaded.fileName,
                fileMime: uploaded.fileMime,
                fileSize: uploaded.fileSize
              });
            }
            payload = null as any;
          } else {
            let file = selectedFile;
            if (!file && messageType === "VOICE" && voiceBlob) {
              file = new File([voiceBlob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
            }
            if (!file) { toast.error("No file selected."); return; }
            const uploaded = await uploadFile(file);
            payload = {
              recipientId: selectedUserId,
              type: messageType,
              fileUrl: uploaded.url,
              fileName: uploaded.fileName,
              fileMime: uploaded.fileMime,
              fileSize: uploaded.fileSize,
              durationSec: messageType === "VOICE" ? voiceDurationSec ?? undefined : undefined
            };
          }
        }

        if (payload) {
          await withSocketAck<Message>("message:send", payload);
        }
      }
      setMessageText("");
      setSelectedFile(null);
      clearPendingAttachments();
      setVoiceBlob(null);
      setVoiceDurationSec(null);
      setLocationLat("");
      setLocationLng("");
      setLocationAccuracy(null);
      setMessageType("TEXT");
      sendTypingSignal(false);
      if (sendSound) playMessageSentSound();
    } catch (error) {
      toast.error(readAxiosMessage(error, "Message not sent."));
    } finally {
      setIsSending(false);
      setUploadProgress(0);
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error("Enter group name.");
      return;
    }
    if (newGroupMembers.length === 0) {
      toast.error("Select at least 1 member.");
      return;
    }
    try {
      const response = await api.post<{ group: Group }>("/groups", {
        name: newGroupName.trim(),
        memberIds: newGroupMembers
      });
      setGroups((prev) => {
        if (prev.some((g) => g.id === response.data.group.id)) return prev;
        return [response.data.group, ...prev];
      });
      setShowCreateGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
      setChatMode("group");
      setSelectedGroupId(response.data.group.id);
      setSelectedUserId("");
      setSidebarTab("groups");
      toast.success("Group created!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to create group."));
    }
  };

  const addMembersToGroup = async () => {
    if (!selectedGroupId || addMemberIds.length === 0) {
      toast.error("Select at least 1 member.");
      return;
    }
    if (!canManageGroupMembers) {
      toast.error("You do not have permission to add members.");
      return;
    }
    try {
      const response = await api.post<{ group: Group }>(`/groups/${selectedGroupId}/members`, {
        memberIds: addMemberIds
      });
      setGroups((prev) => prev.map((g) => g.id === response.data.group.id ? response.data.group : g));
      setShowAddGroupMembers(false);
      setAddMemberIds([]);
      toast.success("Members added!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to add members."));
    }
  };

  const updateGroupDetails = async (payload: { name?: string; avatarUrl?: string | null }) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.patch<{ group: Group }>(`/groups/${selectedGroupId}`, payload);
      setGroups((prev) => prev.map((g) => (g.id === response.data.group.id ? response.data.group : g)));
      return response.data.group;
    } catch (error) {
      if (getAxiosStatus(error) !== 404) {
        throw error;
      }

      const response = await api.put<{ group: Group }>(`/groups/${selectedGroupId}`, payload);
      setGroups((prev) => prev.map((g) => (g.id === response.data.group.id ? response.data.group : g)));
      return response.data.group;
    }
  };

  const saveGroupName = async () => {
    const nextName = editGroupName.trim();
    if (!selectedGroupId || !nextName) {
      toast.error("Enter group name.");
      return;
    }
    if (activeGroup?.name === nextName) {
      setShowEditGroup(false);
      return;
    }
    try {
      await updateGroupDetails({ name: nextName });
      setShowEditGroup(false);
      toast.success("Group name updated.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to update group name."));
    }
  };

  const handleGroupAvatarChange = async (file: File) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const uploaded = await uploadFile(file);
      await updateGroupDetails({ avatarUrl: uploaded.url });
      toast.success("Group photo updated.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to update group photo."));
    }
  };

  const removeGroupAvatar = async () => {
    if (!selectedGroupId) {
      return;
    }
    try {
      await updateGroupDetails({ avatarUrl: null });
      toast.success("Group photo removed.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to remove group photo."));
    }
  };

  const updateGroupMemberRole = async (memberUserId: string, role: Exclude<GroupRole, "OWNER">) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.patch<{ group: Group }>(`/groups/${selectedGroupId}/members/${memberUserId}/role`, { role });
      setGroups((prev) => prev.map((g) => (g.id === response.data.group.id ? response.data.group : g)));
      toast.success(role === "ADMIN" ? "Member promoted to admin." : "Admin role removed.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to update member role."));
    }
  };

  const kickGroupMember = async (memberUserId: string) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.delete<{ group: Group }>(`/groups/${selectedGroupId}/members/${memberUserId}`);
      if (response.data.group) {
        setGroups((prev) => prev.map((g) => (g.id === response.data.group.id ? response.data.group : g)));
      }
      toast.success("Member removed from group.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to remove member."));
    }
  };

  const setupPeerConnection = useCallback(async (recipientId: string) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const peer = new RTCPeerConnection(getRtcConfiguration());
    const localCandTypes: Record<string, number> = {};

    peer.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current) {
        if (!event.candidate) {
          console.info(`[ICE][direct] gathering complete. Local candidate types:`, localCandTypes);
        }
        return;
      }
      const candStr = event.candidate.candidate || "";
      const typMatch = candStr.match(/ typ (\w+)/);
      const protoMatch = candStr.match(/^candidate:\S+ \d+ (\w+)/);
      const typ = typMatch ? typMatch[1] : "?";
      const proto = protoMatch ? protoMatch[1] : "?";
      localCandTypes[typ] = (localCandTypes[typ] || 0) + 1;
      console.info(`[ICE][direct] local candidate typ=${typ} proto=${proto}`);
      if (localCandTypes[typ] === 1) pushCallEvent(`local cand ${typ}/${proto}`, typ === "relay" ? "ok" : "info");
      const target = callPeerIdRef.current;
      if (!target || target === callGroupIdRef.current) {
        pendingIceCandidatesRef.current.push(event.candidate.toJSON());
        return;
      }
      socketRef.current.emit("call:ice-candidate", {
        recipientId: target,
        candidate: event.candidate.toJSON()
      });
    };

    peer.onicegatheringstatechange = () => {
      console.info(`[ICE][direct] gathering state: ${peer.iceGatheringState}`);
    };

    peer.ontrack = (event) => {
      console.log("[WebRTC] ontrack fired:", event.track.kind, "streams:", event.streams.length);
      if (event.track.kind === "video") {
        const video = remoteVideoRef.current;
        if (video) {
          video.srcObject = event.streams[0] || new MediaStream([event.track]);
          video.play().catch(() => { });
        }
        setIsRemoteScreenSharing(true);
        event.track.onended = () => {
          setIsRemoteScreenSharing(false);
          setScreenFullscreen(false);
        };
        event.track.onmute = () => {
          console.log("[WebRTC] Remote video track muted temporarily");
        };
        event.track.onunmute = () => {
          setIsRemoteScreenSharing(true);
        };
      }
      if (event.track.kind === "audio") {
        const audio = remoteAudioRef.current;
        if (!audio) {
          console.warn("[WebRTC] remoteAudioRef is null, cannot play remote audio!");
          return;
        }
        // Check if we already have this exact track playing — skip if same
        const existing = audio.srcObject as MediaStream | null;
        if (existing && existing.getAudioTracks().some(t => t.id === event.track.id && t.readyState === "live")) {
          console.log("[WebRTC] Same audio track already active, skipping");
          return;
        }
        const stream = new MediaStream([event.track]);
        audio.srcObject = stream;
        audio.volume = toMediaElementVolume(speakerVolume);
        if (selectedAudioOutput && typeof (audio as any).setSinkId === "function") {
          (audio as any).setSinkId(selectedAudioOutput).catch((err: any) => {
            console.warn("[WebRTC] setSinkId failed:", err);
            setSelectedAudioOutput("");
            localStorage.removeItem("audio_output");
          });
        }
        // Force play with aggressive retry — keep trying while call is active
        let attempts = 0;
        const tryPlay = () => {
          if (callStatusRef.current === "idle") return;
          attempts++;
          audio.play().then(() => {
            console.log(`[WebRTC] Remote audio playing (attempt ${attempts})`);
          }).catch((err) => {
            console.warn(`[WebRTC] audio.play() attempt ${attempts} failed:`, err);
            if (attempts < 20) {
              setTimeout(tryPlay, 300);
            }
          });
        };
        tryPlay();

        // Also listen for track unmute to ensure playback starts
        event.track.onunmute = () => {
          console.log("[WebRTC] Remote audio track unmuted");
          attempts = 0;
          tryPlay();
        };
      }
    };

    // Monitor ICE connection state
    peer.oniceconnectionstatechange = () => {
      const state = peer.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);
      pushCallEvent(`ICE: ${state}`, state === "connected" || state === "completed" ? "ok" : (state === "failed" ? "err" : (state === "disconnected" ? "warn" : "info")));
      if (state === "failed") {
        if (callDisconnectedTimerRef.current) {
          window.clearTimeout(callDisconnectedTimerRef.current);
          callDisconnectedTimerRef.current = null;
        }
        toast.error("Connection lost. Reconnecting...");
        pushCallEvent("restartIce() — failed state", "warn");
        peer.restartIce();
      } else if (state === "disconnected") {
        toast("Connection temporarily lost...");
        pushCallEvent("restartIce() — disconnected (immediate)", "warn");
        try { peer.restartIce(); } catch {}
        if (!callDisconnectedTimerRef.current) {
          callDisconnectedTimerRef.current = window.setTimeout(() => {
            callDisconnectedTimerRef.current = null;
            if (callStatusRef.current !== "idle") {
              stopCall(false);
              toast.error("Connection tiklanmadi. Call tugatildi.");
            }
          }, 12000);
        }
      } else if (state === "connected" || state === "completed") {
        if (callDisconnectedTimerRef.current) {
          window.clearTimeout(callDisconnectedTimerRef.current);
          callDisconnectedTimerRef.current = null;
        }
        console.log("[WebRTC] Audio aloqa o'rnatildi!");
        void logSelectedIceRoute(peer, "direct");
        // When ICE is connected, force play the audio element again
        const audio = remoteAudioRef.current;
        if (audio && audio.srcObject) {
          audio.play().catch(() => { });
        }
      } else {
        if (callDisconnectedTimerRef.current && (state === "checking" || state === "new")) {
          window.clearTimeout(callDisconnectedTimerRef.current);
          callDisconnectedTimerRef.current = null;
        }
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", peer.connectionState);
      pushCallEvent(`Conn: ${peer.connectionState}`, peer.connectionState === "connected" ? "ok" : (peer.connectionState === "failed" ? "err" : "info"));
      if (peer.connectionState === "failed") {
        console.warn("[WebRTC] connectionState=failed → attempting ICE restart");
        toast("Aloqa qayta ulanmoqda...");
        try { peer.restartIce(); } catch (e) { console.warn("[WebRTC] restartIce error:", e); }
        // Don't auto-end: rely on disconnected timer to end if restart fails
        if (!callDisconnectedTimerRef.current) {
          callDisconnectedTimerRef.current = window.setTimeout(() => {
            callDisconnectedTimerRef.current = null;
            if (callStatusRef.current !== "idle" && (peer.connectionState === "failed" || peer.iceConnectionState === "failed")) {
              stopCall(false);
              toast.error("Aloqa tiklanmadi. Call tugatildi.");
            }
          }, 20000);
        }
      }
    };

    peerConnectionRef.current = peer;
    return peer;
  }, [logSelectedIceRoute, selectedAudioOutput, speakerVolume, stopCall, pushCallEvent]);

  const getCallMicStream = useCallback(async () => {
    const audioConstraints: any = {
      noiseSuppression: noiseReduction,
      echoCancellation: noiseReduction,
      autoGainControl: noiseReduction,
      googEchoCancellation: noiseReduction,
      googAutoGainControl: noiseReduction,
      googNoiseSuppression: noiseReduction,
      googHighpassFilter: noiseReduction,
      googTypingNoiseDetection: noiseReduction,
      ...(selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : {})
    };

    const logTrack = async (stream: MediaStream, source: string) => {
      const track = stream.getAudioTracks()[0];
      if (!track) {
        console.error(`[Mic] ${source}: NO audio track in stream!`);
        return;
      }
      const settings = track.getSettings();
      console.info(`[Mic] ${source} OK — label="${track.label}" deviceId=${settings.deviceId} state=${track.readyState} muted=${track.muted} enabled=${track.enabled} sampleRate=${settings.sampleRate} channels=${settings.channelCount}`);
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const dev = devs.find((d) => d.deviceId === settings.deviceId && d.kind === "audioinput");
        if (dev) console.info(`[Mic] device-info: "${dev.label}" groupId=${dev.groupId}`);
      } catch {}
    };

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      await logTrack(s, selectedAudioInput ? `selected(${selectedAudioInput.slice(0, 8)})` : "default");
      return s;
    } catch (err) {
      if (!selectedAudioInput) {
        console.error("[Mic] getUserMedia failed (no saved deviceId)", err);
        throw err;
      }
      console.warn("[Mic] Selected mic unavailable, retrying with default input", err);
      setSelectedAudioInput("");
      localStorage.removeItem("audio_input");
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      await logTrack(s, "fallback-default");
      return s;
    }
  }, [noiseReduction, selectedAudioInput]);

  const runLoopbackCallTest = useCallback(async (): Promise<boolean> => {
    console.info("[Loopback] ▶ start E2E test (mic → RNNoise → RTCPeerConnection loopback → audio element)");
    let micStream: MediaStream | null = null;
    let processed: MediaStream | null = null;
    let pc1: RTCPeerConnection | null = null;
    let pc2: RTCPeerConnection | null = null;
    let testAudio: HTMLAudioElement | null = null;
    let monitorTimer: number | null = null;
    const cleanup = () => {
      if (monitorTimer) window.clearInterval(monitorTimer);
      try { pc1?.close(); } catch {}
      try { pc2?.close(); } catch {}
      try { processed?.getTracks().forEach(t => t.stop()); } catch {}
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      if (testAudio) {
        try { testAudio.pause(); } catch {}
        testAudio.srcObject = null;
        testAudio.remove();
      }
    };

    try {
      micStream = await getCallMicStream();
      const rawT = micStream.getAudioTracks()[0];
      console.info(`[Loopback] mic raw track: id=${rawT?.id} state=${rawT?.readyState} muted=${rawT?.muted} enabled=${rawT?.enabled} label="${rawT?.label}"`);
      if (!rawT || rawT.readyState !== "live") {
        console.error("[Loopback] FAIL: raw mic track not live");
        cleanup();
        return false;
      }

      processed = await applyRNNoiseFilter(micStream);
      const procT = processed.getAudioTracks()[0];
      console.info(`[Loopback] processed (post-RNNoise): id=${procT?.id} state=${procT?.readyState} muted=${procT?.muted} enabled=${procT?.enabled}`);
      if (!procT || procT.readyState !== "live") {
        console.error("[Loopback] FAIL: processed track not live after RNNoise");
        cleanup();
        return false;
      }

      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => { if (e.candidate) pc2!.addIceCandidate(e.candidate).catch(() => {}); };
      pc2.onicecandidate = (e) => { if (e.candidate) pc1!.addIceCandidate(e.candidate).catch(() => {}); };
      pc1.oniceconnectionstatechange = () => console.info(`[Loopback] pc1 ICE: ${pc1!.iceConnectionState}`);
      pc2.oniceconnectionstatechange = () => console.info(`[Loopback] pc2 ICE: ${pc2!.iceConnectionState}`);

      testAudio = document.createElement("audio");
      testAudio.autoplay = true;
      (testAudio as any).playsInline = true;
      testAudio.volume = 1;
      document.body.appendChild(testAudio);

      pc2.ontrack = (e) => {
        console.info(`[Loopback] pc2 ontrack: kind=${e.track.kind} id=${e.track.id} streams=${e.streams.length}`);
        const s = e.streams[0] || new MediaStream([e.track]);
        testAudio!.srcObject = s;
        testAudio!.play().then(() => console.info("[Loopback] testAudio.play() OK")).catch((err) => console.warn("[Loopback] testAudio.play() failed:", err));
      };

      processed.getTracks().forEach(t => {
        const sender = pc1!.addTrack(t, processed!);
        console.info(`[Loopback] pc1 addTrack kind=${t.kind} id=${t.id} senderTrack=${sender.track?.id}`);
      });

      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      const audioMline = (offer.sdp || "").split("\n").find((l) => l.startsWith("m=audio"));
      console.info(`[Loopback] SDP audio m-line: ${audioMline?.trim()}`);

      // Monitor inbound audio bytes for 5 sec to confirm media flow
      let lastBytes = 0;
      let samples = 0;
      let bytesEverGrew = false;
      monitorTimer = window.setInterval(async () => {
        if (!pc2) return;
        const stats = await pc2.getStats();
        let inboundBytes = 0;
        let packetsReceived = 0;
        stats.forEach((r: any) => {
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            inboundBytes = r.bytesReceived || 0;
            packetsReceived = r.packetsReceived || 0;
          }
        });
        const delta = inboundBytes - lastBytes;
        if (delta > 0) bytesEverGrew = true;
        console.info(`[Loopback] @${++samples}s inbound bytes=${inboundBytes} (Δ${delta}) pkts=${packetsReceived}`);
        lastBytes = inboundBytes;
      }, 1000);

      await new Promise((r) => setTimeout(r, 5500));
      window.clearInterval(monitorTimer);
      monitorTimer = null;
      cleanup();

      if (bytesEverGrew) {
        console.info("[Loopback] ✅ PASS: media bytes flowed end-to-end. Audio pipeline OK.");
        return true;
      }
      console.error("[Loopback] ❌ FAIL: zero inbound audio bytes received in 5s. Pipeline broken.");
      return false;
    } catch (err) {
      console.error("[Loopback] exception:", err);
      cleanup();
      return false;
    }
  }, [getCallMicStream]);

  const startCall = async (overridePeerId?: string) => {
    const targetPeerId = overridePeerId || selectedUserId;
    if (!targetPeerId) {
      toast("Select a chat user first.");
      return;
    }
    if (targetPeerId === currentUserIdRef.current) {
      toast.error("You cannot call yourself.");
      return;
    }
    if (!socketRef.current) {
      toast.error("Socket not connected.");
      return;
    }

    try {
      // Unlock audio element within user gesture context (critical for WebView2)
      const audioEl = remoteAudioRef.current;
      if (audioEl) {
        audioEl.muted = true;
        audioEl.srcObject = new MediaStream();
        audioEl.play().then(() => { audioEl.muted = false; }).catch(() => { audioEl.muted = false; });
        window.setTimeout(() => {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
        }, 0);
      }

      console.info(`[Call] ▶ startCall (OUTGOING) → peer=${targetPeerId} micVolume=${micVolume} noiseReduction=${noiseReduction}`);
      setCallMicMuted(false);
      let rawStream = await getCallMicStream();
      const beforeFilter = rawStream.getAudioTracks()[0];
      console.info(`[Call] raw mic track before RNNoise: id=${beforeFilter?.id} state=${beforeFilter?.readyState} muted=${beforeFilter?.muted}`);
      rawStream = await applyRNNoiseFilter(rawStream);
      const afterFilter = rawStream.getAudioTracks()[0];
      console.info(`[Call] mic track AFTER RNNoise: id=${afterFilter?.id} state=${afterFilter?.readyState} muted=${afterFilter?.muted} enabled=${afterFilter?.enabled}`);
      localCallStreamRef.current = rawStream;
      pendingIceCandidatesRef.current = [];
      remoteDescriptionSetRef.current = false;
      remoteIceCandidatesBufferRef.current = [];
      setCallPeerId(targetPeerId);
      callPeerIdRef.current = targetPeerId;
      const peer = await setupPeerConnection(targetPeerId);
      rawStream.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, rawStream);
        console.info(`[Call] addTrack kind=${track.kind} id=${track.id} senderId=${(sender as any)?.track?.id}`);
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const audioMline = (offer.sdp || "").split("\n").find((l) => l.startsWith("m=audio"));
      const sendrecv = /a=sendrecv/.test(offer.sdp || "");
      console.info(`[Call] Local OFFER created. audio m-line="${audioMline?.trim()}" hasSendrecv=${sendrecv}`);

      socketRef.current.emit("call:offer", {
        recipientId: targetPeerId,
        sdp: offer
      });
      console.info(`[Call] ✉ call:offer SENT → ${targetPeerId}`);

      setCallStatus("calling");
      // Persist active-call state for auto-resume after restart/update
      saveActiveCallState({
        peerId: targetPeerId,
        type: "direct",
        startedAt: Date.now(),
        lastTickAt: Date.now()
      });

      // Answer-timeout: if no call:answer arrives in 30s, abort with clear message
      if (callAnswerTimeoutRef.current) {
        window.clearTimeout(callAnswerTimeoutRef.current);
      }
      callAnswerTimeoutRef.current = window.setTimeout(() => {
        callAnswerTimeoutRef.current = null;
        if (callStatusRef.current === "calling") {
          console.warn("[Call] ⏱ No call:answer in 30s — aborting");
          toast.error("Boshqa tomon javob bermadi (30s). Versiyasi eski yoki offline bo'lishi mumkin.");
          stopCall(true);
        }
      }, 30000);
    } catch (err) {
      console.error("Call start error:", err);
      toast.error("Failed to start call. Check microphone permission.");
      stopCall(true);
    }
  };

  // Expose latest startCall via ref so non-component code (auto-resume effect) can call it
  startCallRef.current = startCall;

  // ── Auto-resume call after restart/update ──
  // If we were in a call within the last ACTIVE_CALL_RESUME_WINDOW_MS,
  // automatically re-dial the same peer once socket is connected.
  useEffect(() => {
    if (!isSocketConnected) return;
    if (autoResumeAttemptedRef.current) return;
    if (callStatusRef.current !== "idle") return;
    const saved = loadActiveCallState();
    if (!saved) return;
    const age = Date.now() - (saved.lastTickAt || saved.startedAt || 0);
    if (age > ACTIVE_CALL_RESUME_WINDOW_MS) {
      clearActiveCallState();
      return;
    }
    if (saved.type !== "direct" || !saved.peerId) {
      // Group resume not implemented yet — skip
      clearActiveCallState();
      return;
    }
    autoResumeAttemptedRef.current = true;
    // Small delay so socket auth + handlers fully attached
    window.setTimeout(() => {
      if (callStatusRef.current !== "idle") return;
      toast("Qo'ng'iroqni qayta ulayapman...");
      startCallRef.current?.(saved.peerId).catch((err) => {
        console.warn("[Call] auto-resume failed:", err);
        clearActiveCallState();
      });
    }, 1500);
  }, [isSocketConnected]);

  const toggleScreenShare = async () => {
    if (callGroupIdRef.current) {
      toast("Group call uchun ekran ulashish hozircha o'chirilgan.");
      return;
    }
    if (!peerConnectionRef.current || !socketRef.current || !callPeerIdRef.current) return;

    if (isScreenSharing) {
      localScreenStreamRef.current?.getTracks().forEach(t => t.stop());
      localScreenStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;

      // Remove all screenshare senders (video and any leftover audio)
      const senders = peerConnectionRef.current.getSenders();
      const micTrack = localCallStreamRef.current?.getAudioTracks()[0] ?? null;
      for (const sender of senders) {
        if (sender.track && sender.track !== micTrack && (sender.track.kind === "video" || sender.track.kind === "audio")) {
          peerConnectionRef.current.removeTrack(sender);
        }
      }

      setIsScreenSharing(false);
      setLocalScreenFullscreen(false);

      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => null);
        if (!stream) return;

        localScreenStreamRef.current = stream;
        setIsScreenSharing(true);

        // Only add video track — keep call audio separate from screenshare
        stream.getTracks().forEach(t => {
          if (t.kind === "video") {
            peerConnectionRef.current!.addTrack(t, stream);
            t.onended = () => {
              if (localScreenStreamRef.current) toggleScreenShare();
            };
          } else {
            t.stop(); // Stop screen audio track — not needed
          }
        });

        requestAnimationFrame(() => {
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        });

        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !socketRef.current) {
      return;
    }
    try {
      await clearMobileCallNotification();
      // Unlock audio element within user gesture context (critical for WebView2)
      const audioEl = remoteAudioRef.current;
      if (audioEl) {
        audioEl.muted = true;
        audioEl.srcObject = new MediaStream();
        audioEl.play().then(() => { audioEl.muted = false; }).catch(() => { audioEl.muted = false; });
        window.setTimeout(() => {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
        }, 0);
      }

      console.info(`[Call] ▶ acceptCall (INCOMING) ← from=${incomingCall.fromUserId} micVolume=${micVolume} noiseReduction=${noiseReduction} group=${callGroupIdRef.current ?? "-"}`);
      setCallMicMuted(false);
      let rawStream = await getCallMicStream();
      const beforeF = rawStream.getAudioTracks()[0];
      console.info(`[Call] raw mic before RNNoise: id=${beforeF?.id} state=${beforeF?.readyState} muted=${beforeF?.muted}`);
      rawStream = await applyRNNoiseFilter(rawStream);
      const afterF = rawStream.getAudioTracks()[0];
      console.info(`[Call] mic AFTER RNNoise: id=${afterF?.id} state=${afterF?.readyState} muted=${afterF?.muted} enabled=${afterF?.enabled}`);
      localCallStreamRef.current = rawStream;

      if (callGroupIdRef.current) {
        const groupId = callGroupIdRef.current;
        const peer = setupGroupPeerConnection(incomingCall.fromUserId);
        await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
        groupRemoteDescriptionSetRef.current.set(incomingCall.fromUserId, true);
        const buffered = groupRemoteIceCandidatesBufferRef.current.get(incomingCall.fromUserId) ?? [];
        groupRemoteIceCandidatesBufferRef.current.set(incomingCall.fromUserId, []);
        console.info(`[GroupCall] Flushing ${buffered.length} buffered remote ICE candidates from ${incomingCall.fromUserId}`);
        pushCallEvent(`grp flushed ${buffered.length} cand`, buffered.length > 0 ? "ok" : "warn");
        for (const candidate of buffered) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
            console.warn("[WebRTC] group buffered addIceCandidate failed:", err);
          });
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current.emit("group:call:answer", {
          groupId,
          toUserId: incomingCall.fromUserId,
          sdp: answer
        });

        socketRef.current.emit("group:call:join", { groupId });
        setGroupCallParticipants((prev) => {
          const next = [...prev];
          const ensure = (uid: string) => {
            if (!next.some((p) => p.userId === uid)) {
              next.push({ userId: uid, speaking: false });
            }
          };
          ensure(currentUserIdRef.current);
          ensure(incomingCall.fromUserId);
          return next;
        });
        startVAD(rawStream, groupId);
        setCallPeerId(groupId);
        setCallStatus("in-call");
        setCallMinimized(true);
        setIncomingCall(null);
        // Persist for auto-resume
        saveActiveCallState({ peerId: groupId, type: "group", startedAt: Date.now(), lastTickAt: Date.now() });
        toast.success("Call accepted.");
        return;
      }

      remoteDescriptionSetRef.current = false;
      // ⚠️ DO NOT clear remoteIceCandidatesBufferRef here!
      // Caller's ICE candidates arrive during the ringing phase (before user accepts)
      // and are buffered. If we wipe them, callee will have ZERO remote candidates
      // → ICE state stuck at "new" forever (caller doesn't re-send).
      setCallPeerId(incomingCall.fromUserId);
      callPeerIdRef.current = incomingCall.fromUserId;
      const peer = await setupPeerConnection(incomingCall.fromUserId);
      rawStream.getTracks().forEach((track) => peer.addTrack(track, rawStream));

      await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      remoteDescriptionSetRef.current = true;
      // Flush ALL buffered remote ICE candidates (those received during ringing + during setRemoteDescription)
      const buffered = remoteIceCandidatesBufferRef.current;
      remoteIceCandidatesBufferRef.current = [];
      console.info(`[Call] Flushing ${buffered.length} buffered remote ICE candidates`);
      pushCallEvent(`flushed ${buffered.length} remote cand`, buffered.length > 0 ? "ok" : "warn");
      for (const c of buffered) {
        await peer.addIceCandidate(new RTCIceCandidate(c)).catch((err) => {
          console.warn("[WebRTC] buffered addIceCandidate failed:", err);
        });
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socketRef.current.emit("call:answer", {
        recipientId: incomingCall.fromUserId,
        sdp: answer
      });

      // If this is a group call, emit join and start VAD
      if (callGroupIdRef.current) {
        socketRef.current.emit("group:call:join", { groupId: callGroupIdRef.current });
        setGroupCallParticipants(prev => {
          const uid = currentUserIdRef.current;
          if (prev.some(p => p.userId === uid)) return prev;
          return [...prev, { userId: uid, speaking: false }];
        });
        startVAD(rawStream, callGroupIdRef.current);
      }

      setCallPeerId(incomingCall.fromUserId);
      setCallStatus("in-call");
      setCallMinimized(true);
      setIncomingCall(null);
      // Persist for auto-resume after restart/update
      saveActiveCallState({
        peerId: incomingCall.fromUserId,
        type: "direct",
        startedAt: Date.now(),
        lastTickAt: Date.now()
      });
      toast.success("Call accepted.");
    } catch (err: any) {
      const stage = err?.message || String(err);
      console.error("[Call] ❌ acceptCall FAILED:", err);
      toast.error(`Accept fail: ${stage}`.slice(0, 200));
      try {
        if (incomingCall && socketRef.current) {
          socketRef.current.emit("call:end", { recipientId: incomingCall.fromUserId, reason: `accept-error: ${stage}`.slice(0, 120) });
        }
      } catch {}
      stopCall(true);
    }
  };

  const declineCall = () => {
    if (incomingCall && socketRef.current) {
      socketRef.current.emit("call:end", { recipientId: incomingCall.fromUserId, reason: "declined" });
    }
    void clearMobileCallNotification();
    stopCall(true);
  };

  // Listen for accept/decline from the call notification (Wails event)
  const acceptCallRef = useRef(acceptCall);
  const declineCallRef = useRef(declineCall);
  acceptCallRef.current = acceptCall;
  declineCallRef.current = declineCall;
  pendingCallActionHandlerRef.current = (action, userId) => {
    if (callStatusRef.current !== "ringing" || !incomingCall) {
      return;
    }
    if (userId && incomingCall.fromUserId !== userId) {
      return;
    }
    if (action === "accept") {
      acceptCallRef.current();
      return;
    }
    declineCallRef.current();
  };
  useEffect(() => {
    EventsOn("call-notif:action", (action: string) => {
      if (action === "accept") {
        acceptCallRef.current();
      } else {
        declineCallRef.current();
      }
    });
    return () => { EventsOff("call-notif:action"); };
  }, []);

  useEffect(() => {
    if (!isNativeMobileRuntime) {
      return;
    }

    let appStateHandle: PluginListenerHandle | undefined;
    let notificationActionHandle: PluginListenerHandle | undefined;

    CapacitorApp.getState().then((state) => {
      isAppActiveRef.current = state.isActive;
      if (state.isActive) {
        void clearMobileCallNotification();
        syncActiveChatSnapshot();
      }
    }).catch(() => {});

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      isAppActiveRef.current = isActive;
      if (isActive) {
        void clearMobileCallNotification();
        syncActiveChatSnapshot();
      }
    }).then((handle) => {
      appStateHandle = handle;
    }).catch(() => {});

    LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      const notificationKind = event.notification.extra?.kind;
      if (notificationKind === "incoming-message") {
        const target = readNotificationTarget(event.notification.extra);
        openNotificationTarget(target);
        return;
      }

      if (notificationKind !== "incoming-call") {
        return;
      }

      void clearMobileCallNotification();

      if (event.actionId === MOBILE_CALL_DECLINE_ACTION_ID) {
        declineCallRef.current();
        return;
      }

      acceptCallRef.current();
    }).then((handle) => {
      notificationActionHandle = handle;
    }).catch(() => {});

    return () => {
      void appStateHandle?.remove();
      void notificationActionHandle?.remove();
    };
  }, [clearMobileCallNotification, openNotificationTarget, syncActiveChatSnapshot]);

  useEffect(() => {
    if (!(appLocked && appLockEnabled)) {
      return;
    }

    const forceFocus = () => {
      const el = lockPasscodeInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (isNativeMobileRuntime) {
        requestAnimationFrame(() => {
          const active = lockPasscodeInputRef.current;
          active?.focus({ preventScroll: true });
        });
      }
    };

    forceFocus();
    const t1 = window.setTimeout(forceFocus, 140);
    const t2 = window.setTimeout(forceFocus, 420);

    const onVisible = () => {
      if (!document.hidden) forceFocus();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [appLocked, appLockEnabled]);

  // ── Force play remote audio when call connects ──
  useEffect(() => {
    if (callStatus === "in-call") {
      const audio = remoteAudioRef.current;
      // Retry audio playback every 500ms while call is active
      const interval = setInterval(() => {
        const a = remoteAudioRef.current;
        if (a && a.srcObject) {
          a.muted = false;
          a.volume = toMediaElementVolume(speakerVolume);
          if (a.paused) {
            a.play().then(() => {
              console.log("[Call] Remote audio playing via retry");
            }).catch(() => {});
          }
        }
      }, 500);
      // Also try immediately
      if (audio && audio.srcObject) {
        audio.muted = false;
        audio.volume = toMediaElementVolume(speakerVolume);
        audio.play().catch(() => {});
      }
      return () => clearInterval(interval);
    }
  }, [callStatus, speakerVolume]);

  // ── Tick active-call state every 5s while in-call (so resume window stays fresh) ──
  useEffect(() => {
    if (callStatus !== "in-call") return;
    const tick = () => {
      const cur = loadActiveCallState();
      if (cur) {
        cur.lastTickAt = Date.now();
        saveActiveCallState(cur);
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [callStatus]);

  // ── LISTEN FOR UPDATE PROGRESS ──
  useEffect(() => {
    if (!isWails) return;
    EventsOn("update:progress", (payload: any) => {
      if (typeof payload === "number") {
        setUpdateProgress(payload);
        return;
      }
      if (payload && typeof payload === "object") {
        const percent = Number(payload.percent);
        const speedMbps = Number(payload.speedMbps);
        if (Number.isFinite(percent)) {
          setUpdateProgress(Math.max(0, Math.min(100, Math.round(percent))));
        }
        if (Number.isFinite(speedMbps)) {
          setUpdateSpeedMbps(Math.max(0, speedMbps));
        }
      }
    });
    return () => { EventsOff("update:progress"); };
  }, [isWails]);

  // ── AUTO-LOCK: lock app after idle/minimized timeout ──
  useEffect(() => {
    if (!appLockEnabled || !autoLockEnabled || appLocked) return;

    const startAutoLockTimer = () => {
      if (autoLockTimerRef.current) window.clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = window.setTimeout(() => {
        if (appLockEnabled && autoLockEnabled) {
          setAppLocked(true);
        }
      }, autoLockMinutes * 60 * 1000);
    };

    const stopAutoLockTimer = () => {
      if (autoLockTimerRef.current) {
        window.clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        startAutoLockTimer();
      } else {
        stopAutoLockTimer();
      }
    };

    // Also reset timer on user activity
    const resetIdleTimer = () => {
      stopAutoLockTimer();
      startAutoLockTimer();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("mousemove", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    window.addEventListener("click", resetIdleTimer);

    // Start the timer initially
    startAutoLockTimer();

    return () => {
      stopAutoLockTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("mousemove", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      window.removeEventListener("click", resetIdleTimer);
    };
  }, [appLockEnabled, autoLockEnabled, autoLockMinutes, appLocked]);

  // ── CHAT PIN / ARCHIVE / ORDER HELPERS ──
  const togglePin = (chatId: string) => {
    setPinnedChats(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      localStorage.setItem("pinned_chats", JSON.stringify([...next]));
      return next;
    });
  };
  const toggleArchive = (chatId: string) => {
    setArchivedChats(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
  };
  const removeChat = (chatId: string) => {
    setArchivedChats(prev => {
      const next = new Set(prev);
      next.add(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
    if (selectedUserId === chatId) setSelectedUserId("");
    if (selectedGroupId === chatId) setSelectedGroupId("");
  };
  const clearChatLocalState = (chatId: string) => {
    setPinnedChats((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      localStorage.setItem("pinned_chats", JSON.stringify([...next]));
      return next;
    });
    setArchivedChats((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
    setChatOrder((prev) => {
      if (!prev.includes(chatId)) return prev;
      const next = prev.filter((id) => id !== chatId);
      localStorage.setItem("chat_order", JSON.stringify(next));
      return next;
    });
  };
  const removeGroupChat = async (groupId: string) => {
    if (!currentUser) {
      return;
    }
    try {
      await api.delete(`/groups/${groupId}`);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      clearChatLocalState(groupId);
      if (selectedGroupId === groupId) {
        setSelectedGroupId("");
      }
      toast.success("Group deleted.");
      return;
    } catch (error) {
      const status = getAxiosStatus(error);
      if (status !== 403 && status !== 404) {
        toast.error(readAxiosMessage(error, "Failed to remove group."));
        return;
      }
    }

    try {
      await api.delete(`/groups/${groupId}/members/${currentUser.id}`);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      clearChatLocalState(groupId);
      if (selectedGroupId === groupId) {
        setSelectedGroupId("");
      }
      toast.success("You left the group.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to remove group."));
    }
  };
  const saveChatOrder = (order: string[]) => {
    setChatOrder(order);
    localStorage.setItem("chat_order", JSON.stringify(order));
  };

  const handleDragStart = (chatId: string) => setDraggedChatId(chatId);
  const handleDragOver = (e: React.DragEvent, chatId: string) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (draggedChatId && chatId !== draggedChatId) setDragOverId(chatId); };
  const handleDragLeave = () => setDragOverId(null);
  const handleDrop = (targetChatId: string, items: { id: string }[]) => {
    if (!draggedChatId || draggedChatId === targetChatId) return;
    const ids = items.map(i => i.id);
    const fromIdx = ids.indexOf(draggedChatId);
    const toIdx = ids.indexOf(targetChatId);
    if (fromIdx < 0 || toIdx < 0) return;
    const newOrder = [...ids];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedChatId);
    saveChatOrder(newOrder);
    setDraggedChatId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => { setDraggedChatId(null); setDragOverId(null); };

  // Sort function: pinned first, then custom order, then default
  const sortChats = <T extends { id: string }>(list: T[]): T[] => {
    const pinned = list.filter(i => pinnedChats.has(i.id));
    const unpinned = list.filter(i => !pinnedChats.has(i.id));
    const sortByOrder = (a: { id: string }, b: { id: string }) => {
      const ai = chatOrder.indexOf(a.id);
      const bi = chatOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    };
    pinned.sort(sortByOrder);
    unpinned.sort(sortByOrder);
    return [...pinned, ...unpinned];
  };

  // ── Filtered chat lists ──
  const filteredUsers = useMemo(() => {
    let list = users.filter(u => !archivedChats.has(u.id) || showArchived);
    if (chatSearch.trim()) {
      const q = chatSearch.toLowerCase();
      list = list.filter(u => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return sortChats(list);
  }, [users, chatSearch, pinnedChats, archivedChats, chatOrder, showArchived]);

  const filteredGroups = useMemo(() => {
    let list = groups.filter(g => !archivedChats.has(g.id) || showArchived);
    if (chatSearch.trim()) {
      const q = chatSearch.toLowerCase();
      list = list.filter(g => g.name.toLowerCase().includes(q));
    }
    return sortChats(list);
  }, [groups, chatSearch, pinnedChats, archivedChats, chatOrder, showArchived]);
  
  useEffect(() => {
    if (mobileBottomTab === "chats") {
      setSidebarTab("contacts");
      setIsMobileChatOpen(false);
      return;
    }
    if (mobileBottomTab === "groups") {
      setSidebarTab("groups");
      setIsMobileChatOpen(false);
    }
  }, [mobileBottomTab]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobileViewport(mobile);
      if (!mobile) {
        setIsMobileChatOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── APP LOCK SCREEN ──
  if (appLocked && appLockEnabled) {
    return (
      <div className="layout dark">
        <div className="auth-page" style={{ gridColumn: "1 / -1" }}>
          <div className="auth-card" onClick={() => lockPasscodeInputRef.current?.focus()}>
            <div className="auth-logo">🔒</div>
            <h1>App Locked</h1>
            <p>Enter passcode to continue</p>
            <form className="form" onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}>
              <input
                ref={lockPasscodeInputRef}
                type="password"
                placeholder="Enter passcode"
                value={lockPasscodeInput}
                onChange={(e) => setLockPasscodeInput(sanitizeUnlockInput(e.target.value, unlockKeyboardMode))}
                inputMode={unlockKeyboardMode === "numeric" ? "numeric" : "text"}
                pattern={unlockKeyboardMode === "numeric" ? "[0-9]*" : undefined}
                maxLength={PASSCODE_MAX_LENGTH}
                autoFocus
                required
              />
              <button
                className="btn-link"
                type="button"
                onClick={() => setUnlockKeyboardMode((prev) => (prev === "numeric" ? "text" : "numeric"))}
              >
                {unlockKeyboardMode === "numeric"
                  ? "Old passcode (harf) uchun ABC keyboard"
                  : "Raqamli keyboardga qaytish (123)"}
              </button>
              <button className="btn-primary" type="submit">Unlock</button>
            </form>
          </div>
        </div>
        {/* Update dialog on lock screen */}
        {updateAvailable && (
          <div className="lightbox-overlay" onClick={() => setUpdateAvailable(null)}>
            <div className="create-group-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 40 }}>🔄</span>
                <h3 style={{ margin: '8px 0' }}>New version available!</h3>
                <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>
                  Version <strong>{updateAvailable.newVersion}</strong> is ready to download
                </p>
                {updateAvailable.notes && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0' }}>
                    {updateAvailable.notes}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, padding: 12, borderRadius: 10, fontWeight: 600, fontSize: 14 }}
                  disabled={isUpdating}
                  onClick={() => { void handleUpdateInstall(); }}
                >
                  {isUpdating
                  ? `Downloading... ${updateProgress}%${updateSpeedLabel}`
                    : updateActionLabel}
                </button>
                <button
                  style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                  onClick={() => setUpdateAvailable(null)}
                  disabled={isUpdating}
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!token || !currentUser) {
    if (token && (isSessionBootstrapping || sessionBootstrapError)) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <div className="session-loader-mark" aria-hidden="true">
              <div className="session-loader-ring" />
              <div className="session-loader-core">CD</div>
            </div>
            <h1>Session tiklanmoqda</h1>
            <p>
              {isSessionBootstrapping
                ? "Avvalgi login ma'lumotlari tekshirilmoqda..."
                : sessionBootstrapError}
            </p>
            {!isSessionBootstrapping && (
              <button className="btn-primary" type="button" onClick={() => setSessionBootstrapNonce((prev) => prev + 1)}>
                Qayta urinish
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">💬</div>
          <h1>Chat Desktop</h1>
          <p>Secure real-time messaging</p>

          {authStep === "login" && (
            <form className="form" onSubmit={handleLogin}>
              <input
                type="email"
                placeholder="Email address"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Sign In
              </button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("register")}>
                Create Account
              </button>
              <button className="btn-link" disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("forgot")}>
                Forgot password?
              </button>
              <div className="auth-divider"><span>or</span></div>
              <button type="button" className="google-desktop-btn" onClick={startGoogleLogin} disabled={googleAuthLoading}>
                {googleAuthLoading ? "⏳ Browserda kiring..." : "🔵 Google bilan kirish"}
              </button>
            </form>
          )}

          {authStep === "register" && (
            <form className="form" onSubmit={handleRegister}>
              <input
                type="text"
                placeholder="Display name"
                value={registerDisplayName}
                onChange={(event) => setRegisterDisplayName(event.target.value)}
                required
              />
              <input
                type="email"
                placeholder="Email address"
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Sign Up
              </button>
              <button className="btn-link" disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                ← Back to Sign In
              </button>
            </form>
          )}

          {authStep === "verify" && (
            <form className="form" onSubmit={handleVerifyEmail}>
              <input
                type="email"
                placeholder="Email address"
                value={verifyEmail}
                onChange={(event) => setVerifyEmail(event.target.value)}
                required
              />
              <input
                type="text"
                placeholder="6-digit verification code"
                value={verifyCode}
                onChange={(event) => setVerifyCode(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Verify & Sign In
              </button>
              <button className="btn-link" disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                ← Back to Sign In
              </button>
            </form>
          )}

          {authStep === "login2fa" && (
            <form className="form" onSubmit={handle2FALogin}>
              <input
                type="text"
                placeholder="Authenticator code"
                value={twoFALoginCode}
                onChange={(event) => setTwoFALoginCode(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Verify 2FA
              </button>
              <button
                className="btn-link"
                disabled={isSubmittingAuth}
                type="button"
                onClick={() => {
                  setAuthStep("login");
                  setTempTwoFAToken("");
                }}
              >
                ← Back
              </button>
            </form>
          )}

          {authStep === "forgot" && (
            <form className="form" onSubmit={handleForgotPassword}>
              <input
                type="email"
                placeholder="Email address"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Send Reset Code
              </button>
              <button className="btn-link" disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                ← Back to Sign In
              </button>
            </form>
          )}

          {authStep === "reset" && (
            <form className="form" onSubmit={handleResetPassword}>
              <input
                type="email"
                placeholder="Email address"
                value={verifyEmail}
                onChange={(event) => setVerifyEmail(event.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Reset code"
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
                required
              />
              <input
                type="password"
                placeholder="New password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                required
              />
              <button className="btn-primary" disabled={isSubmittingAuth} type="submit">
                Reset Password
              </button>
              <button className="btn-link" disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                ← Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`layout dark${isMobileChatOpen ? " mobile-chat-open" : ""}`} style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}>
      {/* ── GLOBAL MUSIC CONTROLLER BAR ── */}
      <GlobalMusicController />

      {/* ── FLOATING INCOMING CALL OVERLAY ── */}
      {!isNativeMobileRuntime && !isWails && callStatus === "ringing" && incomingCall && (
        <div className="floating-call-overlay">
          <div className="floating-call-card">
            <div className="floating-call-pulse">📞</div>
            <div className="floating-call-info">
              <div className="floating-call-title">Incoming call</div>
              <div className="floating-call-name">
                {users.find(u => u.id === incomingCall.fromUserId)?.displayName ?? incomingCall.fromUserId}
              </div>
            </div>
            <div className="floating-call-btns">
              <button className="floating-accept-btn" onClick={acceptCall}>✓</button>
              <button className="floating-decline-btn" onClick={declineCall}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── BURGER MENU OVERLAY (Settings/Night Mode/etc) ── */}
      {leftOpen && <div className="sidebar-overlay" onClick={() => setLeftOpen(false)} />}
      <aside className={`left-panel${leftOpen ? " open" : ""}`}>
        <div className="profile-card clickable" onClick={() => { setLeftOpen(false); setShowMyProfile(true); setEditDisplayName(currentUser.displayName); setEditUsername(currentUser.username ?? ""); setEditStatusText(currentUser.statusText ?? ""); setEditStatusEmoji(currentUser.statusEmoji ?? ""); }}>
          {hasUsableAvatar(currentUser.avatarUrl) && !brokenAvatarIds[currentUser.id] ? (
            <img
              src={`${API_URL}${currentUser.avatarUrl}`}
              alt="Avatar"
              className="profile-avatar-img"
              onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [currentUser.id]: true }))}
            />
          ) : (
            <div className="profile-avatar">{getInitialLetter(currentUser.displayName)}</div>
          )}
          <div className="profile-info">
            <strong>{currentUser.displayName}</strong>
            <small>{currentUser.statusEmoji || currentUser.statusText
              ? `${currentUser.statusEmoji ?? ""} ${currentUser.statusText ?? ""}`.trim()
              : currentUser.username ? `@${currentUser.username}` : currentUser.email}</small>
          </div>
        </div>

        <div className="sidebar-menu">
          <button className="sidebar-menu-item" onClick={() => { setShowCreateGroup(true); setLeftOpen(false); }}>➕ Create Group</button>
          <button className="sidebar-menu-item" onClick={() => { setChatMode("user"); setSelectedUserId(currentUser.id); setSelectedGroupId(""); setIsSelectionMode(false); setSelectedMessageIds(new Set()); if (isMobileViewport) setIsMobileChatOpen(true); setLeftOpen(false); }}>🔖 Saved Messages</button>
          <button className="sidebar-menu-item" onClick={() => { setShowSettings(true); setLeftOpen(false); }}>⚙️ Settings</button>
          <button className="sidebar-menu-item" onClick={() => {
            if (appLockEnabled) {
              setAppLocked(true);
              setLeftOpen(false);
            } else {
              toast("Set a passcode in settings first.");
            }
          }}>🔒 Lock</button>
          <button className="sidebar-menu-item" onClick={clearSession}>🚪 Logout</button>
        </div>

        <div className="sidebar-bottom">
          <div className="theme-toggle-row">
            <span className="theme-toggle-label">Theme mode: Dark</span>
          </div>
        </div>
      </aside>

      {/* ── SETTINGS MODAL ── */}
      {showSettings && (
        <div className="lightbox-overlay" onClick={() => { setShowSettings(false); setProxyLoaded(false); }}>
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()} ref={(el) => {
            if (el && !proxyLoaded && isWails) {
              setProxyLoaded(true);
              GetProxyConfig().then((cfg: any) => {
                setProxyEnabled(!!cfg.enabled);
                setProxyType(cfg.type || "socks5");
                setProxyHost(cfg.host || "");
                setProxyPort(cfg.port || "");
              }).catch(() => {});
              GetToastPosition().then((pos) => {
                const raw = (pos || "bottom-right") as "top-left" | "top-right" | "bottom-left" | "bottom-right";
                const p = raw === "top-left" ? "bottom-left" : raw === "top-right" ? "bottom-right" : raw;
                setToastPositionState(p);
              }).catch(() => {});
            }
          }}>
            <div className="settings-header">
              <h3>⚙️ Settings</h3>
              <button className="settings-close" onClick={() => { setShowSettings(false); setProxyLoaded(false); }}>✕</button>
            </div>

            <div className="settings-tabs">
              <button
                className={`settings-tab-btn${settingsCategory === "general" ? " active" : ""}`}
                onClick={() => setSettingsCategory("general")}
                type="button"
              >
                General
              </button>
              <button
                className={`settings-tab-btn${settingsCategory === "design" ? " active" : ""}`}
                onClick={() => setSettingsCategory("design")}
                type="button"
              >
                Design
              </button>
              <button
                className={`settings-tab-btn${settingsCategory === "call" ? " active" : ""}`}
                onClick={() => setSettingsCategory("call")}
                type="button"
              >
                Call
              </button>
              <button
                className={`settings-tab-btn${settingsCategory === "security" ? " active" : ""}`}
                onClick={() => setSettingsCategory("security")}
                type="button"
              >
                Security
              </button>
              {developerUnlocked && (
                <button
                  className={`settings-tab-btn${settingsCategory === "developer" ? " active" : ""}`}
                  onClick={() => setSettingsCategory("developer")}
                  type="button"
                >
                  Developer
                </button>
              )}
            </div>

            <div className="settings-section">
            {settingsCategory === "general" && (
            <>
            {/* Startup on Windows */}
            {isWails && (
              <div className="settings-row">
                <span>🖥️ Launch at startup</span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={startupEnabled} onChange={toggleStartup} />
                  <span className="toggle-slider" />
                </label>
              </div>
            )}

            {/* Close to tray / Pin to taskbar */}
            {isWails && (
              <div className="settings-row">
                <span>📌 Close to tray</span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={closeToTray} onChange={async () => {
                    const next = !closeToTray;
                    setCloseToTray(next);
                    localStorage.setItem("close_to_tray", String(next));
                    await SetCloseToTray(next);
                    toast.success(next ? "Close to tray enabled" : "App will fully close");
                  }} />
                  <span className="toggle-slider" />
                </label>
              </div>
            )}

            {isWails && (
              <div className="settings-row">
                <span>🔔 Notification corner</span>
                <select
                  value={toastPosition}
                  onChange={async (e) => {
                    const next = e.target.value as "bottom-left" | "bottom-right";
                    setToastPositionState(next);
                    const ok = await SetToastPosition(next);
                    if (ok) {
                      toast.success("Notification corner saved");
                    } else {
                      toast.error("Could not save corner");
                    }
                  }}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-hover)", color: "var(--text)", fontSize: 13 }}
                >
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </div>
            )}

            {/* Smooth Caret Animation */}
            <div className="settings-row">
              <span>✨ Smooth caret animation</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={smoothCaret} onChange={() => {
                  const next = !smoothCaret;
                  setSmoothCaret(next);
                  localStorage.setItem("smooth_caret", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>

            {/* Cursor Blinking */}
            <div className="settings-row">
              <span>💫 Cursor blinking (phase)</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={cursorBlink} onChange={() => {
                  const next = !cursorBlink;
                  setCursorBlink(next);
                  localStorage.setItem("cursor_blink", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>

            {/* Send Sound */}
            <div className="settings-row">
              <span>🔊 Message send sound</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={sendSound} onChange={() => {
                  const next = !sendSound;
                  setSendSound(next);
                  localStorage.setItem("send_sound", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>

            </>
            )}

            {settingsCategory === "call" && (
            <>
            <div className="settings-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 10 }}>
              <span>🎵 Incoming call ringtone</span>
              <small style={{ color: "var(--text)", opacity: 0.72, lineHeight: 1.5 }}>
                Server ringtone: {ringtoneLabel || "Server ringtone"}
              </small>
              <small style={{ color: "var(--text)", opacity: 0.72, lineHeight: 1.5 }}>
                Active source: {ringtoneUrl === DEFAULT_RINGTONE_URL ? "server default" : ringtoneUrl}
              </small>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="settings-btn primary" type="button" onClick={() => { void useServerRingtone(); }} disabled={ringtoneUploading}>
                  ⬇️ Download server ringtone
                </button>
                <button className="settings-btn" type="button" onClick={() => ringtoneFileInputRef.current?.click()} disabled={ringtoneUploading}>
                  {ringtoneUploading ? "⏳ Uploading..." : "⬆️ Upload own ringtone"}
                </button>
                <button className="settings-btn" type="button" onClick={previewRingtone}>
                  ▶️ Preview
                </button>
                <button className="settings-btn danger" type="button" onClick={resetCustomRingtone}>
                  ♻️ Reset
                </button>
              </div>
              <input
                ref={ringtoneFileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  await handleRingtoneUpload(file);
                }}
              />
            </div>
            </>
            )}

            {settingsCategory === "design" && (
            <>
            <div className="settings-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 12 }}>
              <span>🎨 Theme designer (real-time)</span>

              <div className="settings-color-group">
                <span className="settings-color-label">Accent / Circle colors</span>
                <div className="settings-color-swatches">
                  {ACCENT_COLOR_PRESETS.map((color) => (
                    <button
                      key={`accent-${color}`}
                      type="button"
                      className={`settings-color-swatch${themeAccentColor === color ? " active" : ""}`}
                      style={{ background: color }}
                      onClick={() => setThemeAccentColor(color)}
                      aria-label={`Accent ${color}`}
                    />
                  ))}
                </div>
                <label className="settings-color-picker-wrap">
                  <span>Custom accent</span>
                  <input
                    type="color"
                    value={themeAccentColor}
                    onChange={(e) => setThemeAccentColor(normalizeHexColor(e.target.value, "#0e7c66"))}
                  />
                </label>
              </div>

              <div className="settings-color-group">
                <span className="settings-color-label">Layout color (panels)</span>
                <div className="settings-color-swatches">
                  {LAYOUT_COLOR_PRESETS.map((color) => (
                    <button
                      key={`layout-${color}`}
                      type="button"
                      className={`settings-color-swatch${themeLayoutColor === color ? " active" : ""}`}
                      style={{ background: color }}
                      onClick={() => setThemeLayoutColor(color)}
                      aria-label={`Layout ${color}`}
                    />
                  ))}
                </div>
                <label className="settings-color-picker-wrap">
                  <span>Custom layout</span>
                  <input
                    type="color"
                    value={themeLayoutColor}
                    onChange={(e) => setThemeLayoutColor(normalizeHexColor(e.target.value, "#1e2c3a"))}
                  />
                </label>
              </div>

              <div className="settings-color-inline-pickers">
                <label className="settings-color-picker-wrap">
                  <span>Text color</span>
                  <div className="settings-color-swatches compact">
                    {TEXT_COLOR_PRESETS.map((color) => (
                      <button
                        key={`text-${color}`}
                        type="button"
                        className={`settings-color-swatch${themeTextColor === color ? " active" : ""}`}
                        style={{ background: color }}
                        onClick={() => setThemeTextColor(color)}
                        aria-label={`Text ${color}`}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={themeTextColor}
                    onChange={(e) => setThemeTextColor(normalizeHexColor(e.target.value, "#e1e8ef"))}
                  />
                </label>

                <label className="settings-color-picker-wrap">
                  <span>Main background</span>
                  <input
                    type="color"
                    value={themeBackgroundColor}
                    onChange={(e) => setThemeBackgroundColor(normalizeHexColor(e.target.value, "#17212b"))}
                  />
                </label>

                <label className="settings-color-picker-wrap">
                  <span>Search/message input</span>
                  <input
                    type="color"
                    value={themeInputColor}
                    onChange={(e) => setThemeInputColor(normalizeHexColor(e.target.value, "#17212b"))}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="settings-btn"
                  type="button"
                  onClick={() => {
                    setThemeAccentColor("#0e7c66");
                    setThemeLayoutColor("#1e2c3a");
                    setThemeTextColor("#e1e8ef");
                    setThemeBackgroundColor("#17212b");
                    setThemeInputColor("#17212b");
                    toast.success("Theme ranglari default holatga qaytdi");
                  }}
                >
                  Reset theme colors
                </button>
                <input
                  type="text"
                  className="theme-profile-name-input"
                  placeholder="Profile name (masalan: Night Ocean)"
                  value={themeProfileName}
                  onChange={(e) => setThemeProfileName(e.target.value.slice(0, 60))}
                />
                <button className="settings-btn primary" type="button" onClick={saveCurrentThemeProfileLocally}>
                  Save local
                </button>
                <button className="settings-btn" type="button" onClick={exportThemeProfilesToFile}>
                  Export JSON
                </button>
                <button
                  className="settings-btn"
                  type="button"
                  onClick={() => themeProfileImportInputRef.current?.click()}
                >
                  Import JSON
                </button>
                <button
                  className="settings-btn primary"
                  type="button"
                  onClick={shareCurrentThemeProfile}
                  disabled={themeProfilesSharing}
                >
                  {themeProfilesSharing ? "Sharing..." : "Share community"}
                </button>
              </div>

              <input
                ref={themeProfileImportInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await importThemeProfilesFromFile(file);
                  e.currentTarget.value = "";
                }}
              />

              {localThemeProfiles.length > 0 && (
                <div className="theme-profile-list-wrap">
                  <span className="settings-color-label">Saved local profiles ({localThemeProfiles.length})</span>
                  <div className="theme-profile-list">
                    {localThemeProfiles.slice(0, 20).map((profile) => (
                      <div className="theme-profile-card" key={profile.id}>
                        <div className="theme-profile-main">
                          <strong>{profile.name}</strong>
                          <small>{new Date(profile.createdAt).toLocaleString()}</small>
                          <div className="theme-profile-swatches">
                            {Object.values(profile.palette).map((color, idx) => (
                              <span key={`${profile.id}-${idx}`} style={{ background: color }} />
                            ))}
                          </div>
                        </div>
                        <div className="theme-profile-actions">
                          <button className="settings-btn" type="button" onClick={() => {
                            applyThemePalette(profile.palette);
                            toast.success(`Applied: ${profile.name}`);
                          }}>
                            Apply
                          </button>
                          <button className="settings-btn danger" type="button" onClick={() => {
                            setLocalThemeProfiles((prev) => prev.filter((p) => p.id !== profile.id));
                            toast.success("Profile o'chirildi");
                          }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="theme-profile-list-wrap">
                <span className="settings-color-label">Community profiles {themeProfilesLoading ? "(loading...)" : `(${communityThemeProfiles.length})`}</span>
                <div className="theme-profile-list">
                  {communityThemeProfiles.slice(0, 30).map((profile) => (
                    <div className="theme-profile-card" key={profile.id}>
                      <div className="theme-profile-main">
                        <strong>{profile.name}</strong>
                        <small>
                          by {profile.author.displayName}{profile.author.username ? ` (@${profile.author.username})` : ""}
                        </small>
                        <div className="theme-profile-swatches">
                          {[profile.accentColor, profile.layoutColor, profile.textColor, profile.backgroundColor, profile.inputColor].map((color, idx) => (
                            <span key={`${profile.id}-c-${idx}`} style={{ background: color }} />
                          ))}
                        </div>
                      </div>
                      <div className="theme-profile-actions">
                        <button className="settings-btn" type="button" onClick={() => {
                          applyThemePalette({
                            accentColor: profile.accentColor,
                            layoutColor: profile.layoutColor,
                            textColor: profile.textColor,
                            backgroundColor: profile.backgroundColor,
                            inputColor: profile.inputColor,
                          });
                          toast.success(`Applied community: ${profile.name}`);
                        }}>
                          Apply
                        </button>
                      </div>
                    </div>
                  ))}
                  {!themeProfilesLoading && communityThemeProfiles.length === 0 && (
                    <small style={{ color: "var(--muted)" }}>Hozircha community profile yo'q.</small>
                  )}
                </div>
              </div>

              <small style={{ color: "var(--muted)", fontSize: 12 }}>
                Ranglarni local saqlash, JSON import/export va community share/apply qilish mumkin.
              </small>
            </div>

            <div className="settings-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
              <span>🖼️ Chat background image</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label className="settings-btn primary" style={{ cursor: "pointer" }}>
                  Choose image
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const rawDataUrl = await readFileAsDataUrl(file);
                        const optimizedDataUrl = await compressImageDataUrl(rawDataUrl);
                        setChatBackgroundImage(optimizedDataUrl);
                        toast.success("Chat background updated");
                      } catch {
                        toast.error("Could not set background image");
                      } finally {
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </label>
                <button
                  className="settings-btn"
                  disabled={!chatBackgroundImage}
                  onClick={() => {
                    setChatBackgroundImage("");
                    toast.success("Chat background removed");
                  }}
                >
                  Remove image
                </button>
              </div>
              <small style={{ color: "var(--muted)", fontSize: 12 }}>
                Rasm tanlansa chat oynasi fonida ko'rinadi.
              </small>
            </div>
            </>
            )}
            </div>

            {/* App Lock */}
            {settingsCategory === "security" && (
            <div className="settings-section">
              <h4>🔒 App Passcode</h4>
              {appLockEnabled ? (
                <div className="settings-row">
                  <span>Passcode is set</span>
                  <button className="settings-btn danger" onClick={handleRemovePasscode}>Remove</button>
                </div>
              ) : (
                <>
                  {!showSetPasscode ? (
                    <button className="settings-btn primary" onClick={() => setShowSetPasscode(true)}>Set Passcode</button>
                  ) : (
                    <div className="settings-passcode-form">
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={PASSCODE_MAX_LENGTH}
                        placeholder="New passcode (min 4 digits)"
                        value={newPasscode}
                        onChange={(e) => setNewPasscode(sanitizePasscodeInput(e.target.value))}
                      />
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={PASSCODE_MAX_LENGTH}
                        placeholder="Confirm passcode"
                        value={confirmPasscode}
                        onChange={(e) => setConfirmPasscode(sanitizePasscodeInput(e.target.value))}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="settings-btn primary" onClick={handleSetPasscode}>Save</button>
                        <button className="settings-btn" onClick={() => { setShowSetPasscode(false); setNewPasscode(""); setConfirmPasscode(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Auto-lock */}
              {appLockEnabled && (
                <>
                  <div className="settings-row" style={{ marginTop: 12 }}>
                    <span>⏱️ Auto-lock when idle</span>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={autoLockEnabled} onChange={() => {
                        const next = !autoLockEnabled;
                        setAutoLockEnabled(next);
                        localStorage.setItem("auto_lock", String(next));
                      }} />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  {autoLockEnabled && (
                    <div className="settings-row">
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Lock after (minutes)</span>
                      <select
                        value={autoLockMinutes}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setAutoLockMinutes(val);
                          localStorage.setItem("auto_lock_minutes", String(val));
                        }}
                        style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-hover)", color: "var(--text)", fontSize: 13 }}
                      >
                        <option value={1}>1 min</option>
                        <option value={2}>2 min</option>
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
            )}

            {/* 2FA */}
            <div className="settings-section">
              {settingsCategory === "security" && (
              <>
              <h4>🔐 Two-Factor Authentication (2FA)</h4>
              <div className="settings-row">
                <span>Status</span>
                {currentUser.isTwoFAEnabled ? <span className="badge-on">Enabled</span> : <span className="badge-off">Disabled</span>}
              </div>
              {!currentUser.isTwoFAEnabled && (
                <>
                  <button className="settings-btn primary" onClick={startTwoFASetup}>Setup 2FA</button>
                  {twoFAQrDataUrl && <img src={twoFAQrDataUrl} alt="2FA QR" className="qr-image" />}
                  {twoFAQrDataUrl && (
                    <div className="settings-passcode-form">
                      <input type="text" placeholder="Authenticator code" value={twoFASetupCode} onChange={(e) => setTwoFASetupCode(e.target.value)} />
                      <button className="settings-btn primary" onClick={enableTwoFA}>Enable 2FA</button>
                    </div>
                  )}
                </>
              )}
              {currentUser.isTwoFAEnabled && (
                <div className="settings-passcode-form">
                  <input type="text" placeholder="Enter 2FA code" value={twoFADisableCode} onChange={(e) => setTwoFADisableCode(e.target.value)} />
                  <button className="settings-btn danger" onClick={disableTwoFA}>Disable 2FA</button>
                </div>
              )}
              </>
              )}

              {/* ── NETWORK INFO ── */}
              {settingsCategory === "general" && (
              <>
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14 }}>
                <h4>🌐 Network</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Public IP: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{publicIp || "—"}</strong></span>
                  <button
                    className="settings-btn primary"
                    onClick={fetchPublicIp}
                    disabled={ipLoading}
                    style={{ minWidth: 36, padding: "4px 10px" }}
                  >
                    {ipLoading ? "..." : "🔄"}
                  </button>
                </div>
              </div>

              {/* ── PROXY SETTINGS ── */}
              {isWails && (
                <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14 }}>
                  <h4>🔒 Proxy</h4>
                  <div className="settings-row">
                    <span>Enable Proxy</span>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={proxyEnabled} onChange={() => setProxyEnabled(!proxyEnabled)} />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  {proxyEnabled && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select
                          value={proxyType}
                          onChange={(e) => setProxyType(e.target.value)}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-hover)", color: "var(--text)", fontSize: 13, minWidth: 90 }}
                        >
                          <option value="socks5">SOCKS5</option>
                          <option value="http">HTTP</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Host (127.0.0.1)"
                          value={proxyHost}
                          onChange={(e) => setProxyHost(e.target.value)}
                          style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-hover)", color: "var(--text)", fontSize: 13, fontFamily: "monospace" }}
                        />
                        <input
                          type="text"
                          placeholder="Port"
                          value={proxyPort}
                          onChange={(e) => setProxyPort(e.target.value.replace(/[^0-9]/g, ''))}
                          style={{ width: 70, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-hover)", color: "var(--text)", fontSize: 13, fontFamily: "monospace" }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="settings-btn primary"
                          onClick={async () => {
                            const ok = await SaveProxyConfig({ enabled: proxyEnabled, type: proxyType, host: proxyHost, port: proxyPort });
                            if (ok) {
                              toast.success("Proxy saved. Restart app to apply.");
                            } else {
                              toast.error("Failed to save proxy.");
                            }
                          }}
                        >
                          💾 Save
                        </button>
                        <button
                          className="settings-btn"
                          onClick={async () => {
                            await SaveProxyConfig({ enabled: proxyEnabled, type: proxyType, host: proxyHost, port: proxyPort });
                            toast("Restarting app...");
                            setTimeout(() => RestartApp(), 500);
                          }}
                        >
                          🔄 Save & Restart
                        </button>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", opacity: 0.7 }}>Proxy applies after app restart</span>
                    </div>
                  )}
                  {!proxyEnabled && proxyHost && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="settings-btn"
                        onClick={async () => {
                          setProxyHost(""); setProxyPort("");
                          await SaveProxyConfig({ enabled: false, type: "socks5", host: "", port: "" });
                          toast.success("Proxy cleared. Restart app to apply.");
                        }}
                      >
                        Clear Proxy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── UPDATE SECTION ── */}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14 }}>
                <h4>🔄 Update</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Current version: <strong style={{ color: "var(--text)" }}>v{appVersion}</strong></span>
                  <button
                    className="settings-btn primary"
                    onClick={async () => {
                      try {
                        const result: any = await CheckForUpdate();
                        if (result.available) {
                          setUpdateAvailable({ newVersion: result.newVersion, notes: result.notes || "" });
                          setShowSettings(false);
                        } else {
                          toast.success("You are on the latest version!");
                        }
                      } catch {
                        toast.error("Could not check for updates");
                      }
                    }}
                  >
                    Check for updates
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <label style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={autoUpdateEnabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setAutoUpdateEnabled(val);
                        localStorage.setItem("auto_update", val ? "true" : "false");
                      }}
                    />
                    Auto-check for updates
                  </label>
                </div>
              </div>
              </>
              )}

              {/* ── DEBUG SECTION ── */}
              {settingsCategory === "developer" && developerUnlocked && (
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14 }}>
                <h4>🐞 Debug</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    className="settings-btn primary"
                    onClick={async () => {
                      try {
                        const ok = await OpenDevTools();
                        if (!ok) toast("DevTools faqat debug-build da mavjud (F12 / Ctrl+Shift+I).");
                      } catch {
                        toast.error("DevTools ochib bo'lmadi.");
                      }
                    }}
                  >
                    Open DevTools
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Yoki: F12 / Ctrl+Shift+I / o'ng-klik → Inspect</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    className="settings-btn"
                    onClick={async () => {
                      const ok = await runLoopbackCallTest();
                      if (ok) toast.success("Loopback test ishladi — siz o'z ovozingizni eshitishingiz kerak. Console'da [Loopback] log'larni tekshiring.");
                      else toast.error("Loopback test muvaffaqiyatsiz. Console'ni tekshiring.");
                    }}
                  >
                    🔁 Run Loopback Call Test (E2E)
                  </button>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                    Mic → RNNoise → RTCPeerConnection → audio element. 5 soniya o'zingizni eshitsangiz audio-pipeline OK.
                  </div>
                </div>

                {/* ── ICE PROBE ── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                  {/* P2P toggle */}
                  <div style={{ marginBottom: 10, padding: 10, background: "var(--surface-2)", borderRadius: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        defaultChecked={(() => {
                          try { return localStorage.getItem("webrtc_force_relay") !== "true"; }
                          catch { return true; }
                        })()}
                        onChange={(e) => {
                          const preferP2P = e.target.checked;
                          try {
                            localStorage.setItem("webrtc_force_relay", preferP2P ? "false" : "true");
                            toast.success(preferP2P
                              ? "P2P afzal: keyingi callda direct ulanish sinaladi (past ms)"
                              : "TURN-only: barcha calllar relay orqali (ishonchli, yuqori ms)");
                          } catch {}
                        }}
                      />
                      <span><strong>Prefer P2P (lower latency)</strong></span>
                    </label>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginLeft: 24 }}>
                      Yoqilgan: ICE avval direct (host/srflx) sinaydi → ishlasa 30-100ms, ishlamasa avtomatik TURN'ga o'tadi.<br/>
                      O'chirilgan: faqat TURN (relay) — ishonchli lekin 150-300ms.
                    </div>
                  </div>

                  <button
                    className="settings-btn"
                    disabled={iceProbing}
                    onClick={async () => {
                      setIceProbing(true);
                      try {
                        const res = await probeAllIceServers();
                        setIceProbeResults(res);
                        localStorage.setItem("ice_probe_at", String(Date.now()));
                        const okCount = res.filter((r) => r.ok).length;
                        if (okCount === 0) toast.error("Hech qaysi server ishlamadi!");
                        else toast.success(`${okCount}/${res.length} ICE server ishlaydi`);
                      } finally {
                        setIceProbing(false);
                      }
                    }}
                  >
                    {iceProbing ? "🔬 Probing..." : "🔬 Run ICE Probe (test STUN/TURN)"}
                  </button>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                    Har bir STUN/TURN serverni alohida sinaydi. Ishlaydiganlar call paytida birinchi ishlatiladi.
                  </div>
                  {iceProbeResults.length > 0 && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, fontFamily: "monospace", fontSize: 11 }}>
                      {iceProbeResults.map((r) => (
                        <div key={r.url} style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: r.ok ? "rgba(76,175,80,0.12)" : "rgba(244,67,54,0.12)",
                          color: r.ok ? "#4caf50" : "#f44336",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8
                        }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.ok ? "✅" : "❌"} {r.url}
                          </span>
                          <span style={{ flexShrink: 0 }}>
                            [{r.candidateTypes.join(",") || "none"}] {r.rttMs}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              )}

              <div className="settings-developer-unlock-row">
                <button className="settings-btn" type="button" onClick={handleDeveloperTap}>
                  {developerUnlocked ? "I am developer" : `I am developer (${developerTapCount}/3)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MY PROFILE MODAL ── */}
      {showMyProfile && currentUser && (
        <div className="lightbox-overlay" onClick={() => setShowMyProfile(false)}>
          <div className="my-profile-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>👤 My Profile</h3>
              <button className="settings-close" onClick={() => setShowMyProfile(false)}>✕</button>
            </div>

            <div className="my-profile-avatar-section">
              <div className="my-profile-avatar-wrapper">
                {hasUsableAvatar(currentUser.avatarUrl) && !brokenAvatarIds[currentUser.id] ? (
                  <img
                    src={`${API_URL}${currentUser.avatarUrl}`}
                    alt="Avatar"
                    className="my-profile-avatar-img clickable"
                    onClick={() => setLightboxUrl(`${API_URL}${currentUser.avatarUrl}`)}
                    onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [currentUser.id]: true }))}
                  />
                ) : (
                  <div className="my-profile-avatar-placeholder">
                    {getInitialLetter(currentUser.displayName)}
                  </div>
                )}
                <label className="my-profile-avatar-edit" title="Change photo">
                  📷
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append("file", file);
                    try {
                      const uploadRes = await api.post<{ url: string }>("/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
                      const avatarUrl = uploadRes.data.url;
                      const profileRes = await api.put<{ user: PublicUser }>("/auth/profile", { avatarUrl });
                      setCurrentUser(profileRes.data.user);
                      toast.success("Profile photo updated!");
                    } catch {
                      toast.error("Failed to upload photo");
                    }
                  }} />
                </label>
              </div>
            </div>

            <div className="my-profile-form">
              <div className="my-profile-field">
                <label>Name</label>
                <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="Display name" maxLength={40} />
              </div>
              <div className="my-profile-field">
                <label>Status</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={editStatusEmoji}
                    onChange={(e) => setEditStatusEmoji(e.target.value)}
                    placeholder="😊"
                    maxLength={4}
                    style={{ width: 50, textAlign: "center", fontSize: 20 }}
                  />
                  <input
                    type="text"
                    value={editStatusText}
                    onChange={(e) => setEditStatusText(e.target.value)}
                    placeholder="What are you up to?"
                    maxLength={100}
                    style={{ flex: 1 }}
                  />
                </div>
                {(currentUser.statusEmoji || currentUser.statusText) && (
                  <small style={{ color: "var(--text-muted)", marginTop: 4 }}>
                    Current: {currentUser.statusEmoji} {currentUser.statusText}
                  </small>
                )}
              </div>
              <div className="my-profile-field">
                <label>Username</label>
                <div className="username-input-wrapper">
                  <span className="username-at">@</span>
                  <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="username" maxLength={30} />
                </div>
                {currentUser.username && <small className="username-preview">@{currentUser.username}</small>}
              </div>
              <div className="my-profile-field">
                <label>Email</label>
                <input type="text" value={currentUser.email} disabled className="profile-disabled-input" />
              </div>
              <button className="settings-btn primary" disabled={profileSaving} onClick={async () => {
                setProfileSaving(true);
                try {
                  const data: Record<string, string | null> = {};
                  if (editDisplayName.trim() && editDisplayName !== currentUser.displayName) data.displayName = editDisplayName.trim();
                  if (editUsername !== (currentUser.username ?? "")) data.username = editUsername || null;

                  // Update status via socket (real-time broadcast)
                  const newStatusText = editStatusText.trim() || null;
                  const newStatusEmoji = editStatusEmoji.trim() || null;
                  const statusChanged = newStatusText !== (currentUser.statusText ?? null) || newStatusEmoji !== (currentUser.statusEmoji ?? null);
                  if (statusChanged && socketRef.current) {
                    socketRef.current.emit("status:update", { statusText: newStatusText, statusEmoji: newStatusEmoji });
                  }

                  if (Object.keys(data).length === 0 && !statusChanged) { toast("No changes"); setProfileSaving(false); return; }
                  if (Object.keys(data).length > 0) {
                    const res = await api.put<{ user: PublicUser }>("/auth/profile", data);
                    setCurrentUser(res.data.user);
                  }
                  toast.success("Profile updated!");
                  setShowMyProfile(false);
                } catch (err: any) {
                  toast.error(err?.response?.data?.message ?? "An error occurred");
                } finally {
                  setProfileSaving(false);
                }
              }}>
                {profileSaving ? "Saving..." : "💾 Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── USER PROFILE VIEW POPUP ── */}
      {profileViewUser && (
        <div className="lightbox-overlay" onClick={() => setProfileViewUser(null)}>
          <div className="user-profile-popup" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>👤 Profile</h3>
              <button className="settings-close" onClick={() => setProfileViewUser(null)}>✕</button>
            </div>
            <div className="user-profile-popup-body">
              {hasUsableAvatar(profileViewUser.avatarUrl) && !brokenAvatarIds[profileViewUser.id] ? (
                <img
                  src={`${API_URL}${profileViewUser.avatarUrl}`}
                  alt="Avatar"
                  className="user-profile-popup-avatar-img clickable"
                  onClick={() => setLightboxUrl(`${API_URL}${profileViewUser.avatarUrl}`)}
                  onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [profileViewUser.id]: true }))}
                />
              ) : (
                <div className="user-profile-popup-avatar">
                  {getInitialLetter(profileViewUser.displayName)}
                </div>
              )}
              <h3 className="user-profile-popup-name">{profileViewUser.displayName}</h3>
              {profileViewUser.username && <span className="user-profile-popup-username">@{profileViewUser.username}</span>}
              <small className="user-profile-popup-status">
                {profileViewUser.isOnline ? "🟢 Online" : formatLastSeen(profileViewUser.lastSeenAt)}
              </small>
              <div className="user-profile-popup-actions">
                <button className="action-btn" onClick={() => {
                  // Switch to direct chat with this user
                  setChatMode("user");
                  setSelectedUserId(profileViewUser.id);
                  setSelectedGroupId("");
                  if (isMobileViewport) setIsMobileChatOpen(true);
                  setSidebarTab("contacts");
                  setProfileViewUser(null);
                }}>💬 Send message</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LEFT CHAT LIST (always visible like Telegram) ── */}
      <aside className="chat-list-panel">
        <div className="chat-list-header">
          <button className="burger-btn" onClick={() => setLeftOpen(!leftOpen)}>☰</button>
          <div className="chat-search-wrapper">
            <input
              type="text"
              className="chat-search-input"
              placeholder="Search..."
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
            />
            {chatSearch && (
              <button className="chat-search-clear" onClick={() => setChatSearch("")}>✕</button>
            )}
          </div>
        </div>

        <div className="sidebar-tabs">
          <button className={`sidebar-tab${sidebarTab === "contacts" ? " active" : ""}`} onClick={() => setSidebarTab("contacts")}>
            Contacts ({users.length})
          </button>
          <button className={`sidebar-tab${sidebarTab === "groups" ? " active" : ""}`} onClick={() => setSidebarTab("groups")}>
            Groups ({groups.length})
          </button>
        </div>

        {/* Archive toggle */}
        {archivedChats.size > 0 && (
          <button className="archived-toggle" onClick={() => setShowArchived(!showArchived)}>
            📦 {showArchived ? "Hide archive" : `Archived (${archivedChats.size})`}
          </button>
        )}

        {sidebarTab === "contacts" && (
          <div className="user-list">
            {/* ── Saved Messages (self-chat) ── */}
            <button
              className={`user-item saved-messages-entry${chatMode === "user" && currentUser.id === selectedUserId ? " active" : ""}`}
              onClick={() => { setChatMode("user"); setSelectedUserId(currentUser.id); setSelectedGroupId(""); setIsSelectionMode(false); setSelectedMessageIds(new Set()); if (isMobileViewport) setIsMobileChatOpen(true); }}
            >
              <div className="user-avatar saved-avatar">🔖</div>
              <div className="user-meta">
                <span>Saved Messages</span>
                <small>your cloud storage</small>
              </div>
            </button>
            {filteredUsers.map((user) => (
              <button
                key={user.id}
                className={`user-item${chatMode === "user" && user.id === selectedUserId ? " active" : ""}${pinnedChats.has(user.id) ? " pinned" : ""}${draggedChatId === user.id ? " dragging" : ""}${dragOverId === user.id ? " drag-over" : ""}`}
                onClick={() => { setChatMode("user"); setSelectedUserId(user.id); setSelectedGroupId(""); setIsSelectionMode(false); setSelectedMessageIds(new Set()); setUnreadCounts(prev => { const next = { ...prev }; delete next[user.id]; return next; }); setMentionCounts(prev => { const next = { ...prev }; delete next[user.id]; return next; }); if (isMobileViewport) setIsMobileChatOpen(true); }}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: user.id, type: "user" }); }}
                draggable
                onDragStart={() => handleDragStart(user.id)}
                onDragOver={(e) => handleDragOver(e, user.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(user.id, filteredUsers)}
                onDragEnd={handleDragEnd}
              >
                {pinnedChats.has(user.id) && <span className="pin-badge">📌</span>}
                {hasUsableAvatar(user.avatarUrl) && !brokenAvatarIds[user.id] ? (
                  <div className="user-avatar">
                    <img
                      src={`${API_URL}${user.avatarUrl}`}
                      alt=""
                      className="user-avatar-img"
                      onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [user.id]: true }))}
                    />
                    {user.isOnline && <span className="online-dot" />}
                  </div>
                ) : (
                  <div className="user-avatar">
                    {getInitialLetter(user.displayName)}
                    {user.isOnline && <span className="online-dot" />}
                  </div>
                )}
                <div className="user-meta">
                  <span>{user.displayName}</span>
                  <small>
                    {user.statusEmoji || user.statusText
                      ? `${user.statusEmoji ?? ""} ${user.statusText ?? ""}`.trim()
                      : user.isOnline ? "online" : formatLastSeen(user.lastSeenAt)}
                  </small>
                </div>
                {(unreadCounts[user.id] || 0) > 0 && <span className="unread-badge">{unreadCounts[user.id]}</span>}
                {(mentionCounts[user.id] || 0) > 0 && <span className="mention-notify-badge">@</span>}
              </button>
            ))}
            {filteredUsers.length === 0 && chatSearch && <p style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}>No results found</p>}
          </div>
        )}

        {sidebarTab === "groups" && (
          <div className="user-list">
            {filteredGroups.map((group) => (
              <button
                key={group.id}
                className={`user-item${chatMode === "group" && group.id === selectedGroupId ? " active" : ""}${pinnedChats.has(group.id) ? " pinned" : ""}${draggedChatId === group.id ? " dragging" : ""}${dragOverId === group.id ? " drag-over" : ""}`}
                onClick={() => { setChatMode("group"); setSelectedGroupId(group.id); setSelectedUserId(""); setIsSelectionMode(false); setSelectedMessageIds(new Set()); setUnreadCounts(prev => { const next = { ...prev }; delete next[group.id]; return next; }); setMentionCounts(prev => { const next = { ...prev }; delete next[group.id]; return next; }); if (isMobileViewport) setIsMobileChatOpen(true); }}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: group.id, type: "group" }); }}
                draggable
                onDragStart={() => handleDragStart(group.id)}
                onDragOver={(e) => handleDragOver(e, group.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(group.id, filteredGroups)}
                onDragEnd={handleDragEnd}
              >
                {pinnedChats.has(group.id) && <span className="pin-badge">📌</span>}
                {group.avatarUrl ? (
                  <div className="user-avatar group-avatar">
                    <img src={normalizeFileUrl(group.avatarUrl) ?? ""} alt="" className="user-avatar-img" />
                  </div>
                ) : (
                  <div className="user-avatar group-avatar">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="user-meta">
                  <span>{group.name}</span>
                  <small>{group._count?.members ?? group.members?.length ?? 0} members</small>
                </div>
                {(unreadCounts[group.id] || 0) > 0 && <span className="unread-badge">{unreadCounts[group.id]}</span>}
                {(mentionCounts[group.id] || 0) > 0 && <span className="mention-notify-badge">@</span>}
              </button>
            ))}
            {filteredGroups.length === 0 && !chatSearch && <p style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}>No groups yet</p>}
            {filteredGroups.length === 0 && chatSearch && <p style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}>No results found</p>}
          </div>
        )}
      </aside>

      {/* ── SIDEBAR RESIZE HANDLE ── */}
      <div className="sidebar-resize-handle" onMouseDown={handleSidebarMouseDown} />

      <main className="chat-panel">
        <header className="chat-header">
          {isMobileViewport && isMobileChatOpen && (
            <button
              className="mobile-chat-back-btn"
              onClick={() => setIsMobileChatOpen(false)}
              aria-label="Back to chats"
            >
              ←
            </button>
          )}
          {/* User/Group avatar in header */}
          {chatMode === "user" && selectedUserId === currentUser.id ? (
            <div className="chat-header-avatar saved-avatar" style={{ fontSize: 22 }}>🔖</div>
          ) : chatMode === "user" && activeUser && (
            hasUsableAvatar(activeUser.avatarUrl) && !brokenAvatarIds[activeUser.id] ? (
              <div className="chat-header-avatar" onClick={() => setRightOpen(!rightOpen)} title="View profile">
                <img
                  src={`${API_URL}${activeUser.avatarUrl}`}
                  alt=""
                  className="chat-header-avatar-img"
                  onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [activeUser.id]: true }))}
                />
                {activeUser.isOnline && <span className="online-dot" />}
              </div>
            ) : (
              <div className="chat-header-avatar" onClick={() => setRightOpen(!rightOpen)} title="View profile">
                {getInitialLetter(activeUser.displayName)}
                {activeUser.isOnline && <span className="online-dot" />}
              </div>
            )
          )}
          {chatMode === "group" && activeGroup && (
            activeGroup.avatarUrl ? (
              <div className="chat-header-avatar group-avatar" onClick={() => setRightOpen(!rightOpen)} title="View profile">
                <img src={normalizeFileUrl(activeGroup.avatarUrl) ?? ""} alt="" className="chat-header-avatar-img" />
              </div>
            ) : (
              <div className="chat-header-avatar group-avatar" onClick={() => setRightOpen(!rightOpen)} title="View profile">
                {activeGroup.name.charAt(0).toUpperCase()}
              </div>
            )
          )}
          <div className="chat-header-info" onClick={() => selectedUserId !== currentUser.id && setRightOpen(!rightOpen)} style={{ cursor: "pointer" }}>
            {chatMode === "user" ? (
              selectedUserId === currentUser.id ? (
                <>
                  <strong>Saved Messages</strong>
                  <p>your notes &amp; saved content</p>
                </>
              ) : (
                <>
                  <strong>{activeUser?.displayName ?? "Select a contact"}</strong>
                  <p>{activeUser?.isOnline ? "🟢 online" : activeUser ? formatLastSeen(activeUser.lastSeenAt) : ""}</p>
                  {(activeUser?.statusEmoji || activeUser?.statusText) && (
                    <small>{`${activeUser.statusEmoji ?? ""} ${activeUser.statusText ?? ""}`.trim()}</small>
                  )}
                </>
              )
            ) : (
              <>
                <strong>{activeGroup?.name ?? "Select a group"}</strong>
                <p>{activeGroup ? `${activeGroup._count?.members ?? activeGroup.members?.length ?? 0} a'zo` : ""}</p>
              </>
            )}
          </div>

          <div className="call-actions">
            {activeUser && activeUser.clientType && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4, opacity: 0.6 }}>
                {activeUser.clientType === "web" ? "web" : `v${activeUser.clientVersion || "?"}`}
              </span>
            )}
            {callStatus === "idle" && chatMode === "user" && selectedUserId !== currentUser.id && (
              <button disabled={!activeUser} onClick={() => startCall()}>
                📞 Call
              </button>
            )}
            {callStatus === "idle" && chatMode === "group" && activeGroup && (
              <button onClick={async () => {
                if (!socketRef.current || !selectedGroupId) return;
                try {
                  callGroupIdRef.current = selectedGroupId;
                  setCallMicMuted(false);
                  const audioConstraints: any = {
                    noiseSuppression: noiseReduction,
                    echoCancellation: noiseReduction,
                    autoGainControl: noiseReduction,
                    googEchoCancellation: noiseReduction,
                    googAutoGainControl: noiseReduction,
                    googNoiseSuppression: noiseReduction,
                    googHighpassFilter: noiseReduction,
                    googTypingNoiseDetection: noiseReduction,
                    ...(selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : {})
                  };
                  let rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                  rawStream = await applyRNNoiseFilter(rawStream);
                  localCallStreamRef.current = rawStream;

                  socketRef.current.emit("group:call:join", { groupId: selectedGroupId });
                  setGroupCallParticipants([{ userId: currentUser.id, speaking: false }]);
                  setGroupActiveCallUsers((prev) => {
                    const existing = new Set(prev[selectedGroupId] ?? []);
                    existing.add(currentUser.id);
                    return { ...prev, [selectedGroupId]: [...existing] };
                  });
                  startVAD(rawStream, selectedGroupId);
                  setCallPeerId(selectedGroupId);
                  setCallStatus("in-call");
                  setCallMinimized(true);

                  const activeTargetIds = joinableActiveGroupUserIds;
                  const fallbackMemberIds = (activeGroup.members ?? [])
                    .map((member) => member.userId)
                    .filter((memberId) => memberId !== currentUser.id);
                  const memberIds = activeTargetIds.length > 0 ? activeTargetIds : fallbackMemberIds;

                  for (const memberId of memberIds) {
                    const peer = setupGroupPeerConnection(memberId);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    socketRef.current.emit("group:call:offer", {
                      groupId: selectedGroupId,
                      toUserId: memberId,
                      sdp: offer
                    });
                  }
                } catch (err) {
                  console.error("Group call start error:", err);
                  toast.error("Group callni boshlab bo'lmadi.");
                  stopCall(true);
                }
              }}>📞 {joinableActiveGroupUserIds.length > 0 ? "Join" : "Group Call"}</button>
            )}
            {callStatus !== "idle" && (
              <button className="end-call-btn" onClick={() => {
                stopCall(false);
              }}>
                End call ({callStatus})
              </button>
            )}
            <button className="device-settings-btn" onClick={() => { enumerateAudioDevices(); setShowDeviceSettings(!showDeviceSettings); }} title="Audio device settings">
              🎧
            </button>

          </div>
          {showDeviceSettings && (
            <div className="device-settings-dropdown">
              <div className="device-settings-header">
                <strong>🎙️ Audio Settings</strong>
                <button className="device-settings-close" onClick={() => setShowDeviceSettings(false)}>✕</button>
              </div>
              <div className="device-select-group">
                <label>Microphone (input):</label>
                <select
                  value={selectedAudioInput}
                  onChange={(e) => { setSelectedAudioInput(e.target.value); localStorage.setItem("audio_input", e.target.value); }}
                >
                  {audioInputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="device-select-group">
                <label>Speaker (output):</label>
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => { setSelectedAudioOutput(e.target.value); localStorage.setItem("audio_output", e.target.value); }}
                >
                  {audioOutputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="device-select-group">
                <label>🎤 Mikrofon balandligi: {Math.round(micVolume * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={micVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setMicVolume(v);
                    if (micGainNodeRef.current) micGainNodeRef.current.gain.value = v;
                    localStorage.setItem("mic_volume", String(v));
                  }}
                  className="volume-slider"
                />
              </div>
              <div className="device-select-group">
                <label>🔊 Speaker volume: {Math.round(speakerVolume * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={speakerVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setSpeakerVolume(v);
                    if (remoteAudioRef.current) remoteAudioRef.current.volume = toMediaElementVolume(v);
                    localStorage.setItem("speaker_volume", String(v));
                  }}
                  className="volume-slider"
                />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "1rem", cursor: "pointer", fontSize: "14px", color: "var(--text)" }}>
                <input 
                  type="checkbox" 
                  checked={noiseReduction}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setNoiseReduction(checked);
                    localStorage.setItem("noise_reduction", checked.toString());
                  }}
                />
                Noise reduction (Shovqin filtri)
              </label>

              <button className={`btn-test-audio${isMicTesting ? " active" : ""}`} style={{ marginTop: "1rem" }} onClick={async () => {
                if (isMicTesting) {
                  // Stop test
                  micTestStreamRef.current?.getTracks().forEach(t => t.stop());
                  micTestStreamRef.current = null;
                  micTestAudioCtxRef.current?.close().catch(() => {});
                  micTestAudioCtxRef.current = null;
                  setIsMicTesting(false);
                  return;
                }
                try {
                  const audioConstraints: any = {
                    noiseSuppression: noiseReduction,
                    echoCancellation: noiseReduction,
                    autoGainControl: noiseReduction,
                    googEchoCancellation: noiseReduction,
                    googAutoGainControl: noiseReduction,
                    googNoiseSuppression: noiseReduction,
                    googHighpassFilter: noiseReduction,
                    googTypingNoiseDetection: noiseReduction,
                    ...(selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : {})
                  };
                  let stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                  stream = await applyRNNoiseFilter(stream);
                  micTestStreamRef.current = stream;
                  const ctx = new AudioContext();
                  const src = ctx.createMediaStreamSource(stream);
                  const gain = ctx.createGain();
                  gain.gain.value = micVolume;
                  src.connect(gain).connect(ctx.destination);
                  micTestAudioCtxRef.current = ctx;
                  setIsMicTesting(true);
                  toast.success("🎤 Mikrofon test \u2014 gapiring!");
                } catch {
                  toast.error("Mikrofon ruxsati yo'q!");
                }
              }}>
                {isMicTesting ? "🛑 Testni to'xtatish" : "🎤 Test microphone"}
              </button>
            </div>
          )}
        </header>

        <section className={`messages${isSelectionMode ? " selection-active" : ""}`}>
          {chatMode === "user" && (
            <>
              {isLoadingMessages && <p style={{ color: "var(--muted)", textAlign: "center" }}>Loading...</p>}
              {!isLoadingMessages && (() => {
                const userVoiceQueue = messages
                  .filter((m) => m.type === "VOICE" && !!normalizeFileUrl(m.fileUrl))
                  .map((m) => ({ id: m.id, src: normalizeFileUrl(m.fileUrl) ?? "", durationSec: m.durationSec }));
                return messages.map((message, idx) => {
                  const isMine = message.senderId === currentUser.id;
                  return (
                    <div key={message.id} className={`message-row${isSelectionMode ? " selectable" : ""}${selectedMessageIds.has(message.id) ? " selected" : ""}`}
                      onClick={(e) => {
                        if (isSelectionMode) {
                          if (e.shiftKey && lastSelectedIndexRef.current !== null) {
                            // Shift+Click: select range
                            const start = Math.min(lastSelectedIndexRef.current, idx);
                            const end = Math.max(lastSelectedIndexRef.current, idx);
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              for (let i = start; i <= end; i++) {
                                next.add(messages[i].id);
                              }
                              return next;
                            });
                          } else {
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            });
                            lastSelectedIndexRef.current = idx;
                          }
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!isSelectionMode) {
                          setIsSelectionMode(true);
                          setSelectedMessageIds(new Set([message.id]));
                          lastSelectedIndexRef.current = idx;
                        }
                      }}
                    >
                      {isSelectionMode && (
                        <label className="msg-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedMessageIds.has(message.id)} onChange={(e) => {
                            if (e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey && lastSelectedIndexRef.current !== null) {
                              const start = Math.min(lastSelectedIndexRef.current, idx);
                              const end = Math.max(lastSelectedIndexRef.current, idx);
                              setSelectedMessageIds(prev => {
                                const next = new Set(prev);
                                for (let i = start; i <= end; i++) {
                                  next.add(messages[i].id);
                                }
                                return next;
                              });
                            } else {
                              setSelectedMessageIds(prev => {
                                const next = new Set(prev);
                                if (next.has(message.id)) next.delete(message.id);
                                else next.add(message.id);
                                return next;
                              });
                              lastSelectedIndexRef.current = idx;
                            }
                          }} />
                        </label>
                      )}
                      <article className={isMine ? "message mine" : "message"}>
                        <div className="bubble">{renderMessage(message, setLightboxUrl, isMine, handleMentionClick, userVoiceQueue)}</div>
                        <time>
                          {new Date(message.createdAt).toLocaleTimeString()}
                          <span className={`msg-check${message.readAt ? " read" : ""}${!isMine && message.seenAt ? " seen" : ""}`}>
                            {isMine
                              ? (message.readAt ? "✓✓" : "✓")
                              : (message.seenAt ? "👁✓" : message.readAt ? "✓✓" : "✓")}
                          </span>
                        </time>
                      </article>
                    </div>
                  );
                });
              })()}
              {typingFromUserId === selectedUserId && <p className="typing">typing...</p>}
            </>
          )}

          {chatMode === "group" && (
            <>
              {isLoadingGroupMessages && <p style={{ color: "var(--muted)", textAlign: "center" }}>Loading...</p>}
              {!isLoadingGroupMessages && (() => {
                const groupVoiceQueue = groupMessages
                  .filter((m) => m.type === "VOICE" && !!normalizeFileUrl(m.fileUrl))
                  .map((m) => ({ id: m.id, src: normalizeFileUrl(m.fileUrl) ?? "", durationSec: m.durationSec }));
                return groupMessages.map((message, idx) => {
                  const isMine = message.senderId === currentUser.id;
                  return (
                    <div key={message.id} className={`message-row${isSelectionMode ? " selectable" : ""}${selectedMessageIds.has(message.id) ? " selected" : ""}`}
                      onClick={(e) => {
                        if (isSelectionMode) {
                          if (e.shiftKey && lastSelectedIndexRef.current !== null) {
                            const start = Math.min(lastSelectedIndexRef.current, idx);
                            const end = Math.max(lastSelectedIndexRef.current, idx);
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              for (let i = start; i <= end; i++) {
                                next.add(groupMessages[i].id);
                              }
                              return next;
                            });
                          } else {
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            });
                            lastSelectedIndexRef.current = idx;
                          }
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!isSelectionMode) {
                          setIsSelectionMode(true);
                          setSelectedMessageIds(new Set([message.id]));
                          lastSelectedIndexRef.current = idx;
                        }
                      }}
                    >
                      {isSelectionMode && (
                        <label className="msg-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedMessageIds.has(message.id)} onChange={(e) => {
                            if (e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey && lastSelectedIndexRef.current !== null) {
                              const start = Math.min(lastSelectedIndexRef.current, idx);
                              const end = Math.max(lastSelectedIndexRef.current, idx);
                              setSelectedMessageIds(prev => {
                                const next = new Set(prev);
                                for (let i = start; i <= end; i++) {
                                  next.add(groupMessages[i].id);
                                }
                                return next;
                              });
                            } else {
                              setSelectedMessageIds(prev => {
                                const next = new Set(prev);
                                if (next.has(message.id)) next.delete(message.id);
                                else next.add(message.id);
                                return next;
                              });
                              lastSelectedIndexRef.current = idx;
                            }
                          }} />
                        </label>
                      )}
                      <article
                        className={isMine ? "message mine" : "message"}
                        title={(() => {
                          if (!isMine) return undefined;
                          const seenNames = (message.seenBy ?? [])
                            .filter((seen) => seen.userId !== message.senderId)
                            .map((seen) => seen.user?.displayName || users.find((u) => u.id === seen.userId)?.displayName || "")
                            .filter((name): name is string => Boolean(name));
                          if (seenNames.length === 0) return undefined;
                          return `Seen by: ${Array.from(new Set(seenNames)).join(", ")}`;
                        })()}
                      >
                        {!isMine && <small className="group-sender">{message.sender?.displayName ?? "?"}</small>}
                        <div className="bubble">{renderMessage(message as unknown as Message, setLightboxUrl, isMine, handleMentionClick, groupVoiceQueue)}</div>
                        <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
                      </article>
                    </div>
                  );
                });
              })()}
              {groupTypingUserId && (
                <p className="typing">
                  {users.find((u) => u.id === groupTypingUserId)?.displayName ?? "Someone"} typing...
                </p>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </section>

        {/* ── Selection action bar ── */}
        {isSelectionMode && (
          <div className="selection-bar">
            <button className="sel-btn sel-forward" onClick={() => setShowForwardModal(true)}>
              ⤳ Forward ({selectedMessageIds.size})
            </button>
            <button className="sel-btn sel-save" onClick={async () => {
              try {
                await api.post("/messages/forward", {
                  messageIds: [...selectedMessageIds],
                  recipientId: currentUser.id
                });
                toast.success(`${selectedMessageIds.size} message(s) saved to Saved Messages`);
              } catch (err) {
                toast.error(readAxiosMessage(err, "Failed to save"));
              }
              setSelectedMessageIds(new Set());
              setIsSelectionMode(false);
            }}>
              🔖 Save ({selectedMessageIds.size})
            </button>
            {/* Show in Explorer — only when 1 file message selected and already downloaded */}
            {selectedMessageIds.size === 1 && (() => {
              const selMsg = messages.find(m => selectedMessageIds.has(m.id));
              return selMsg && selMsg.type === "FILE" && selMsg.fileUrl ? (
                <>
                  <button className="sel-btn sel-explorer" onClick={async () => {
                    try {
                      const rawUrl = selMsg.fileUrl ?? "";
                      const url = normalizeFileUrl(rawUrl) ?? rawUrl;
                      const savedPath = await SaveFileFromURL(url, selMsg.fileName ?? "file");
                      await ShowInExplorer(savedPath);
                    } catch (err) {
                      toast.error("Error opening file");
                    }
                  }}>
                    📂 Show in Explorer
                  </button>
                </>
              ) : null;
            })()}
            <button className="sel-btn sel-delete" onClick={async () => {
              if (selectedMessageIds.size === 0) return;
              try {
                await api.delete("/messages", { data: { messageIds: [...selectedMessageIds] } });
                setMessages(prev => prev.filter(m => !selectedMessageIds.has(m.id)));
                toast.success(`${selectedMessageIds.size} messages deleted`);
              } catch (err) {
                toast.error(readAxiosMessage(err, "Delete error"));
              }
              setSelectedMessageIds(new Set());
              setIsSelectionMode(false);
            }}>
              🗑 Delete ({selectedMessageIds.size})
            </button>
            <button className="sel-btn sel-cancel" onClick={() => {
              setIsSelectionMode(false);
              setSelectedMessageIds(new Set());
            }}>
              ✕ Cancel
            </button>
          </div>
        )}

        {/* ── Forward modal ── */}
        {showForwardModal && (
          <div className="forward-modal-overlay" onClick={() => setShowForwardModal(false)}>
            <div className="forward-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Forward to</h3>
              <div className="forward-user-list">
                {/* Saved Messages (self) */}
                <button className="forward-user-item" onClick={async () => {
                  try {
                    await api.post("/messages/forward", {
                      messageIds: [...selectedMessageIds],
                      recipientId: currentUser.id
                    });
                    toast.success(`${selectedMessageIds.size} message(s) saved`);
                  } catch (err) {
                    toast.error(readAxiosMessage(err, "Failed to save"));
                  }
                  setShowForwardModal(false);
                  setSelectedMessageIds(new Set());
                  setIsSelectionMode(false);
                }}>
                  <span className="forward-user-avatar saved-avatar" style={{ fontSize: 16 }}>🔖</span>
                  <span className="forward-user-name">Saved Messages</span>
                </button>
                {users.filter(u => u.id !== currentUser.id).map(u => (
                  <button key={u.id} className="forward-user-item" onClick={async () => {
                    try {
                      await api.post("/messages/forward", {
                        messageIds: [...selectedMessageIds],
                        recipientId: u.id
                      });
                      toast.success(`${selectedMessageIds.size} message(s) forwarded to ${u.displayName}`);
                    } catch (err) {
                      toast.error(readAxiosMessage(err, "Failed to forward"));
                    }
                    setShowForwardModal(false);
                    setSelectedMessageIds(new Set());
                    setIsSelectionMode(false);
                  }}>
                    <span className="forward-user-avatar">{u.displayName.charAt(0).toUpperCase()}</span>
                    <span className="forward-user-name">{u.displayName}</span>
                  </button>
                ))}
              </div>
              <button className="forward-close-btn" onClick={() => setShowForwardModal(false)}>Cancel</button>
            </div>
          </div>
        )}

        <section className="composer">
          {/* Attachment preview area */}
          {messageType === "FILE" && (
            <div className="composer-attach-area">
              {pendingAttachments.length > 0 ? (
                <div className="composer-attachment-list">
                  {pendingAttachments.map((item) => (
                    <div key={item.id} className="composer-attachment-item">
                      {item.previewUrl ? (
                        <button
                          className="composer-attachment-preview"
                          type="button"
                          onClick={() => setLightboxUrl(item.previewUrl)}
                          title="Preview"
                        >
                          <img src={item.previewUrl} alt={item.file.name} />
                        </button>
                      ) : (
                        <div className="composer-attachment-preview composer-attachment-file">📎</div>
                      )}
                      <button
                        className="composer-attachment-name"
                        type="button"
                        onClick={() => item.previewUrl && setLightboxUrl(item.previewUrl)}
                        title={item.file.name}
                      >
                        {item.file.name}
                      </button>
                      <button className="attach-cancel" onClick={() => removePendingAttachment(item.id)}>✕</button>
                    </div>
                  ))}
                </div>
              ) : selectedFile ? (
                <span>📎 {selectedFile.name}</span>
              ) : (
                <span>Fayl tanlang yoki Ctrl+V bilan rasm qo'ying</span>
              )}
              <button className="attach-cancel" onClick={() => { setMessageType("TEXT"); setSelectedFile(null); clearPendingAttachments(); }}>✕</button>
            </div>
          )}

          {messageType === "LOCATION" && (
            <div className="composer-attach-area">
              <span>📍 {locationLat && locationLng ? `Location: ${Number(locationLat).toFixed(5)}, ${Number(locationLng).toFixed(5)}` : "Detecting location..."}</span>
              <button className="attach-cancel" onClick={() => { setMessageType("TEXT"); setLocationLat(""); setLocationLng(""); setLocationAccuracy(null); }}>✕</button>
            </div>
          )}

          {messageType === "VOICE" && !isRecordingVoice && voiceBlob && (
            <div className="composer-attach-area">
              <span>🎤 Voice yozuv ({voiceDurationSec}s)</span>
              <button className="attach-cancel" onClick={() => { setMessageType("TEXT"); setVoiceBlob(null); setVoiceDurationSec(null); }}>✕</button>
            </div>
          )}

          {/* Voice recording overlay */}
          {isRecordingVoice && (
            <div className="composer-recording">
              <button className="voice-cancel" onClick={() => {
                cancelAnimationFrame(waveformAnimRef.current);
                analyserRef.current = null;
                setRecordingWaveform([]);
                mediaRecorderRef.current?.stop();
                mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
                mediaRecorderRef.current = null;
                mediaStreamRef.current = null;
                setIsRecordingVoice(false);
                setMessageType("TEXT");
                setVoiceBlob(null);
                setVoiceDurationSec(null);
              }}>✕</button>
              <div className="waveform-live">
                {recordingWaveform.map((v, i) => (
                  <div key={i} className="waveform-bar" style={{ height: `${Math.max(4, v * 28)}px` }} />
                ))}
              </div>
              <small className="rec-timer">{Math.round((Date.now() - recordStartedAtRef.current) / 1000)}s</small>
              <button className="voice-stop-btn" onClick={stopVoiceRecording}>⏹ Stop</button>
            </div>
          )}

          {/* Main input row */}
          <div
            className={`composer-row${composerDragActive ? " file-drag-active" : ""}`}
            onDragOver={handleComposerDragOver}
            onDragEnter={handleComposerDragOver}
            onDragLeave={() => setComposerDragActive(false)}
            onDrop={handleComposerDrop}
          >
            <div className="attach-wrapper">
              <button className="attach-btn" onClick={() => setShowAttachMenu(!showAttachMenu)}>📎</button>
              <input
                ref={composerFileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) {
                    queueComposerFiles(files);
                  }
                  event.currentTarget.value = "";
                }}
              />
              {showAttachMenu && (
                <>
                  <div className="attach-menu-backdrop" onClick={() => setShowAttachMenu(false)} />
                  <div className="attach-menu">
                    <button onClick={() => { composerFileInputRef.current?.click(); setShowAttachMenu(false); }}>📎 File</button>
                    <button onClick={() => { handleGetLocation(); setShowAttachMenu(false); }}>📍 Location</button>
                  </div>
                </>
              )}
            </div>

            <div className="textarea-mention-wrapper">
              {/* Mention dropdown */}
              {showMentionDropdown && mentionCandidates.length > 0 && (
                <div className="mention-dropdown">
                  {mentionCandidates.map((u, idx) => (
                    <div
                      key={u.id}
                      className={`mention-dropdown-item${idx === mentionSelectedIdx ? " selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                      onMouseEnter={() => setMentionSelectedIdx(idx)}
                    >
                      {u.avatarUrl ? (
                        <img src={`${API_URL}${u.avatarUrl}`} alt="" className="mention-dropdown-avatar-img" />
                      ) : (
                        <div className="mention-dropdown-avatar">{u.displayName.charAt(0).toUpperCase()}</div>
                      )}
                      <div className="mention-dropdown-info">
                        <span className="mention-dropdown-name">{u.displayName}</span>
                        {u.username && <small className="mention-dropdown-username">@{u.username}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                className={`${smoothCaret ? "smooth-caret" : ""}${cursorBlink ? " cursor-blink-phase" : " cursor-no-blink"}`}
                placeholder="Write a message..."
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                autoComplete="off"
                value={messageText}
                onChange={(event) => handleTextChange(event.target.value)}
                onKeyDown={(event) => {
                  if (showMentionDropdown && mentionCandidates.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionSelectedIdx(prev => (prev + 1) % mentionCandidates.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionSelectedIdx(prev => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                      return;
                    }
                    if (event.key === "Tab" || event.key === "Enter") {
                      event.preventDefault();
                      insertMention(mentionCandidates[mentionSelectedIdx]);
                      return;
                    }
                  }
                  if (event.key === "Escape" && showMentionDropdown) {
                    setShowMentionDropdown(false);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                onBlur={() => {
                  // Small delay so onMouseDown on dropdown fires first
                  setTimeout(() => setShowMentionDropdown(false), 150);
                }}
                onPaste={(event) => {
                  const items = event.clipboardData?.items;
                  if (!items) return;

                  const pastedImages: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    if (!items[i].type.startsWith("image/")) continue;
                    const blob = items[i].getAsFile();
                    if (!blob) continue;
                    const ext = items[i].type.split("/")[1] || "png";
                    pastedImages.push(new File([blob], `clipboard_${Date.now()}_${i}.${ext}`, { type: items[i].type }));
                  }

                  if (pastedImages.length > 0) {
                    event.preventDefault();
                    queueComposerFiles(pastedImages);
                  }
                }}
            />
              <span className="composer-char-counter" aria-hidden="true">{messageText.length}</span>
            </div>

            {messageText.trim() || messageType !== "TEXT" ? (
              <button className="send-btn-round" onClick={sendMessage} disabled={isSending || !networkOnline || !isSocketConnected}>
                {!networkOnline || !isSocketConnected
                  ? "!!!"
                  : isSending
                    ? (uploadProgress > 0 ? `${uploadProgress}%` : "⏳")
                    : "➤"}
              </button>
            ) : (
              <button className="mic-btn" onClick={startVoiceRecording}>
                🎤
              </button>
            )}
          </div>
          {token && (!networkOnline || !isSocketConnected) && (
            <div className="composer-connection-warning">
              {!networkOnline ? "!!! Internet yo'q. Xabar yuborilmaydi." : "⏳ Serverga qayta ulanmoqda..."}
            </div>
          )}
        </section>
      </main>
      <nav className={`mobile-bottom-nav${leftOpen ? " hidden" : ""}`} aria-label="Mobile Navigation">
        <button
          className={`mobile-bottom-nav-btn${mobileBottomTab === "chats" ? " active" : ""}`}
          onClick={() => setMobileBottomTab("chats")}
        >
          <span>Chats</span>
        </button>
        <button
          className={`mobile-bottom-nav-btn${mobileBottomTab === "groups" ? " active" : ""}`}
          onClick={() => setMobileBottomTab("groups")}
        >
          <span>Groups</span>
        </button>
        <button
          className={`mobile-bottom-nav-btn${mobileBottomTab === "settings" ? " active" : ""}`}
          onClick={() => {
            setMobileBottomTab("settings");
            setShowSettings(true);
          }}
        >
          <span>Settings</span>
        </button>
        <button
          className={`mobile-bottom-nav-btn${mobileBottomTab === "profile" ? " active" : ""}`}
          onClick={() => {
            setMobileBottomTab("profile");
            setShowMyProfile(true);
            setEditDisplayName(currentUser.displayName);
            setEditUsername(currentUser.username ?? "");
            setEditStatusText(currentUser.statusText ?? "");
            setEditStatusEmoji(currentUser.statusEmoji ?? "");
          }}
        >
          <span>Profile</span>
        </button>
      </nav>

      {/* ── CONTEXT MENU ── */}
      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => { togglePin(contextMenu.chatId); setContextMenu(null); }}>
              {pinnedChats.has(contextMenu.chatId) ? "📌 Unpin" : "📌 Pin"}
            </button>
            <button onClick={() => { toggleArchive(contextMenu.chatId); setContextMenu(null); }}>
              {archivedChats.has(contextMenu.chatId) ? "📦 Unarchive" : "📦 Archive"}
            </button>
            <button
              className="context-menu-danger"
              onClick={async () => {
                const menu = contextMenu;
                setContextMenu(null);
                if (!menu) return;
                if (menu.type === "group") {
                  await removeGroupChat(menu.chatId);
                  return;
                }
                removeChat(menu.chatId);
              }}
            >
              {contextMenu.type === "group" ? "🚪 Remove group" : "🗑️ Hide chat"}
            </button>
          </div>
        </>
      )}

      {/* ── RIGHT SIDEBAR OVERLAY ── */}
      {rightOpen && <div className="sidebar-overlay right" onClick={() => setRightOpen(false)} />}
      <aside className={`right-panel${rightOpen ? " open" : ""}`}>
        {chatMode === "user" && activeUser && (
          <div className="right-profile">
            {hasUsableAvatar(activeUser.avatarUrl) && !brokenAvatarIds[activeUser.id] ? (
              <img
                src={`${API_URL}${activeUser.avatarUrl}`}
                alt="Avatar"
                className="right-profile-avatar-img clickable"
                onClick={() => setLightboxUrl(`${API_URL}${activeUser.avatarUrl}`)}
                onError={() => setBrokenAvatarIds((prev) => ({ ...prev, [activeUser.id]: true }))}
              />
            ) : (
              <div className="right-profile-avatar">{getInitialLetter(activeUser.displayName)}</div>
            )}
            <h3>{activeUser.displayName}</h3>
            {activeUser.username && <span className="right-profile-username">@{activeUser.username}</span>}
            <small>{activeUser.isOnline ? "🟢 Online" : formatLastSeen(activeUser.lastSeenAt)}</small>
          </div>
        )}

        {chatMode === "group" && activeGroup && (
          <>
            <div className="right-profile">
              {activeGroup.avatarUrl ? (
                <img
                  src={normalizeFileUrl(activeGroup.avatarUrl) ?? ""}
                  alt="Group avatar"
                  className="right-profile-avatar-img clickable"
                  onClick={() => {
                    const imageUrl = normalizeFileUrl(activeGroup.avatarUrl);
                    if (imageUrl) setLightboxUrl(imageUrl);
                  }}
                />
              ) : (
                <div className="right-profile-avatar group-avatar">{activeGroup.name.charAt(0).toUpperCase()}</div>
              )}
              <h3>{activeGroup.name}</h3>
              <small>{activeGroup._count?.members ?? activeGroup.members?.length ?? 0} members</small>
            </div>
            {canManageGroupMembers && (
              <div className="right-section">
                <h4>Group management</h4>
                <button className="action-btn" onClick={() => setShowEditGroup(true)}>✏️ Edit group name</button>
                <button
                  className="action-btn"
                  onClick={() => groupAvatarInputRef.current?.click()}
                >
                  🖼️ Change group photo
                </button>
                {activeGroup.avatarUrl && (
                  <button className="action-btn" onClick={() => { void removeGroupAvatar(); }}>
                    🗑️ Remove group photo
                  </button>
                )}
                <input
                  ref={groupAvatarInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleGroupAvatarChange(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>
            )}
            <div className="right-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>Members</h4>
                <button
                  className="btn-primary"
                  style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                  onClick={() => { setShowAddGroupMembers(true); setAddMemberIds([]); }}
                  disabled={!canManageGroupMembers}
                >
                  + Add
                </button>
              </div>
              {activeGroup.members?.map((m) => (
                <div key={m.id} className="group-member-row clickable" onClick={() => {
                  if (m.user) setProfileViewUser(m.user);
                }}>
                  {m.user?.avatarUrl ? (
                    <img src={`${API_URL}${m.user.avatarUrl}`} alt="" className="group-member-avatar-img" />
                  ) : (
                    <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {m.user?.displayName?.charAt(0).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span>{m.user?.displayName ?? m.userId}</span>
                  {m.role === "OWNER" && <small className="badge-owner">Owner</small>}
                  {m.role === "ADMIN" && <small className="badge-on">Admin</small>}
                  {m.role === "MEMBER" && <small className="badge-member">Member</small>}
                  {(canAssignGroupAdmins || canManageGroupMembers) && currentUser?.id !== m.userId && (
                    <div className="group-member-actions" onClick={(event) => event.stopPropagation()}>
                      {canAssignGroupAdmins && m.role !== "OWNER" && (
                        <button
                          className="member-action-btn"
                          onClick={() => void updateGroupMemberRole(m.userId, m.role === "ADMIN" ? "MEMBER" : "ADMIN")}
                        >
                          {m.role === "ADMIN" ? "Revoke admin" : "Make admin"}
                        </button>
                      )}
                      {((myGroupRole === "OWNER" && m.role !== "OWNER") || (myGroupRole === "ADMIN" && m.role === "MEMBER")) && (
                        <button
                          className="member-action-btn danger"
                          onClick={() => void kickGroupMember(m.userId)}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="right-section">
          <h4>Security</h4>
          <div className="security-row">
            <span>Two-Factor Auth</span>
            {currentUser.isTwoFAEnabled ? (
              <span className="badge-on">Enabled</span>
            ) : (
              <span className="badge-off">Disabled</span>
            )}
          </div>
          <button className="action-btn" onClick={() => { setShowSettings(true); setRightOpen(false); }}>⚙️ Open Settings</button>
        </div>

        {callStatus === "ringing" && incomingCall && (
          <div className="right-section">
            <div className="incoming-call">
              <p>📞 Incoming call</p>
              <div className="call-buttons">
                <button className="accept-btn" onClick={acceptCall}>Accept</button>
                <button className="decline-btn" onClick={declineCall}>Decline</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {callStatus === "in-call" && (
        <>
          {/* Minimized call strip - centered, not blocking edges */}
          {callMinimized && (
            <div
              style={{
                position: 'fixed',
                top: 84,
                left: isMobileViewport
                  ? '50%'
                  : `calc(${sidebarWidth}px + 4px + (100vw - ${sidebarWidth}px - 4px) / 2)`,
                transform: 'translateX(-50%)',
                background: 'var(--bg)',
                padding: '5px 18px',
                borderRadius: '10px',
                border: '1px solid var(--line)',
                zIndex: 9990,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
                whiteSpace: 'nowrap',
                maxWidth: 'calc(100vw - 24px)'
              }}
            >
              <span style={{ fontSize: 14 }}>📞</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace', fontWeight: 600 }}>{formatCallDuration(callStats.durationSec)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>⬆{callStats.upKbps.toFixed(0)}/⬇{callStats.downKbps.toFixed(0)} kbps{callStats.rttMs != null ? ` · ${callStats.rttMs}ms` : ""}</span>
              {callGroupIdRef.current && groupCallParticipants.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {groupCallParticipants.length} kishi
                  {groupCallParticipants.some(p => p.speaking) && " • 🎤"}
                </span>
              )}
              <button style={{ padding: '3px 10px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }} onClick={() => setCallMinimized(false)}>
                Open
              </button>
              <button
                style={{ padding: '3px 10px', background: callMicMuted ? 'var(--danger)' : 'var(--panel-hover)', color: callMicMuted ? '#fff' : 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                onClick={toggleCallMicMute}
                title={callMicMuted ? 'Unmute mic' : 'Mute mic'}
              >
                {callMicMuted ? 'Unmute' : 'Mute'}
              </button>
              <button style={{ padding: '3px 10px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); stopCall(false); }}>
                End
              </button>
            </div>
          )}

          {/* Full call overlay - always mounted for video refs */}
          <div className="in-call-overlay" style={{ position: 'fixed', bottom: 20, right: 20, width: 340, background: 'var(--bg-card)', borderRadius: 12, padding: 16, border: '1px solid var(--line)', zIndex: 9999, display: callMinimized ? 'none' : 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--text)' }}>Call in progress</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--primary)', fontSize: 13 }}>{formatCallDuration(callStats.durationSec)}</span>
                <button onClick={() => setCallMinimized(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }} title="Close">✕</button>
              </div>
            </div>

            {/* ── CALL STATS BAR ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '6px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              <span>⬆ {callStats.upKbps.toFixed(1)} kbps</span>
              <span>⬇ {callStats.downKbps.toFixed(1)} kbps</span>
              <span>RTT: {callStats.rttMs != null ? `${callStats.rttMs} ms` : "--"}</span>
              <span>Loss: {callStats.lossPct != null ? `${callStats.lossPct.toFixed(2)}%` : "--"}</span>
              <span>Jitter: {callStats.jitterMs != null ? `${callStats.jitterMs} ms` : "--"}</span>
              <span>Codec: {callStats.codec ?? "--"}</span>
              <span style={{ color: callStats.iceState === "connected" || callStats.iceState === "completed" ? "#4caf50" : callStats.iceState === "failed" ? "#f44336" : "#ff9800" }}>ICE: {callStats.iceState}</span>
              <span style={{ color: callStats.connState === "connected" ? "#4caf50" : callStats.connState === "failed" ? "#f44336" : "#ff9800" }}>Conn: {callStats.connState}</span>
            </div>
            {(callStats.bytesSentTotal === 0 && callStats.durationSec > 5) && (
              <div style={{ padding: '6px 8px', background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, fontSize: 11, color: '#f44336' }}>
                ⚠ Hech qanday audio jonatilmayapti! Mikrofon yoki ICE muammosi.
              </div>
            )}
            {(callStats.iceState === "failed" || callStats.connState === "failed") && (
              <div style={{ padding: '6px 8px', background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, fontSize: 11, color: '#f44336' }}>
                ⚠ ICE/Conn FAILED — TURN server yoki tarmoq muammosi.
              </div>
            )}

            {/* ── LIVE EVENT LOG ── */}
            {callEvents.length > 0 && (
              <details style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px' }}>
                <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                  📜 Event log ({callEvents.length})
                </summary>
                <div style={{ marginTop: 6, maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'monospace', fontSize: 10 }}>
                  {callEvents.slice().reverse().map((ev, i) => {
                    const color = ev.level === 'ok' ? '#4caf50' : ev.level === 'warn' ? '#ff9800' : ev.level === 'err' ? '#f44336' : 'var(--text-muted)';
                    const time = new Date(ev.t).toLocaleTimeString('en-GB', { hour12: false });
                    return (
                      <div key={`${ev.t}-${i}`} style={{ color, lineHeight: 1.3 }}>
                        <span style={{ opacity: 0.6 }}>{time.slice(3)}</span> {ev.msg}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* ── GROUP CALL PARTICIPANTS LIST ── */}
            {callGroupIdRef.current && groupCallParticipants.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>
                  Ishtirokchilar ({groupCallParticipants.length})
                </div>
                {groupCallParticipants.map(p => {
                  const isMe = p.userId === currentUser?.id;
                  const u = isMe ? currentUser : users.find(x => x.id === p.userId);
                  const vol = participantVolumes[p.userId] ?? 100;
                  const latencyMs = participantLatencyMs[p.userId];
                  const latencyLabel = isMe ? "local" : (typeof latencyMs === "number" ? `${latencyMs}ms` : "--");
                  return (
                    <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 8, background: p.speaking ? 'rgba(76,175,80,0.12)' : 'transparent', border: p.speaking ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent', transition: 'all 0.2s' }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {u?.avatarUrl ? (
                          <img src={`${API_URL}${u.avatarUrl}`} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: p.speaking ? '2px solid #4caf50' : '2px solid transparent', transition: 'border 0.2s' }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, border: p.speaking ? '2px solid #4caf50' : '2px solid transparent', transition: 'border 0.2s' }}>
                            {(u?.displayName ?? "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        {p.speaking && (
                          <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#4caf50', border: '2px solid var(--bg-card)', animation: 'pulse 1s infinite' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u?.displayName ?? p.userId.slice(0, 8)}{isMe ? " (siz)" : ""}
                        </div>
                        <div style={{ fontSize: 10, color: p.speaking ? '#4caf50' : 'var(--text-muted)' }}>
                          {p.speaking ? "🎤 Gapirmoqda" : "🔇 Tinglamoqda"} • {latencyLabel}
                        </div>
                      </div>
                      {!isMe && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>{vol}%</span>
                          <input
                            type="range" min="0" max="200" value={vol}
                            onChange={e => {
                              const v = Number(e.target.value);
                              setParticipantVolumes(prev => {
                                const next = { ...prev, [p.userId]: v };
                                localStorage.setItem("participant_volumes", JSON.stringify(next));
                                return next;
                              });
                            }}
                            style={{ width: 60, height: 4, accentColor: 'var(--primary)', cursor: 'pointer' }}
                            title={`Ovoz balandligi: ${vol}%`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div
              style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', minHeight: 180, cursor: ((remoteVideoRef.current?.srcObject as MediaStream | null)?.getVideoTracks().some(track => track.readyState === 'live') || isRemoteScreenSharing) ? 'pointer' : 'default' }}
              onClick={() => {
                const remoteStream = remoteVideoRef.current?.srcObject as MediaStream | null;
                const hasRemoteVideo = !!remoteStream?.getVideoTracks().some(track => track.readyState === 'live');
                if (isRemoteScreenSharing || hasRemoteVideo) {
                  setScreenFullscreen(true);
                }
              }}
              title={isRemoteScreenSharing ? 'Katta qilish' : ''}
            >
              <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <video ref={localVideoRef} autoPlay playsInline muted onClick={(e) => { if (isScreenSharing) { e.stopPropagation(); setLocalScreenFullscreen(true); } }} style={{ width: 100, position: 'absolute', bottom: 10, right: 10, borderRadius: 6, border: '2px solid var(--primary)', background: '#000', objectFit: 'cover', display: isScreenSharing ? 'block' : 'none', cursor: isScreenSharing ? 'pointer' : 'default' }} />
              {isScreenSharing && (
                <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11, pointerEvents: 'none' }}>⛶ Katta qilish</div>
              )}
              {isRemoteScreenSharing && (
                <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>⛶ Katta qilish</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ flex: 1, padding: '10px 0', background: callMicMuted ? 'var(--danger)' : 'var(--panel-hover)', color: callMicMuted ? '#fff' : 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={toggleCallMicMute}>
                {callMicMuted ? "Unmute" : "Mute"}
              </button>
              <button style={{ flex: 1, padding: '10px 0', background: isScreenSharing ? 'var(--danger)' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={toggleScreenShare}>
                {isScreenSharing ? "Stop sharing" : "Share screen"}
              </button>
              <button style={{ flex: 1, padding: '10px 0', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={() => stopCall(false)}>
                End call
              </button>
            </div>
          </div>
        </>
      )}

      <audio ref={remoteAudioRef} autoPlay />

      {/* Dark notification bar when local user is sharing screen */}
      {isScreenSharing && callStatus === "in-call" && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100000, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 20px', borderRadius: '0 0 12px 12px', display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
            <span style={{ fontSize: 14 }}>🖥️</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Ekran ulashilmoqda</span>
            <button onClick={toggleScreenShare} style={{ padding: '4px 14px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>To'xtatish</button>
          </div>
        </div>
      )}

      {/* Fullscreen local screenshare overlay */}
      {localScreenFullscreen && isScreenSharing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <video
            autoPlay playsInline muted
            ref={(el) => {
              if (el && localScreenStreamRef.current) {
                el.srcObject = localScreenStreamRef.current;
              }
            }}
            style={{ flex: 1, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => setLocalScreenFullscreen(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, backdropFilter: 'blur(8px)' }}>✕ Yopish</button>
            <button onClick={toggleScreenShare} style={{ padding: '8px 16px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>To'xtatish</button>
          </div>
        </div>
      )}

      {/* Fullscreen screenshare overlay */}
      {screenFullscreen && ((remoteVideoRef.current?.srcObject as MediaStream | null)?.getVideoTracks().some(track => track.readyState === 'live') || isRemoteScreenSharing) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <video
            autoPlay playsInline
            ref={(el) => {
              if (el && remoteVideoRef.current) {
                el.srcObject = remoteVideoRef.current.srcObject;
              }
            }}
            style={{ flex: 1, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => setScreenFullscreen(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, backdropFilter: 'blur(8px)' }}>✕ Yopish</button>
            <button onClick={() => stopCall(false)} style={{ padding: '8px 16px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>End call</button>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Preview" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
        </div>
      )}

      {/* ── CREATE GROUP DIALOG ── */}

      {showCreateGroup && (
        <div className="lightbox-overlay" onClick={() => setShowCreateGroup(false)}>
          <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Group</h3>
            <input
              type="text"
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
            />
            <div className="group-member-select">
              <h4>Select members:</h4>
              {users.map((user) => (
                <label key={user.id} className="group-member-checkbox">
                  <input
                    type="checkbox"
                    checked={newGroupMembers.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewGroupMembers([...newGroupMembers, user.id]);
                      } else {
                        setNewGroupMembers(newGroupMembers.filter((id) => id !== user.id));
                      }
                    }}
                  />
                  <span>{user.displayName}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, padding: 10, borderRadius: 10 }} onClick={createGroup}>
                Create ({newGroupMembers.length} members)
              </button>
              <button style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }} onClick={() => setShowCreateGroup(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditGroup && activeGroup && (
        <div className="lightbox-overlay" onClick={() => setShowEditGroup(false)}>
          <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Group</h3>
            <input
              type="text"
              placeholder="Group name"
              value={editGroupName}
              onChange={(e) => setEditGroupName(e.target.value)}
              autoFocus
              maxLength={100}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, padding: 10, borderRadius: 10 }} onClick={() => void saveGroupName()}>
                Save
              </button>
              <button style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }} onClick={() => setShowEditGroup(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD MEMBERS DIALOG ── */}
      {showAddGroupMembers && activeGroup && (
        <div className="lightbox-overlay" onClick={() => setShowAddGroupMembers(false)}>
          <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Add Members to {activeGroup.name}</h3>
            <div className="group-member-select">
              {users.filter(u => !activeGroup.members?.some(m => m.userId === u.id)).map((user) => (
                <label key={user.id} className="group-member-checkbox">
                  <input
                    type="checkbox"
                    checked={addMemberIds.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAddMemberIds([...addMemberIds, user.id]);
                      } else {
                        setAddMemberIds(addMemberIds.filter((id) => id !== user.id));
                      }
                    }}
                  />
                  {user.avatarUrl ? (
                    <img src={`${API_URL}${user.avatarUrl}`} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div className="user-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{user.displayName.charAt(0).toUpperCase()}</div>
                  )}
                  <span>{user.displayName}</span>
                </label>
              ))}
              {users.filter(u => !activeGroup.members?.some(m => m.userId === u.id)).length === 0 && (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No users available to add</p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, padding: 10, borderRadius: 10 }} onClick={addMembersToGroup}>
                Add ({addMemberIds.length})
              </button>
              <button style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }} onClick={() => setShowAddGroupMembers(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AUTO-UPDATE DIALOG ── */}
      {updateAvailable && (
        <div className="lightbox-overlay" onClick={() => setUpdateAvailable(null)}>
          <div className="create-group-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 40 }}>🔄</span>
              <h3 style={{ margin: '8px 0' }}>New version available!</h3>
              <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>
                Version <strong>{updateAvailable.newVersion}</strong> is ready to download
              </p>
              {updateAvailable.notes && (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0' }}>
                  {updateAvailable.notes}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-primary"
                style={{ flex: 1, padding: 12, borderRadius: 10, fontWeight: 600, fontSize: 14 }}
                disabled={isUpdating}
                onClick={() => { void handleUpdateInstall(); }}
              >
                {isUpdating
                  ? `Downloading... ${updateProgress}%${updateSpeedLabel}`
                  : updateActionLabel}
              </button>
              {isUpdating && (
                <div style={{ width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${updateProgress}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.2s ease' }} />
                </div>
              )}
              <button
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                onClick={() => setUpdateAvailable(null)}
                disabled={isUpdating}
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function disconnectSocket(socketRef: MutableRefObject<Socket | null>) {
  socketRef.current?.removeAllListeners();
  socketRef.current?.disconnect();
  socketRef.current = null;
}

// Clean up active call silently (no toast) when app is closing
function silentCallCleanup(
  peerConnectionRef: MutableRefObject<RTCPeerConnection | null>,
  localCallStreamRef: MutableRefObject<MediaStream | null>,
  localScreenStreamRef: MutableRefObject<MediaStream | null>
) {
  peerConnectionRef.current?.close();
  peerConnectionRef.current = null;
  localCallStreamRef.current?.getTracks().forEach((t) => t.stop());
  localCallStreamRef.current = null;
  localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
  localScreenStreamRef.current = null;
}

function formatLastSeen(lastSeenAt?: string | null) {
  if (!lastSeenAt) {
    return "offline";
  }
  return `last seen ${new Date(lastSeenAt).toLocaleTimeString()}`;
}

function buildMessagePreview(message: Message) {
  if (message.type === "TEXT") {
    return message.text ?? "Text";
  }
  if (message.type === "LOCATION") {
    return "Location yuborildi";
  }
  if (message.type === "VOICE") {
    return "Voice message";
  }
  return message.fileName ?? "File";
}

function isImageFile(message: Message): boolean {
  if (message.fileMime?.startsWith("image/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext ?? "");
}

function isVideoFile(message: Message): boolean {
  if (message.fileMime?.startsWith("video/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext ?? "");
}

function isMusicFile(message: Message): boolean {
  if (message.type === "VOICE") return false; // voice messages use different player
  if (message.fileMime?.startsWith("audio/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma"].includes(ext ?? "");
}

/** Extract music title from filename */
function extractMusicTitle(fileName: string | null | undefined): { artist: string; title: string } {
  if (!fileName) return { artist: "Unknown", title: "Unknown" };
  const name = fileName.replace(/\.[^.]+$/, ""); // remove extension
  // Try "Artist – Title" or "Artist - Title" pattern
  const separators = [" – ", " - ", " — "];
  for (const sep of separators) {
    const idx = name.indexOf(sep);
    if (idx > 0) {
      return { artist: name.slice(0, idx).trim(), title: name.slice(idx + sep.length).trim() };
    }
  }
  return { artist: "", title: name };
}

/** Custom Video Player component */
function VideoMessagePlayer({ src, fileName, isMine }: { src: string; fileName?: string | null; isMine?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState(1);
  const animRef = useRef<number>(0);
  const hideTimerRef = useRef<number>(0);

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (isFullscreen && isPlaying) {
      hideTimerRef.current = window.setTimeout(() => setShowControls(false), 3000);
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      cancelAnimationFrame(animRef.current);
      setIsPlaying(false);
    } else {
      v.play();
      setIsPlaying(true);
      const tick = () => {
        if (v.duration) {
          setProgress(v.currentTime / v.duration);
          setCurrentTime(v.currentTime);
        }
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
    setCurrentTime(v.currentTime);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => { });
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => { });
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return (
    <div className={`video-player${isMine ? " mine" : ""}${isFullscreen ? " fullscreen" : ""}`}
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (isFullscreen && isPlaying) setShowControls(false); }}
    >
      <div className="video-container" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={() => { if (videoRef.current) setDuration(videoRef.current.duration); }}
          onEnded={() => { cancelAnimationFrame(animRef.current); setIsPlaying(false); setProgress(0); setCurrentTime(0); }}
        />
        {!isPlaying && (
          <div className="video-play-overlay">
            <div className="video-play-circle">▶</div>
          </div>
        )}
      </div>
      {
        <div className={`video-controls${!showControls && isFullscreen ? " hidden" : ""}`}>
          <button className="video-ctrl-btn" onClick={togglePlay}>{isPlaying ? "⏸" : "▶"}</button>
          <div className="video-progress-bar" onClick={handleSeek}>
            <div className="video-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="video-time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
          <button className="video-ctrl-btn" onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.volume > 0) { v.volume = 0; setVolume(0); }
            else { v.volume = 1; setVolume(1); }
          }} title="Volume">{volume > 0 ? "🔊" : "🔇"}</button>
          <input
            type="range"
            className="video-volume-slider"
            min="0" max="1" step="0.01"
            value={volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (videoRef.current) videoRef.current.volume = v;
            }}
          />
          <button className="video-ctrl-btn video-fullscreen-btn" onClick={toggleFullscreen} title="Fullscreen">
            {isFullscreen ? "⛶" : "⛶"}
          </button>
        </div>
      }
      {fileName && <div className="video-filename">{fileName}</div>}
    </div>
  );
}

/** Global music player context — single audio element architecture */
type MusicTrack = {
  src: string;
  fileName: string;
  artist: string;
  title: string;
  isVoice?: boolean;
  durationHintSec?: number;
  voiceQueue?: {
    items: { id: string; src: string; durationSec?: number | null }[];
    index: number;
  };
};

type MusicPlaybackState = {
  track: MusicTrack | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
};

// ── Centralized music player engine (single <audio> element) ──
const musicStateListeners: Set<(state: MusicPlaybackState) => void> = new Set();
const musicCommandListeners: Set<(cmd: MusicCommand) => void> = new Set();

type MusicCommand =
  | { type: "play"; track: MusicTrack }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggle"; track: MusicTrack }
  | { type: "seek"; ratio: number }
  | { type: "seekRelative"; delta: number }
  | { type: "setVolume"; volume: number }
  | { type: "setRepeat"; repeat: boolean }
  | { type: "stop" };

let globalMusicState: MusicPlaybackState = {
  track: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
};

function emitMusicState(state: MusicPlaybackState) {
  globalMusicState = state;
  musicStateListeners.forEach(fn => fn(state));
}

function sendMusicCommand(cmd: MusicCommand) {
  musicCommandListeners.forEach(fn => fn(cmd));
}

function useMusicPlaybackState() {
  const [state, setState] = useState<MusicPlaybackState>(globalMusicState);
  useEffect(() => {
    const handler = (s: MusicPlaybackState) => setState(s);
    musicStateListeners.add(handler);
    return () => { musicStateListeners.delete(handler); };
  }, []);
  return state;
}

function getEffectiveDuration(mediaDuration: number, hintDuration?: number) {
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
    return mediaDuration;
  }
  if (Number.isFinite(hintDuration) && (hintDuration ?? 0) > 0) {
    return hintDuration as number;
  }
  return 0;
}

/** Telegram-style Music Player in message bubble (UI only — no <audio>) */
function MusicMessagePlayer({ src, fileName, isMine }: { src: string; fileName?: string | null; isMine?: boolean }) {
  const { artist, title } = useMemo(() => extractMusicTitle(fileName), [fileName]);
  const playback = useMusicPlaybackState();

  // Is THIS track the currently active one?
  const isActiveTrack = playback.track?.src === src;
  const isPlaying = isActiveTrack && playback.isPlaying;
  const progress = isActiveTrack ? playback.progress : 0;
  const currentTime = isActiveTrack ? playback.currentTime : 0;
  const duration = isActiveTrack ? playback.duration : 0;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const togglePlay = () => {
    sendMusicCommand({ type: "toggle", track: { src, fileName: fileName ?? "", artist, title } });
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActiveTrack) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    sendMusicCommand({ type: "seek", ratio });
  };

  return (
    <div className={`music-player${isMine ? " mine" : ""}`}>
      <button className="music-play-btn" onClick={togglePlay}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <div className="music-info">
        <div className="music-title">{title || fileName}</div>
        {artist && <div className="music-artist">{artist}</div>}
        <div className="music-progress-row">
          <div className="music-progress-bar" onClick={handleSeek}>
            <div className="music-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="music-time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
        </div>
      </div>
      <div className="music-icon">🎵</div>
    </div>
  );
}

/** Global Music Controller Bar (top of screen) — owns the single <audio> element */
function GlobalMusicController() {
  const playback = useMusicPlaybackState();
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animRef = useRef<number>(0);
  const currentSrcRef = useRef<string>("");

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Start the progress animation loop
  const startProgressLoop = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const effectiveDuration = getEffectiveDuration(a.duration, globalMusicState.track?.durationHintSec);
        emitMusicState({
          ...globalMusicState,
          isPlaying: !a.paused,
          progress: effectiveDuration > 0 ? Math.max(0, Math.min(1, a.currentTime / effectiveDuration)) : 0,
          currentTime: a.currentTime,
          duration: effectiveDuration,
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  // Handle commands from bubble players and internal controls
  useEffect(() => {
    const handler = (cmd: MusicCommand) => {
      const a = audioRef.current;
      if (!a) return;

      switch (cmd.type) {
        case "play": {
          if (currentSrcRef.current !== cmd.track.src) {
            a.src = cmd.track.src;
            a.load();
            currentSrcRef.current = cmd.track.src;
          }
          a.volume = volume;
          a.play().then(() => {
            const effectiveDuration = getEffectiveDuration(a.duration, cmd.track.durationHintSec);
            emitMusicState({
              track: cmd.track,
              isPlaying: true,
              progress: 0,
              currentTime: 0,
              duration: effectiveDuration,
            });
            startProgressLoop();
          }).catch(() => { });
          break;
        }
        case "pause": {
          a.pause();
          cancelAnimationFrame(animRef.current);
          emitMusicState({ ...globalMusicState, isPlaying: false });
          break;
        }
        case "resume": {
          a.play().then(() => {
            emitMusicState({ ...globalMusicState, isPlaying: true });
            startProgressLoop();
          }).catch(() => { });
          break;
        }
        case "toggle": {
          const isCurrentTrack = globalMusicState.track?.src === cmd.track.src;
          if (isCurrentTrack && globalMusicState.isPlaying) {
            // Pause current track
            a.pause();
            cancelAnimationFrame(animRef.current);
            emitMusicState({ ...globalMusicState, isPlaying: false });
          } else if (isCurrentTrack && !globalMusicState.isPlaying) {
            // Resume current track
            a.play().then(() => {
              emitMusicState({ ...globalMusicState, isPlaying: true });
              startProgressLoop();
            }).catch(() => { });
          } else {
            // Play new track
            a.src = cmd.track.src;
            a.load();
            currentSrcRef.current = cmd.track.src;
            a.volume = volume;
            a.play().then(() => {
              const effectiveDuration = getEffectiveDuration(a.duration, cmd.track.durationHintSec);
              emitMusicState({
                track: cmd.track,
                isPlaying: true,
                progress: 0,
                currentTime: 0,
                duration: effectiveDuration,
              });
              startProgressLoop();
            }).catch(() => { });
          }
          break;
        }
        case "seek": {
          if (a.duration) {
            a.currentTime = cmd.ratio * a.duration;
            emitMusicState({
              ...globalMusicState,
              progress: cmd.ratio,
              currentTime: a.currentTime,
            });
          }
          break;
        }
        case "seekRelative": {
          a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + cmd.delta));
          break;
        }
        case "setVolume": {
          a.volume = cmd.volume;
          break;
        }
        case "setRepeat": {
          a.loop = cmd.repeat;
          break;
        }
        case "stop": {
          a.pause();
          a.src = "";
          currentSrcRef.current = "";
          cancelAnimationFrame(animRef.current);
          emitMusicState({
            track: null,
            isPlaying: false,
            progress: 0,
            currentTime: 0,
            duration: 0,
          });
          break;
        }
      }
    };

    musicCommandListeners.add(handler);
    return () => { musicCommandListeners.delete(handler); };
  }, [volume, startProgressLoop]);

  // Audio ended handler
  const handleEnded = useCallback(() => {
    if (!repeat) {
      cancelAnimationFrame(animRef.current);
      emitMusicState({
        track: null,
        isPlaying: false,
        progress: 0,
        currentTime: 0,
        duration: 0,
      });
    }
  }, [repeat]);

  const track = playback.track;

  const togglePlay = () => {
    if (playback.isPlaying) {
      sendMusicCommand({ type: "pause" });
    } else {
      sendMusicCommand({ type: "resume" });
    }
  };

  const playVoiceFromQueue = useCallback((dir: -1 | 1) => {
    const track = globalMusicState.track;
    const queue = track?.voiceQueue;
    if (!track?.isVoice || !queue || queue.items.length === 0) {
      sendMusicCommand({ type: "seekRelative", delta: dir === -1 ? -10 : 10 });
      return;
    }

    const nextIndex = queue.index + dir;
    if (nextIndex < 0 || nextIndex >= queue.items.length) {
      return;
    }

    const nextItem = queue.items[nextIndex];
    sendMusicCommand({
      type: "play",
      track: {
        src: nextItem.src,
        fileName: "voice",
        artist: "",
        title: "Voice message",
        isVoice: true,
        durationHintSec: nextItem.durationSec ?? undefined,
        voiceQueue: {
          items: queue.items,
          index: nextIndex,
        },
      },
    });
  }, []);

  const seekBackward = () => playVoiceFromQueue(-1);
  const seekForward = () => playVoiceFromQueue(1);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    sendMusicCommand({ type: "setVolume", volume: v });
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    sendMusicCommand({ type: "seek", ratio });
  };

  const close = () => sendMusicCommand({ type: "stop" });

  // Always render <audio> so command handler works; only show bar UI when track exists
  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={() => {
          const a = audioRef.current;
          if (a) {
            emitMusicState({
              ...globalMusicState,
              duration: getEffectiveDuration(a.duration, globalMusicState.track?.durationHintSec),
            });
          }
        }}
        onEnded={handleEnded}
        style={{ display: "none" }}
      />
      {track && (
        <div className="global-music-bar">
          <div className="gmb-controls">
            <button className="gmb-btn" onClick={seekBackward} title="10s orqaga">⏪</button>
            <button className="gmb-btn gmb-play" onClick={togglePlay}>{playback.isPlaying ? "⏸" : "▶"}</button>
            <button className="gmb-btn" onClick={seekForward} title="10s oldinga">⏩</button>
          </div>
          <div className="gmb-info">
            <span className="gmb-title">
              {track.isVoice ? "🎙️ Voice message" : track.artist ? `${track.artist} – ${track.title}` : track.title}
            </span>
            <span className="gmb-time">{fmtTime(playback.currentTime)}</span>
          </div>
          <div className="gmb-progress" onClick={handleSeek}>
            <div className="gmb-progress-fill" style={{ width: `${playback.progress * 100}%` }} />
          </div>
          <div className="gmb-right">
            <button className="gmb-btn" onClick={() => {
              if (volume > 0) {
                setPrevVolume(volume);
                setVolume(0);
                sendMusicCommand({ type: "setVolume", volume: 0 });
              } else {
                const restore = prevVolume > 0 ? prevVolume : 1;
                setVolume(restore);
                sendMusicCommand({ type: "setVolume", volume: restore });
              }
            }} title="Volume">
              {volume > 0 ? "🔊" : "🔇"}
            </button>
            <input type="range" className="gmb-volume" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} />
            <button className={`gmb-btn${repeat ? " active" : ""}`} onClick={() => {
              const next = !repeat;
              setRepeat(next);
              sendMusicCommand({ type: "setRepeat", repeat: next });
            }} title="Repeat">
              🔁
            </button>
            <button className="gmb-btn gmb-close" onClick={close} title="Close">✕</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Voice message player with waveform visualisation — uses global audio engine */
function AudioWaveformPlayer({ src, durationSec, isMine, messageId, voiceQueue }: { src: string; durationSec?: number | null; isMine?: boolean; messageId: string; voiceQueue?: { id: string; src: string; durationSec?: number | null }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const playback = useMusicPlaybackState();

  // Is THIS voice the currently active track?
  const isActiveTrack = playback.track?.src === src;
  const isPlaying = isActiveTrack && playback.isPlaying;
  const progress = isActiveTrack ? playback.progress : 0;
  const currentTime = isActiveTrack ? playback.currentTime : 0;

  // Decode audio and generate waveform data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(src);
        const buffer = await resp.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buffer);
        const raw = decoded.getChannelData(0);
        const bars = 48;
        const step = Math.floor(raw.length / bars);
        const peaks: number[] = [];
        for (let i = 0; i < bars; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) {
            const abs = Math.abs(raw[i * step + j]);
            if (abs > max) max = abs;
          }
          peaks.push(max);
        }
        const peakMax = Math.max(...peaks, 0.01);
        if (!cancelled) setWaveformData(peaks.map((p) => p / peakMax));
        ctx.close();
      } catch {
        if (!cancelled) setWaveformData(Array.from({ length: 48 }, () => 0.2 + Math.random() * 0.6));
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const barW = Math.max(2, (w / waveformData.length) - 1.5);
    const gap = (w - barW * waveformData.length) / (waveformData.length - 1 || 1);
    const progressBars = Math.floor(progress * waveformData.length);

    const playedColor = isMine ? "#ffffff" : "#0e7c66";
    const unplayedColor = isMine ? "rgba(255,255,255,0.35)" : "rgba(14,124,102,0.3)";

    for (let i = 0; i < waveformData.length; i++) {
      const barH = Math.max(3, waveformData[i] * (h - 4));
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      ctx.fillStyle = i < progressBars ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      ctx.fill();
    }
  }, [waveformData, progress, isMine]);

  const togglePlay = () => {
    const queueIndex = voiceQueue?.findIndex((item) => item.id === messageId) ?? -1;
    sendMusicCommand({
      type: "toggle",
      track: {
        src,
        fileName: "voice",
        artist: "",
        title: "Voice message",
        isVoice: true,
        durationHintSec: durationSec ?? undefined,
        voiceQueue: queueIndex >= 0 && voiceQueue
          ? { items: voiceQueue, index: queueIndex }
          : undefined,
      },
    });
  };

  const dur = durationSec ?? 0;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className={`voice-waveform-player${isMine ? " mine" : ""}`}>
      <button className="wave-play-btn" onClick={togglePlay}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <canvas ref={canvasRef} className="wave-canvas" />
      <span className="wave-time">{isPlaying ? fmtTime(Math.floor(currentTime)) : fmtTime(dur)}</span>
    </div>
  );
}

// ── URL detection regex ──
const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

// ── Mention detection regex: @[DisplayName](userId) ──
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

// ── OG Metadata cache (persists across re-renders) ──
const ogMetaCache = new Map<string, OgMeta | null>();
const ogMetaFetching = new Set<string>();

type OgMeta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  video: string | null;
};

function getSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return "";
  }
}

/** Extract YouTube video ID from various URL formats */
function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtube.com/watch?v=ID
    if (u.hostname.includes("youtube.com") && u.searchParams.has("v")) {
      return u.searchParams.get("v");
    }
    // youtu.be/ID
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    // youtube.com/embed/ID
    if (u.hostname.includes("youtube.com") && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }
    // youtube.com/shorts/ID
    if (u.hostname.includes("youtube.com") && u.pathname.startsWith("/shorts/")) {
      return u.pathname.split("/")[2] || null;
    }
  } catch { /* ignore */ }
  return null;
}

function isYouTubeShortsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("youtube.com") && u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

/** Extract Instagram post/reel URL for embeddable iframe endpoint */
function getInstagramEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("instagram.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const kind = parts[0];
    const id = parts[1];
    if (!["p", "reel", "tv"].includes(kind) || !id) return null;
    return `https://www.instagram.com/${kind}/${id}/embed/captioned/`;
  } catch {
    return null;
  }
}

// Allow message text links to request inline opening in the corresponding LinkPreview card.
const inlineLinkOpenListeners = new Set<(url: string) => void>();
function requestInlineLinkOpen(url: string) {
  inlineLinkOpenListeners.forEach((fn) => fn(url));
}

/** Link preview card (Telegram-style) with inline YouTube / Instagram player */
function LinkPreview({ url }: { url: string }) {
  const [meta, setMeta] = useState<OgMeta | null>(ogMetaCache.get(url) ?? null);
  const [loaded, setLoaded] = useState(ogMetaCache.has(url));
  const [imgError, setImgError] = useState(false);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [igPlaying, setIgPlaying] = useState(false);
  const [igLoaded, setIgLoaded] = useState(false);
  const [igInlineFailed, setIgInlineFailed] = useState(false);
  const [inlineVolume, setInlineVolume] = useState<number>(() => {
    const v = Number(localStorage.getItem("inline_media_volume") ?? "1");
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  });
  const isYouTube = /youtube\.com|youtu\.be/i.test(url);
  const ytVideoId = isYouTube ? getYouTubeVideoId(url) : null;
  const isYouTubeShorts = isYouTube ? isYouTubeShortsUrl(url) : false;
  const isInstagram = /instagram\.com/i.test(url);
  const instagramEmbedUrl = isInstagram ? getInstagramEmbedUrl(url) : null;
  const canUseNativeInstagramVideo = isInstagram && Boolean(meta?.video);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const igVideoRef = useRef<HTMLVideoElement | null>(null);

  const applyYouTubeVolume = useCallback((vol: number) => {
    const iframe = ytIframeRef.current;
    if (!iframe?.contentWindow) return;
    const pct = Math.round(Math.max(0, Math.min(1, vol)) * 100);
    const message = JSON.stringify({ event: "command", func: "setVolume", args: [pct] });
    iframe.contentWindow.postMessage(message, "*");
  }, []);

  useEffect(() => {
    if (ogMetaCache.has(url)) {
      setMeta(ogMetaCache.get(url) ?? null);
      setLoaded(true);
      return;
    }
    if (ogMetaFetching.has(url)) return;
    ogMetaFetching.add(url);

    fetch(`${API_URL}/og-meta?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data: OgMeta) => {
        ogMetaCache.set(url, data);
        ogMetaFetching.delete(url);
        setMeta(data);
        setLoaded(true);
      })
      .catch(() => {
        ogMetaCache.set(url, null);
        ogMetaFetching.delete(url);
        setLoaded(true);
      });
  }, [url]);

  useEffect(() => {
    if (canUseNativeInstagramVideo) return;
    if (!igPlaying) return;
    setIgLoaded(false);
    setIgInlineFailed(false);
    const t = window.setTimeout(() => {
      setIgInlineFailed((prev) => prev || !igLoaded);
    }, 4500);
    return () => window.clearTimeout(t);
  }, [igPlaying, igLoaded, canUseNativeInstagramVideo]);

  useEffect(() => {
    localStorage.setItem("inline_media_volume", String(inlineVolume));
    if (ytPlaying && isYouTube) {
      applyYouTubeVolume(inlineVolume);
    }
    if (igPlaying && canUseNativeInstagramVideo && igVideoRef.current) {
      igVideoRef.current.volume = inlineVolume;
    }
  }, [inlineVolume, ytPlaying, isYouTube, applyYouTubeVolume, igPlaying, canUseNativeInstagramVideo]);

  useEffect(() => {
    const openInline = (targetUrl: string) => {
      if (targetUrl !== url) return;
      if (isYouTube && ytVideoId) {
        setYtPlaying(true);
        return;
      }
      if (isInstagram && instagramEmbedUrl) {
        setIgPlaying(true);
      }
    };
    inlineLinkOpenListeners.add(openInline);
    return () => {
      inlineLinkOpenListeners.delete(openInline);
    };
  }, [url, isYouTube, ytVideoId, isInstagram, instagramEmbedUrl]);

  if (!loaded) {
    return (
      <div className="link-preview loading">
        <div className="link-preview-spinner" />
      </div>
    );
  }

  if (!meta || (!meta.title && !meta.description && !meta.image)) {
    return null; // No OG meta, show nothing extra
  }

  const siteName = meta.siteName || getSiteName(url);

  // YouTube inline player mode
  if (isYouTube && ytVideoId && ytPlaying) {
    const ytSrc = isYouTubeShorts
      ? `https://www.youtube.com/embed/${ytVideoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1&mute=1&loop=1&playlist=${ytVideoId}`
      : `https://www.youtube.com/embed/${ytVideoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`;

    return (
      <div className="link-preview youtube-embed" onClick={(e) => e.stopPropagation()}>
        <div className={`youtube-player-wrap${isYouTubeShorts ? " shorts" : ""}`}>
          <iframe
            ref={ytIframeRef}
            src={ytSrc}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={meta.title || "YouTube video"}
            onLoad={() => applyYouTubeVolume(inlineVolume)}
          />
        </div>
        <div className="link-preview-body" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {meta.title && <div className="link-preview-title" style={{ fontSize: 12 }}>{meta.title}</div>}
            <div className="inline-media-volume-row">
              <span>🔊</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={inlineVolume}
                onChange={(e) => setInlineVolume(parseFloat(e.target.value))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="yt-inline-btn"
              onClick={(e) => { e.stopPropagation(); setYtPlaying(false); }}
              title="Close player"
            >✕</button>
            <button
              className="yt-inline-btn"
              onClick={(e) => { e.stopPropagation(); BrowserOpenURL(url); }}
              title="Open in browser"
            >↗</button>
          </div>
        </div>
      </div>
    );
  }

  // Instagram inline embed mode
  if (isInstagram && instagramEmbedUrl && igPlaying) {
    return (
      <div className="link-preview instagram-embed" onClick={(e) => e.stopPropagation()}>
        {canUseNativeInstagramVideo ? (
          <div className="instagram-native-wrap">
            <video
              ref={igVideoRef}
              className="instagram-native-video"
              src={meta?.video ?? undefined}
              controls
              playsInline
              autoPlay
              preload="metadata"
              poster={meta?.image ?? undefined}
              onLoadedMetadata={() => {
                if (igVideoRef.current) {
                  igVideoRef.current.volume = inlineVolume;
                }
              }}
            />
          </div>
        ) : (
          <div className="instagram-player-wrap">
            <iframe
              src={instagramEmbedUrl}
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
              title={meta.title || "Instagram post"}
              onLoad={() => setIgLoaded(true)}
            />
          </div>
        )}
        {!canUseNativeInstagramVideo && igInlineFailed && (
          <div className="instagram-inline-warning">
            Instagram inline ochilmadi. Avval login talab qilinishi mumkin.
            <button className="yt-inline-btn" onClick={(e) => { e.stopPropagation(); BrowserOpenURL("https://www.instagram.com/accounts/login/"); }} title="Login Instagram">Login</button>
          </div>
        )}
        <div className="link-preview-body" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {meta.title && <div className="link-preview-title" style={{ fontSize: 12 }}>{meta.title}</div>}
            <div className="inline-media-volume-row">
              <span>🔊</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={inlineVolume}
                onChange={(e) => setInlineVolume(parseFloat(e.target.value))}
                disabled={!canUseNativeInstagramVideo}
              />
            </div>
            {!canUseNativeInstagramVideo && (
              <small className="inline-media-volume-note">Instagram iframe rejimida ovoz boshqaruvi cheklangan.</small>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              className="yt-inline-btn"
              onClick={(e) => { e.stopPropagation(); setIgPlaying(false); }}
              title="Close player"
            >✕</button>
            <button
              className="yt-inline-btn"
              onClick={(e) => { e.stopPropagation(); BrowserOpenURL(url); }}
              title="Open in browser"
            >↗</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="link-preview"
      onClick={(e) => {
        e.stopPropagation();
        if (isYouTube && ytVideoId) {
          setYtPlaying(true);
        } else if (isInstagram && instagramEmbedUrl) {
          setIgPlaying(true);
        } else {
          BrowserOpenURL(url);
        }
      }}
    >
      {meta.image && !imgError && (
        <div className={`link-preview-image${isYouTube ? " youtube" : ""}${isInstagram ? " instagram" : ""}`}>
          <img
            src={meta.image}
            alt=""
            onError={() => setImgError(true)}
          />
          {isYouTube && (
            <div className="link-preview-play">
              <svg viewBox="0 0 68 48" width="48" height="34">
                <path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.63-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/>
                <path d="M45 24L27 14v20" fill="white"/>
              </svg>
            </div>
          )}
          {isInstagram && (
            <div className="link-preview-play">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="5" fill="rgba(0,0,0,0.55)" />
                <path d="M12 8.2C14.1 8.2 15.8 9.9 15.8 12C15.8 14.1 14.1 15.8 12 15.8C9.9 15.8 8.2 14.1 8.2 12C8.2 9.9 9.9 8.2 12 8.2Z" fill="white"/>
                <circle cx="16.7" cy="7.3" r="1" fill="white"/>
              </svg>
            </div>
          )}
        </div>
      )}
      <div className="link-preview-body">
        {siteName && <div className="link-preview-site">{siteName}</div>}
        {meta.title && <div className="link-preview-title">{meta.title}</div>}
        {meta.description && (
          <div className="link-preview-desc">
            {meta.description.length > 150
              ? meta.description.slice(0, 150) + "…"
              : meta.description}
          </div>
        )}
      </div>
    </div>
  );
}

function formatCallLogDuration(totalSeconds: number) {
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

function normalizeLegacyCallLogText(text: string) {
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

/** Render text with clickable links, OG previews, and @mentions */
function renderTextWithLinks(text: string, onMentionClick?: (userId: string) => void): React.ReactNode {
  // First, split by mention pattern, then by URL pattern
  const MENTION_SPLIT = /@\[([^\]]+)\]\(([^)]+)\)/g;
  
  // Split text by mentions first
  const mentionParts: (string | { type: "mention"; name: string; userId: string })[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  MENTION_SPLIT.lastIndex = 0;
  while ((match = MENTION_SPLIT.exec(text)) !== null) {
    if (match.index > lastIdx) {
      mentionParts.push(text.slice(lastIdx, match.index));
    }
    mentionParts.push({ type: "mention", name: match[1], userId: match[2] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    mentionParts.push(text.slice(lastIdx));
  }

  const urls: string[] = [];
  const elements = mentionParts.map((part, i) => {
    if (typeof part !== "string") {
      // Render mention badge
      return (
        <span
          key={`mention-${i}`}
          className="mention-badge"
          onClick={(e) => {
            e.stopPropagation();
            onMentionClick?.(part.userId);
          }}
        >
          @{part.name}
        </span>
      );
    }

    // For string parts, split by URLs
    const urlParts = part.split(URL_REGEX);
    if (urlParts.length === 1) return <span key={i}>{part}</span>;

    return urlParts.map((urlPart, j) => {
      if (URL_REGEX.test(urlPart)) {
        URL_REGEX.lastIndex = 0;
        if (!urls.includes(urlPart)) urls.push(urlPart);
        return (
          <a
            key={`${i}-${j}`}
            href="#"
            className="msg-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (/youtube\.com|youtu\.be|instagram\.com/i.test(urlPart)) {
                requestInlineLinkOpen(urlPart);
              } else {
                BrowserOpenURL(urlPart);
              }
            }}
          >
            {urlPart}
          </a>
        );
      }
      URL_REGEX.lastIndex = 0;
      return <span key={`${i}-${j}`}>{urlPart}</span>;
    });
  });

  return (
    <>
      <span>{elements}</span>
      {urls.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </>
  );
}

function renderMessage(
  message: Message,
  onImageClick?: (url: string) => void,
  isMine?: boolean,
  onMentionClick?: (userId: string) => void,
  voiceQueue?: { id: string; src: string; durationSec?: number | null }[]
) {
  if (message.type === "TEXT") {
    return renderTextWithLinks(normalizeLegacyCallLogText(message.text ?? ""), onMentionClick);
  }
  if (message.type === "LOCATION") {
    const lat = Number(message.latitude);
    const lng = Number(message.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return <span>📍 Location yuborildi</span>;
    }

    const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const delta = 0.01;
    const west = (lng - delta).toFixed(6);
    const east = (lng + delta).toFixed(6);
    const north = (lat + delta).toFixed(6);
    const south = (lat - delta).toFixed(6);
    const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;

    return (
      <div className="location-preview">
        <iframe
          title={`Location ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
          src={embedUrl}
          className="location-preview-map"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <a href={mapUrl} target="_blank" rel="noreferrer" className="location-preview-caption">
          📍 {lat.toFixed(5)}, {lng.toFixed(5)}
        </a>
      </div>
    );
  }
  if (message.type === "VOICE") {
    return (
      <AudioWaveformPlayer
        src={normalizeFileUrl(message.fileUrl) ?? ""}
        durationSec={message.durationSec}
        isMine={isMine}
        messageId={message.id}
        voiceQueue={voiceQueue}
      />
    );
  }
  // Video preview
  if (isVideoFile(message)) {
    return <VideoMessagePlayer src={normalizeFileUrl(message.fileUrl) ?? ""} fileName={message.fileName} isMine={isMine} />;
  }
  // Music preview (Telegram style)
  if (isMusicFile(message)) {
    return <MusicMessagePlayer src={normalizeFileUrl(message.fileUrl) ?? ""} fileName={message.fileName} isMine={isMine} />;
  }
  // Image preview inline
  if (isImageFile(message)) {
    const imgUrl = normalizeFileUrl(message.fileUrl) ?? "";
    return (
      <img
        src={imgUrl}
        alt={message.fileName ?? "Image"}
        style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 10, display: "block", cursor: "pointer" }}
        onClick={() => onImageClick?.(imgUrl)}
      />
    );
  }
  return (
    <FileMessageBubble message={message} />
  );
}

/** File message bubble with Download + Show in Explorer buttons */
function FileMessageBubble({ message }: { message: Message }) {
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileName = message.fileName ?? "file";
  const canRevealDownloadedFile = isWailsRuntime;

  useEffect(() => {
    FileExistsInDownloads(fileName).then(setDownloaded).catch(() => {});
  }, [fileName]);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const rawUrl = message.fileUrl ?? "";
      const url = normalizeFileUrl(rawUrl) ?? rawUrl;
      await SaveFileFromURL(url, fileName);
      if (canRevealDownloadedFile) {
        setDownloaded(true);
      }
      toast.success("File downloaded!");
    } catch {
      toast.error("Download error");
    } finally {
      setDownloading(false);
    }
  };

  const handleShowInExplorer = async () => {
    try {
      const path = await GetDownloadPath(fileName);
      if (path) await ShowInExplorer(path);
    } catch {
      toast.error("Error opening file");
    }
  };

  return (
    <div className="file-msg-bubble">
      <div className="file-msg-name">📎 {fileName}</div>
      <div className="file-msg-actions">
        {!downloaded || !canRevealDownloadedFile ? (
          <button className="file-msg-btn file-download-btn" onClick={handleDownload} disabled={downloading}>
            {downloading ? "⏳ Yuklanmoqda..." : "⬇ Download"}
          </button>
        ) : (
          <button className="file-msg-btn file-explorer-btn" onClick={handleShowInExplorer}>
            📂 Show in Explorer
          </button>
        )}
      </div>
    </div>
  );
}

function readAxiosMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getAxiosStatus(error: unknown): number | null {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { status?: number } }).response;
    return typeof response?.status === "number" ? response.status : null;
  }
  return null;
}

export default App;

