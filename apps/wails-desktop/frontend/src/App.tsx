import {
  FormEvent,
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { PluginListenerHandle } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { api, API_URL, persistToken, readPersistedToken } from "./lib/api";
import {
  DEFAULT_RINGTONE_URL,
  getDialToneSourceInfo,
  getRingtoneSourceInfo,
  resetDialToneSource,
  resetRingtoneSource,
  setDialToneSource,
  setRingtoneSource,
  startRingtone,
  startDialTone,
  stopAllCallSounds,
  playEndCallSound,
  playMessageSentSound,
} from "./lib/callSounds";
import { createSocket } from "./lib/socket";
import {
  Message,
  MessageType,
  PublicUser,
  Group,
  GroupMessage,
  GroupRole,
} from "./types";
import { RNNoiseNode } from "simple-rnnoise-wasm";
// @ts-ignore
import rnnoiseWasmUrl from "simple-rnnoise-wasm/rnnoise.wasm?url";
import {
  GetStartupEnabled,
  SetStartupEnabled,
  SetStartupLaunchMinimized,
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
  GetUpdateHistory,
  ShowInExplorer,
  SaveFileFromURL,
  FileExistsInDownloads,
  GetDownloadPath,
  GetGeoLocation,
  RestoreNormalWindow,
  RestartApp,
  GetAppliedProxy,
  EventsOn,
  EventsOff,
  BrowserOpenURL,
  ConsumePendingNotificationTarget,
  SetWindowCaptionTheme,
  isWailsRuntime,
  isNativeMobileRuntime,
} from "./platform/bridge";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";
import { UserProfileModal } from "./components/UserProfileModal";
import { AppLockScreen } from "./components/AppLockScreen";
import { UpdateModal } from "./components/UpdateModal";
import { CreateGroupModal } from "./components/modals/CreateGroupModal";
import { EditGroupModal } from "./components/modals/EditGroupModal";
import { AddMembersModal } from "./components/modals/AddMembersModal";
import { MyProfileModal } from "./components/modals/MyProfileModal";
import { ForwardModal } from "./components/modals/ForwardModal";
import { AuthScreen } from "./components/auth/AuthScreen";
import { CallOverlay } from "./components/call/CallOverlay";
import { SettingsModal } from "./components/settings/SettingsModal";
import { RightPanel } from "./components/chat/RightPanel";
import { BurgerMenu } from "./components/navigation/BurgerMenu";
import {
  ChatContextMenu,
  MessageContextMenu,
} from "./components/chat/ContextMenus";
import {
  normalizeFileUrl,
  getInitialLetter,
  hasUsableAvatar,
  escapeForRegex,
  mentionInsertText,
  downloadJsonFile,
  normalizeVolumeLevel,
  toMediaElementVolume,
  normalizeHexColor,
  hexToRgb,
  shiftHexColor,
  formatCallDuration,
  formatCallLogDuration,
  normalizeLegacyCallLogText,
  formatLastSeen,
  readAxiosMessage,
  getAxiosStatus,
} from "./utils/formatters";
import {
  URL_REGEX,
  MENTION_REGEX,
  getSiteName,
  getYouTubeVideoId,
  isYouTubeShortsUrl,
  getInstagramEmbedUrl,
  requestInlineLinkOpen,
} from "./utils/linkUtils";
import {
  buildMessagePreview,
  isImageFile,
  isVideoFile,
  isMusicFile,
  extractMusicTitle,
  parseMarkdownFormatting,
  renderTextWithLinks,
  renderMessage,
} from "./utils/messageUtils";
import {
  GlobalMusicController,
  MusicMessagePlayer,
  useMusicPlaybackState,
  sendMusicCommand,
} from "./components/media/MusicMessagePlayer";
import { VideoMessagePlayer } from "./components/media/VideoMessagePlayer";
import { AudioWaveformPlayer } from "./components/media/AudioWaveformPlayer";
import { LinkPreview } from "./components/media/LinkPreview";
import { FileMessageBubble } from "./components/media/FileMessageBubble";

const RNNOISE_WORKLET_PUBLIC_URL = "/rnnoise.worklet.js";

type AuthStep =
  | "login"
  | "register"
  | "verify"
  | "forgot"
  | "reset"
  | "login2fa";
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

type UpdateHistoryEntry = {
  version: string;
  notes: string;
  releasedAt: string;
  isLatest: boolean;
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
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `theme_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeThemePalette(
  raw: Partial<ThemePalette> | null | undefined,
): ThemePalette {
  return {
    accentColor: normalizeHexColor(
      raw?.accentColor,
      DEFAULT_THEME_PALETTE.accentColor,
    ),
    layoutColor: normalizeHexColor(
      raw?.layoutColor,
      DEFAULT_THEME_PALETTE.layoutColor,
    ),
    textColor: normalizeHexColor(
      raw?.textColor,
      DEFAULT_THEME_PALETTE.textColor,
    ),
    backgroundColor: normalizeHexColor(
      raw?.backgroundColor,
      DEFAULT_THEME_PALETTE.backgroundColor,
    ),
    inputColor: normalizeHexColor(
      raw?.inputColor,
      DEFAULT_THEME_PALETTE.inputColor,
    ),
  };
}

function parseThemeProfileFromUnknown(raw: unknown): LocalThemeProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const paletteCandidate =
    source.palette && typeof source.palette === "object"
      ? (source.palette as Partial<ThemePalette>)
      : (source as Partial<ThemePalette>);
  const palette = normalizeThemePalette(paletteCandidate);

  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim().slice(0, 60)
      : "Imported theme";

  return {
    id:
      typeof source.id === "string" && source.id.trim()
        ? source.id
        : createThemeProfileId(),
    name,
    palette,
    createdAt:
      typeof source.createdAt === "string" && source.createdAt
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

const copyImageToClipboard = async (url: string) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    toast.success("Rasm nusxalandi");
  } catch (err) {
    toast.error(
      "Nusxalashda xatolik: faqatgina text copy/paste orqali otishi mumkin",
    );
    console.error(err);
  }
};

const WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:mytelegramchat.ddns.net:3478" },
  {
    urls: "turn:mytelegramchat.ddns.net:3478",
    username: "chatturn",
    credential: "9Fzi61Srx5OU9isIoJ8vwJ7N",
  },
  {
    urls: "turn:mytelegramchat.ddns.net:3478?transport=tcp",
    username: "chatturn",
    credential: "9Fzi61Srx5OU9isIoJ8vwJ7N",
  },
  {
    urls: "turn:mytelegramchat.ddns.net:3478",
    username: "chatuser",
    credential: "ChatTurnPass2026",
  },
  {
    urls: "turn:mytelegramchat.ddns.net:3478?transport=tcp",
    username: "chatuser",
    credential: "ChatTurnPass2026",
  },
];

const FORCE_WEBRTC_RELAY = (() => {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem("webrtc_force_relay") === "true"
    );
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
const ACTIVE_CALL_RESUME_WINDOW_MS = 180_000; // resume only if call was active in the last 3 minutes

type ActiveCallState = {
  peerId: string; // userId for direct, groupId for group
  type: "direct" | "group";
  startedAt: number;
  lastTickAt: number; // updated periodically while in-call
};

function loadActiveCallState(): ActiveCallState | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_CALL_LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ActiveCallState;
    if (!v?.peerId || !v?.type) return null;
    return v;
  } catch {
    return null;
  }
}

function saveActiveCallState(state: ActiveCallState): void {
  try {
    window.localStorage.setItem(ACTIVE_CALL_LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function clearActiveCallState(): void {
  try {
    window.localStorage.removeItem(ACTIVE_CALL_LS_KEY);
  } catch {
    /* ignore */
  }
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

async function probeIceServer(
  server: RTCIceServer,
  timeoutMs = 5000,
): Promise<IceProbeResult> {
  const url = Array.isArray(server.urls)
    ? server.urls[0]
    : (server.urls as string);
  const start = Date.now();
  const types = new Set<string>();
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection({
      iceServers: [server],
      iceCandidatePoolSize: 0,
    });
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
    const ok = isStun
      ? types.has("srflx")
      : isTurn
        ? types.has("relay")
        : types.size > 0;
    return {
      url,
      ok,
      candidateTypes: Array.from(types),
      rttMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      url,
      ok: false,
      candidateTypes: Array.from(types),
      rttMs: Date.now() - start,
      error: String(err?.message || err),
    };
  } finally {
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
  }
}

async function probeAllIceServers(): Promise<IceProbeResult[]> {
  console.info(
    `[ICE-Probe] Boshlandi (${WEBRTC_ICE_SERVERS.length} ta server)`,
  );
  const results = await Promise.all(
    WEBRTC_ICE_SERVERS.map((s) => probeIceServer(s)),
  );
  results.forEach((r) => {
    console.info(
      `[ICE-Probe] ${r.ok ? "✅" : "❌"} ${r.url} types=[${r.candidateTypes.join(",")}] ${r.rttMs}ms${r.error ? ` err=${r.error}` : ""}`,
    );
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
  const turnWorks = probeResults.some(
    (r) => r.ok && (r.url.startsWith("turn:") || r.url.startsWith("turns:")),
  );
  const lsOverride = (() => {
    try {
      const v = window.localStorage.getItem("webrtc_force_relay");
      if (v === "true") return true;
      if (v === "false") return false;
      return null;
    } catch {
      return null;
    }
  })();
  // Priority: explicit user setting > env flag > default (all = prefer P2P)
  const useRelay = lsOverride !== null ? lsOverride : FORCE_WEBRTC_RELAY;
  if (useRelay) {
    console.info(
      `[RTC] iceTransportPolicy=relay (forceFlag=${FORCE_WEBRTC_RELAY} ls=${lsOverride})`,
    );
  } else {
    console.info(
      `[RTC] iceTransportPolicy=all — prefer P2P, TURN as fallback (turnWorks=${turnWorks})`,
    );
  }
  return {
    iceServers: sorted,
    iceCandidatePoolSize: 10,
    ...(useRelay
      ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy }
      : {}),
  };
}

function messageMentionsUser(
  messageText: string,
  me: PublicUser | null,
): boolean {
  if (!messageText || !me) return false;

  const legacyRegex = new RegExp(
    `@\\[[^\\]]+\\]\\(${escapeForRegex(me.id)}\\)`,
  );
  if (legacyRegex.test(messageText)) return true;

  const candidates = [me.username?.trim(), me.displayName?.trim()].filter(
    (v): v is string => Boolean(v),
  );
  for (const candidate of candidates) {
    const tokenRegex = new RegExp(
      `(^|\\s)@${escapeForRegex(candidate)}(?=$|\\s|[.,!?;:])`,
      "i",
    );
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
    case "update_restart":
      return "Suhbatdosh ilovasini yangilamoqda. Qayta ulanadi...";
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

function readNotificationTarget(
  extra: unknown,
): NotificationTarget | undefined {
  if (!extra || typeof extra !== "object") {
    return undefined;
  }

  const data = extra as Record<string, unknown>;
  if (
    data.chatMode === "user" &&
    typeof data.userId === "string" &&
    data.userId.trim()
  ) {
    return { chatMode: "user", userId: data.userId };
  }
  if (
    data.chatMode === "group" &&
    typeof data.groupId === "string" &&
    data.groupId.trim()
  ) {
    return { chatMode: "group", groupId: data.groupId };
  }

  return undefined;
}

const MOBILE_GOOGLE_AUTH_RETURN_TO =
  import.meta.env.VITE_MOBILE_DEEP_LINK_URL ?? "chatmobile://auth/google";
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

function App() {
  const [token, setToken] = useState<string | null>(() => readPersistedToken());
  const [isSessionBootstrapping, setIsSessionBootstrapping] = useState(() =>
    Boolean(readPersistedToken()),
  );
  const [sessionBootstrapError, setSessionBootstrapError] = useState<
    string | null
  >(null);
  const [sessionBootstrapNonce, setSessionBootstrapNonce] = useState(0);
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const [messageType, setMessageType] = useState<MessageType>("TEXT");
  const [messageText, setMessageText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [locationLat, setLocationLat] = useState("");
  const [locationLng, setLocationLng] = useState("");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [typingFromUserId, setTypingFromUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const hasSocketConnectedOnceRef = useRef(false);

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // ── APP LOCK / PASSCODE ──
  const [appLockEnabled, setAppLockEnabled] = useState(
    () => !!localStorage.getItem("app_lock_hash"),
  );
  const [appLocked, setAppLocked] = useState(
    () => !!localStorage.getItem("app_lock_hash"),
  );
  const [lockPasscodeInput, setLockPasscodeInput] = useState("");
  const [unlockKeyboardMode, setUnlockKeyboardMode] = useState<
    "numeric" | "text"
  >("numeric");
  const [autoLockEnabled, setAutoLockEnabled] = useState(
    () => localStorage.getItem("auto_lock") === "true",
  );
  const [autoLockMinutes, setAutoLockMinutes] = useState(() =>
    parseInt(localStorage.getItem("auto_lock_minutes") ?? "5", 10),
  );
  const autoLockTimerRef = useRef<number | null>(null);
  const lockPasscodeInputRef = useRef<HTMLInputElement | null>(null);

  // ── SETTINGS / NIGHT MODE ──
  const [showSettings, setShowSettings] = useState(false);
  const [nightMode] = useState(true);
  const [themeAccentColor, setThemeAccentColor] = useState(() =>
    normalizeHexColor(localStorage.getItem("theme_accent_color"), "#0e7c66"),
  );
  const [themeLayoutColor, setThemeLayoutColor] = useState(() =>
    normalizeHexColor(localStorage.getItem("theme_layout_color"), "#1e2c3a"),
  );
  const [themeTextColor, setThemeTextColor] = useState(() =>
    normalizeHexColor(localStorage.getItem("theme_text_color"), "#e1e8ef"),
  );
  const [themeBackgroundColor, setThemeBackgroundColor] = useState(() =>
    normalizeHexColor(
      localStorage.getItem("theme_background_color"),
      "#17212b",
    ),
  );
  const [themeInputColor, setThemeInputColor] = useState(() =>
    normalizeHexColor(localStorage.getItem("theme_input_color"), "#17212b"),
  );
  const [themeProfileName, setThemeProfileName] = useState("");
  const [localThemeProfiles, setLocalThemeProfiles] = useState<
    LocalThemeProfile[]
  >(() => readLocalThemeProfiles());
  const [communityThemeProfiles, setCommunityThemeProfiles] = useState<
    CommunityThemeProfile[]
  >([]);
  const [themeProfilesLoading, setThemeProfilesLoading] = useState(false);
  const [themeProfilesSharing, setThemeProfilesSharing] = useState(false);
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<Record<string, true>>(
    {},
  );
  const [startupEnabled, setStartupEnabledState] = useState(false);
  const [closeToTray, setCloseToTray] = useState(
    () => localStorage.getItem("close_to_tray") !== "false",
  );
  const [launchMinimizedOnStartup, setLaunchMinimizedOnStartup] = useState(
    () => localStorage.getItem("launch_minimized_on_startup") === "true",
  );
  const [toastPosition, setToastPositionState] = useState<
    "bottom-left" | "bottom-right"
  >("bottom-right");
  const [chatBackgroundImage, setChatBackgroundImage] = useState(
    () => localStorage.getItem("chat_bg_image") ?? "",
  );
  const [ringtoneUrl, setRingtoneUrl] = useState(
    () => getRingtoneSourceInfo().url,
  );
  const [ringtoneLabel, setRingtoneLabel] = useState(
    () => getRingtoneSourceInfo().label,
  );
  const [dialToneUrl, setDialToneUrl] = useState(
    () => getDialToneSourceInfo().url,
  );
  const [dialToneLabel, setDialToneLabel] = useState(
    () => getDialToneSourceInfo().label,
  );
  const [ringtoneUploading, setRingtoneUploading] = useState(false);
  const [dialToneUploading, setDialToneUploading] = useState(false);

  // ── CURSOR SETTINGS ──
  const [smoothCaret, setSmoothCaret] = useState(
    () => localStorage.getItem("smooth_caret") === "true",
  );
  const [cursorBlink, setCursorBlink] = useState(
    () => localStorage.getItem("cursor_blink") !== "false",
  );
  const [sendSound, setSendSound] = useState(
    () => localStorage.getItem("send_sound") !== "false",
  );

  // ── SAVED MESSAGES (now handled via self-chat) ──

  // ── CHAT ORDER & PIN/ARCHIVE ──
  const [chatOrder, setChatOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("chat_order") ?? "[]");
    } catch {
      return [];
    }
  });
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("pinned_chats") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [archivedChats, setArchivedChats] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("archived_chats") ?? "[]"),
      );
    } catch {
      return new Set();
    }
  });
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    chatId: string;
    type: "user" | "group";
  } | null>(null);
  const [msgContextMenu, setMsgContextMenu] = useState<{
    x: number;
    y: number;
    message: Message | GroupMessage;
    isGroup: boolean;
  } | null>(null);
  const [messageReactions, setMessageReactions] = useState<
    Record<string, Record<string, string[]>>
  >(() => {
    try {
      const raw = localStorage.getItem("chat_message_reactions");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>(
    {},
  );
  const [showMyProfile, setShowMyProfile] = useState(false);

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
  const dialToneFileInputRef = useRef<HTMLInputElement>(null);

  // ── TEXT FORMATTING TOOLBAR STATE ──
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const [showLinkPrompt, setShowLinkPrompt] = useState(false);
  const [linkInputUrl, setLinkInputUrl] = useState("https://");

  // ── USER PROFILE VIEW (popup for any user) ──
  const [profileViewUser, setProfileViewUser] = useState<PublicUser | null>(
    null,
  );

  // ── SHIFT+CLICK SELECTION ──
  const lastSelectedIndexRef = useRef<number | null>(null);


  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number | null>(null);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>([]);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    messageIds: string[];
    canDeleteForEveryone: boolean;
    recipientName: string;
    isGroup: boolean;
  } | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callPeerId, setCallPeerId] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [screenFullscreen, setScreenFullscreen] = useState(false);
  const [localScreenFullscreen, setLocalScreenFullscreen] = useState(false);
  const [callMinimized, setCallMinimized] = useState(false);
  const [callMicMuted, setCallMicMuted] = useState(false);
  const [iceProbeResults, setIceProbeResults] = useState<IceProbeResult[]>(() =>
    loadIceProbeResults(),
  );
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
    isReconnecting: boolean;
  }>({
    upKbps: 0,
    downKbps: 0,
    rttMs: null,
    lossPct: null,
    durationSec: 0,
    jitterMs: null,
    codec: null,
    iceState: "new",
    connState: "new",
    bytesSentTotal: 0,
    bytesRecvTotal: 0,
    isReconnecting: false,
  });
  const [callEvents, setCallEvents] = useState<
    { t: number; msg: string; level: "info" | "warn" | "ok" | "err" }[]
  >([]);
  const callEventsRef = useRef<
    { t: number; msg: string; level: "info" | "warn" | "ok" | "err" }[]
  >([]);
  const pushCallEvent = useCallback(
    (msg: string, level: "info" | "warn" | "ok" | "err" = "info") => {
      const next = [
        ...callEventsRef.current,
        { t: Date.now(), msg, level },
      ].slice(-40);
      callEventsRef.current = next;
      setCallEvents(next);
      console.info(`[CallEvent][${level}] ${msg}`);
    },
    [],
  );
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(
    null,
  );
  const [desktopInlineNotifications, setDesktopInlineNotifications] = useState<
    DesktopInlineNotification[]
  >([]);

  // ── AUDIO DEVICE SELECTION ──
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [audioOutputDevices, setAudioOutputDevices] = useState<
    MediaDeviceInfo[]
  >([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(
    () => localStorage.getItem("audio_input") ?? "",
  );
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(
    () => localStorage.getItem("audio_output") ?? "",
  );
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [noiseReduction, setNoiseReduction] = useState<boolean>(() => {
    const saved = localStorage.getItem("noise_reduction");
    return saved ? saved === "true" : true;
  });
  const [micVolume, setMicVolume] = useState<number>(() =>
    normalizeVolumeLevel(parseFloat(localStorage.getItem("mic_volume") ?? "1")),
  );
  const [speakerVolume, setSpeakerVolume] = useState<number>(() =>
    normalizeVolumeLevel(
      parseFloat(localStorage.getItem("speaker_volume") ?? "1"),
    ),
  );
  const [isMicTesting, setIsMicTesting] = useState(false);
  const rnnoiseAssetsRef = useRef<any>(null);

  useEffect(() => {
    const initPurify = async () => {
      try {
        const response = await fetch(rnnoiseWasmUrl);
        const buffer = await response.arrayBuffer();
        const wasmModule = await WebAssembly.compile(buffer);
        rnnoiseAssetsRef.current = [
          RNNOISE_WORKLET_PUBLIC_URL,
          Promise.resolve(wasmModule),
        ];
        console.log("RNNoise (WASM Wrapper) Initialized!");
      } catch (err: any) {
        console.error("RNNoise init error:", err);
      }
    };
    initPurify();
  }, []);

  // ── GROUP STATE ──
  const [chatMode, setChatMode] = useState<ChatMode>("user");
  const chatModeRef = useRef(chatMode);
  chatModeRef.current = chatMode;
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("contacts");
  const [mobileBottomTab, setMobileBottomTab] =
    useState<MobileBottomTab>("chats");
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const isMobileChatOpenRef = useRef(isMobileChatOpen);
  isMobileChatOpenRef.current = isMobileChatOpen;
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false,
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
  const [groupTypingUserId, setGroupTypingUserId] = useState<string | null>(
    null,
  );

  // ── GROUP CALL PARTICIPANTS ──
  const [groupCallParticipants, setGroupCallParticipants] = useState<
    { userId: string; speaking: boolean }[]
  >([]);
  const [groupActiveCallUsers, setGroupActiveCallUsers] = useState<
    Record<string, string[]>
  >({});
  const [participantVolumes, setParticipantVolumes] = useState<
    Record<string, number>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("participant_volumes") ?? "{}");
    } catch {
      return {};
    }
  });
  const participantVolumesRef = useRef<Record<string, number>>(participantVolumes);
  participantVolumesRef.current = participantVolumes;
  const [participantLatencyMs, setParticipantLatencyMs] = useState<
    Record<string, number>
  >({});
  const vadIntervalRef = useRef<number | null>(null);
  const wasSpeakingRef = useRef(false);

  // ── AUTO-UPDATE STATE ──
  const [updateAvailable, setUpdateAvailable] = useState<{
    newVersion: string;
    notes: string;
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSpeedMbps, setUpdateSpeedMbps] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState("...");
  const appVersionRef = useRef("...");
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(
    () => localStorage.getItem("auto_update") !== "false",
  );
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>([]);
  const [selectedUpdateVersion, setSelectedUpdateVersion] = useState("");
  const [isLoadingUpdateHistory, setIsLoadingUpdateHistory] = useState(false);
  const selectedUpdateHistoryItem = useMemo(
    () =>
      updateHistory.find((item) => item.version === selectedUpdateVersion) ??
      null,
    [selectedUpdateVersion, updateHistory],
  );

  const loadUpdateHistory = useCallback(async () => {
    setIsLoadingUpdateHistory(true);
    try {
      const result: any = await GetUpdateHistory();
      const versions: UpdateHistoryEntry[] = Array.isArray(result?.versions)
        ? result.versions
            .filter((item: any) => item && typeof item.version === "string")
            .map((item: any) => ({
              version: String(item.version),
              notes: typeof item.notes === "string" ? item.notes : "",
              releasedAt:
                typeof item.releasedAt === "string" ? item.releasedAt : "",
              isLatest: Boolean(item.isLatest),
            }))
        : [];

      setUpdateHistory(versions);
      setSelectedUpdateVersion((current) => {
        if (
          current &&
          versions.some((item: UpdateHistoryEntry) => item.version === current)
        ) {
          return current;
        }
        return versions[0]?.version ?? "";
      });
    } catch {
      setUpdateHistory([]);
      setSelectedUpdateVersion("");
    } finally {
      setIsLoadingUpdateHistory(false);
    }
  }, []);

  // ── RESIZABLE SIDEBAR ──
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    parseInt(localStorage.getItem("sidebar_width") ?? "340", 10),
  );
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
  const groupPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(
    new Map(),
  );
  const groupPeerStatsTimersRef = useRef<Map<string, number>>(new Map());
  const groupRemoteDescriptionSetRef = useRef<Map<string, boolean>>(new Map());
  const groupRemoteIceCandidatesBufferRef = useRef<
    Map<string, RTCIceCandidateInit[]>
  >(new Map());
  const groupRemoteAudioTracksRef = useRef<Map<string, MediaStreamTrack>>(
    new Map(),
  );
  const groupRemoteAudioStreamRef = useRef<MediaStream | null>(null);
  const groupParticipantAudiosRef = useRef<Map<string, HTMLAudioElement>>(
    new Map(),
  );
  const groupAudioContextRef = useRef<AudioContext | null>(null);
  const groupAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(
    null,
  );
  const groupAudioMasterGainRef = useRef<GainNode | null>(null);
  const groupAudioSilentGainRef = useRef<GainNode | null>(null);
  const groupAudioNodesRef = useRef<
    Map<
      string,
      {
        source: MediaStreamAudioSourceNode;
        gain: GainNode;
        stream: MediaStream;
        track: MediaStreamTrack;
      }
    >
  >(new Map());
  const callDisconnectedTimerRef = useRef<number | null>(null);
  const callStartTsRef = useRef<number>(0);
  const startCallRef = useRef<
    ((overridePeerId?: string) => Promise<void>) | null
  >(null);
  const stopCallRef = useRef<
    ((keepRemoteState?: boolean, keepPersistentState?: boolean) => void) | null
  >(null);
  const autoResumeAttemptedRef = useRef<boolean>(false);
  const defaultThemeAppliedRef = useRef<boolean>(false);
  const callStatsPrevRef = useRef<{
    ts: number;
    bytesSent: number;
    bytesRecv: number;
    packetsLost: number;
    packetsRecv: number;
  } | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteIceCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const googleAuthStateRef = useRef<string | null>(
    localStorage.getItem("pending_google_auth_state"),
  );
  const themeProfileImportInputRef = useRef<HTMLInputElement | null>(null);
  const googleAuthPollIntervalRef = useRef<number | null>(null);
  const googleAuthTimeoutRef = useRef<number | null>(null);
  const googleAuthPollInFlightRef = useRef(false);
  const stopGoogleLoginPollingFnRef = useRef<(clearState?: boolean) => void>(
    () => {},
  );
  const startGoogleLoginPollingFnRef = useRef<(state: string) => void>(
    () => {},
  );
  const pollGoogleLoginOnceFnRef = useRef<
    (stateOverride?: string) => Promise<boolean>
  >(async () => false);
  const isAppActiveRef = useRef(true);
  const mobileCallNotificationsReadyRef = useRef(false);
  const mobileMessageNotificationIdRef = useRef(300000);
  const mobileUpdateNotificationIdRef = useRef(910000);
  const autoUpdateTriggeredVersionRef = useRef<string | null>(null);
  const scrollHideTimerRef = useRef<number | null>(null);
  const notificationAudioCtxRef = useRef<AudioContext | null>(null);
  const lastDesktopNotifSoundAtRef = useRef(0);
  const desktopNotifTimersRef = useRef<number[]>([]);
  const pendingCallActionHandlerRef = useRef<
    (action: "accept" | "decline", userId?: string) => void
  >(() => {});

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
      // Stay passive here: just list devices.
      // Mic permission is requested only when a call or mic test actually needs it.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);

      // Selected output can become stale (USB/Bluetooth unplugged). Reset to default when missing.
      if (
        selectedAudioOutput &&
        !outputs.some((d) => d.deviceId === selectedAudioOutput)
      ) {
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
    navigator.mediaDevices.addEventListener(
      "devicechange",
      enumerateAudioDevices,
    );
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        enumerateAudioDevices,
      );
    };
  }, [enumerateAudioDevices]);

  // Apply output device to <audio> elements
  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (
      audio &&
      selectedAudioOutput &&
      typeof (audio as any).setSinkId === "function"
    ) {
      (audio as any).setSinkId(selectedAudioOutput).catch((err: Error) => {
        console.error("Cannot set audio output device:", err);
        setSelectedAudioOutput("");
        localStorage.removeItem("audio_output");
      });
    }
    groupParticipantAudiosRef.current.forEach((participantAudio) => {
      if (
        selectedAudioOutput &&
        typeof (participantAudio as any).setSinkId === "function"
      ) {
        (participantAudio as any)
          .setSinkId(selectedAudioOutput)
          .catch(() => {});
      }
    });
  }, [selectedAudioOutput]);

  // Apply speaker volume to remote audio elements (direct and group participants)
  useEffect(() => {
    const nextVolume = toMediaElementVolume(speakerVolume);
    const audio = remoteAudioRef.current;
    if (audio) audio.volume = nextVolume;
    groupParticipantAudiosRef.current.forEach((participantAudio, uid) => {
      const userVol = (participantVolumes[uid] ?? 100) / 100;
      participantAudio.volume = Math.max(0, Math.min(1, userVol * nextVolume));
    });
  }, [speakerVolume, participantVolumes]);

  // ── Sidebar resize handler ──
  const handleSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [sidebarWidth],
  );

  // Play call sounds based on status
  useEffect(() => {
    if (callStatus === "ringing") {
      startRingtone();
    } else if (callStatus === "calling") {
      startDialTone();
    } else {
      stopAllCallSounds();
    }
    return () => {
      stopAllCallSounds();
    };
  }, [callStatus]);

  // ── Call stats polling: bitrate up/down, RTT, packet loss, duration ──
  useEffect(() => {
    if (callStatus !== "in-call") {
      callStartTsRef.current = 0;
      callStatsPrevRef.current = null;
      setCallStats({
        upKbps: 0,
        downKbps: 0,
        rttMs: null,
        lossPct: null,
        durationSec: 0,
        jitterMs: null,
        codec: null,
        iceState: "new",
        connState: "new",
        bytesSentTotal: 0,
        bytesRecvTotal: 0,
        isReconnecting: false,
      });
      return;
    }
    if (!callStartTsRef.current) callStartTsRef.current = Date.now();

    const tick = async () => {
      try {
        const peers: RTCPeerConnection[] = [];
        if (peerConnectionRef.current) peers.push(peerConnectionRef.current);
        groupPeerConnectionsRef.current.forEach((pc) => peers.push(pc));
        if (peers.length === 0) {
          if (callGroupIdRef.current) {
            setCallStats((prev) => ({
              ...prev,
              upKbps: 0,
              downKbps: 0,
              rttMs: null,
              lossPct: null,
              jitterMs: null,
              iceState: "new",
              connState: "new",
              isReconnecting: false,
            }));
          }
          return;
        }

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
            if (r.type === "codec" && r.mimeType)
              codecMap.set(r.id, r.mimeType);
          });
          stats.forEach((r: any) => {
            if (r.type === "outbound-rtp" && r.kind === "audio") {
              if (typeof r.bytesSent === "number") bytesSent += r.bytesSent;
            }
            if (r.type === "inbound-rtp" && r.kind === "audio") {
              if (typeof r.bytesReceived === "number")
                bytesRecv += r.bytesReceived;
              if (typeof r.packetsLost === "number")
                packetsLost += r.packetsLost;
              if (typeof r.packetsReceived === "number")
                packetsRecv += r.packetsReceived;
              if (
                typeof r.jitter === "number" &&
                (jitterSec == null || r.jitter > jitterSec)
              )
                jitterSec = r.jitter;
              if (!codecHolder.mime && r.codecId && codecMap.has(r.codecId))
                codecHolder.mime = codecMap.get(r.codecId) ?? null;
            }
            if (
              r.type === "candidate-pair" &&
              r.state === "succeeded" &&
              (r.nominated || r.selected)
            ) {
              if (typeof r.currentRoundTripTime === "number")
                rttSec = r.currentRoundTripTime;
            }
            if (
              rttSec == null &&
              r.type === "remote-inbound-rtp" &&
              typeof r.roundTripTime === "number"
            ) {
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
            upKbps = Math.max(
              0,
              ((bytesSent - prev.bytesSent) * 8) / 1000 / dt,
            );
            downKbps = Math.max(
              0,
              ((bytesRecv - prev.bytesRecv) * 8) / 1000 / dt,
            );
          }
        }
        callStatsPrevRef.current = {
          ts: now,
          bytesSent,
          bytesRecv,
          packetsLost,
          packetsRecv,
        };

        const totalRecv = packetsRecv + packetsLost;
        const lossPct = totalRecv > 0 ? (packetsLost / totalRecv) * 100 : null;
        const durationSec = Math.floor((now - callStartTsRef.current) / 1000);

        const isGroupCall = Boolean(callGroupIdRef.current);
        const primaryIceState = peers[0]?.iceConnectionState ?? "new";
        const primaryConnState = peers[0]?.connectionState ?? "new";

        const isIceConnected = peers.some(
          (pc) =>
            pc.iceConnectionState === "connected" ||
            pc.iceConnectionState === "completed",
        );
        const isConnDisconnected =
          primaryIceState === "disconnected" ||
          primaryIceState === "failed" ||
          primaryConnState === "disconnected" ||
          primaryConnState === "failed";
        const isSocketOk = socketRef.current ? socketRef.current.connected : true;
        const isOnline = navigator.onLine;

        // In a group call: reconnection is ONLY relevant if the user's socket or internet is down.
        // In a direct call: reconnection is when socket/net is down, or an established connection disconnected/failed.
        const isReconnecting = isGroupCall
          ? (!isSocketOk || !isOnline)
          : (!isSocketOk || !isOnline || isConnDisconnected);

        // When internet or socket is down, or direct call connection actually dropped
        if (!isSocketOk || !isOnline || (!isGroupCall && isConnDisconnected)) {
          upKbps = 0;
          downKbps = 0;
          rttSec = null;
        }

        setCallStats({
          upKbps: Math.round(upKbps * 10) / 10,
          downKbps: Math.round(downKbps * 10) / 10,
          rttMs: rttSec != null ? Math.round(rttSec * 1000) : null,
          lossPct: lossPct != null ? Math.round(lossPct * 100) / 100 : null,
          durationSec,
          jitterMs:
            jitterSec != null ? Math.round((jitterSec as number) * 1000) : null,
          codec: codecHolder.mime
            ? codecHolder.mime.replace(/^audio\//, "")
            : null,
          iceState: primaryIceState,
          connState: primaryConnState,
          bytesSentTotal: bytesSent,
          bytesRecvTotal: bytesRecv,
          isReconnecting,
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
      console.info(
        `[ICE-Probe] Cached natija ishlatildi (${Math.round(ageMs / 60000)}m oldin)`,
        cached,
      );
      return;
    }
    setIceProbing(true);
    probeAllIceServers()
      .then((res) => {
        setIceProbeResults(res);
        localStorage.setItem("ice_probe_at", String(Date.now()));
        const okCount = res.filter((r) => r.ok).length;
        if (okCount === 0) {
          toast.error(
            "Hech qaysi ICE server ishlamadi! Internet/firewall tekshiring.",
          );
        } else {
          console.info(`[ICE-Probe] ${okCount}/${res.length} server ishlaydi`);
        }
      })
      .finally(() => setIceProbing(false));
  }, []);

  const activeUser = useMemo(
    () => (users ?? []).find((item) => item.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const activeGroup = useMemo(
    () => (groups ?? []).find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
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
    return (
      activeGroup.members?.find((member) => member.userId === currentUser.id)
        ?.role ?? null
    );
  }, [activeGroup, currentUser]);

  const canManageGroupMembers =
    myGroupRole === "OWNER" || myGroupRole === "ADMIN";
  const canAssignGroupAdmins = myGroupRole === "OWNER";

  useEffect(() => {
    setEditGroupName(activeGroup?.name ?? "");
  }, [activeGroup?.id, activeGroup?.name]);

  const isWails = isWailsRuntime;
  const updateActionLabel = isNativeMobileRuntime ? "Download APK" : "Update";

  // ── AUTO-SCROLL TO BOTTOM ──
  const scrollToBottom = useCallback((smooth = false) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView(
        smooth ? { behavior: "smooth" } : undefined,
      );
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
  useEffect(() => {
    scrollToBottom();
  }, [selectedUserId, scrollToBottom]);
  useEffect(() => {
    scrollToBottom();
  }, [selectedGroupId, scrollToBottom]);

  // Desktop UX: focus composer after chat selection.
  useEffect(() => {
    if (isMobileViewport || !token || appLocked) return;
    const hasSelectedChat =
      chatMode === "group" ? Boolean(selectedGroupId) : Boolean(selectedUserId);
    if (!hasSelectedChat) return;

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    selectedUserId,
    selectedGroupId,
    chatMode,
    isMobileViewport,
    token,
    appLocked,
  ]);

  useEffect(() => {
    let browserFinishedHandle: PluginListenerHandle | undefined;
    let appResumeHandle: PluginListenerHandle | undefined;
    let appUrlOpenHandle: PluginListenerHandle | undefined;

    const resumeGoogleAuth = (stateOverride?: string | null) => {
      const nextState = stateOverride ?? googleAuthStateRef.current;
      if (nextState) {
        const startedAtRaw = localStorage.getItem(
          GOOGLE_AUTH_STATE_STARTED_AT_KEY,
        );
        const startedAt = startedAtRaw ? Number(startedAtRaw) : NaN;
        if (
          !Number.isFinite(startedAt) ||
          Date.now() - startedAt > GOOGLE_AUTH_STATE_TTL_MS
        ) {
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
      const startedAtRaw = localStorage.getItem(
        GOOGLE_AUTH_STATE_STARTED_AT_KEY,
      );
      const startedAt = startedAtRaw ? Number(startedAtRaw) : NaN;
      if (
        !Number.isFinite(startedAt) ||
        Date.now() - startedAt > GOOGLE_AUTH_STATE_TTL_MS
      ) {
        stopGoogleLoginPollingFnRef.current();
        setGoogleAuthLoading(false);
      } else {
        setGoogleAuthLoading(true);
        startGoogleLoginPollingFnRef.current(googleAuthStateRef.current);
        void pollGoogleLoginOnceFnRef.current(googleAuthStateRef.current);
      }
    }

    if (isNativeMobileRuntime) {
      Browser.addListener("browserFinished", resumeGoogleAuth)
        .then((handle) => {
          browserFinishedHandle = handle;
        })
        .catch(() => {});

      CapacitorApp.addListener("resume", resumeGoogleAuth)
        .then((handle) => {
          appResumeHandle = handle;
        })
        .catch(() => {});

      CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        if (
          !url ||
          !url
            .toLowerCase()
            .startsWith(MOBILE_GOOGLE_AUTH_RETURN_TO.toLowerCase())
        ) {
          return;
        }
        try {
          const deepLinkUrl = new URL(url);
          resumeGoogleAuth(deepLinkUrl.searchParams.get("state"));
        } catch {
          resumeGoogleAuth();
        }
      })
        .then((handle) => {
          appUrlOpenHandle = handle;
        })
        .catch(() => {});
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
    root.style.setProperty(
      "--custom-accent-strong",
      shiftHexColor(accent, -24),
    );
    root.style.setProperty(
      "--custom-accent-light",
      accentRgb
        ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.15)`
        : "rgba(14, 124, 102, 0.15)",
    );

    root.style.setProperty("--custom-dark-bg", bg);
    root.style.setProperty("--custom-dark-panel", layout);
    root.style.setProperty(
      "--custom-dark-panel-hover",
      shiftHexColor(layout, 12),
    );
    root.style.setProperty("--custom-dark-line", shiftHexColor(layout, 20));
    root.style.setProperty("--custom-dark-text", text);
    root.style.setProperty(
      "--custom-dark-muted",
      textRgb
        ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.65)`
        : "#8899a6",
    );
    root.style.setProperty(
      "--custom-dark-bubble-theirs",
      shiftHexColor(layout, 14),
    );

    root.style.setProperty("--custom-light-bg", bg);
    root.style.setProperty("--custom-light-panel", layout);
    root.style.setProperty(
      "--custom-light-panel-hover",
      shiftHexColor(layout, 10),
    );
    root.style.setProperty("--custom-light-line", shiftHexColor(layout, -12));
    root.style.setProperty("--custom-light-text", text);
    root.style.setProperty(
      "--custom-light-muted",
      textRgb
        ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.68)`
        : "#65676b",
    );
    root.style.setProperty(
      "--custom-light-bubble-theirs",
      shiftHexColor(layout, -8),
    );
    root.style.setProperty("--custom-light-bubble-theirs-text", text);
    root.style.setProperty("--custom-dark-input-bg", input);
    root.style.setProperty("--custom-light-input-bg", input);

    const captionColor = nightMode ? layout : shiftHexColor(layout, 6);
    const captionTextColor = nightMode ? text : shiftHexColor(text, -36);
    SetWindowCaptionTheme(captionColor, captionTextColor, nightMode).catch(
      () => {},
    );

    localStorage.setItem("theme_accent_color", accent);
    localStorage.setItem("theme_layout_color", layout);
    localStorage.setItem("theme_text_color", text);
    localStorage.setItem("theme_background_color", bg);
    localStorage.setItem("theme_input_color", input);
  }, [
    themeAccentColor,
    themeLayoutColor,
    themeTextColor,
    themeBackgroundColor,
    themeInputColor,
    nightMode,
  ]);

  const getCurrentThemePalette = useCallback(
    (): ThemePalette => ({
      accentColor: normalizeHexColor(
        themeAccentColor,
        DEFAULT_THEME_PALETTE.accentColor,
      ),
      layoutColor: normalizeHexColor(
        themeLayoutColor,
        DEFAULT_THEME_PALETTE.layoutColor,
      ),
      textColor: normalizeHexColor(
        themeTextColor,
        DEFAULT_THEME_PALETTE.textColor,
      ),
      backgroundColor: normalizeHexColor(
        themeBackgroundColor,
        DEFAULT_THEME_PALETTE.backgroundColor,
      ),
      inputColor: normalizeHexColor(
        themeInputColor,
        DEFAULT_THEME_PALETTE.inputColor,
      ),
    }),
    [
      themeAccentColor,
      themeLayoutColor,
      themeTextColor,
      themeBackgroundColor,
      themeInputColor,
    ],
  );

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
      localStorage.setItem(
        THEME_PROFILES_STORAGE_KEY,
        JSON.stringify(localThemeProfiles),
      );
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
        const res = await api.get<{ profiles: CommunityThemeProfile[] }>(
          "/users/theme-profiles",
          {
            params: { limit: 80 },
          },
        );
        if (!cancelled) {
          setCommunityThemeProfiles(
            Array.isArray(res.data?.profiles) ? res.data.profiles : [],
          );
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
        const res = await api.get<{ profiles: CommunityThemeProfile[] }>(
          "/users/theme-profiles",
          {
            params: { limit: 1 },
          },
        );
        const profile = Array.isArray(res.data?.profiles)
          ? res.data.profiles[0]
          : null;
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

  const saveCurrentThemeProfileLocally = useCallback(() => {
    const name =
      themeProfileName.trim() || `Theme ${localThemeProfiles.length + 1}`;
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
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { profiles?: unknown[] }).profiles)
          ? (parsed as { profiles: unknown[] }).profiles
          : [parsed];

      const imported = incomingRaw
        .map(parseThemeProfileFromUnknown)
        .filter((p): p is LocalThemeProfile => Boolean(p))
        .map((p) => ({
          ...p,
          id: createThemeProfileId(),
          createdAt: new Date().toISOString(),
        }));

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
      const res = await api.post<{ profile: CommunityThemeProfile }>(
        "/users/theme-profiles",
        payload,
      );
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
      const escaped = chatBackgroundImage.replace(/"/g, '\\"');
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

    const passiveCapture: AddEventListenerOptions = {
      passive: true,
      capture: true,
    };
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
    GetAppVersionInfo()
      .then((v: string) => {
        setAppVersion(v);
        appVersionRef.current = v;
      })
      .catch(() => {});

    const runUpdateCheck = () => {
      if (localStorage.getItem("auto_update") !== "false") {
        CheckForUpdate()
          .then((result: any) => {
            if (result?.available) {
              setUpdateAvailable({
                newVersion: result.newVersion,
                notes: result.notes || "",
              });
            }
          })
          .catch(() => {});
      }
    };

    runUpdateCheck();

    const handleVisibility = () => {
      if (!document.hidden) runUpdateCheck();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ── LOAD STARTUP STATE & SYNC CLOSE-TO-TRAY ──
  useEffect(() => {
    if (isWails) {
      GetStartupEnabled()
        .then(setStartupEnabledState)
        .catch(() => {});
      // Sync close-to-tray setting with Wails backend
      const savedCloseToTray =
        localStorage.getItem("close_to_tray") !== "false";
      SetCloseToTray(savedCloseToTray).catch(() => {});
      SetStartupLaunchMinimized(launchMinimizedOnStartup).catch(() => {});

      // ── AUTO-UPDATE CHECK ──
      GetAppVersionInfo()
        .then((v: string) => {
          setAppVersion(v);
          appVersionRef.current = v;
        })
        .catch(() => {});
      const runUpdateCheck = () => {
        if (localStorage.getItem("auto_update") !== "false") {
          CheckForUpdate()
            .then((result: any) => {
              if (result?.available) {
                setUpdateAvailable({
                  newVersion: result.newVersion,
                  notes: result.notes || "",
                });
              }
            })
            .catch(() => {});
        }
      };
      runUpdateCheck();
      void loadUpdateHistory();

      // Re-check update when window is restored from tray
      const handleVisibility = () => {
        if (!document.hidden) runUpdateCheck();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      return () =>
        document.removeEventListener("visibilitychange", handleVisibility);
    }
  }, [isWails, loadUpdateHistory]);

  // ── CLEANUP CALL ON WINDOW CLOSE ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (
        callStatusRef.current !== "idle" &&
        socketRef.current &&
        callPeerIdRef.current
      ) {
        socketRef.current.emit("call:end", {
          recipientId: callPeerIdRef.current,
          reason: "window-unload",
        });
      }
      silentCallCleanup(
        peerConnectionRef,
        localCallStreamRef,
        localScreenStreamRef,
      );
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

  const toggleStartup = async () => {
    if (!isWails) return;
    const next = !startupEnabled;
    try {
      const result = await SetStartupEnabled(next, launchMinimizedOnStartup);
      setStartupEnabledState(result);
      toast.success(
        next ? "Launch at startup enabled" : "Launch at startup disabled",
      );
    } catch {
      toast.error("Settings error");
    }
  };

  const toggleLaunchMinimizedOnStartup = async () => {
    if (!isWails) return;
    const next = !launchMinimizedOnStartup;
    setLaunchMinimizedOnStartup(next);
    localStorage.setItem("launch_minimized_on_startup", String(next));
    try {
      const result = await SetStartupLaunchMinimized(next);
      if (startupEnabled) {
        setStartupEnabledState(await SetStartupEnabled(true, next));
      }
      toast.success(
        result
          ? next
            ? "Startup will open minimized"
            : "Startup will open normally"
          : "Settings error",
      );
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
  }, []);

  const clearSession = useCallback(() => {
    if (isNativeMobileRuntime) {
      const savedPushToken = localStorage.getItem(MOBILE_PUSH_TOKEN_KEY);
      if (savedPushToken) {
        api
          .delete("/users/push-token", { data: { token: savedPushToken } })
          .catch(() => {});
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

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const msg =
        customEvent.detail?.message ||
        "Sessiya eskirgan yoki bekor qilingan. Iltimos, qaytadan kiring.";
      toast.error(msg);
      clearSession();
    };

    window.addEventListener("chat:auth:expired", handleAuthExpired);
    return () => {
      window.removeEventListener("chat:auth:expired", handleAuthExpired);
    };
  }, [clearSession]);

  // ── GOOGLE SIGN-IN (Browser-based OAuth2 flow) ──
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);

  const clearPendingGoogleAuthState = useCallback(() => {
    googleAuthStateRef.current = null;
    localStorage.removeItem("pending_google_auth_state");
    localStorage.removeItem(GOOGLE_AUTH_STATE_STARTED_AT_KEY);
  }, []);

  const stopGoogleLoginPolling = useCallback(
    (clearState = true) => {
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
    },
    [clearPendingGoogleAuthState],
  );

  const completeGoogleLogin = useCallback(
    (nextToken: string, user: PublicUser) => {
      stopGoogleLoginPolling();
      applySession(nextToken, user);
      toast.success("Google orqali kirildi!");
      setGoogleAuthLoading(false);
    },
    [applySession, stopGoogleLoginPolling],
  );

  const pollGoogleLoginOnce = useCallback(
    async (stateOverride?: string) => {
      const state = stateOverride ?? googleAuthStateRef.current;
      if (!state || googleAuthPollInFlightRef.current) {
        return false;
      }

      googleAuthPollInFlightRef.current = true;
      try {
        const pollResp = await api.get<{
          ready: boolean;
          token?: string;
          user?: PublicUser;
          expired?: boolean;
        }>(`/auth/google/poll?state=${state}`);
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
    },
    [completeGoogleLogin, stopGoogleLoginPolling],
  );

  const startGoogleLoginPolling = useCallback(
    (state: string) => {
      googleAuthStateRef.current = state;
      localStorage.setItem("pending_google_auth_state", state);
      localStorage.setItem(
        GOOGLE_AUTH_STATE_STARTED_AT_KEY,
        String(Date.now()),
      );

      if (googleAuthPollIntervalRef.current) {
        window.clearInterval(googleAuthPollIntervalRef.current);
      }
      googleAuthPollIntervalRef.current = window.setInterval(() => {
        void pollGoogleLoginOnce(state);
      }, 1500);

      if (googleAuthTimeoutRef.current) {
        window.clearTimeout(googleAuthTimeoutRef.current);
      }
      googleAuthTimeoutRef.current = window.setTimeout(
        () => {
          if (googleAuthStateRef.current === state) {
            stopGoogleLoginPolling();
            setGoogleAuthLoading(false);
            toast.error("Google login vaqti tugadi.");
          }
        },
        2 * 60 * 1000,
      );
    },
    [pollGoogleLoginOnce, stopGoogleLoginPolling],
  );

  const startGoogleLogin = useCallback(async () => {
    setGoogleAuthLoading(true);
    stopGoogleLoginPolling();
    try {
      const resp = await api.get<{ url: string; state: string }>(
        "/auth/google/desktop",
        {
          params: isNativeMobileRuntime
            ? { returnTo: MOBILE_GOOGLE_AUTH_RETURN_TO }
            : undefined,
        },
      );
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

  const handleUpdateInstall = useCallback(
    async (targetVersion = "", allowSameVersion = false) => {
      // ⚠️ DO NOT drop call here! User can continue talking while downloading!
      setIsUpdating(true);
      setUpdateProgress(0);
      setUpdateSpeedMbps(null);
      if (callStatusRef.current !== "idle") {
        toast("Yangilanish yuklab olinmoqda... Qo'ng'iroq davom etadi.");
      }
      try {
        const result: any = await DownloadAndUpdate(
          targetVersion,
          allowSameVersion,
        );
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
          return;
        }

        // ✅ Download complete! Disconnect right before install & save state for auto-recall
        if (callStatusRef.current !== "idle") {
          const peerId = callPeerIdRef.current;
          const groupId = callGroupIdRef.current;
          if (peerId) {
            saveActiveCallState({
              peerId,
              type: groupId ? "group" : "direct",
              startedAt: Date.now(),
              lastTickAt: Date.now(),
            });
            if (socketRef.current) {
              if (groupId) {
                socketRef.current.emit("group:call:leave", { groupId });
              } else {
                socketRef.current.emit("call:end", {
                  recipientId: peerId,
                  reason: "update_restart",
                });
              }
            }
          }
          stopCallRef.current?.(true, true);
          toast("Ilova yangilanmoqda va qayta ishga tushmoqda. Qo'ng'iroq qayta ulanadi...");
        }
      } catch {
        toast.error("Update error");
        setIsUpdating(false);
        setUpdateProgress(0);
        setUpdateSpeedMbps(null);
      }
    },
    [],
  );

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
    void handleUpdateInstall(updateAvailable.newVersion);
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
      const activeNotifications = delivered.notifications.filter(
        (item) => item.id === MOBILE_CALL_NOTIFICATION_ID,
      );
      if (activeNotifications.length > 0) {
        await LocalNotifications.removeDeliveredNotifications({
          notifications: activeNotifications,
        });
      }
    } catch (error) {
      console.warn("[Mobile] notification cleanup failed:", error);
    }
  }, []);

  const showMobileIncomingCallNotification = useCallback(
    async (title: string, body: string, callerName: string) => {
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
    },
    [clearMobileCallNotification, ensureMobileCallNotificationsReady],
  );

  const showMobileMessageNotification = useCallback(
    async (title: string, body: string, target?: NotificationTarget) => {
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
    },
    [ensureMobileCallNotificationsReady],
  );

  const showMobileUpdateNotification = useCallback(
    async (title: string, body: string) => {
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
    },
    [ensureMobileCallNotificationsReady],
  );

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
        const status =
          permission.receive === "prompt"
            ? await PushNotifications.requestPermissions()
            : permission;

        if (status.receive !== "granted") {
          return;
        }

        registrationHandle = await PushNotifications.addListener(
          "registration",
          (tokenInfo) => {
            const nextToken = tokenInfo?.value;
            if (!nextToken) return;
            api
              .post("/users/push-token", {
                token: nextToken,
                platform: "android",
              })
              .then(() => {
                localStorage.setItem(MOBILE_PUSH_TOKEN_KEY, nextToken);
              })
              .catch(() => {});
          },
        );

        registrationErrorHandle = await PushNotifications.addListener(
          "registrationError",
          () => {
            // Keep app usable even if push registration fails.
          },
        );

        pushReceivedHandle = await PushNotifications.addListener(
          "pushNotificationReceived",
          async (notification) => {
            const kind = notification?.data?.kind;
            if (kind !== "update-available") {
              return;
            }

            const version =
              typeof notification.data?.version === "string"
                ? notification.data.version
                : "";
            const notes =
              typeof notification.data?.notes === "string"
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
                setUpdateAvailable({
                  newVersion: result.newVersion,
                  notes: result.notes || "",
                });
              }
            }

            const title = notification.title || "New update available";
            const body =
              notification.body ||
              (version
                ? `Version ${version} is ready to install`
                : "A newer app version is ready.");
            await showMobileUpdateNotification(title, body);
          },
        );

        pushActionHandle = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          async (event) => {
            if (event.notification?.data?.kind !== "update-available") {
              return;
            }

            const version =
              typeof event.notification?.data?.version === "string"
                ? event.notification.data.version
                : "";
            if (version) {
              const notes =
                typeof event.notification?.data?.notes === "string"
                  ? event.notification.data.notes
                  : "";
              setUpdateAvailable({ newVersion: version, notes });
              return;
            }

            const result = await CheckForUpdate();
            if (result?.available && result?.newVersion) {
              setUpdateAvailable({
                newVersion: result.newVersion,
                notes: result.notes || "",
              });
            }
          },
        );

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
      const response = await api.get<{ messages: Message[] }>(
        `/messages/${otherUserId}?limit=50`,
      );
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

  const markGroupMessagesSeen = useCallback(
    (groupId: string, messagesToCheck: GroupMessage[]) => {
      const socket = socketRef.current;
      const me = currentUserIdRef.current;

      const canEmitSeen =
        chatModeRef.current === "group" &&
        selectedGroupIdRef.current === groupId &&
        document.hasFocus() &&
        (!isNativeMobileRuntime ||
          (isAppActiveRef.current && isMobileChatOpenRef.current));

      if (!socket || !groupId || !canEmitSeen || !messagesToCheck.length) {
        return;
      }

      const unseenMessageIds = messagesToCheck
        .filter((msg) => msg.senderId !== me)
        .filter((msg) => !(msg.seenBy ?? []).some((seen) => seen.userId === me))
        .map((msg) => msg.id);

      if (unseenMessageIds.length > 0) {
        socket.emit("group:message:seen", {
          groupId,
          messageIds: unseenMessageIds,
        });
      }
    },
    [],
  );

  const fetchGroupMessages = useCallback(
    async (groupId: string) => {
      if (!groupId) {
        setGroupMessages([]);
        return;
      }
      setIsLoadingGroupMessages(true);
      try {
        const response = await api.get<{ messages: GroupMessage[] }>(
          `/groups/${groupId}/messages?limit=50`,
        );
        const fetchedMessages = response.data.messages ?? [];
        setGroupMessages(fetchedMessages);
        markGroupMessagesSeen(groupId, fetchedMessages);
      } finally {
        setIsLoadingGroupMessages(false);
      }
    },
    [markGroupMessagesSeen],
  );

  const fetchMe = useCallback(async () => {
    const response = await api.get<{ user: PublicUser }>("/auth/me");
    setCurrentUser(response.data.user);
  }, []);

  const withSocketAck = useCallback(<T,>(event: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket) {
      return Promise.reject(new Error("Socket not connected."));
    }
    return new Promise<T>((resolve, reject) => {
      socket.emit(
        event,
        payload,
        (ack: { ok: boolean; message?: T; error?: string }) => {
          if (!ack?.ok) {
            reject(new Error(ack?.error ?? "Socket error."));
            return;
          }
          resolve(ack.message as T);
        },
      );
    });
  }, []);

  const openNotificationTarget = useCallback(
    (target?: NotificationTarget) => {
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
    },
    [isMobileViewport],
  );

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
            const userId =
              typeof parsed?.userId === "string" ? parsed.userId : undefined;
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
    setDesktopInlineNotifications((prev) =>
      prev.filter((item) => item.id !== id),
    );
  }, []);

  const pushDesktopInlineNotification = useCallback(
    (
      title: string,
      body: string,
      target?: DesktopInlineNotification["target"],
    ) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setDesktopInlineNotifications((prev) =>
        [{ id, title, body, target }, ...prev].slice(0, 4),
      );

      const timer = window.setTimeout(() => {
        dismissDesktopInlineNotification(id);
        desktopNotifTimersRef.current = desktopNotifTimersRef.current.filter(
          (item) => item !== timer,
        );
      }, 9000);
      desktopNotifTimersRef.current.push(timer);
    },
    [dismissDesktopInlineNotification],
  );

  const openDesktopInlineNotification = useCallback(
    (notification: DesktopInlineNotification) => {
      openNotificationTarget(notification.target);
      dismissDesktopInlineNotification(notification.id);
    },
    [dismissDesktopInlineNotification, openNotificationTarget],
  );

  const notifyIncoming = useCallback(
    async (
      title: string,
      body: string,
      target?: DesktopInlineNotification["target"],
    ) => {
      if (isWails) {
        pushDesktopInlineNotification(title, body, target);
        // Play a single soft custom chime (Discord-like) and avoid duplicate dings.
        const now = Date.now();
        if (now - lastDesktopNotifSoundAtRef.current > 900) {
          lastDesktopNotifSoundAtRef.current = now;
          try {
            if (
              !notificationAudioCtxRef.current ||
              notificationAudioCtxRef.current.state === "closed"
            ) {
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
          ShowOSNotification(title, body).catch(() => {});
        });
        return;
      }

      if (isNativeMobileRuntime) {
        await showMobileMessageNotification(title, body, target);
      }
    },
    [isWails, pushDesktopInlineNotification, showMobileMessageNotification],
  );

  useEffect(() => {
    return () => {
      notificationAudioCtxRef.current?.close().catch(() => {});
      notificationAudioCtxRef.current = null;
      desktopNotifTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
      desktopNotifTimersRef.current = [];
    };
  }, []);

  const stopCall = useCallback(
    (keepRemoteState = false, keepPersistentState = false) => {
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
      micTestStreamRef.current?.getTracks().forEach((t) => t.stop());
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
      groupParticipantAudiosRef.current.forEach((audioEl) => {
        try {
          audioEl.pause();
          audioEl.srcObject = null;
          audioEl.remove();
        } catch {}
      });
      groupParticipantAudiosRef.current.clear();
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
      groupAudioNodesRef.current.forEach((node) => {
        try {
          node.source.disconnect();
          node.gain.disconnect();
        } catch {}
      });
      groupAudioNodesRef.current.clear();
      if (groupAudioMasterGainRef.current) {
        try {
          groupAudioMasterGainRef.current.disconnect();
        } catch {}
        groupAudioMasterGainRef.current = null;
      }
      if (groupAudioSilentGainRef.current) {
        try {
          groupAudioSilentGainRef.current.disconnect();
        } catch {}
        groupAudioSilentGainRef.current = null;
      }
      if (groupAudioContextRef.current) {
        try {
          groupAudioContextRef.current.close().catch(() => {});
        } catch {}
        groupAudioContextRef.current = null;
      }
      groupAudioDestinationRef.current = null;

      if (!keepRemoteState && socketRef.current) {
        if (callGroupIdRef.current) {
          socketRef.current.emit("group:call:leave", {
            groupId: callGroupIdRef.current,
          });
        } else if (callPeerIdRef.current) {
          socketRef.current.emit("call:end", {
            recipientId: callPeerIdRef.current,
            reason: "ended",
          });
        }
      }
      // Clear persistent active-call state (graceful end → no auto-resume)
      if (!keepPersistentState) {
        clearActiveCallState();
      }
      callGroupIdRef.current = null;
      pendingIceCandidatesRef.current = [];
      remoteIceCandidatesBufferRef.current = [];
      remoteDescriptionSetRef.current = false;
      // Stop VAD
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      wasSpeakingRef.current = false;
      setGroupCallParticipants([]);
      playEndCallSound();
      // Hide floating call notification
      HideCallNotif().catch(() => {});
      void clearMobileCallNotification();
      // Restore normal window (remove always-on-top)
      RestoreNormalWindow().catch(() => {});
      setCallStatus("idle");
      setCallPeerId(null);
      setIncomingCall(null);
      setCallStats({
        upKbps: 0,
        downKbps: 0,
        rttMs: null,
        lossPct: null,
        durationSec: 0,
        jitterMs: null,
        codec: null,
        iceState: "new",
        connState: "new",
        bytesSentTotal: 0,
        bytesRecvTotal: 0,
        isReconnecting: false,
      });
    },
    [clearMobileCallNotification],
  );
  stopCallRef.current = stopCall;

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
        socketRef.current?.emit("group:call:speaking", {
          groupId: callGroupIdRef.current,
          speaking: false,
        });
      }
      const myId = currentUserIdRef.current;
      if (myId) {
        setGroupCallParticipants((prev) =>
          prev.map((p) => (p.userId === myId ? { ...p, speaking: false } : p)),
        );
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
            prev.map((item) =>
              item.userId === myUserId
                ? { ...item, speaking: isSpeaking }
                : item,
            ),
          );
          socketRef.current?.emit("group:call:speaking", {
            groupId,
            speaking: isSpeaking,
          });
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

  const updateGroupPeerLatency = useCallback(
    async (targetUserId: string, peer: RTCPeerConnection) => {
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
            if (
              typeof candidateRtt === "number" &&
              Number.isFinite(candidateRtt) &&
              selected
            ) {
              rttSec = candidateRtt;
            }
          }

          if (rttSec == null && report.type === "remote-inbound-rtp") {
            const inbound = report as RTCStats & { roundTripTime?: number };
            if (
              typeof inbound.roundTripTime === "number" &&
              Number.isFinite(inbound.roundTripTime)
            ) {
              rttSec = inbound.roundTripTime;
            }
          }
        });

        if (rttSec == null) return;
        const latencyMs = Math.max(0, Math.round(rttSec * 1000));
        setParticipantLatencyMs((prev) =>
          prev[targetUserId] === latencyMs
            ? prev
            : { ...prev, [targetUserId]: latencyMs },
        );
      } catch {
        // Ignore transient getStats errors while renegotiating.
      }
    },
    [],
  );

  const logSelectedIceRoute = useCallback(
    async (peer: RTCPeerConnection, scope: string) => {
      try {
        const stats = await peer.getStats();
        let selectedPair: any = null;
        const localCandidates = new Map<
          string,
          { candidateType?: string; protocol?: string; relayProtocol?: string }
        >();
        const remoteCandidates = new Map<
          string,
          { candidateType?: string; protocol?: string; relayProtocol?: string }
        >();

        stats.forEach((report) => {
          if (report.type === "local-candidate") {
            localCandidates.set(
              report.id,
              report as {
                candidateType?: string;
                protocol?: string;
                relayProtocol?: string;
              },
            );
            return;
          }
          if (report.type === "remote-candidate") {
            remoteCandidates.set(
              report.id,
              report as {
                candidateType?: string;
                protocol?: string;
                relayProtocol?: string;
              },
            );
            return;
          }
          if (report.type === "candidate-pair") {
            const pair = report as any;
            if (
              pair.state === "succeeded" &&
              (pair.nominated || pair.selected)
            ) {
              selectedPair = pair;
            }
          }
        });

        if (!selectedPair) {
          console.warn(`[WebRTC][${scope}] selected candidate pair topilmadi`);
          return;
        }

        const pair: any = selectedPair;

        const local = pair.localCandidateId
          ? localCandidates.get(pair.localCandidateId)
          : undefined;
        const remote = pair.remoteCandidateId
          ? remoteCandidates.get(pair.remoteCandidateId)
          : undefined;

        console.log(`[WebRTC][${scope}] selected route`, {
          forceRelay: FORCE_WEBRTC_RELAY,
          localType: local?.candidateType,
          localProtocol: local?.protocol,
          localRelayProtocol: local?.relayProtocol,
          remoteType: remote?.candidateType,
          remoteProtocol: remote?.protocol,
          remoteRelayProtocol: remote?.relayProtocol,
          rttSec: pair.currentRoundTripTime,
        });
        // Surface in overlay event log
        const lt = local?.candidateType ?? "?";
        const rt = remote?.candidateType ?? "?";
        const rttMs = pair.currentRoundTripTime
          ? Math.round(pair.currentRoundTripTime * 1000)
          : null;
        const isP2P = lt !== "relay" && rt !== "relay";
        pushCallEvent(
          `route ${lt}↔${rt}${rttMs !== null ? ` (${rttMs}ms)` : ""} ${isP2P ? "P2P" : "TURN"}`,
          isP2P ? "ok" : "info",
        );
      } catch (err) {
        console.warn(`[WebRTC][${scope}] getStats route log xato:`, err);
      }
    },
    [pushCallEvent],
  );

  const selectedAudioOutputRef = useRef(selectedAudioOutput);
  selectedAudioOutputRef.current = selectedAudioOutput;
  const speakerVolumeRef = useRef(speakerVolume);
  speakerVolumeRef.current = speakerVolume;

  const ensureGroupAudioGraph = useCallback(() => {
    let ctx = groupAudioContextRef.current;
    if (!ctx || ctx.state === "closed") {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AudioContextClass();
      groupAudioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    let master = groupAudioMasterGainRef.current;
    let dest = groupAudioDestinationRef.current;

    if (!dest || !master) {
      dest = ctx.createMediaStreamDestination();
      groupAudioDestinationRef.current = dest;

      master = ctx.createGain();
      master.gain.value = 1.0;
      master.connect(dest);

      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      master.connect(silentGain);
      silentGain.connect(ctx.destination);
      groupAudioSilentGainRef.current = silentGain;

      groupAudioMasterGainRef.current = master;
    }

    return { ctx, dest, master };
  }, []);

  const syncGroupRemoteAudio = useCallback(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;
    const { dest, ctx } = ensureGroupAudioGraph();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    if (audio.srcObject !== dest.stream) {
      audio.srcObject = dest.stream;
    }
    audio.muted = false;
    audio.volume = toMediaElementVolume(speakerVolumeRef.current);
    if (
      selectedAudioOutputRef.current &&
      typeof (
        audio as HTMLAudioElement & {
          setSinkId?: (id: string) => Promise<void>;
        }
      ).setSinkId === "function"
    ) {
      (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
        .setSinkId(selectedAudioOutputRef.current)
        .catch((err) => {
          console.warn("[WebRTC] group setSinkId failed:", err);
        });
    }
    audio.play().catch(() => {});
  }, [ensureGroupAudioGraph]);

  const attachGroupParticipantTrack = useCallback(
    (targetUserId: string, track: MediaStreamTrack) => {
      // 1. Direct dedicated HTMLAudioElement for this participant (rock-solid native WebRTC playback)
      let audioEl = groupParticipantAudiosRef.current.get(targetUserId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        (audioEl as any).playsInline = true;
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        groupParticipantAudiosRef.current.set(targetUserId, audioEl);
      }
      const stream = new MediaStream([track]);
      audioEl.srcObject = stream;
      audioEl.muted = false;
      const savedVol = participantVolumesRef.current[targetUserId] ?? 100;
      audioEl.volume = Math.max(
        0,
        Math.min(
          1,
          (savedVol / 100) * toMediaElementVolume(speakerVolumeRef.current),
        ),
      );
      if (
        selectedAudioOutputRef.current &&
        typeof (audioEl as any).setSinkId === "function"
      ) {
        (audioEl as any)
          .setSinkId(selectedAudioOutputRef.current)
          .catch((err: any) => {
            console.warn("[WebRTC] group audio setSinkId failed:", err);
          });
      }

      let attempts = 0;
      const tryPlay = () => {
        if (callStatusRef.current === "idle") return;
        attempts++;
        audioEl!
          .play()
          .then(() => {
            console.log(
              `[WebRTC] Group remote audio playing for ${targetUserId} (attempt ${attempts})`,
            );
          })
          .catch((err) => {
            console.warn(
              `[WebRTC] group audio.play() for ${targetUserId} attempt ${attempts} failed:`,
              err,
            );
            if (attempts < 20) {
              setTimeout(tryPlay, 300);
            }
          });
      };
      tryPlay();

      track.onunmute = () => {
        console.log(
          `[WebRTC] Group remote audio track unmuted for ${targetUserId}`,
        );
        attempts = 0;
        tryPlay();
      };

      // 2. Also maintain WebAudio graph for visualizer / CallOverlay level meters
      try {
        const { ctx, master } = ensureGroupAudioGraph();
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }

        const prev = groupAudioNodesRef.current.get(targetUserId);
        if (prev) {
          if (prev.track.id === track.id) {
            groupRemoteAudioTracksRef.current.set(targetUserId, track);
            return;
          }
          try {
            prev.source.disconnect();
            prev.gain.disconnect();
          } catch {}
          groupAudioNodesRef.current.delete(targetUserId);
        }

        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, savedVol / 100);

        source.connect(gain);
        gain.connect(master);

        groupAudioNodesRef.current.set(targetUserId, {
          source,
          gain,
          stream,
          track,
        });
        syncGroupRemoteAudio();
      } catch (err) {
        console.warn("[WebRTC] attachGroupParticipantTrack WebAudio warning:", err);
      }

      groupRemoteAudioTracksRef.current.set(targetUserId, track);
    },
    [ensureGroupAudioGraph, syncGroupRemoteAudio],
  );

  const detachGroupParticipantTrack = useCallback((targetUserId: string) => {
    const audioEl = groupParticipantAudiosRef.current.get(targetUserId);
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      } catch {}
      groupParticipantAudiosRef.current.delete(targetUserId);
    }

    const node = groupAudioNodesRef.current.get(targetUserId);
    if (node) {
      try {
        node.source.disconnect();
        node.gain.disconnect();
      } catch {}
      groupAudioNodesRef.current.delete(targetUserId);
    }
    groupRemoteAudioTracksRef.current.delete(targetUserId);
  }, []);

  const removeGroupPeerConnection = useCallback(
    (targetUserId: string) => {
      stopGroupPeerStats(targetUserId);
      const peer = groupPeerConnectionsRef.current.get(targetUserId);
      if (peer) {
        peer.close();
        groupPeerConnectionsRef.current.delete(targetUserId);
      }
      groupRemoteDescriptionSetRef.current.delete(targetUserId);
      groupRemoteIceCandidatesBufferRef.current.delete(targetUserId);
      detachGroupParticipantTrack(targetUserId);
    },
    [detachGroupParticipantTrack, stopGroupPeerStats],
  );

  const setupGroupPeerConnection = useCallback(
    (targetUserId: string) => {
      removeGroupPeerConnection(targetUserId);

      const peer = new RTCPeerConnection(getRtcConfiguration());

      const localStream = localCallStreamRef.current;
      if (localStream) {
        localStream
          .getTracks()
          .forEach((track) => peer.addTrack(track, localStream));
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
          candidate: event.candidate.toJSON(),
        });
      };

      peer.ontrack = (event) => {
        if (event.track.kind !== "audio") {
          return;
        }
        attachGroupParticipantTrack(targetUserId, event.track);
        event.track.onended = () => {
          detachGroupParticipantTrack(targetUserId);
        };
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          void updateGroupPeerLatency(targetUserId, peer);
          void logSelectedIceRoute(peer, `group:${targetUserId}`);
        }
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        ) {
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
    },
    [
      attachGroupParticipantTrack,
      detachGroupParticipantTrack,
      logSelectedIceRoute,
      removeGroupPeerConnection,
      updateGroupPeerLatency,
    ],
  );

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
          console.info(
            "[Call] Stale state with same peer — cleaning up before accepting new offer",
          );
          stopCall(true);
          stalePeerCleanup = true;
          // stopCall queues setCallStatus("idle"); ref updates on next render.
          // Manually align so the busy-check below passes immediately.
          callStatusRef.current = "idle";
        }
        if (callStatusRef.current !== "idle" && !stalePeerCleanup) {
          socket.emit("call:end", {
            recipientId: payload.fromUserId,
            reason: "busy",
          });
          return;
        }
        setIncomingCall(payload);
        setCallPeerId(payload.fromUserId);
        setCallStatus("ringing");
        const callerUser = usersRef.current.find(
          (u) => u.id === payload.fromUserId,
        );
        const callerName = callerUser?.displayName ?? payload.fromUserId;
        await notifyIncoming("Incoming call", `${callerName} is calling you.`, {
          chatMode: "user",
          userId: payload.fromUserId,
          kind: "incoming-call",
        });
        // Show call notification via Wails & bring window to front
        ShowCallNotif(callerName).catch(() => {});
        ShowWindow().catch(() => {});
        if (isNativeMobileRuntime) {
          await showMobileIncomingCallNotification(
            "Incoming call",
            `${callerName} is calling you.`,
            callerName,
          );
        }
      });

      socket.on(
        "call:answer",
        async (payload: {
          fromUserId: string;
          sdp: RTCSessionDescriptionInit;
        }) => {
          if (callAnswerTimeoutRef.current) {
            window.clearTimeout(callAnswerTimeoutRef.current);
            callAnswerTimeoutRef.current = null;
          }
          if (!peerConnectionRef.current || !payload?.sdp) {
            console.warn("[Call] call:answer received but no peer or sdp");
            return;
          }
          console.log(
            "[Call] call:answer received, setting remote description",
          );
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(payload.sdp),
          );
          remoteDescriptionSetRef.current = true;
          // Flush any ICE candidates that arrived before remote description was set
          const buffered = remoteIceCandidatesBufferRef.current;
          remoteIceCandidatesBufferRef.current = [];
          for (const c of buffered) {
            await peerConnectionRef.current
              .addIceCandidate(new RTCIceCandidate(c))
              .catch(() => {});
          }
          setCallStatus("in-call");
          setCallMinimized(true);
          if (payload.fromUserId) {
            callPeerIdRef.current = payload.fromUserId;
            setCallPeerId(payload.fromUserId);
            const queued = pendingIceCandidatesRef.current;
            pendingIceCandidatesRef.current = [];
            for (const c of queued) {
              socketRef.current?.emit("call:ice-candidate", {
                recipientId: payload.fromUserId,
                candidate: c,
              });
            }
          }
        },
      );

      socket.on(
        "call:ice-candidate",
        async (payload: {
          fromUserId: string;
          candidate: RTCIceCandidateInit;
        }) => {
          if (!payload?.candidate) {
            return;
          }
          if (!peerConnectionRef.current || !remoteDescriptionSetRef.current) {
            remoteIceCandidatesBufferRef.current.push(payload.candidate);
            return;
          }
          await peerConnectionRef.current
            .addIceCandidate(new RTCIceCandidate(payload.candidate))
            .catch((err) => {
              console.warn("[WebRTC] addIceCandidate failed:", err);
            });
        },
      );

      socket.on(
        "call:renegotiate",
        async (payload: { fromUserId: string; type: string; sdp: any }) => {
          if (!peerConnectionRef.current) return;
          try {
            if (payload.type === "offer") {
              // Handle glare: if we're already in have-local-offer, rollback first
              if (
                peerConnectionRef.current.signalingState === "have-local-offer"
              ) {
                await peerConnectionRef.current.setLocalDescription({
                  type: "rollback",
                });
              }
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(payload.sdp),
              );
              const answer = await peerConnectionRef.current.createAnswer();
              await peerConnectionRef.current.setLocalDescription(answer);
              socketRef.current?.emit("call:renegotiate", {
                recipientId: payload.fromUserId,
                type: "answer",
                sdp: answer,
              });
              // Check if remote started/stopped screenshare
              const hasVideo = peerConnectionRef.current
                .getReceivers()
                .some(
                  (r) =>
                    r.track &&
                    r.track.kind === "video" &&
                    r.track.readyState === "live" &&
                    !r.track.muted,
                );
              if (hasVideo) {
                setIsRemoteScreenSharing(true);
              } else {
                setIsRemoteScreenSharing(false);
                setScreenFullscreen(false);
              }
            } else if (payload.type === "answer") {
              if (
                peerConnectionRef.current.signalingState === "have-local-offer"
              ) {
                await peerConnectionRef.current.setRemoteDescription(
                  new RTCSessionDescription(payload.sdp),
                );
              }
            }
          } catch (e) {
            console.warn("[WebRTC] call:renegotiate error:", e);
          }
        },
      );

      socket.on("call:end", (payload?: DirectCallEndPayload) => {
        // Direct 1-on-1 call end should NOT kill an active group call
        if (callGroupIdRef.current) {
          return;
        }
        if (callStatusRef.current !== "idle") {
          stopCall(true);
          playEndCallSound();
          toast(getCallEndToastText(payload?.reason));
        }
      });

      socket.on("disconnect", () => {
        if (callStatusRef.current !== "idle") {
          console.warn("[WebRTC] Signaling socket disconnected during call. Waiting for reconnect...");
          if (!callDisconnectedTimerRef.current) {
            callDisconnectedTimerRef.current = window.setTimeout(() => {
              callDisconnectedTimerRef.current = null;
              if (callStatusRef.current !== "idle" && !socketRef.current?.connected) {
                stopCall(true);
                toast.error("Aloqa uzildi (3 daqiqa kutildi). Call tugatildi.");
              }
            }, 180000);
          }
        }
      });
    },
    [notifyIncoming, stopCall],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string, isGroup?: boolean) => {
      const myId = currentUserIdRef.current;
      if (!myId) return;

      setMessageReactions((prev) => {
        const msgReactions = { ...(prev[messageId] || {}) };
        const userList = [...(msgReactions[emoji] || [])];
        const existsIndex = userList.indexOf(myId);
        if (existsIndex >= 0) {
          userList.splice(existsIndex, 1);
          if (userList.length === 0) {
            delete msgReactions[emoji];
          } else {
            msgReactions[emoji] = userList;
          }
        } else {
          userList.push(myId);
          msgReactions[emoji] = userList;
        }
        const next = { ...prev, [messageId]: msgReactions };
        try {
          localStorage.setItem("chat_message_reactions", JSON.stringify(next));
        } catch {}
        return next;
      });

      if (socketRef.current) {
        if (isGroup && selectedGroupIdRef.current) {
          socketRef.current.emit("group:message:react", {
            groupId: selectedGroupIdRef.current,
            messageId,
            emoji,
          });
        } else if (selectedUserIdRef.current) {
          socketRef.current.emit("message:react", {
            recipientId: selectedUserIdRef.current,
            messageId,
            emoji,
          });
        }
      }
    },
    [],
  );

  const attachChatHandlers = useCallback(
    (socket: Socket) => {
      socket.on("presence:update", (payload: PresencePayload) => {
        const isKnown = usersRef.current.some((user) => user.id === payload.userId);
        if (!isKnown && payload.userId !== currentUserIdRef.current) {
          fetchUsers().catch(() => undefined);
          return;
        }
        setUsers((prev) =>
          prev.map((user) =>
            user.id === payload.userId
              ? {
                  ...user,
                  isOnline: payload.isOnline,
                  lastSeenAt: payload.lastSeenAt ?? user.lastSeenAt,
                  clientType: payload.clientType ?? user.clientType,
                  clientVersion: payload.clientVersion ?? user.clientVersion,
                }
              : user,
          ),
        );
      });

      socket.on(
        "status:changed",
        (payload: {
          userId: string;
          statusText: string | null;
          statusEmoji: string | null;
        }) => {
          setUsers((prev) =>
            prev.map((user) =>
              user.id === payload.userId
                ? {
                    ...user,
                    statusText: payload.statusText,
                    statusEmoji: payload.statusEmoji,
                  }
                : user,
            ),
          );
          setCurrentUser((prev) =>
            prev && prev.id === payload.userId
              ? {
                  ...prev,
                  statusText: payload.statusText,
                  statusEmoji: payload.statusEmoji,
                }
              : prev,
          );
        },
      );

      socket.on(
        "user:profile-updated",
        (payload: {
          userId: string;
          displayName: string;
          username: string | null;
          avatarUrl: string | null;
        }) => {
          const isKnown = usersRef.current.some((user) => user.id === payload.userId);
          if (!isKnown && payload.userId !== currentUserIdRef.current) {
            fetchUsers().catch(() => undefined);
          }
          setUsers((prev) =>
            prev.map((user) =>
              user.id === payload.userId
                ? {
                    ...user,
                    displayName: payload.displayName,
                    username: payload.username,
                    avatarUrl: payload.avatarUrl,
                  }
                : user,
            ),
          );
          // Also update currentUser if it's me
          setCurrentUser((prev) =>
            prev && prev.id === payload.userId
              ? {
                  ...prev,
                  displayName: payload.displayName,
                  username: payload.username,
                  avatarUrl: payload.avatarUrl,
                }
              : prev,
          );
          setProfileViewUser((prev) =>
            prev && prev.id === payload.userId
              ? {
                  ...prev,
                  displayName: payload.displayName,
                  username: payload.username,
                  avatarUrl: payload.avatarUrl,
                }
              : prev,
          );
        },
      );

      socket.on("typing:start", (payload: { fromUserId: string }) => {
        setTypingFromUserId(payload.fromUserId);
      });

      socket.on("typing:stop", (payload: { fromUserId: string }) => {
        setTypingFromUserId((prev) =>
          prev === payload.fromUserId ? null : prev,
        );
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
            setUnreadCounts((prev) => ({
              ...prev,
              [message.senderId]: (prev[message.senderId] || 0) + 1,
            }));
            // Check for @mention of current user
            if (message.text && messageMentionsUser(message.text, meUser)) {
              setMentionCounts((prev) => ({
                ...prev,
                [message.senderId]: (prev[message.senderId] || 0) + 1,
              }));
            }
          }
          const senderName =
            usersRef.current.find((item) => item.id === message.senderId)
              ?.displayName ?? "New message";
          const body = buildMessagePreview(message);
          await notifyIncoming(senderName, body, {
            chatMode: "user",
            userId: message.senderId,
          });
        }
      });

      socket.on("messages:deleted", (payload: { messageIds: string[] }) => {
        const deletedSet = new Set(payload.messageIds);
        setMessages((prev) => prev.filter((m) => !deletedSet.has(m.id)));
      });

      socket.on(
        "message:read",
        (payload: {
          readByUserId: string;
          readAt: string;
          fromSenderId?: string;
        }) => {
          setMessages((prev) =>
            prev.map((m) => {
              // If I sent it and the recipient read it
              if (
                m.senderId === currentUserIdRef.current &&
                m.recipientId === payload.readByUserId &&
                !m.readAt
              ) {
                return { ...m, readAt: payload.readAt };
              }
              // If someone else sent it and I read it (fromSenderId present)
              if (
                payload.fromSenderId &&
                m.senderId === payload.fromSenderId &&
                m.recipientId === payload.readByUserId &&
                !m.readAt
              ) {
                return { ...m, readAt: payload.readAt };
              }
              return m;
            }),
          );

          // If I'm currently in this conversation as sender, mark read receipts as seen.
          const isChatOpenAndFocused =
            selectedUserIdRef.current === payload.readByUserId &&
            payload.readByUserId !== currentUserIdRef.current &&
            document.hasFocus() &&
            (!isNativeMobileRuntime ||
              (isAppActiveRef.current && isMobileChatOpenRef.current));

          if (isChatOpenAndFocused) {
            socket.emit("message:seen", { recipientId: payload.readByUserId });
          }
        },
      );

      socket.on(
        "message:seen",
        (payload: {
          senderId: string;
          recipientId: string;
          seenAt: string;
        }) => {
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
            }),
          );
        },
      );

      socket.on(
        "message:react",
        (payload: { messageId: string; userId: string; emoji: string }) => {
          if (!payload?.messageId || !payload?.emoji) return;
          setMessageReactions((prev) => {
            const msgReactions = { ...(prev[payload.messageId] || {}) };
            const userList = [...(msgReactions[payload.emoji] || [])];
            if (!userList.includes(payload.userId)) {
              userList.push(payload.userId);
              msgReactions[payload.emoji] = userList;
            }
            const next = { ...prev, [payload.messageId]: msgReactions };
            try {
              localStorage.setItem("chat_message_reactions", JSON.stringify(next));
            } catch {}
            return next;
          });
        },
      );

      socket.on(
        "group:message:react",
        (payload: {
          groupId: string;
          messageId: string;
          userId: string;
          emoji: string;
        }) => {
          if (!payload?.messageId || !payload?.emoji) return;
          setMessageReactions((prev) => {
            const msgReactions = { ...(prev[payload.messageId] || {}) };
            const userList = [...(msgReactions[payload.emoji] || [])];
            if (!userList.includes(payload.userId)) {
              userList.push(payload.userId);
              msgReactions[payload.emoji] = userList;
            }
            const next = { ...prev, [payload.messageId]: msgReactions };
            try {
              localStorage.setItem("chat_message_reactions", JSON.stringify(next));
            } catch {}
            return next;
          });
        },
      );
    },
    [fetchUsers, notifyIncoming],
  );

  const attachGroupHandlers = useCallback(
    (socket: Socket) => {
      socket.on("group:created", (group: Group) => {
        setGroups((prev) => {
          if (prev.some((g) => g.id === group.id)) {
            return prev.map((g) => (g.id === group.id ? group : g));
          }
          return [group, ...prev];
        });
      });

      socket.on("group:updated", (group: Group) => {
        setGroups((prev) => {
          const exists = prev.some((g) => g.id === group.id);
          if (!exists) {
            return [group, ...prev];
          }
          return prev.map((g) => (g.id === group.id ? group : g));
        });
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
            setUnreadCounts((prev) => ({
              ...prev,
              [message.groupId]: (prev[message.groupId] || 0) + 1,
            }));
            // Check for @mention of current user
            if (message.text && messageMentionsUser(message.text, meUser)) {
              setMentionCounts((prev) => ({
                ...prev,
                [message.groupId]: (prev[message.groupId] || 0) + 1,
              }));
            }
          }
          const senderName = message.sender?.displayName ?? "Group message";
          const body = buildMessagePreview(message as unknown as Message);
          await notifyIncoming(senderName, body, {
            chatMode: "group",
            groupId: message.groupId,
          });
        }
      });

      socket.on(
        "group:message:seen",
        (payload: {
          groupId: string;
          entries: Array<{
            messageId: string;
            userId: string;
            seenAt: string;
            user?: PublicUser;
          }>;
        }) => {
          if (
            !payload?.groupId ||
            !Array.isArray(payload.entries) ||
            payload.entries.length === 0
          ) {
            return;
          }

          setGroupMessages((prev) =>
            prev.map((msg) => {
              if (msg.groupId !== payload.groupId) {
                return msg;
              }

              const matched = payload.entries.filter(
                (entry) => entry.messageId === msg.id,
              );
              if (matched.length === 0) {
                return msg;
              }

              const seenMap = new Map(
                (msg.seenBy ?? []).map((row) => [row.userId, row]),
              );
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
                return (
                  new Date(a.seenAt).getTime() - new Date(b.seenAt).getTime()
                );
              });

              return { ...msg, seenBy: mergedSeenBy };
            }),
          );
        },
      );

      socket.on(
        "group:typing:start",
        (payload: { groupId: string; fromUserId: string }) => {
          if (payload.groupId === selectedGroupIdRef.current) {
            setGroupTypingUserId(payload.fromUserId);
          }
        },
      );

      socket.on(
        "group:typing:stop",
        (payload: { groupId: string; fromUserId: string }) => {
          setGroupTypingUserId((prev) =>
            prev === payload.fromUserId ? null : prev,
          );
        },
      );

      // Group call handlers
      socket.on(
        "group:call:status",
        (payload: { groupId: string; userIds: string[] }) => {
          if (!payload?.groupId || !Array.isArray(payload.userIds)) return;
          const deduped = [
            ...new Set(
              payload.userIds.filter(
                (id) => typeof id === "string" && id.length > 0,
              ),
            ),
          ];
          setGroupActiveCallUsers((prev) => {
            if (deduped.length === 0) {
              if (!(payload.groupId in prev)) return prev;
              const next = { ...prev };
              delete next[payload.groupId];
              return next;
            }
            const current = prev[payload.groupId] ?? [];
            if (
              current.length === deduped.length &&
              current.every((id, idx) => id === deduped[idx])
            ) {
              return prev;
            }
            return { ...prev, [payload.groupId]: deduped };
          });
        },
      );

      socket.on(
        "group:call:offer",
        async (payload: {
          groupId: string;
          fromUserId: string;
          sdp: RTCSessionDescriptionInit;
        }) => {
          if (!payload?.groupId || !payload?.fromUserId || !payload?.sdp)
            return;

          setGroupActiveCallUsers((prev) => {
            const existing = new Set(prev[payload.groupId] ?? []);
            existing.add(payload.fromUserId);
            return { ...prev, [payload.groupId]: [...existing] };
          });

          if (callStatusRef.current === "idle") {
            callGroupIdRef.current = payload.groupId;
            setIncomingCall({
              fromUserId: payload.fromUserId,
              sdp: payload.sdp,
            });
            setCallPeerId(payload.fromUserId);
            setCallStatus("ringing");
            const callerUser = usersRef.current.find(
              (u) => u.id === payload.fromUserId,
            );
            const callerName = callerUser?.displayName ?? "Group call";
            await notifyIncoming(
              "Group Call",
              `${callerName} - Incoming group call.`,
              { chatMode: "group", groupId: payload.groupId },
            );
            ShowCallNotif(callerName).catch(() => {});
            if (isNativeMobileRuntime) {
              await showMobileIncomingCallNotification(
                "Group call",
                `${callerName} started a group call.`,
                callerName,
              );
            }
            return;
          }

          if (
            callStatusRef.current !== "in-call" ||
            callGroupIdRef.current !== payload.groupId ||
            !localCallStreamRef.current
          ) {
            return;
          }

          const existingPeer = groupPeerConnectionsRef.current.get(
            payload.fromUserId,
          );
          let peer = existingPeer;
          if (
            !peer ||
            peer.connectionState === "closed" ||
            peer.connectionState === "failed" ||
            peer.iceConnectionState === "failed" ||
            peer.iceConnectionState === "disconnected"
          ) {
            peer = setupGroupPeerConnection(payload.fromUserId);
          } else if (peer.signalingState === "have-local-offer") {
            try {
              await peer.setLocalDescription({ type: "rollback" });
            } catch {
              peer = setupGroupPeerConnection(payload.fromUserId);
            }
          }

          await peer.setRemoteDescription(
            new RTCSessionDescription(payload.sdp),
          );
          groupRemoteDescriptionSetRef.current.set(payload.fromUserId, true);

          const buffered =
            groupRemoteIceCandidatesBufferRef.current.get(payload.fromUserId) ??
            [];
          groupRemoteIceCandidatesBufferRef.current.set(payload.fromUserId, []);
          for (const candidate of buffered) {
            await peer
              .addIceCandidate(new RTCIceCandidate(candidate))
              .catch(() => {});
          }

          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socketRef.current?.emit("group:call:answer", {
            groupId: payload.groupId,
            toUserId: payload.fromUserId,
            sdp: answer,
          });
        },
      );

      socket.on(
        "group:call:answer",
        async (payload: {
          groupId: string;
          fromUserId: string;
          sdp: RTCSessionDescriptionInit;
        }) => {
          if (!payload?.fromUserId || !payload?.sdp) return;
          const peer = groupPeerConnectionsRef.current.get(payload.fromUserId);
          if (!peer) return;
          await peer.setRemoteDescription(
            new RTCSessionDescription(payload.sdp),
          );
          groupRemoteDescriptionSetRef.current.set(payload.fromUserId, true);
          const buffered =
            groupRemoteIceCandidatesBufferRef.current.get(payload.fromUserId) ??
            [];
          groupRemoteIceCandidatesBufferRef.current.set(payload.fromUserId, []);
          for (const candidate of buffered) {
            await peer
              .addIceCandidate(new RTCIceCandidate(candidate))
              .catch(() => {});
          }
          setCallStatus("in-call");
          setCallMinimized(true);
        },
      );

      socket.on(
        "group:call:ice-candidate",
        async (payload: {
          groupId: string;
          fromUserId: string;
          candidate: RTCIceCandidateInit;
        }) => {
          if (!payload?.fromUserId || !payload?.candidate) return;
          const peer = groupPeerConnectionsRef.current.get(payload.fromUserId);
          // ⚠️ Even if peer not yet created (incoming during ringing), buffer the candidate.
          // It will be flushed once setRemoteDescription is called in acceptCall().
          if (
            !peer ||
            !groupRemoteDescriptionSetRef.current.get(payload.fromUserId)
          ) {
            const existing =
              groupRemoteIceCandidatesBufferRef.current.get(
                payload.fromUserId,
              ) ?? [];
            existing.push(payload.candidate);
            groupRemoteIceCandidatesBufferRef.current.set(
              payload.fromUserId,
              existing,
            );
            return;
          }
          await peer
            .addIceCandidate(new RTCIceCandidate(payload.candidate))
            .catch((err) => {
              console.warn("[WebRTC] group addIceCandidate failed:", err);
            });
        },
      );

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
      socket.on(
        "group:call:join",
        (payload: { groupId: string; userId: string }) => {
          if (
            !payload?.groupId ||
            !payload?.userId ||
            payload.groupId !== callGroupIdRef.current
          ) {
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
          setGroupCallParticipants((prev) => {
            if (prev.some((p) => p.userId === payload.userId)) return prev;
            return [...prev, { userId: payload.userId, speaking: false }];
          });

          if (
            payload.userId === currentUserIdRef.current ||
            callStatusRef.current !== "in-call" ||
            !localCallStreamRef.current
          ) {
            return;
          }

          const existingPeer = groupPeerConnectionsRef.current.get(
            payload.userId,
          );
          if (
            existingPeer &&
            existingPeer.connectionState === "connected" &&
            (existingPeer.iceConnectionState === "connected" ||
              existingPeer.iceConnectionState === "completed")
          ) {
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
                sdp: offer,
              });
            } catch (err) {
              console.warn("[WebRTC] group offer on join failed:", err);
            }
          })();
        },
      );

      socket.on(
        "group:call:leave",
        (payload: { groupId: string; userId: string }) => {
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
          setGroupCallParticipants((prev) =>
            prev.filter((p) => p.userId !== payload.userId),
          );
          if (groupPeerConnectionsRef.current.size === 0) {
            setCallStats((prev) => ({
              ...prev,
              upKbps: 0,
              downKbps: 0,
              rttMs: null,
              lossPct: null,
              isReconnecting: false,
            }));
          }
        },
      );

      socket.on(
        "group:call:speaking",
        (payload: { groupId: string; userId: string; speaking: boolean }) => {
          if (!payload?.groupId || payload.groupId !== callGroupIdRef.current)
            return;
          setGroupCallParticipants((prev) =>
            prev.map((p) =>
              p.userId === payload.userId
                ? { ...p, speaking: payload.speaking }
                : p,
            ),
          );

          // If speaking events arrive but we have no remote track for this user,
          // recover by re-negotiating a direct group peer link.
          if (
            payload.speaking &&
            payload.userId !== currentUserIdRef.current &&
            callStatusRef.current === "in-call" &&
            !!localCallStreamRef.current &&
            !groupRemoteAudioTracksRef.current.has(payload.userId)
          ) {
            const existingPeer = groupPeerConnectionsRef.current.get(
              payload.userId,
            );
            const state = existingPeer?.connectionState;
            const shouldReconnect =
              !existingPeer ||
              state === "failed" ||
              state === "closed" ||
              state === "disconnected";
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
                  sdp: offer,
                });
              } catch (err) {
                console.warn(
                  "[WebRTC] group offer on speaking recovery failed:",
                  err,
                );
              }
            })();
          }
        },
      );
    },
    [
      markGroupMessagesSeen,
      notifyIncoming,
      removeGroupPeerConnection,
      setupGroupPeerConnection,
      showMobileIncomingCallNotification,
      stopCall,
    ],
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
          hasSocketConnectedOnceRef.current = true;
          setIsSocketConnected(true);
          if (callDisconnectedTimerRef.current && callStatusRef.current !== "idle") {
            window.clearTimeout(callDisconnectedTimerRef.current);
            callDisconnectedTimerRef.current = null;
          }
          if (selectedGroupIdRef.current) {
            requestGroupCallStatus(selectedGroupIdRef.current);
          }
        });
        socket.on("disconnect", () => {
          setIsSocketConnected(false);
          if (callStatusRef.current !== "idle" && !callDisconnectedTimerRef.current) {
            callDisconnectedTimerRef.current = window.setTimeout(() => {
              callDisconnectedTimerRef.current = null;
              if (callStatusRef.current !== "idle") {
                stopCall(false);
                toast.error("Internet aloqasi tiklanmadi. Qo'ng'iroq tugatildi.");
              }
            }, 25000);
          }
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
          await new Promise((r) => setTimeout(r, 2000));
          if (!cancelled) return run(attempt + 1);
        } else {
          setIsSessionBootstrapping(false);
          setSessionBootstrapError(
            "Serverga ulanib bo'lmadi. Session saqlandi, qayta urinib ko'ring.",
          );
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
  }, [
    attachCallHandlers,
    attachChatHandlers,
    attachGroupHandlers,
    clearSession,
    fetchMe,
    fetchGroups,
    fetchUsers,
    token,
    appLocked,
    appLockEnabled,
    sessionBootstrapNonce,
    requestGroupCallStatus,
  ]);

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
  }, [
    fetchGroupMessages,
    selectedGroupId,
    token,
    chatMode,
    requestGroupCallStatus,
  ]);



  const sendTypingSignal = useCallback(
    (isTyping: boolean) => {
      if (!selectedUserId || !socketRef.current) {
        return;
      }
      socketRef.current.emit(isTyping ? "typing:start" : "typing:stop", {
        recipientId: selectedUserId,
      });
    },
    [selectedUserId],
  );

  const handleGetLocation = () => {
    setMessageType("LOCATION");
    setLocationAccuracy(null);
    toast("Detecting location...");

    const applyDetectedLocation = (
      lat: number,
      lng: number,
      accuracy?: number,
    ) => {
      if (
        typeof accuracy === "number" &&
        Number.isFinite(accuracy) &&
        accuracy > MAX_LOCATION_ACCURACY_M
      ) {
        toast.error(
          `Location accuracy is too low (~${Math.round(accuracy)}m). Move to open area and try again.`,
        );
        return false;
      }

      setLocationLat(String(lat));
      setLocationLng(String(lng));
      setLocationAccuracy(
        typeof accuracy === "number" && Number.isFinite(accuracy)
          ? accuracy
          : null,
      );
      const accuracyText =
        typeof accuracy === "number" && Number.isFinite(accuracy)
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
          if (
            applyDetectedLocation(
              Number(res.latitude),
              Number(res.longitude),
              Number(res.accuracy),
            )
          ) {
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
            if (
              !applyDetectedLocation(
                position.coords.latitude,
                position.coords.longitude,
                position.coords.accuracy,
              )
            ) {
              toast.error(
                "Could not detect precise location. Check GPS/location settings and try again.",
              );
            }
          },
          () => {
            toast.error(
              "Location not detected. Enable device location and try again.",
            );
            setMessageType("TEXT");
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
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
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, ta.scrollHeight),
    );
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
    const memberList =
      chatMode === "group" && activeGroup?.members
        ? (activeGroup.members
            .map((m) => m.user)
            .filter(Boolean) as PublicUser[])
        : users;
    return memberList
      .filter((u) => u.id !== currentUser?.id)
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(mentionQuery) ||
          (u.username && u.username.toLowerCase().includes(mentionQuery)),
      )
      .slice(0, 8);
  }, [
    showMentionDropdown,
    mentionQuery,
    chatMode,
    activeGroup,
    users,
    currentUser,
  ]);

  const insertMention = (user: PublicUser) => {
    const before = messageText.slice(0, mentionStartIndex);
    const after = messageText.slice(
      textareaRef.current?.selectionStart ?? messageText.length,
    );
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

  // ── TEXT FORMATTING ACTIONS (Bold, Italic, Link, etc.) ──
  const applyFormatting = useCallback(
    (
      type:
        | "bold"
        | "italic"
        | "strike"
        | "mono"
        | "spoiler"
        | "underline"
        | "quote"
        | "clear",
    ) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start == null || end == null || start === end) return;

      const selected = messageText.slice(start, end);
      let newText = "";
      let newCursorStart = start;
      let newCursorEnd = end;

      if (type === "clear") {
        let cleaned = selected;
        cleaned = cleaned.replace(/^(\*\*|\*|__|_|~~|`|\|\||> )+/, "");
        cleaned = cleaned.replace(/(\*\*|\*|__|_|~~|`|\|\|)+$/, "");
        newText = messageText.slice(0, start) + cleaned + messageText.slice(end);
        newCursorStart = start;
        newCursorEnd = start + cleaned.length;
      } else {
        let prefix = "";
        let suffix = "";

        switch (type) {
          case "bold":
            prefix = "**";
            suffix = "**";
            break;
          case "italic":
            prefix = "*";
            suffix = "*";
            break;
          case "strike":
            prefix = "~~";
            suffix = "~~";
            break;
          case "mono":
            prefix = "`";
            suffix = "`";
            break;
          case "spoiler":
            prefix = "||";
            suffix = "||";
            break;
          case "underline":
            prefix = "__";
            suffix = "__";
            break;
          case "quote":
            prefix = "> ";
            suffix = "";
            break;
        }

        if (
          prefix &&
          suffix &&
          selected.startsWith(prefix) &&
          selected.endsWith(suffix) &&
          selected.length >= prefix.length + suffix.length
        ) {
          // Unwrap selection
          const unwrapped = selected.slice(
            prefix.length,
            selected.length - suffix.length,
          );
          newText =
            messageText.slice(0, start) + unwrapped + messageText.slice(end);
          newCursorStart = start;
          newCursorEnd = start + unwrapped.length;
        } else if (
          prefix &&
          suffix &&
          start >= prefix.length &&
          messageText.slice(start - prefix.length, start) === prefix &&
          messageText.slice(end, end + suffix.length) === suffix
        ) {
          // Unwrap outer text
          newText =
            messageText.slice(0, start - prefix.length) +
            selected +
            messageText.slice(end + suffix.length);
          newCursorStart = start - prefix.length;
          newCursorEnd = end - prefix.length;
        } else {
          // Wrap selection
          const wrapped = prefix + selected + suffix;
          newText = messageText.slice(0, start) + wrapped + messageText.slice(end);
          newCursorStart = start + prefix.length;
          newCursorEnd = start + prefix.length + selected.length;
        }
      }

      setMessageText(newText);
      setShowFormatBar(false);
      setShowFormatDropdown(false);
      setShowLinkPrompt(false);

      setTimeout(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(newCursorStart, newCursorEnd);
        }
      }, 0);
    },
    [messageText],
  );

  const applyLinkFormatting = useCallback(
    (url: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start == null || end == null || start === end) return;

      const selected = messageText.slice(start, end);
      const cleanUrl = url.trim() || "https://";
      const wrapped = `[${selected}](${cleanUrl})`;
      const newText =
        messageText.slice(0, start) + wrapped + messageText.slice(end);

      setMessageText(newText);
      setShowFormatBar(false);
      setShowFormatDropdown(false);
      setShowLinkPrompt(false);
      setLinkInputUrl("https://");

      setTimeout(() => {
        if (ta) {
          ta.focus();
          const pos = start + wrapped.length;
          ta.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [messageText],
  );

  /** Open profile popup for a mentioned user */
  const handleMentionClick = useCallback(
    (userId: string) => {
      const user = users.find((u) => u.id === userId);
      if (user) {
        setProfileViewUser(user);
      }
    },
    [users],
  );

  const applyRNNoiseFilter = async (
    rawStream: MediaStream,
  ): Promise<MediaStream> => {
    if (!noiseReduction || !rnnoiseAssetsRef.current) {
      try {
        const audioCtx = new AudioContext();
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        const source = audioCtx.createMediaStreamSource(rawStream);
        const outputGain = audioCtx.createGain();
        outputGain.gain.value = normalizeVolumeLevel(micVolume);
        micGainNodeRef.current = outputGain;
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(outputGain);
        outputGain.connect(destination);

        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        outputGain.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        const processedStream = destination.stream;
        const originalTracks = rawStream.getTracks();
        const cleanup = () => {
          originalTracks.forEach((ot) => ot.stop());
          if (micGainNodeRef.current === outputGain) {
            micGainNodeRef.current = null;
          }
          audioCtx.close().catch(() => {});
        };
        processedStream.getTracks().forEach((t) => {
          const oldStop = t.stop.bind(t);
          t.stop = () => {
            oldStop();
            cleanup();
          };
        });
        return processedStream;
      } catch {
        return rawStream;
      }
    }
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
        try {
          rnnoise.update(true);
        } catch {}
      }, 40);

      const processedStream = destination.stream;
      const originalTracks = rawStream.getTracks();

      // Sanity check: processed stream MUST contain a live audio track. Fall back to raw if not.
      const processedAudio = processedStream.getAudioTracks()[0];
      if (!processedAudio || processedAudio.readyState !== "live") {
        console.warn(
          "[RNNoise] Processed stream has no live audio track, falling back to raw mic",
        );
        window.clearInterval(tickTimer);
        try {
          audioCtx.close();
        } catch {}
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

      processedStream.getTracks().forEach((t) => {
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
        ...(selectedAudioInput
          ? { deviceId: { exact: selectedAudioInput } }
          : {}),
      };
      let stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
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
        const duration = Math.max(
          1,
          Math.round((Date.now() - recordStartedAtRef.current) / 1000),
        );
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
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : null,
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
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          setUploadProgress(
            Math.round((progressEvent.loaded * 100) / progressEvent.total),
          );
        }
      },
    });
    setUploadProgress(0);
    return response.data;
  };

  const applyRingtoneSource = useCallback(
    (sourceUrl: string, label: string) => {
      const safeUrl = setRingtoneSource(sourceUrl, label);
      setRingtoneUrl(safeUrl);
      setRingtoneLabel(label);
      toast.success("Ringtone applied");
    },
    [],
  );

  const applyDialToneSource = useCallback(
    (sourceUrl: string, label: string) => {
      const safeUrl = setDialToneSource(sourceUrl, label);
      setDialToneUrl(safeUrl);
      setDialToneLabel(label);
      toast.success("Outgoing tone applied");
    },
    [],
  );

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

  const resetCustomDialTone = useCallback(() => {
    resetDialToneSource();
    setDialToneUrl("");
    setDialToneLabel("Default dial tone");
    toast.success("Default outgoing tone restored");
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

  const handleDialToneUpload = async (file: File) => {
    if (!file.type.startsWith("audio/")) {
      toast.error("Audio file tanlang");
      return;
    }
    setDialToneUploading(true);
    try {
      const uploaded = await uploadFile(file);
      applyDialToneSource(uploaded.url, uploaded.fileName || file.name);
    } catch (error) {
      console.error("Dial tone upload failed:", error);
      toast.error("Outgoing tone upload bo'lmadi");
    } finally {
      setDialToneUploading(false);
    }
  };

  const previewRingtone = useCallback(() => {
    startRingtone(ringtoneUrl);
    window.setTimeout(() => stopAllCallSounds(), 5000);
  }, [ringtoneUrl]);

  const previewDialTone = useCallback(() => {
    startDialTone(dialToneUrl);
    window.setTimeout(() => stopAllCallSounds(), 5000);
  }, [dialToneUrl]);

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
          type: messageType,
        };

        if (messageType === "TEXT") {
          const text = messageText.trim();
          if (!text) {
            toast.error("Message is empty.");
            return;
          }
          groupPayload.text = text;
        } else if (messageType === "LOCATION") {
          if (
            locationAccuracy !== null &&
            locationAccuracy > MAX_LOCATION_ACCURACY_M
          ) {
            toast.error(
              `Location is too approximate (~${Math.round(locationAccuracy)}m). Try again.`,
            );
            return;
          }
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            toast.error("Invalid location values.");
            return;
          }
          groupPayload.latitude = latitude;
          groupPayload.longitude = longitude;
        } else {
          if (messageType === "FILE") {
            const files =
              pendingAttachments.length > 0
                ? pendingAttachments.map((item) => item.file)
                : selectedFile
                  ? [selectedFile]
                  : [];
            if (files.length === 0) {
              toast.error("No file selected.");
              return;
            }

            for (const file of files) {
              const uploaded = await uploadFile(file);
              await withSocketAck<GroupMessage>("group:message:send", {
                groupId: selectedGroupId,
                type: "FILE",
                fileUrl: uploaded.url,
                fileName: uploaded.fileName,
                fileMime: uploaded.fileMime,
                fileSize: uploaded.fileSize,
              });
            }
            groupPayload = null as any;
          } else {
            let file = selectedFile;
            if (!file && messageType === "VOICE" && voiceBlob) {
              file = new File([voiceBlob], `voice-${Date.now()}.webm`, {
                type: "audio/webm",
              });
            }
            if (!file) {
              toast.error("No file selected.");
              return;
            }
            const uploaded = await uploadFile(file);
            groupPayload = {
              ...groupPayload,
              fileUrl: uploaded.url,
              fileName: uploaded.fileName,
              fileMime: uploaded.fileMime,
              fileSize: uploaded.fileSize,
              durationSec:
                messageType === "VOICE"
                  ? (voiceDurationSec ?? undefined)
                  : undefined,
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
          | {
              recipientId: string;
              type: MessageType;
              fileUrl: string;
              fileName: string;
              fileMime: string;
              fileSize: number;
              durationSec?: number;
            }
          | {
              recipientId: string;
              type: MessageType;
              latitude: number;
              longitude: number;
            };

        if (messageType === "TEXT") {
          const text = messageText.trim();
          if (!text) {
            toast.error("Message is empty.");
            return;
          }
          payload = { recipientId: selectedUserId, type: "TEXT", text };
        } else if (messageType === "LOCATION") {
          if (
            locationAccuracy !== null &&
            locationAccuracy > MAX_LOCATION_ACCURACY_M
          ) {
            toast.error(
              `Location is too approximate (~${Math.round(locationAccuracy)}m). Try again.`,
            );
            return;
          }
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            toast.error("Invalid location values.");
            return;
          }
          payload = {
            recipientId: selectedUserId,
            type: "LOCATION",
            latitude,
            longitude,
          };
        } else {
          if (messageType === "FILE") {
            const files =
              pendingAttachments.length > 0
                ? pendingAttachments.map((item) => item.file)
                : selectedFile
                  ? [selectedFile]
                  : [];
            if (files.length === 0) {
              toast.error("No file selected.");
              return;
            }

            for (const file of files) {
              const uploaded = await uploadFile(file);
              await withSocketAck<Message>("message:send", {
                recipientId: selectedUserId,
                type: "FILE",
                fileUrl: uploaded.url,
                fileName: uploaded.fileName,
                fileMime: uploaded.fileMime,
                fileSize: uploaded.fileSize,
              });
            }
            payload = null as any;
          } else {
            let file = selectedFile;
            if (!file && messageType === "VOICE" && voiceBlob) {
              file = new File([voiceBlob], `voice-${Date.now()}.webm`, {
                type: "audio/webm",
              });
            }
            if (!file) {
              toast.error("No file selected.");
              return;
            }
            const uploaded = await uploadFile(file);
            payload = {
              recipientId: selectedUserId,
              type: messageType,
              fileUrl: uploaded.url,
              fileName: uploaded.fileName,
              fileMime: uploaded.fileMime,
              fileSize: uploaded.fileSize,
              durationSec:
                messageType === "VOICE"
                  ? (voiceDurationSec ?? undefined)
                  : undefined,
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
        memberIds: newGroupMembers,
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
      const response = await api.post<{ group: Group }>(
        `/groups/${selectedGroupId}/members`,
        {
          memberIds: addMemberIds,
        },
      );
      setGroups((prev) =>
        prev.map((g) =>
          g.id === response.data.group.id ? response.data.group : g,
        ),
      );
      setShowAddGroupMembers(false);
      setAddMemberIds([]);
      toast.success("Members added!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to add members."));
    }
  };

  const updateGroupDetails = async (payload: {
    name?: string;
    avatarUrl?: string | null;
  }) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.patch<{ group: Group }>(
        `/groups/${selectedGroupId}`,
        payload,
      );
      setGroups((prev) =>
        prev.map((g) =>
          g.id === response.data.group.id ? response.data.group : g,
        ),
      );
      return response.data.group;
    } catch (error) {
      if (getAxiosStatus(error) !== 404) {
        throw error;
      }

      const response = await api.put<{ group: Group }>(
        `/groups/${selectedGroupId}`,
        payload,
      );
      setGroups((prev) =>
        prev.map((g) =>
          g.id === response.data.group.id ? response.data.group : g,
        ),
      );
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

  const updateGroupMemberRole = async (
    memberUserId: string,
    role: Exclude<GroupRole, "OWNER">,
  ) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.patch<{ group: Group }>(
        `/groups/${selectedGroupId}/members/${memberUserId}/role`,
        { role },
      );
      setGroups((prev) =>
        prev.map((g) =>
          g.id === response.data.group.id ? response.data.group : g,
        ),
      );
      toast.success(
        role === "ADMIN" ? "Member promoted to admin." : "Admin role removed.",
      );
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to update member role."));
    }
  };

  const kickGroupMember = async (memberUserId: string) => {
    if (!selectedGroupId) {
      return;
    }
    try {
      const response = await api.delete<{ group: Group }>(
        `/groups/${selectedGroupId}/members/${memberUserId}`,
      );
      if (response.data.group) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === response.data.group.id ? response.data.group : g,
          ),
        );
      }
      toast.success("Member removed from group.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Failed to remove member."));
    }
  };

  const setupPeerConnection = useCallback(
    async (recipientId: string) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const peer = new RTCPeerConnection(getRtcConfiguration());
      const localCandTypes: Record<string, number> = {};

      peer.onicecandidate = (event) => {
        if (!event.candidate || !socketRef.current) {
          if (!event.candidate) {
            console.info(
              `[ICE][direct] gathering complete. Local candidate types:`,
              localCandTypes,
            );
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
        if (localCandTypes[typ] === 1)
          pushCallEvent(
            `local cand ${typ}/${proto}`,
            typ === "relay" ? "ok" : "info",
          );
        const target = callPeerIdRef.current;
        if (!target || target === callGroupIdRef.current) {
          pendingIceCandidatesRef.current.push(event.candidate.toJSON());
          return;
        }
        socketRef.current.emit("call:ice-candidate", {
          recipientId: target,
          candidate: event.candidate.toJSON(),
        });
      };

      peer.onicegatheringstatechange = () => {
        console.info(
          `[ICE][direct] gathering state: ${peer.iceGatheringState}`,
        );
      };

      peer.ontrack = (event) => {
        console.log(
          "[WebRTC] ontrack fired:",
          event.track.kind,
          "streams:",
          event.streams.length,
        );
        if (event.track.kind === "video") {
          const video = remoteVideoRef.current;
          if (video) {
            video.srcObject =
              event.streams[0] || new MediaStream([event.track]);
            video.play().catch(() => {});
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
            console.warn(
              "[WebRTC] remoteAudioRef is null, cannot play remote audio!",
            );
            return;
          }
          // Check if we already have this exact track playing — skip if same
          const existing = audio.srcObject as MediaStream | null;
          if (
            existing &&
            existing
              .getAudioTracks()
              .some((t) => t.id === event.track.id && t.readyState === "live")
          ) {
            console.log("[WebRTC] Same audio track already active, skipping");
            return;
          }
          const stream = new MediaStream([event.track]);
          audio.srcObject = stream;
          audio.volume = toMediaElementVolume(speakerVolumeRef.current);
          if (
            selectedAudioOutputRef.current &&
            typeof (audio as any).setSinkId === "function"
          ) {
            (audio as any)
              .setSinkId(selectedAudioOutputRef.current)
              .catch((err: any) => {
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
            audio
              .play()
              .then(() => {
                console.log(
                  `[WebRTC] Remote audio playing (attempt ${attempts})`,
                );
              })
              .catch((err) => {
                console.warn(
                  `[WebRTC] audio.play() attempt ${attempts} failed:`,
                  err,
                );
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

      const triggerIceRestart = async () => {
        try {
          if (!peer || peer.signalingState === "closed") return;
          peer.restartIce();
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          if (callPeerIdRef.current && socketRef.current?.connected) {
            socketRef.current.emit("call:renegotiate", {
              recipientId: callPeerIdRef.current,
              type: "offer",
              sdp: offer,
            });
            console.info("[WebRTC] Sent ICE restart renegotiation offer");
          }
        } catch (err) {
          console.warn("[WebRTC] restartIce / renegotiate failed:", err);
        }
      };

      // Monitor ICE connection state
      peer.oniceconnectionstatechange = () => {
        const state = peer.iceConnectionState;
        console.log("[WebRTC] ICE connection state:", state);
        pushCallEvent(
          `ICE: ${state}`,
          state === "connected" || state === "completed"
            ? "ok"
            : state === "failed"
              ? "err"
              : state === "disconnected"
                ? "warn"
                : "info",
        );
        if (state === "failed") {
          toast.error("Aloqa uzildi. Qayta ulanish kutilmoqda...");
          pushCallEvent("restartIce() — failed state", "warn");
          void triggerIceRestart();
          if (!callDisconnectedTimerRef.current) {
            callDisconnectedTimerRef.current = window.setTimeout(() => {
              callDisconnectedTimerRef.current = null;
              if (callStatusRef.current !== "idle") {
                stopCall(false);
                toast.error("Aloqa tiklanmadi (25s kutildi). Qo'ng'iroq tugatildi.");
              }
            }, 25000);
          }
        } else if (state === "disconnected") {
          toast("Aloqa vaqtincha uzildi. Qayta ulanmoqda...");
          pushCallEvent("restartIce() — disconnected", "warn");
          void triggerIceRestart();
          if (!callDisconnectedTimerRef.current) {
            callDisconnectedTimerRef.current = window.setTimeout(() => {
              callDisconnectedTimerRef.current = null;
              if (callStatusRef.current !== "idle") {
                stopCall(false);
                toast.error("Aloqa tiklanmadi (25s kutildi). Qo'ng'iroq tugatildi.");
              }
            }, 25000);
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
            audio.play().catch(() => {});
          }
        } else {
          if (
            callDisconnectedTimerRef.current &&
            (state === "checking" || state === "new")
          ) {
            window.clearTimeout(callDisconnectedTimerRef.current);
            callDisconnectedTimerRef.current = null;
          }
        }
      };

      peer.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", peer.connectionState);
        pushCallEvent(
          `Conn: ${peer.connectionState}`,
          peer.connectionState === "connected"
            ? "ok"
            : peer.connectionState === "failed"
              ? "err"
              : "info",
        );
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          console.warn(
            `[WebRTC] connectionState=${peer.connectionState} → attempting ICE restart`,
          );
          toast("Aloqa uzildi. Qayta ulanish kutilmoqda...");
          void triggerIceRestart();
          if (!callDisconnectedTimerRef.current) {
            callDisconnectedTimerRef.current = window.setTimeout(() => {
              callDisconnectedTimerRef.current = null;
              if (
                callStatusRef.current !== "idle" &&
                (peer.connectionState === "failed" ||
                  peer.connectionState === "disconnected" ||
                  peer.iceConnectionState === "failed" ||
                  peer.iceConnectionState === "disconnected")
              ) {
                stopCall(false);
                toast.error("Aloqa tiklanmadi (25s kutildi). Qo'ng'iroq tugatildi.");
              }
            }, 25000);
          }
        }
      };

      peerConnectionRef.current = peer;
      return peer;
    },
    [logSelectedIceRoute, stopCall, pushCallEvent],
  );

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
      ...(selectedAudioInput
        ? { deviceId: { exact: selectedAudioInput } }
        : {}),
    };

    const logTrack = async (stream: MediaStream, source: string) => {
      const track = stream.getAudioTracks()[0];
      if (!track) {
        console.error(`[Mic] ${source}: NO audio track in stream!`);
        return;
      }
      const settings = track.getSettings();
      console.info(
        `[Mic] ${source} OK — label="${track.label}" deviceId=${settings.deviceId} state=${track.readyState} muted=${track.muted} enabled=${track.enabled} sampleRate=${settings.sampleRate} channels=${settings.channelCount}`,
      );
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const dev = devs.find(
          (d) => d.deviceId === settings.deviceId && d.kind === "audioinput",
        );
        if (dev)
          console.info(
            `[Mic] device-info: "${dev.label}" groupId=${dev.groupId}`,
          );
      } catch {}
    };

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      await logTrack(
        s,
        selectedAudioInput
          ? `selected(${selectedAudioInput.slice(0, 8)})`
          : "default",
      );
      return s;
    } catch (err) {
      if (!selectedAudioInput) {
        console.error("[Mic] getUserMedia failed (no saved deviceId)", err);
        throw err;
      }
      console.warn(
        "[Mic] Selected mic unavailable, retrying with default input",
        err,
      );
      setSelectedAudioInput("");
      localStorage.removeItem("audio_input");
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      await logTrack(s, "fallback-default");
      return s;
    }
  }, [noiseReduction, selectedAudioInput]);

  const runLoopbackCallTest = useCallback(async (): Promise<boolean> => {
    console.info(
      "[Loopback] ▶ start E2E test (mic → RNNoise → RTCPeerConnection loopback → audio element)",
    );
    let micStream: MediaStream | null = null;
    let processed: MediaStream | null = null;
    let pc1: RTCPeerConnection | null = null;
    let pc2: RTCPeerConnection | null = null;
    let testAudio: HTMLAudioElement | null = null;
    let monitorTimer: number | null = null;
    const cleanup = () => {
      if (monitorTimer) window.clearInterval(monitorTimer);
      try {
        pc1?.close();
      } catch {}
      try {
        pc2?.close();
      } catch {}
      try {
        processed?.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        micStream?.getTracks().forEach((t) => t.stop());
      } catch {}
      if (testAudio) {
        try {
          testAudio.pause();
        } catch {}
        testAudio.srcObject = null;
        testAudio.remove();
      }
    };

    try {
      micStream = await getCallMicStream();
      const rawT = micStream.getAudioTracks()[0];
      console.info(
        `[Loopback] mic raw track: id=${rawT?.id} state=${rawT?.readyState} muted=${rawT?.muted} enabled=${rawT?.enabled} label="${rawT?.label}"`,
      );
      if (!rawT || rawT.readyState !== "live") {
        console.error("[Loopback] FAIL: raw mic track not live");
        cleanup();
        return false;
      }

      processed = await applyRNNoiseFilter(micStream);
      const procT = processed.getAudioTracks()[0];
      console.info(
        `[Loopback] processed (post-RNNoise): id=${procT?.id} state=${procT?.readyState} muted=${procT?.muted} enabled=${procT?.enabled}`,
      );
      if (!procT || procT.readyState !== "live") {
        console.error(
          "[Loopback] FAIL: processed track not live after RNNoise",
        );
        cleanup();
        return false;
      }

      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => {
        if (e.candidate) pc2!.addIceCandidate(e.candidate).catch(() => {});
      };
      pc2.onicecandidate = (e) => {
        if (e.candidate) pc1!.addIceCandidate(e.candidate).catch(() => {});
      };
      pc1.oniceconnectionstatechange = () =>
        console.info(`[Loopback] pc1 ICE: ${pc1!.iceConnectionState}`);
      pc2.oniceconnectionstatechange = () =>
        console.info(`[Loopback] pc2 ICE: ${pc2!.iceConnectionState}`);

      testAudio = document.createElement("audio");
      testAudio.autoplay = true;
      (testAudio as any).playsInline = true;
      testAudio.volume = 1;
      document.body.appendChild(testAudio);

      pc2.ontrack = (e) => {
        console.info(
          `[Loopback] pc2 ontrack: kind=${e.track.kind} id=${e.track.id} streams=${e.streams.length}`,
        );
        const s = e.streams[0] || new MediaStream([e.track]);
        testAudio!.srcObject = s;
        testAudio!
          .play()
          .then(() => console.info("[Loopback] testAudio.play() OK"))
          .catch((err) =>
            console.warn("[Loopback] testAudio.play() failed:", err),
          );
      };

      processed.getTracks().forEach((t) => {
        const sender = pc1!.addTrack(t, processed!);
        console.info(
          `[Loopback] pc1 addTrack kind=${t.kind} id=${t.id} senderTrack=${sender.track?.id}`,
        );
      });

      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      const audioMline = (offer.sdp || "")
        .split("\n")
        .find((l) => l.startsWith("m=audio"));
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
        console.info(
          `[Loopback] @${++samples}s inbound bytes=${inboundBytes} (Δ${delta}) pkts=${packetsReceived}`,
        );
        lastBytes = inboundBytes;
      }, 1000);

      await new Promise((r) => setTimeout(r, 5500));
      window.clearInterval(monitorTimer);
      monitorTimer = null;
      cleanup();

      if (bytesEverGrew) {
        console.info(
          "[Loopback] ✅ PASS: media bytes flowed end-to-end. Audio pipeline OK.",
        );
        return true;
      }
      console.error(
        "[Loopback] ❌ FAIL: zero inbound audio bytes received in 5s. Pipeline broken.",
      );
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
        audioEl
          .play()
          .then(() => {
            audioEl.muted = false;
          })
          .catch(() => {
            audioEl.muted = false;
          });
        window.setTimeout(() => {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
        }, 0);
      }

      console.info(
        `[Call] ▶ startCall (OUTGOING) → peer=${targetPeerId} micVolume=${micVolume} noiseReduction=${noiseReduction}`,
      );
      setCallMicMuted(false);
      let rawStream = await getCallMicStream();
      const beforeFilter = rawStream.getAudioTracks()[0];
      console.info(
        `[Call] raw mic track before RNNoise: id=${beforeFilter?.id} state=${beforeFilter?.readyState} muted=${beforeFilter?.muted}`,
      );
      rawStream = await applyRNNoiseFilter(rawStream);
      const afterFilter = rawStream.getAudioTracks()[0];
      console.info(
        `[Call] mic track AFTER RNNoise: id=${afterFilter?.id} state=${afterFilter?.readyState} muted=${afterFilter?.muted} enabled=${afterFilter?.enabled}`,
      );
      localCallStreamRef.current = rawStream;
      pendingIceCandidatesRef.current = [];
      remoteDescriptionSetRef.current = false;
      remoteIceCandidatesBufferRef.current = [];
      setCallPeerId(targetPeerId);
      callPeerIdRef.current = targetPeerId;
      const peer = await setupPeerConnection(targetPeerId);
      rawStream.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, rawStream);
        console.info(
          `[Call] addTrack kind=${track.kind} id=${track.id} senderId=${(sender as any)?.track?.id}`,
        );
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const audioMline = (offer.sdp || "")
        .split("\n")
        .find((l) => l.startsWith("m=audio"));
      const sendrecv = /a=sendrecv/.test(offer.sdp || "");
      console.info(
        `[Call] Local OFFER created. audio m-line="${audioMline?.trim()}" hasSendrecv=${sendrecv}`,
      );

      socketRef.current.emit("call:offer", {
        recipientId: targetPeerId,
        sdp: offer,
      });
      console.info(`[Call] ✉ call:offer SENT → ${targetPeerId}`);

      setCallStatus("calling");
      // Persist active-call state for auto-resume after restart/update
      saveActiveCallState({
        peerId: targetPeerId,
        type: "direct",
        startedAt: Date.now(),
        lastTickAt: Date.now(),
      });

      // Answer-timeout: if no call:answer arrives in 30s, abort with clear message
      if (callAnswerTimeoutRef.current) {
        window.clearTimeout(callAnswerTimeoutRef.current);
      }
      callAnswerTimeoutRef.current = window.setTimeout(() => {
        callAnswerTimeoutRef.current = null;
        if (callStatusRef.current === "calling") {
          console.warn("[Call] ⏱ No call:answer in 30s — aborting");
          toast.error(
            "Boshqa tomon javob bermadi (30s). Versiyasi eski yoki offline bo'lishi mumkin.",
          );
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
  // ── Auto-resume active call on restart/update ──
  // If the app was closed (or restarted for update) while in a call,
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
    autoResumeAttemptedRef.current = true;
    clearActiveCallState();

    // Small delay so socket auth + handlers fully attached
    window.setTimeout(() => {
      if (callStatusRef.current !== "idle") return;
      toast.success("Ilova yangilandi! Qo'ng'iroq qayta ulanmoqda...");
      if (saved.type === "direct" && saved.peerId) {
        startCallRef.current?.(saved.peerId).catch((err) => {
          console.warn("[Call] auto-resume failed:", err);
        });
      }
    }, 1500);
  }, [isSocketConnected]);

  const toggleScreenShare = async () => {
    if (callGroupIdRef.current) {
      toast("Group call uchun ekran ulashish hozircha o'chirilgan.");
      return;
    }
    if (
      !peerConnectionRef.current ||
      !socketRef.current ||
      !callPeerIdRef.current
    )
      return;

    if (isScreenSharing) {
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;

      // Remove all screenshare senders (video and any leftover audio)
      const senders = peerConnectionRef.current.getSenders();
      const micTrack = localCallStreamRef.current?.getAudioTracks()[0] ?? null;
      for (const sender of senders) {
        if (
          sender.track &&
          sender.track !== micTrack &&
          (sender.track.kind === "video" || sender.track.kind === "audio")
        ) {
          peerConnectionRef.current.removeTrack(sender);
        }
      }

      setIsScreenSharing(false);
      setLocalScreenFullscreen(false);

      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit("call:renegotiate", {
        recipientId: callPeerIdRef.current,
        type: "offer",
        sdp: offer,
      });
    } else {
      try {
        const stream = await navigator.mediaDevices
          .getDisplayMedia({ video: true, audio: true })
          .catch(() => null);
        if (!stream) return;

        localScreenStreamRef.current = stream;
        setIsScreenSharing(true);

        // Only add video track — keep call audio separate from screenshare
        stream.getTracks().forEach((t) => {
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
        socketRef.current.emit("call:renegotiate", {
          recipientId: callPeerIdRef.current,
          type: "offer",
          sdp: offer,
        });
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
        audioEl
          .play()
          .then(() => {
            audioEl.muted = false;
          })
          .catch(() => {
            audioEl.muted = false;
          });
        window.setTimeout(() => {
          if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
        }, 0);
      }

      console.info(
        `[Call] ▶ acceptCall (INCOMING) ← from=${incomingCall.fromUserId} micVolume=${micVolume} noiseReduction=${noiseReduction} group=${callGroupIdRef.current ?? "-"}`,
      );
      setCallMicMuted(false);
      let rawStream = await getCallMicStream();
      const beforeF = rawStream.getAudioTracks()[0];
      console.info(
        `[Call] raw mic before RNNoise: id=${beforeF?.id} state=${beforeF?.readyState} muted=${beforeF?.muted}`,
      );
      rawStream = await applyRNNoiseFilter(rawStream);
      const afterF = rawStream.getAudioTracks()[0];
      console.info(
        `[Call] mic AFTER RNNoise: id=${afterF?.id} state=${afterF?.readyState} muted=${afterF?.muted} enabled=${afterF?.enabled}`,
      );
      localCallStreamRef.current = rawStream;

      if (callGroupIdRef.current) {
        const groupId = callGroupIdRef.current;
        const peer = setupGroupPeerConnection(incomingCall.fromUserId);
        await peer.setRemoteDescription(
          new RTCSessionDescription(incomingCall.sdp),
        );
        groupRemoteDescriptionSetRef.current.set(incomingCall.fromUserId, true);
        const buffered =
          groupRemoteIceCandidatesBufferRef.current.get(
            incomingCall.fromUserId,
          ) ?? [];
        groupRemoteIceCandidatesBufferRef.current.set(
          incomingCall.fromUserId,
          [],
        );
        console.info(
          `[GroupCall] Flushing ${buffered.length} buffered remote ICE candidates from ${incomingCall.fromUserId}`,
        );
        pushCallEvent(
          `grp flushed ${buffered.length} cand`,
          buffered.length > 0 ? "ok" : "warn",
        );
        for (const candidate of buffered) {
          await peer
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch((err) => {
              console.warn(
                "[WebRTC] group buffered addIceCandidate failed:",
                err,
              );
            });
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current.emit("group:call:answer", {
          groupId,
          toUserId: incomingCall.fromUserId,
          sdp: answer,
        });

        socketRef.current.emit("group:call:join", { groupId });
        requestGroupCallStatus(groupId);
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
        saveActiveCallState({
          peerId: groupId,
          type: "group",
          startedAt: Date.now(),
          lastTickAt: Date.now(),
        });
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

      await peer.setRemoteDescription(
        new RTCSessionDescription(incomingCall.sdp),
      );
      remoteDescriptionSetRef.current = true;
      // Flush ALL buffered remote ICE candidates (those received during ringing + during setRemoteDescription)
      const buffered = remoteIceCandidatesBufferRef.current;
      remoteIceCandidatesBufferRef.current = [];
      console.info(
        `[Call] Flushing ${buffered.length} buffered remote ICE candidates`,
      );
      pushCallEvent(
        `flushed ${buffered.length} remote cand`,
        buffered.length > 0 ? "ok" : "warn",
      );
      for (const c of buffered) {
        await peer.addIceCandidate(new RTCIceCandidate(c)).catch((err) => {
          console.warn("[WebRTC] buffered addIceCandidate failed:", err);
        });
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socketRef.current.emit("call:answer", {
        recipientId: incomingCall.fromUserId,
        sdp: answer,
      });

      // If this is a group call, emit join and start VAD
      if (callGroupIdRef.current) {
        socketRef.current.emit("group:call:join", {
          groupId: callGroupIdRef.current,
        });
        setGroupCallParticipants((prev) => {
          const uid = currentUserIdRef.current;
          if (prev.some((p) => p.userId === uid)) return prev;
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
        lastTickAt: Date.now(),
      });
      toast.success("Call accepted.");
    } catch (err: any) {
      const stage = err?.message || String(err);
      console.error("[Call] ❌ acceptCall FAILED:", err);
      toast.error(`Accept fail: ${stage}`.slice(0, 200));
      try {
        if (incomingCall && socketRef.current) {
          if (callGroupIdRef.current) {
            socketRef.current.emit("group:call:leave", {
              groupId: callGroupIdRef.current,
            });
          } else {
            socketRef.current.emit("call:end", {
              recipientId: incomingCall.fromUserId,
              reason: `accept-error: ${stage}`.slice(0, 120),
            });
          }
        }
      } catch {}
      stopCall(true);
    }
  };

  const declineCall = () => {
    if (incomingCall && socketRef.current) {
      if (callGroupIdRef.current) {
        socketRef.current.emit("group:call:leave", {
          groupId: callGroupIdRef.current,
        });
      } else {
        socketRef.current.emit("call:end", {
          recipientId: incomingCall.fromUserId,
          reason: "declined",
        });
      }
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
    return () => {
      EventsOff("call-notif:action");
    };
  }, []);

  useEffect(() => {
    if (!isNativeMobileRuntime) {
      return;
    }

    let appStateHandle: PluginListenerHandle | undefined;
    let notificationActionHandle: PluginListenerHandle | undefined;

    CapacitorApp.getState()
      .then((state) => {
        isAppActiveRef.current = state.isActive;
        if (state.isActive) {
          void clearMobileCallNotification();
          syncActiveChatSnapshot();
        }
      })
      .catch(() => {});

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      isAppActiveRef.current = isActive;
      if (isActive) {
        void clearMobileCallNotification();
        syncActiveChatSnapshot();
      }
    })
      .then((handle) => {
        appStateHandle = handle;
      })
      .catch(() => {});

    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
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
      },
    )
      .then((handle) => {
        notificationActionHandle = handle;
      })
      .catch(() => {});

    return () => {
      void appStateHandle?.remove();
      void notificationActionHandle?.remove();
    };
  }, [
    clearMobileCallNotification,
    openNotificationTarget,
    syncActiveChatSnapshot,
  ]);

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
            a.play()
              .then(() => {
                console.log("[Call] Remote audio playing via retry");
              })
              .catch(() => {});
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
    return () => {
      EventsOff("update:progress");
    };
  }, [isWails]);

  // ── AUTO-LOCK: lock app after idle/minimized timeout ──
  useEffect(() => {
    if (!appLockEnabled || !autoLockEnabled || appLocked) return;

    const startAutoLockTimer = () => {
      if (autoLockTimerRef.current)
        window.clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = window.setTimeout(
        () => {
          if (appLockEnabled && autoLockEnabled) {
            setAppLocked(true);
          }
        },
        autoLockMinutes * 60 * 1000,
      );
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
    setPinnedChats((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      localStorage.setItem("pinned_chats", JSON.stringify([...next]));
      return next;
    });
  };
  const toggleArchive = (chatId: string) => {
    setArchivedChats((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
  };
  const removeChat = (chatId: string) => {
    setArchivedChats((prev) => {
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
  const handleDragOver = (e: React.DragEvent, chatId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedChatId && chatId !== draggedChatId) setDragOverId(chatId);
  };
  const handleDragLeave = () => setDragOverId(null);
  const handleDrop = (targetChatId: string, items: { id: string }[]) => {
    if (!draggedChatId || draggedChatId === targetChatId) return;
    const ids = items.map((i) => i.id);
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
  const handleDragEnd = () => {
    setDraggedChatId(null);
    setDragOverId(null);
  };

  // Sort function: pinned first, then custom order, then default
  const sortChats = <T extends { id: string }>(list: T[]): T[] => {
    const pinned = list.filter((i) => pinnedChats.has(i.id));
    const unpinned = list.filter((i) => !pinnedChats.has(i.id));
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
    let list = users.filter((u) => !archivedChats.has(u.id) || showArchived);
    if (chatSearch.trim()) {
      const q = chatSearch.toLowerCase();
      list = list.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      );
    }
    return sortChats(list);
  }, [users, chatSearch, pinnedChats, archivedChats, chatOrder, showArchived]);

  const filteredGroups = useMemo(() => {
    let list = groups.filter((g) => !archivedChats.has(g.id) || showArchived);
    if (chatSearch.trim()) {
      const q = chatSearch.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q));
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

  const handleConfirmDelete = async (forEveryone: boolean) => {
    if (!deleteModalState || deleteModalState.messageIds.length === 0) return;
    const { messageIds, isGroup } = deleteModalState;
    try {
      if (isGroup) {
        for (const id of messageIds) {
          await api
            .delete(`/groups/${selectedGroupId}/messages/${id}`)
            .catch(() => {});
        }
        setGroupMessages((prev) =>
          prev.filter((m) => !messageIds.includes(m.id)),
        );
        toast.success("O'chirildi");
      } else {
        await api.delete("/messages", {
          data: { messageIds, forEveryone },
        });
        setMessages((prev) => prev.filter((m) => !messageIds.includes(m.id)));
        toast.success(
          forEveryone
            ? "Xabar barchadan o'chirildi"
            : "Xabar faqat sizdan o'chirildi",
        );
      }
    } catch (err) {
      toast.error(readAxiosMessage(err, "O'chirishda xatolik"));
    } finally {
      setSelectedMessageIds(new Set());
      setIsSelectionMode(false);
      setDeleteModalState(null);
    }
  };

  // ── APP LOCK SCREEN ──
  if (appLocked && appLockEnabled) {
    return (
      <AppLockScreen
        lockPasscodeInputRef={lockPasscodeInputRef}
        lockPasscodeInput={lockPasscodeInput}
        setLockPasscodeInput={setLockPasscodeInput}
        unlockKeyboardMode={unlockKeyboardMode}
        setUnlockKeyboardMode={setUnlockKeyboardMode}
        handleUnlock={handleUnlock}
        sanitizeUnlockInput={sanitizeUnlockInput}
        passcodeMaxLength={PASSCODE_MAX_LENGTH}
        updateModalProps={
          updateAvailable
            ? {
                updateAvailable,
                onClose: () => setUpdateAvailable(null),
                onInstall: handleUpdateInstall,
                isUpdating,
                updateActionLabel,
                updateProgress,
                updateSpeedLabel,
              }
            : undefined
        }
      />
    );
  }

  if (!token || !currentUser) {
    return (
      <AuthScreen
        token={token}
        isSessionBootstrapping={isSessionBootstrapping}
        sessionBootstrapError={sessionBootstrapError}
        onRetryBootstrap={() => setSessionBootstrapNonce((prev) => prev + 1)}
        onAuthSuccess={applySession}
        startGoogleLogin={startGoogleLogin}
        googleAuthLoading={googleAuthLoading}
        appVersion={appVersion}
        onCheckForUpdate={async () => {
          try {
            const result: any = await CheckForUpdate();
            void loadUpdateHistory();
            if (result?.available) {
              setUpdateAvailable({
                newVersion: result.newVersion,
                notes: result.notes || "",
              });
            } else {
              toast.success("Eng so'nggi versiyadasiz!");
            }
          } catch {
            toast.error("Yangilanishni tekshirib bo'lmadi");
          }
        }}
      />
    );
  }

  return (
    <div
      className={`layout dark${isMobileChatOpen ? " mobile-chat-open" : ""}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}
    >
      {/* ── GLOBAL MUSIC CONTROLLER BAR ── */}
      <GlobalMusicController />

      {/* ── FLOATING INCOMING CALL OVERLAY ── */}
      {!isNativeMobileRuntime &&
        !isWails &&
        callStatus === "ringing" &&
        incomingCall && (
          <div className="floating-call-overlay">
            <div className="floating-call-card">
              <div className="floating-call-pulse">📞</div>
              <div className="floating-call-info">
                <div className="floating-call-title">Incoming call</div>
                <div className="floating-call-name">
                  {users.find((u) => u.id === incomingCall.fromUserId)
                    ?.displayName ?? incomingCall.fromUserId}
                </div>
              </div>
              <div className="floating-call-btns">
                <button className="floating-accept-btn" onClick={acceptCall}>
                  ✓
                </button>
                <button className="floating-decline-btn" onClick={declineCall}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

      {/* ── BURGER MENU OVERLAY (Settings/Night Mode/etc) ── */}
      <BurgerMenu
        isOpen={leftOpen}
        onClose={() => setLeftOpen(false)}
        currentUser={currentUser}
        brokenAvatarIds={brokenAvatarIds}
        setBrokenAvatarIds={setBrokenAvatarIds}
        onOpenMyProfile={() => setShowMyProfile(true)}
        onOpenCreateGroup={() => setShowCreateGroup(true)}
        onOpenSavedMessages={() => {
          setChatMode("user");
          setSelectedUserId(currentUser?.id || "");
          setSelectedGroupId("");
          setIsSelectionMode(false);
          setSelectedMessageIds(new Set());
          if (isMobileViewport) setIsMobileChatOpen(true);
        }}
        onOpenSettings={() => setShowSettings(true)}
        appLockEnabled={appLockEnabled}
        onLockApp={() => setAppLocked(true)}
        onLogout={clearSession}
        appVersion={appVersion}
      />

      {/* ── SETTINGS MODAL ── */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        startupEnabled={startupEnabled}
        toggleStartup={toggleStartup}
        launchMinimizedOnStartup={launchMinimizedOnStartup}
        toggleLaunchMinimizedOnStartup={toggleLaunchMinimizedOnStartup}
        closeToTray={closeToTray}
        setCloseToTray={setCloseToTray}
        toastPosition={toastPosition}
        setToastPositionState={setToastPositionState}
        smoothCaret={smoothCaret}
        setSmoothCaret={setSmoothCaret}
        cursorBlink={cursorBlink}
        setCursorBlink={setCursorBlink}
        sendSound={sendSound}
        setSendSound={setSendSound}
        ringtoneUrl={ringtoneUrl}
        ringtoneLabel={ringtoneLabel}
        ringtoneUploading={ringtoneUploading}
        useServerRingtone={useServerRingtone}
        previewRingtone={previewRingtone}
        resetCustomRingtone={resetCustomRingtone}
        handleRingtoneUpload={handleRingtoneUpload}
        dialToneUrl={dialToneUrl}
        dialToneLabel={dialToneLabel}
        dialToneUploading={dialToneUploading}
        previewDialTone={previewDialTone}
        resetCustomDialTone={resetCustomDialTone}
        handleDialToneUpload={handleDialToneUpload}
        themeAccentColor={themeAccentColor}
        setThemeAccentColor={setThemeAccentColor}
        themeLayoutColor={themeLayoutColor}
        setThemeLayoutColor={setThemeLayoutColor}
        themeTextColor={themeTextColor}
        setThemeTextColor={setThemeTextColor}
        themeBackgroundColor={themeBackgroundColor}
        setThemeBackgroundColor={setThemeBackgroundColor}
        themeInputColor={themeInputColor}
        setThemeInputColor={setThemeInputColor}
        themeProfileName={themeProfileName}
        setThemeProfileName={setThemeProfileName}
        saveCurrentThemeProfileLocally={saveCurrentThemeProfileLocally}
        exportThemeProfilesToFile={exportThemeProfilesToFile}
        importThemeProfilesFromFile={importThemeProfilesFromFile}
        shareCurrentThemeProfile={shareCurrentThemeProfile}
        themeProfilesSharing={themeProfilesSharing}
        localThemeProfiles={localThemeProfiles}
        setLocalThemeProfiles={setLocalThemeProfiles}
        communityThemeProfiles={communityThemeProfiles}
        themeProfilesLoading={themeProfilesLoading}
        applyThemePalette={applyThemePalette}
        chatBackgroundImage={chatBackgroundImage}
        setChatBackgroundImage={setChatBackgroundImage}
        appLockEnabled={appLockEnabled}
        setAppLockEnabled={setAppLockEnabled}
        setAppLocked={setAppLocked}
        autoLockEnabled={autoLockEnabled}
        setAutoLockEnabled={setAutoLockEnabled}
        autoLockMinutes={autoLockMinutes}
        setAutoLockMinutes={setAutoLockMinutes}
        appVersion={appVersion}
        setUpdateAvailable={setUpdateAvailable}
        loadUpdateHistory={loadUpdateHistory}
        autoUpdateEnabled={autoUpdateEnabled}
        setAutoUpdateEnabled={setAutoUpdateEnabled}
        selectedUpdateVersion={selectedUpdateVersion}
        setSelectedUpdateVersion={setSelectedUpdateVersion}
        isLoadingUpdateHistory={isLoadingUpdateHistory}
        updateHistory={updateHistory}
        isUpdating={isUpdating}
        handleUpdateInstall={handleUpdateInstall}
        selectedUpdateHistoryItem={selectedUpdateHistoryItem}
        runLoopbackCallTest={runLoopbackCallTest}
        probeAllIceServers={probeAllIceServers}
        iceProbeResults={iceProbeResults}
        setIceProbeResults={setIceProbeResults}
      />

      {/* ── MY PROFILE MODAL ── */}
      <MyProfileModal
        isOpen={showMyProfile}
        onClose={() => setShowMyProfile(false)}
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        socketRef={socketRef}
        setLightboxUrl={setLightboxUrl}
        brokenAvatarIds={brokenAvatarIds}
        setBrokenAvatarIds={setBrokenAvatarIds}
      />

      {/* ── USER PROFILE VIEW POPUP ── */}
      {profileViewUser && (
        <UserProfileModal
          user={profileViewUser}
          onClose={() => setProfileViewUser(null)}
          apiUrl={API_URL}
          onSendMessage={(u) => {
            setChatMode("user");
            setSelectedUserId(u.id);
            setSelectedGroupId("");
            if (isMobileViewport) setIsMobileChatOpen(true);
            setSidebarTab("contacts");
          }}
          onOpenLightbox={(url) => setLightboxUrl(url)}
          brokenAvatars={brokenAvatarIds}
          onAvatarError={(uid) =>
            setBrokenAvatarIds((prev) => ({ ...prev, [uid]: true }))
          }
          hasUsableAvatar={hasUsableAvatar}
          getInitialLetter={getInitialLetter}
          formatLastSeen={formatLastSeen}
        />
      )}

      {/* ── LEFT CHAT LIST (always visible like Telegram) ── */}
      <aside className="chat-list-panel">
        <div className="chat-list-header">
          <button className="burger-btn" onClick={() => setLeftOpen(!leftOpen)}>
            ☰
          </button>
          <div className="chat-search-wrapper">
            <input
              type="text"
              className="chat-search-input"
              placeholder="Search..."
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
            />
            {chatSearch && (
              <button
                className="chat-search-clear"
                onClick={() => setChatSearch("")}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab${sidebarTab === "contacts" ? " active" : ""}`}
            onClick={() => setSidebarTab("contacts")}
          >
            Contacts ({users.length})
          </button>
          <button
            className={`sidebar-tab${sidebarTab === "groups" ? " active" : ""}`}
            onClick={() => setSidebarTab("groups")}
          >
            Groups ({groups.length})
          </button>
        </div>

        {/* Archive toggle */}
        {archivedChats.size > 0 && (
          <button
            className="archived-toggle"
            onClick={() => setShowArchived(!showArchived)}
          >
            📦{" "}
            {showArchived ? "Hide archive" : `Archived (${archivedChats.size})`}
          </button>
        )}

        {sidebarTab === "contacts" && (
          <div className="user-list">
            {/* ── Saved Messages (self-chat) ── */}
            <button
              className={`user-item saved-messages-entry${chatMode === "user" && currentUser.id === selectedUserId ? " active" : ""}`}
              onClick={() => {
                setChatMode("user");
                setSelectedUserId(currentUser.id);
                setSelectedGroupId("");
                setIsSelectionMode(false);
                setSelectedMessageIds(new Set());
                if (isMobileViewport) setIsMobileChatOpen(true);
              }}
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
                onClick={() => {
                  setChatMode("user");
                  setSelectedUserId(user.id);
                  setSelectedGroupId("");
                  setIsSelectionMode(false);
                  setSelectedMessageIds(new Set());
                  setUnreadCounts((prev) => {
                    const next = { ...prev };
                    delete next[user.id];
                    return next;
                  });
                  setMentionCounts((prev) => {
                    const next = { ...prev };
                    delete next[user.id];
                    return next;
                  });
                  if (isMobileViewport) setIsMobileChatOpen(true);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    chatId: user.id,
                    type: "user",
                  });
                }}
                draggable
                onDragStart={() => handleDragStart(user.id)}
                onDragOver={(e) => handleDragOver(e, user.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(user.id, filteredUsers)}
                onDragEnd={handleDragEnd}
              >
                {pinnedChats.has(user.id) && (
                  <span className="pin-badge">📌</span>
                )}
                {hasUsableAvatar(user.avatarUrl) &&
                !brokenAvatarIds[user.id] ? (
                  <div className="user-avatar">
                    <img
                      src={`${API_URL}${user.avatarUrl}`}
                      alt=""
                      className="user-avatar-img"
                      onError={() =>
                        setBrokenAvatarIds((prev) => ({
                          ...prev,
                          [user.id]: true,
                        }))
                      }
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
                      : user.isOnline
                        ? "online"
                        : formatLastSeen(user.lastSeenAt)}
                  </small>
                </div>
                {(unreadCounts[user.id] || 0) > 0 && (
                  <span className="unread-badge">{unreadCounts[user.id]}</span>
                )}
                {(mentionCounts[user.id] || 0) > 0 && (
                  <span className="mention-notify-badge">@</span>
                )}
              </button>
            ))}
            {filteredUsers.length === 0 && chatSearch && (
              <p
                style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}
              >
                No results found
              </p>
            )}
          </div>
        )}

        {sidebarTab === "groups" && (
          <div className="user-list">
            {filteredGroups.map((group) => (
              <button
                key={group.id}
                className={`user-item${chatMode === "group" && group.id === selectedGroupId ? " active" : ""}${pinnedChats.has(group.id) ? " pinned" : ""}${draggedChatId === group.id ? " dragging" : ""}${dragOverId === group.id ? " drag-over" : ""}`}
                onClick={() => {
                  setChatMode("group");
                  setSelectedGroupId(group.id);
                  setSelectedUserId("");
                  setIsSelectionMode(false);
                  setSelectedMessageIds(new Set());
                  setUnreadCounts((prev) => {
                    const next = { ...prev };
                    delete next[group.id];
                    return next;
                  });
                  setMentionCounts((prev) => {
                    const next = { ...prev };
                    delete next[group.id];
                    return next;
                  });
                  if (isMobileViewport) setIsMobileChatOpen(true);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    chatId: group.id,
                    type: "group",
                  });
                }}
                draggable
                onDragStart={() => handleDragStart(group.id)}
                onDragOver={(e) => handleDragOver(e, group.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(group.id, filteredGroups)}
                onDragEnd={handleDragEnd}
              >
                {pinnedChats.has(group.id) && (
                  <span className="pin-badge">📌</span>
                )}
                {group.avatarUrl ? (
                  <div className="user-avatar group-avatar">
                    <img
                      src={normalizeFileUrl(group.avatarUrl) ?? ""}
                      alt=""
                      className="user-avatar-img"
                    />
                  </div>
                ) : (
                  <div className="user-avatar group-avatar">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="user-meta">
                  <span>{group.name}</span>
                  <small>
                    {group._count?.members ?? group.members?.length ?? 0}{" "}
                    members
                  </small>
                </div>
                {(unreadCounts[group.id] || 0) > 0 && (
                  <span className="unread-badge">{unreadCounts[group.id]}</span>
                )}
                {(mentionCounts[group.id] || 0) > 0 && (
                  <span className="mention-notify-badge">@</span>
                )}
              </button>
            ))}
            {filteredGroups.length === 0 && !chatSearch && (
              <p
                style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}
              >
                No groups yet
              </p>
            )}
            {filteredGroups.length === 0 && chatSearch && (
              <p
                style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}
              >
                No results found
              </p>
            )}
          </div>
        )}
      </aside>

      {/* ── SIDEBAR RESIZE HANDLE ── */}
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleSidebarMouseDown}
      />

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
            <div
              className="chat-header-avatar saved-avatar"
              style={{ fontSize: 22 }}
            >
              🔖
            </div>
          ) : (
            chatMode === "user" &&
            activeUser &&
            (hasUsableAvatar(activeUser.avatarUrl) &&
            !brokenAvatarIds[activeUser.id] ? (
              <div
                className="chat-header-avatar"
                onClick={() => setRightOpen(!rightOpen)}
                title="View profile"
              >
                <img
                  src={`${API_URL}${activeUser.avatarUrl}`}
                  alt=""
                  className="chat-header-avatar-img"
                  onError={() =>
                    setBrokenAvatarIds((prev) => ({
                      ...prev,
                      [activeUser.id]: true,
                    }))
                  }
                />
                {activeUser.isOnline && <span className="online-dot" />}
              </div>
            ) : (
              <div
                className="chat-header-avatar"
                onClick={() => setRightOpen(!rightOpen)}
                title="View profile"
              >
                {getInitialLetter(activeUser.displayName)}
                {activeUser.isOnline && <span className="online-dot" />}
              </div>
            ))
          )}
          {chatMode === "group" &&
            activeGroup &&
            (activeGroup.avatarUrl ? (
              <div
                className="chat-header-avatar group-avatar"
                onClick={() => setRightOpen(!rightOpen)}
                title="View profile"
              >
                <img
                  src={normalizeFileUrl(activeGroup.avatarUrl) ?? ""}
                  alt=""
                  className="chat-header-avatar-img"
                />
              </div>
            ) : (
              <div
                className="chat-header-avatar group-avatar"
                onClick={() => setRightOpen(!rightOpen)}
                title="View profile"
              >
                {activeGroup.name.charAt(0).toUpperCase()}
              </div>
            ))}
          <div
            className="chat-header-info"
            onClick={() =>
              selectedUserId !== currentUser.id && setRightOpen(!rightOpen)
            }
            style={{ cursor: "pointer" }}
          >
            {chatMode === "user" ? (
              selectedUserId === currentUser.id ? (
                <>
                  <strong>Saved Messages</strong>
                  <p>your notes &amp; saved content</p>
                </>
              ) : (
                <>
                  <strong>
                    {activeUser?.displayName ?? "Select a contact"}
                  </strong>
                  <p>
                    {activeUser?.isOnline
                      ? "🟢 online"
                      : activeUser
                        ? formatLastSeen(activeUser.lastSeenAt)
                        : ""}
                  </p>
                  {(activeUser?.statusEmoji || activeUser?.statusText) && (
                    <small>
                      {`${activeUser.statusEmoji ?? ""} ${activeUser.statusText ?? ""}`.trim()}
                    </small>
                  )}
                </>
              )
            ) : (
              <>
                <strong>{activeGroup?.name ?? "Select a group"}</strong>
                <p>
                  {activeGroup
                    ? `${activeGroup._count?.members ?? activeGroup.members?.length ?? 0} a'zo`
                    : ""}
                </p>
              </>
            )}
          </div>

          <div className="call-actions">
            {activeUser && activeUser.clientType && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginRight: 4,
                  opacity: 0.6,
                }}
              >
                {activeUser.clientType === "web"
                  ? "web"
                  : `v${activeUser.clientVersion || "?"}`}
              </span>
            )}
            {incomingCall ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  className="btn-call-header-accept"
                  style={{
                    background: "#16a34a",
                    color: "#ffffff",
                    fontWeight: 700,
                    borderRadius: 8,
                    padding: "6px 12px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 0 12px rgba(22, 163, 74, 0.7)"
                  }}
                  onClick={() => void acceptCall()}
                >
                  📞 Accept
                </button>
                <button
                  className="btn-call-header-decline"
                  style={{
                    background: "#dc2626",
                    color: "#ffffff",
                    fontWeight: 700,
                    borderRadius: 8,
                    padding: "6px 12px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    border: "none",
                    cursor: "pointer"
                  }}
                  onClick={() => declineCall()}
                >
                  ✕ Deny
                </button>
              </div>
            ) : (
              callStatus === "idle" &&
              chatMode === "user" &&
              selectedUserId !== currentUser.id && (
                <button disabled={!activeUser} onClick={() => startCall()}>
                  📞 Call
                </button>
              )
            )}
            {callStatus === "idle" && chatMode === "group" && activeGroup && (
              <button
                onClick={async () => {
                  if (!socketRef.current || !selectedGroupId) return;
                  try {
                    // Unlock audio element within user gesture context
                    const audioEl = remoteAudioRef.current;
                    if (audioEl) {
                      audioEl.muted = true;
                      audioEl.srcObject = new MediaStream();
                      audioEl
                        .play()
                        .then(() => {
                          audioEl.muted = false;
                        })
                        .catch(() => {
                          audioEl.muted = false;
                        });
                      window.setTimeout(() => {
                        if (remoteAudioRef.current)
                          remoteAudioRef.current.muted = false;
                      }, 0);
                    }

                    callGroupIdRef.current = selectedGroupId;
                    setCallMicMuted(false);
                    let rawStream = await getCallMicStream();
                    rawStream = await applyRNNoiseFilter(rawStream);
                    localCallStreamRef.current = rawStream;

                    socketRef.current.emit("group:call:join", {
                      groupId: selectedGroupId,
                    });
                    setGroupCallParticipants([
                      { userId: currentUser.id, speaking: false },
                    ]);
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
                    const isJoiningExisting = activeTargetIds.length > 0;
                    const memberIds = isJoiningExisting
                      ? activeTargetIds
                      : fallbackMemberIds;

                    for (const memberId of memberIds) {
                      // If starting new call, ring all members.
                      // If joining existing call, only initiate offer if my ID < target ID to avoid glare.
                      if (!isJoiningExisting || currentUser.id < memberId) {
                        const peer = setupGroupPeerConnection(memberId);
                        const offer = await peer.createOffer();
                        await peer.setLocalDescription(offer);
                        socketRef.current.emit("group:call:offer", {
                          groupId: selectedGroupId,
                          toUserId: memberId,
                          sdp: offer,
                        });
                      }
                    }
                  } catch (err) {
                    console.error("Group call start error:", err);
                    toast.error("Group callni boshlab bo'lmadi.");
                    stopCall(true);
                  }
                }}
              >
                📞{" "}
                {joinableActiveGroupUserIds.length > 0 ? "Join" : "Group Call"}
              </button>
            )}
            {callStatus !== "idle" && (
              <button
                className="end-call-btn"
                onClick={() => {
                  stopCall(false);
                }}
              >
                End call ({callStatus})
              </button>
            )}
            <button
              className="device-settings-btn"
              onClick={() => {
                if (!showDeviceSettings) {
                  void enumerateAudioDevices();
                }
                setShowDeviceSettings((prev) => !prev);
              }}
              title="Audio device settings"
            >
              🎧
            </button>
          </div>
          {showDeviceSettings && (
            <div className="device-settings-dropdown">
              <div className="device-settings-header">
                <strong>🎙️ Audio Settings</strong>
                <button
                  className="device-settings-close"
                  onClick={() => setShowDeviceSettings(false)}
                >
                  ✕
                </button>
              </div>
              <div className="device-select-group">
                <label>Microphone (input):</label>
                <select
                  value={selectedAudioInput}
                  onChange={(e) => {
                    setSelectedAudioInput(e.target.value);
                    localStorage.setItem("audio_input", e.target.value);
                  }}
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
                  onChange={(e) => {
                    setSelectedAudioOutput(e.target.value);
                    localStorage.setItem("audio_output", e.target.value);
                  }}
                >
                  {audioOutputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="device-select-group">
                <label>
                  🎤 Mikrofon balandligi: {Math.round(micVolume * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={micVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setMicVolume(v);
                    if (micGainNodeRef.current)
                      micGainNodeRef.current.gain.value = v;
                    localStorage.setItem("mic_volume", String(v));
                  }}
                  className="volume-slider"
                />
              </div>
              <div className="device-select-group">
                <label>
                  🔊 Speaker volume: {Math.round(speakerVolume * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={speakerVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setSpeakerVolume(v);
                    if (remoteAudioRef.current)
                      remoteAudioRef.current.volume = toMediaElementVolume(v);
                    localStorage.setItem("speaker_volume", String(v));
                  }}
                  className="volume-slider"
                />
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "1rem",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "var(--text)",
                }}
              >
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

              <button
                className={`btn-test-audio${isMicTesting ? " active" : ""}`}
                style={{ marginTop: "1rem" }}
                onClick={async () => {
                  if (isMicTesting) {
                    // Stop test
                    micTestStreamRef.current
                      ?.getTracks()
                      .forEach((t) => t.stop());
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
                      ...(selectedAudioInput
                        ? { deviceId: { exact: selectedAudioInput } }
                        : {}),
                    };
                    let stream = await navigator.mediaDevices.getUserMedia({
                      audio: audioConstraints,
                    });
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
                }}
              >
                {isMicTesting ? "🛑 Testni to'xtatish" : "🎤 Test microphone"}
              </button>
            </div>
          )}
        </header>

        <section
          className={`messages${isSelectionMode ? " selection-active" : ""}`}
        >
          {chatMode === "user" && (
            <>
              {isLoadingMessages && (
                <p style={{ color: "var(--muted)", textAlign: "center" }}>
                  Loading...
                </p>
              )}
              {!isLoadingMessages &&
                (() => {
                  const userVoiceQueue = messages
                    .filter(
                      (m) =>
                        m.type === "VOICE" && !!normalizeFileUrl(m.fileUrl),
                    )
                    .map((m) => ({
                      id: m.id,
                      src: normalizeFileUrl(m.fileUrl) ?? "",
                      durationSec: m.durationSec,
                    }));
                  return messages.map((message, idx) => {
                    const isMine = message.senderId === currentUser.id;
                    return (
                      <div
                        key={message.id}
                        className={`message-row${isSelectionMode ? " selectable" : ""}${selectedMessageIds.has(message.id) ? " selected" : ""}`}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            if (
                              e.shiftKey &&
                              lastSelectedIndexRef.current !== null
                            ) {
                              // Shift+Click: select range
                              const start = Math.min(
                                lastSelectedIndexRef.current,
                                idx,
                              );
                              const end = Math.max(
                                lastSelectedIndexRef.current,
                                idx,
                              );
                              setSelectedMessageIds((prev) => {
                                const next = new Set(prev);
                                for (let i = start; i <= end; i++) {
                                  next.add(messages[i].id);
                                }
                                return next;
                              });
                            } else {
                              setSelectedMessageIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(message.id))
                                  next.delete(message.id);
                                else next.add(message.id);
                                return next;
                              });
                              lastSelectedIndexRef.current = idx;
                            }
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (isSelectionMode) {
                            setSelectedMessageIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            });
                            lastSelectedIndexRef.current = idx;
                          } else {
                            setMsgContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              message,
                              isGroup: (chatMode as string) === "group",
                            });
                          }
                        }}
                      >
                        {isSelectionMode && (
                          <label
                            className="msg-checkbox"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedMessageIds.has(message.id)}
                              onChange={(e) => {
                                if (
                                  e.nativeEvent instanceof MouseEvent &&
                                  e.nativeEvent.shiftKey &&
                                  lastSelectedIndexRef.current !== null
                                ) {
                                  const start = Math.min(
                                    lastSelectedIndexRef.current,
                                    idx,
                                  );
                                  const end = Math.max(
                                    lastSelectedIndexRef.current,
                                    idx,
                                  );
                                  setSelectedMessageIds((prev) => {
                                    const next = new Set(prev);
                                    for (let i = start; i <= end; i++) {
                                      next.add(messages[i].id);
                                    }
                                    return next;
                                  });
                                } else {
                                  setSelectedMessageIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(message.id))
                                      next.delete(message.id);
                                    else next.add(message.id);
                                    return next;
                                  });
                                  lastSelectedIndexRef.current = idx;
                                }
                              }}
                            />
                          </label>
                        )}
                        <article
                          className={isMine ? "message mine" : "message"}
                        >
                          <div className="bubble">
                            {renderMessage(
                              message,
                              setLightboxUrl,
                              isMine,
                              handleMentionClick,
                              userVoiceQueue,
                            )}
                          </div>
                          {messageReactions[message.id] &&
                            Object.keys(messageReactions[message.id]).length > 0 && (
                              <div
                                className="msg-reactions-row"
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                  marginTop: 4,
                                  marginBottom: 2,
                                }}
                              >
                                {Object.entries(messageReactions[message.id]).map(
                                  ([emoji, userIds]) => {
                                    const hasReacted = userIds.includes(
                                      currentUser.id,
                                    );
                                    return (
                                      <button
                                        key={emoji}
                                        type="button"
                                        className={`msg-reaction-badge${hasReacted ? " active" : ""}`}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 3,
                                          fontSize: "12px",
                                          padding: "2px 7px",
                                          borderRadius: "12px",
                                          border: hasReacted
                                            ? "1px solid #16a34a"
                                            : "1px solid rgba(255,255,255,0.15)",
                                          background: hasReacted
                                            ? "rgba(22, 163, 74, 0.25)"
                                            : "rgba(0,0,0,0.35)",
                                          color: "#fff",
                                          cursor: "pointer",
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleReaction(message.id, emoji, false);
                                        }}
                                      >
                                        <span>{emoji}</span>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            opacity: 0.85,
                                          }}
                                        >
                                          {userIds.length}
                                        </span>
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          <time>
                            {new Date(message.createdAt).toLocaleTimeString()}
                            <span
                              className={`msg-check${message.readAt ? " read" : ""}${!isMine && message.seenAt ? " seen" : ""}`}
                            >
                              {isMine
                                ? message.readAt
                                  ? "✓✓"
                                  : "✓"
                                : message.seenAt
                                  ? "👁✓"
                                  : message.readAt
                                    ? "✓✓"
                                    : "✓"}
                            </span>
                          </time>
                        </article>
                      </div>
                    );
                  });
                })()}
              {typingFromUserId === selectedUserId && (
                <p className="typing">typing...</p>
              )}
            </>
          )}

          {chatMode === "group" && (
            <>
              {isLoadingGroupMessages && (
                <p style={{ color: "var(--muted)", textAlign: "center" }}>
                  Loading...
                </p>
              )}
              {!isLoadingGroupMessages &&
                (() => {
                  const groupVoiceQueue = groupMessages
                    .filter(
                      (m) =>
                        m.type === "VOICE" && !!normalizeFileUrl(m.fileUrl),
                    )
                    .map((m) => ({
                      id: m.id,
                      src: normalizeFileUrl(m.fileUrl) ?? "",
                      durationSec: m.durationSec,
                    }));
                  return groupMessages.map((message, idx) => {
                    const isMine = message.senderId === currentUser.id;
                    return (
                      <div
                        key={message.id}
                        className={`message-row${isSelectionMode ? " selectable" : ""}${selectedMessageIds.has(message.id) ? " selected" : ""}`}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            if (
                              e.shiftKey &&
                              lastSelectedIndexRef.current !== null
                            ) {
                              const start = Math.min(
                                lastSelectedIndexRef.current,
                                idx,
                              );
                              const end = Math.max(
                                lastSelectedIndexRef.current,
                                idx,
                              );
                              setSelectedMessageIds((prev) => {
                                const next = new Set(prev);
                                for (let i = start; i <= end; i++) {
                                  next.add(groupMessages[i].id);
                                }
                                return next;
                              });
                            } else {
                              setSelectedMessageIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(message.id))
                                  next.delete(message.id);
                                else next.add(message.id);
                                return next;
                              });
                              lastSelectedIndexRef.current = idx;
                            }
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (isSelectionMode) {
                            setSelectedMessageIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            });
                            lastSelectedIndexRef.current = idx;
                          } else {
                            setMsgContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              message,
                              isGroup: (chatMode as string) === "group",
                            });
                          }
                        }}
                      >
                        {isSelectionMode && (
                          <label
                            className="msg-checkbox"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedMessageIds.has(message.id)}
                              onChange={(e) => {
                                if (
                                  e.nativeEvent instanceof MouseEvent &&
                                  e.nativeEvent.shiftKey &&
                                  lastSelectedIndexRef.current !== null
                                ) {
                                  const start = Math.min(
                                    lastSelectedIndexRef.current,
                                    idx,
                                  );
                                  const end = Math.max(
                                    lastSelectedIndexRef.current,
                                    idx,
                                  );
                                  setSelectedMessageIds((prev) => {
                                    const next = new Set(prev);
                                    for (let i = start; i <= end; i++) {
                                      next.add(groupMessages[i].id);
                                    }
                                    return next;
                                  });
                                } else {
                                  setSelectedMessageIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(message.id))
                                      next.delete(message.id);
                                    else next.add(message.id);
                                    return next;
                                  });
                                  lastSelectedIndexRef.current = idx;
                                }
                              }}
                            />
                          </label>
                        )}
                        <article
                          className={isMine ? "message mine" : "message"}
                          title={(() => {
                            if (!isMine) return undefined;
                            const seenNames = (message.seenBy ?? [])
                              .filter(
                                (seen) => seen.userId !== message.senderId,
                              )
                              .map(
                                (seen) =>
                                  seen.user?.displayName ||
                                  users.find((u) => u.id === seen.userId)
                                    ?.displayName ||
                                  "",
                              )
                              .filter((name): name is string => Boolean(name));
                            if (seenNames.length === 0) return undefined;
                            return `Seen by: ${Array.from(new Set(seenNames)).join(", ")}`;
                          })()}
                        >
                          {!isMine && (
                            <small className="group-sender">
                              {message.sender?.displayName ?? "?"}
                            </small>
                          )}
                          <div className="bubble">
                            {renderMessage(
                              message as unknown as Message,
                              setLightboxUrl,
                              isMine,
                              handleMentionClick,
                              groupVoiceQueue,
                            )}
                          </div>
                          {messageReactions[message.id] &&
                            Object.keys(messageReactions[message.id]).length > 0 && (
                              <div
                                className="msg-reactions-row"
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                  marginTop: 4,
                                  marginBottom: 2,
                                }}
                              >
                                {Object.entries(messageReactions[message.id]).map(
                                  ([emoji, userIds]) => {
                                    const hasReacted = userIds.includes(
                                      currentUser.id,
                                    );
                                    return (
                                      <button
                                        key={emoji}
                                        type="button"
                                        className={`msg-reaction-badge${hasReacted ? " active" : ""}`}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 3,
                                          fontSize: "12px",
                                          padding: "2px 7px",
                                          borderRadius: "12px",
                                          border: hasReacted
                                            ? "1px solid #16a34a"
                                            : "1px solid rgba(255,255,255,0.15)",
                                          background: hasReacted
                                            ? "rgba(22, 163, 74, 0.25)"
                                            : "rgba(0,0,0,0.35)",
                                          color: "#fff",
                                          cursor: "pointer",
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleReaction(message.id, emoji, true);
                                        }}
                                      >
                                        <span>{emoji}</span>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            opacity: 0.85,
                                          }}
                                        >
                                          {userIds.length}
                                        </span>
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          <time>
                            {new Date(message.createdAt).toLocaleTimeString()}
                          </time>
                        </article>
                      </div>
                    );
                  });
                })()}
              {groupTypingUserId && (
                <p className="typing">
                  {users.find((u) => u.id === groupTypingUserId)?.displayName ??
                    "Someone"}{" "}
                  typing...
                </p>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </section>

        {/* ── Selection action bar ── */}
        {isSelectionMode && (
          <div className="selection-bar">
            <button
              className="sel-btn sel-forward"
              onClick={() => setShowForwardModal(true)}
            >
              ⤳ Forward ({selectedMessageIds.size})
            </button>
            <button
              className="sel-btn sel-save"
              onClick={async () => {
                try {
                  await api.post("/messages/forward", {
                    messageIds: [...selectedMessageIds],
                    recipientId: currentUser.id,
                  });
                  toast.success(
                    `${selectedMessageIds.size} message(s) saved to Saved Messages`,
                  );
                } catch (err) {
                  toast.error(readAxiosMessage(err, "Failed to save"));
                }
                setSelectedMessageIds(new Set());
                setIsSelectionMode(false);
              }}
            >
              🔖 Save ({selectedMessageIds.size})
            </button>
            {/* Show in Explorer — only when 1 file message selected and already downloaded */}
            {selectedMessageIds.size === 1 &&
              (() => {
                const selMsg = messages.find((m) =>
                  selectedMessageIds.has(m.id),
                );
                return selMsg && selMsg.type === "FILE" && selMsg.fileUrl ? (
                  <>
                    <button
                      className="sel-btn sel-explorer"
                      onClick={async () => {
                        try {
                          const rawUrl = selMsg.fileUrl ?? "";
                          const url = normalizeFileUrl(rawUrl) ?? rawUrl;
                          const savedPath = await SaveFileFromURL(
                            url,
                            selMsg.fileName ?? "file",
                          );
                          await ShowInExplorer(savedPath);
                        } catch (err) {
                          toast.error("Error opening file");
                        }
                      }}
                    >
                      📂 Show in Explorer
                    </button>
                  </>
                ) : null;
              })()}
            <button
              className="sel-btn sel-delete"
              onClick={() => {
                if (selectedMessageIds.size === 0) return;
                const isGroup = (chatMode as string) === "group";
                const hasMyMessage = isGroup
                  ? false
                  : messages.some(
                      (m) =>
                        selectedMessageIds.has(m.id) &&
                        m.senderId === currentUser?.id,
                    );
                const activePartnerName =
                  users.find((u) => u.id === selectedUserId)?.displayName ||
                  "suhbatdosh";
                setDeleteModalState({
                  isOpen: true,
                  messageIds: [...selectedMessageIds],
                  canDeleteForEveryone: hasMyMessage,
                  recipientName: activePartnerName,
                  isGroup,
                });
              }}
            >
              🗑 Delete ({selectedMessageIds.size})
            </button>
            <button
              className="sel-btn sel-cancel"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedMessageIds(new Set());
              }}
            >
              ✕ Cancel
            </button>
          </div>
        )}

        {/* ── Forward modal ── */}
        <ForwardModal
          isOpen={showForwardModal}
          onClose={() => setShowForwardModal(false)}
          currentUser={currentUser}
          users={users}
          selectedMessageIds={selectedMessageIds}
          onForwardComplete={() => {
            setSelectedMessageIds(new Set());
            setIsSelectionMode(false);
          }}
        />

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
                        <div className="composer-attachment-preview composer-attachment-file">
                          📎
                        </div>
                      )}
                      <button
                        className="composer-attachment-name"
                        type="button"
                        onClick={() =>
                          item.previewUrl && setLightboxUrl(item.previewUrl)
                        }
                        title={item.file.name}
                      >
                        {item.file.name}
                      </button>
                      <button
                        className="attach-cancel"
                        onClick={() => removePendingAttachment(item.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : selectedFile ? (
                <span>📎 {selectedFile.name}</span>
              ) : (
                <span>Fayl tanlang yoki Ctrl+V bilan rasm qo'ying</span>
              )}
              <button
                className="attach-cancel"
                onClick={() => {
                  setMessageType("TEXT");
                  setSelectedFile(null);
                  clearPendingAttachments();
                }}
              >
                ✕
              </button>
            </div>
          )}

          {messageType === "LOCATION" && (
            <div className="composer-attach-area">
              <span>
                📍{" "}
                {locationLat && locationLng
                  ? `Location: ${Number(locationLat).toFixed(5)}, ${Number(locationLng).toFixed(5)}`
                  : "Detecting location..."}
              </span>
              <button
                className="attach-cancel"
                onClick={() => {
                  setMessageType("TEXT");
                  setLocationLat("");
                  setLocationLng("");
                  setLocationAccuracy(null);
                }}
              >
                ✕
              </button>
            </div>
          )}

          {messageType === "VOICE" && !isRecordingVoice && voiceBlob && (
            <div className="composer-attach-area">
              <span>🎤 Voice yozuv ({voiceDurationSec}s)</span>
              <button
                className="attach-cancel"
                onClick={() => {
                  setMessageType("TEXT");
                  setVoiceBlob(null);
                  setVoiceDurationSec(null);
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Voice recording overlay */}
          {isRecordingVoice && (
            <div className="composer-recording">
              <button
                className="voice-cancel"
                onClick={() => {
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
                }}
              >
                ✕
              </button>
              <div className="waveform-live">
                {recordingWaveform.map((v, i) => (
                  <div
                    key={i}
                    className="waveform-bar"
                    style={{ height: `${Math.max(4, v * 28)}px` }}
                  />
                ))}
              </div>
              <small className="rec-timer">
                {Math.round((Date.now() - recordStartedAtRef.current) / 1000)}s
              </small>
              <button className="voice-stop-btn" onClick={stopVoiceRecording}>
                ⏹ Stop
              </button>
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
              <button
                className="attach-btn"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
              >
                📎
              </button>
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
                  <div
                    className="attach-menu-backdrop"
                    onClick={() => setShowAttachMenu(false)}
                  />
                  <div className="attach-menu">
                    <button
                      onClick={() => {
                        composerFileInputRef.current?.click();
                        setShowAttachMenu(false);
                      }}
                    >
                      📎 File
                    </button>
                    <button
                      onClick={() => {
                        handleGetLocation();
                        setShowAttachMenu(false);
                      }}
                    >
                      📍 Location
                    </button>
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
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(u);
                      }}
                      onMouseEnter={() => setMentionSelectedIdx(idx)}
                    >
                      {u.avatarUrl ? (
                        <img
                          src={`${API_URL}${u.avatarUrl}`}
                          alt=""
                          className="mention-dropdown-avatar-img"
                        />
                      ) : (
                        <div className="mention-dropdown-avatar">
                          {u.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="mention-dropdown-info">
                        <span className="mention-dropdown-name">
                          {u.displayName}
                        </span>
                        {u.username && (
                          <small className="mention-dropdown-username">
                            @{u.username}
                          </small>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── TEXT FORMATTING FLOATING TOOLBAR ── */}
              {showFormatBar && (
                <div
                  className="formatting-bubble-toolbar"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {showLinkPrompt ? (
                    <div className="format-link-box">
                      <input
                        type="text"
                        className="format-link-input"
                        placeholder="https://..."
                        value={linkInputUrl}
                        autoFocus
                        onChange={(e) => setLinkInputUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            applyLinkFormatting(linkInputUrl);
                          } else if (e.key === "Escape") {
                            setShowLinkPrompt(false);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="format-link-btn"
                        onClick={() => applyLinkFormatting(linkInputUrl)}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        style={{ fontSize: 11 }}
                        onClick={() => setShowLinkPrompt(false)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="format-btn"
                        title="Havola qo'shish (Ctrl+K)"
                        onClick={() => {
                          setShowLinkPrompt(true);
                          setShowFormatDropdown(false);
                        }}
                      >
                        <span style={{ fontSize: 13 }}>🔗</span>
                      </button>
                      <button
                        type="button"
                        className="format-btn bold"
                        title="Qalin / Bold (Ctrl+B)"
                        onClick={() => applyFormatting("bold")}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        className="format-btn italic"
                        title="Qiya / Italic (Ctrl+I)"
                        onClick={() => applyFormatting("italic")}
                      >
                        I
                      </button>
                      <div className="format-divider" />
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          className="format-btn"
                          style={{ gap: 2, fontSize: 12, fontWeight: 500 }}
                          title="Boshqa formatlar"
                          onClick={() => setShowFormatDropdown((prev) => !prev)}
                        >
                          Text <span style={{ fontSize: 9 }}>▼</span>
                        </button>
                        {showFormatDropdown && (
                          <div className="format-dropdown-menu">
                            <button
                              type="button"
                              className="format-dropdown-item"
                              onClick={() => applyFormatting("strike")}
                            >
                              <span style={{ textDecoration: "line-through" }}>
                                Chizilgan (Strike)
                              </span>
                              <small
                                style={{ marginLeft: "auto", opacity: 0.6 }}
                              >
                                Ctrl+Shift+X
                              </small>
                            </button>
                            <button
                              type="button"
                              className="format-dropdown-item"
                              onClick={() => applyFormatting("mono")}
                            >
                              <code style={{ fontFamily: "monospace" }}>
                                Monospace
                              </code>
                              <small
                                style={{ marginLeft: "auto", opacity: 0.6 }}
                              >
                                Ctrl+Shift+M
                              </small>
                            </button>
                            <button
                              type="button"
                              className="format-dropdown-item"
                              onClick={() => applyFormatting("spoiler")}
                            >
                              <span>👁‍🗨 Spoiler</span>
                              <small
                                style={{ marginLeft: "auto", opacity: 0.6 }}
                              >
                                Ctrl+Shift+P
                              </small>
                            </button>
                            <button
                              type="button"
                              className="format-dropdown-item"
                              onClick={() => applyFormatting("underline")}
                            >
                              <span style={{ textDecoration: "underline" }}>
                                Tagiga chizilgan
                              </span>
                              <small
                                style={{ marginLeft: "auto", opacity: 0.6 }}
                              >
                                Ctrl+U
                              </small>
                            </button>
                            <button
                              type="button"
                              className="format-dropdown-item"
                              onClick={() => applyFormatting("quote")}
                            >
                              <span>❝ Iqtibos (Quote)</span>
                            </button>
                            <div
                              style={{
                                height: 1,
                                background: "rgba(255,255,255,0.1)",
                                margin: "2px 0",
                              }}
                            />
                            <button
                              type="button"
                              className="format-dropdown-item"
                              style={{ color: "var(--danger, #f44336)" }}
                              onClick={() => applyFormatting("clear")}
                            >
                              <span>✕ Tozalash</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
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
                onSelect={() => {
                  const ta = textareaRef.current;
                  if (
                    ta &&
                    ta.selectionStart != null &&
                    ta.selectionEnd != null &&
                    ta.selectionStart !== ta.selectionEnd
                  ) {
                    setShowFormatBar(true);
                  } else if (!showLinkPrompt) {
                    setShowFormatBar(false);
                    setShowFormatDropdown(false);
                  }
                }}
                onMouseUp={() => {
                  const ta = textareaRef.current;
                  if (
                    ta &&
                    ta.selectionStart != null &&
                    ta.selectionEnd != null &&
                    ta.selectionStart !== ta.selectionEnd
                  ) {
                    setShowFormatBar(true);
                  } else if (!showLinkPrompt) {
                    setShowFormatBar(false);
                    setShowFormatDropdown(false);
                  }
                }}
                onChange={(event) => {
                  handleTextChange(event.target.value);
                  const ta = textareaRef.current;
                  if (!ta || ta.selectionStart === ta.selectionEnd) {
                    if (!showLinkPrompt) {
                      setShowFormatBar(false);
                      setShowFormatDropdown(false);
                    }
                  }
                }}
                onKeyDown={(event) => {
                  // Keyboard shortcuts for formatting
                  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                    const key = event.key.toLowerCase();
                    const ta = textareaRef.current;
                    const hasSelection =
                      ta && ta.selectionStart !== ta.selectionEnd;
                    if (hasSelection) {
                      if (key === "b") {
                        event.preventDefault();
                        applyFormatting("bold");
                        return;
                      }
                      if (key === "i") {
                        event.preventDefault();
                        applyFormatting("italic");
                        return;
                      }
                      if (key === "u") {
                        event.preventDefault();
                        applyFormatting("underline");
                        return;
                      }
                      if (key === "k") {
                        event.preventDefault();
                        setShowFormatBar(true);
                        setShowLinkPrompt(true);
                        return;
                      }
                      if (event.shiftKey && (key === "x" || key === "s")) {
                        event.preventDefault();
                        applyFormatting("strike");
                        return;
                      }
                      if (event.shiftKey && key === "m") {
                        event.preventDefault();
                        applyFormatting("mono");
                        return;
                      }
                      if (event.shiftKey && key === "p") {
                        event.preventDefault();
                        applyFormatting("spoiler");
                        return;
                      }
                    }
                  }

                  if (
                    event.key === "Escape" &&
                    (showFormatBar || showFormatDropdown || showLinkPrompt)
                  ) {
                    setShowFormatBar(false);
                    setShowFormatDropdown(false);
                    setShowLinkPrompt(false);
                    return;
                  }

                  if (showMentionDropdown && mentionCandidates.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionSelectedIdx(
                        (prev) => (prev + 1) % mentionCandidates.length,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionSelectedIdx(
                        (prev) =>
                          (prev - 1 + mentionCandidates.length) %
                          mentionCandidates.length,
                      );
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
                  setTimeout(() => {
                    setShowMentionDropdown(false);
                    if (!showLinkPrompt) {
                      setShowFormatBar(false);
                      setShowFormatDropdown(false);
                    }
                  }, 180);
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
                    pastedImages.push(
                      new File([blob], `clipboard_${Date.now()}_${i}.${ext}`, {
                        type: items[i].type,
                      }),
                    );
                  }

                  if (pastedImages.length > 0) {
                    event.preventDefault();
                    queueComposerFiles(pastedImages);
                  }
                }}
              />
              <span className="composer-char-counter" aria-hidden="true">
                {messageText.length}
              </span>
            </div>

            {messageText.trim() || messageType !== "TEXT" ? (
              <button
                className="send-btn-round"
                onClick={sendMessage}
                disabled={isSending || !networkOnline || !isSocketConnected}
              >
                {!networkOnline || !isSocketConnected
                  ? "!!!"
                  : isSending
                    ? uploadProgress > 0
                      ? `${uploadProgress}%`
                      : "⏳"
                    : "➤"}
              </button>
            ) : (
              <button className="mic-btn" onClick={startVoiceRecording}>
                🎤
              </button>
            )}
          </div>
          {token && (!networkOnline || (!isSocketConnected && hasSocketConnectedOnceRef.current)) && (
            <div className="composer-connection-warning">
              {!networkOnline
                ? "!!! Internet yo'q. Xabar yuborilmaydi."
                : "⏳ Aloqa uzildi, serverga qayta ulanmoqda..."}
            </div>
          )}
        </section>
      </main>
      <nav
        className={`mobile-bottom-nav${leftOpen ? " hidden" : ""}`}
        aria-label="Mobile Navigation"
      >
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
          }}
        >
          <span>Profile</span>
        </button>
      </nav>

      {/* ── CONTEXT MENU ── */}
      <ChatContextMenu
        contextMenu={contextMenu}
        onClose={() => setContextMenu(null)}
        pinnedChats={pinnedChats}
        archivedChats={archivedChats}
        onTogglePin={togglePin}
        onToggleArchive={toggleArchive}
        onClearHistory={async (chatId) => {
          try {
            await api.delete(`/messages/clear/${chatId}`);
            if (activeUser?.id === chatId) {
              setMessages([]);
            }
            toast.success("Chat tarixi tozalandi");
          } catch {
            toast.error("O'chirishda xatolik yuz berdi");
          }
        }}
        onRemoveChat={async (chatId, type) => {
          if (type === "group") {
            await removeGroupChat(chatId);
            return;
          }
          removeChat(chatId);
        }}
      />

      {/* ── MESSAGE CONTEXT MENU ── */}
      <MessageContextMenu
        msgContextMenu={msgContextMenu}
        onClose={() => setMsgContextMenu(null)}
        onToggleReaction={toggleReaction}
        onForward={(messageId) => {
          setSelectedMessageIds(new Set([messageId]));
          setShowForwardModal(true);
        }}
        onDelete={(message, isGroup) => {
          const isMine = message.senderId === currentUser?.id;
          const activePartnerName =
            users.find((u) => u.id === selectedUserId)?.displayName ||
            "suhbatdosh";
          setDeleteModalState({
            isOpen: true,
            messageIds: [message.id],
            canDeleteForEveryone: isMine && !isGroup,
            recipientName: activePartnerName,
            isGroup,
          });
        }}
        copyImageToClipboard={copyImageToClipboard}
      />

      {/* ── RIGHT SIDEBAR OVERLAY ── */}
      <RightPanel
        isOpen={rightOpen}
        onClose={() => setRightOpen(false)}
        chatMode={chatMode}
        activeUser={activeUser}
        activeGroup={activeGroup}
        currentUser={currentUser}
        users={users}
        brokenAvatarIds={brokenAvatarIds}
        setBrokenAvatarIds={setBrokenAvatarIds}
        setLightboxUrl={setLightboxUrl}
        setProfileViewUser={setProfileViewUser}
        canManageGroupMembers={canManageGroupMembers}
        canAssignGroupAdmins={canAssignGroupAdmins}
        myGroupRole={myGroupRole}
        setShowEditGroup={setShowEditGroup}
        setShowAddGroupMembers={setShowAddGroupMembers}
        setAddMemberIds={setAddMemberIds}
        removeGroupAvatar={removeGroupAvatar}
        handleGroupAvatarChange={handleGroupAvatarChange}
        updateGroupMemberRole={updateGroupMemberRole}
        kickGroupMember={kickGroupMember}
        setShowSettings={setShowSettings}
        callStatus={callStatus}
        incomingCall={incomingCall}
        acceptCall={acceptCall}
        declineCall={declineCall}
      />

      {/* ── CALL OVERLAY & SCREENSHARE ── */}
      <CallOverlay
        callStatus={callStatus}
        callMinimized={callMinimized}
        setCallMinimized={setCallMinimized}
        isMobileViewport={isMobileViewport}
        sidebarWidth={sidebarWidth}
        callStats={callStats}
        isSocketConnected={isSocketConnected}
        networkOnline={networkOnline}
        callGroupId={callGroupIdRef.current}
        groupCallParticipants={groupCallParticipants}
        callMicMuted={callMicMuted}
        toggleCallMicMute={toggleCallMicMute}
        stopCall={stopCall}
        callEvents={callEvents}
        currentUser={currentUser}
        users={users}
        micVolume={micVolume}
        setMicVolume={setMicVolume}
        participantVolumes={participantVolumes}
        setParticipantVolumes={setParticipantVolumes}
        participantLatencyMs={participantLatencyMs}
        brokenAvatarIds={brokenAvatarIds}
        setBrokenAvatarIds={setBrokenAvatarIds}
        micGainNodeRef={micGainNodeRef}
        groupAudioNodesRef={groupAudioNodesRef}
        groupAudioContextRef={groupAudioContextRef}
        remoteVideoRef={remoteVideoRef}
        localVideoRef={localVideoRef}
        localScreenStreamRef={localScreenStreamRef}
        isScreenSharing={isScreenSharing}
        isRemoteScreenSharing={isRemoteScreenSharing}
        toggleScreenShare={toggleScreenShare}
        screenFullscreen={screenFullscreen}
        setScreenFullscreen={setScreenFullscreen}
        localScreenFullscreen={localScreenFullscreen}
        setLocalScreenFullscreen={setLocalScreenFullscreen}
      />

      <audio ref={remoteAudioRef} autoPlay />


      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img
            src={lightboxUrl}
            alt="Preview"
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="lightbox-copy"
            onClick={(e) => {
              e.stopPropagation();
              copyImageToClipboard(lightboxUrl);
            }}
            title="Copy Image"
          >
            📋
          </button>
          <button
            className="lightbox-close"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── CREATE GROUP DIALOG ── */}
      <CreateGroupModal
        isOpen={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        users={users}
        newGroupMembers={newGroupMembers}
        setNewGroupMembers={setNewGroupMembers}
        onCreateGroup={createGroup}
      />

      <EditGroupModal
        isOpen={showEditGroup && Boolean(activeGroup)}
        onClose={() => setShowEditGroup(false)}
        editGroupName={editGroupName}
        setEditGroupName={setEditGroupName}
        onSaveGroupName={saveGroupName}
      />

      <AddMembersModal
        isOpen={showAddGroupMembers && Boolean(activeGroup)}
        onClose={() => setShowAddGroupMembers(false)}
        activeGroup={activeGroup}
        users={users}
        addMemberIds={addMemberIds}
        setAddMemberIds={setAddMemberIds}
        brokenAvatarIds={brokenAvatarIds}
        setBrokenAvatarIds={setBrokenAvatarIds}
        onAddMembers={addMembersToGroup}
      />

      {/* ── AUTO-UPDATE DIALOG ── */}
      {updateAvailable && (
        <UpdateModal
          updateAvailable={updateAvailable}
          onClose={() => setUpdateAvailable(null)}
          onInstall={handleUpdateInstall}
          isUpdating={isUpdating}
          updateActionLabel={updateActionLabel}
          updateProgress={updateProgress}
          updateSpeedLabel={updateSpeedLabel}
        />
      )}

      {/* ── TELEGRAM STYLE DELETE CONFIRM MODAL ── */}
      <DeleteConfirmModal
        isOpen={Boolean(deleteModalState?.isOpen)}
        onClose={() => setDeleteModalState(null)}
        onConfirm={handleConfirmDelete}
        canDeleteForEveryone={Boolean(deleteModalState?.canDeleteForEveryone)}
        recipientName={deleteModalState?.recipientName}
        messageCount={deleteModalState?.messageIds.length || 1}
      />
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
  localScreenStreamRef: MutableRefObject<MediaStream | null>,
) {
  peerConnectionRef.current?.close();
  peerConnectionRef.current = null;
  localCallStreamRef.current?.getTracks().forEach((t) => t.stop());
  localCallStreamRef.current = null;
  localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
  localScreenStreamRef.current = null;
}

export default App;

