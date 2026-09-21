import React, { useState, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import { DEFAULT_RINGTONE_URL } from "../../lib/callSounds";
import {
  PublicUser,
  LocalThemeProfile,
  CommunityThemeProfile,
  UpdateHistoryEntry,
} from "../../types";
import {
  GetProxyConfig,
  SaveProxyConfig,
  GetToastPosition,
  SetToastPosition,
  SetCloseToTray,
  CheckForUpdate,
  FetchPublicIp,
  OpenDevTools,
  isWailsRuntime,
} from "../../platform/bridge";
import {
  normalizeHexColor,
} from "../../utils/formatters";

export interface IceProbeResult {
  url: string;
  ok: boolean;
  candidateTypes: string[];
  rttMs: number;
  error?: string;
}

const isWails = isWailsRuntime;
const PASSCODE_MAX_LENGTH = 12;

function sanitizePasscodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PASSCODE_MAX_LENGTH);
}

function hashPasscode(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  }
  return String(h);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(
  dataUrl: string,
  maxSide = 1600,
  quality = 0.82,
): Promise<string> {
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

const ACCENT_COLOR_PRESETS = [
  "#0e7c66",
  "#3b82f6",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#22c55e",
];
const LAYOUT_COLOR_PRESETS = [
  "#1e2c3a",
  "#22313f",
  "#2a2438",
  "#1f2937",
  "#14213d",
  "#102a43",
];
const TEXT_COLOR_PRESETS = [
  "#e1e8ef",
  "#f1f5f9",
  "#fde68a",
  "#d1fae5",
  "#e9d5ff",
  "#fbcfe8",
];

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<PublicUser | null>>;

  // General Desktop Settings
  startupEnabled: boolean;
  toggleStartup: () => Promise<void>;
  launchMinimizedOnStartup: boolean;
  toggleLaunchMinimizedOnStartup: () => Promise<void>;
  closeToTray: boolean;
  setCloseToTray: (val: boolean) => void;
  toastPosition: "bottom-left" | "bottom-right";
  setToastPositionState: (val: "bottom-left" | "bottom-right") => void;
  smoothCaret: boolean;
  setSmoothCaret: (val: boolean) => void;
  cursorBlink: boolean;
  setCursorBlink: (val: boolean) => void;
  sendSound: boolean;
  setSendSound: (val: boolean) => void;

  // Call Settings
  ringtoneUrl: string;
  ringtoneLabel: string;
  ringtoneUploading: boolean;
  useServerRingtone: () => Promise<void>;
  previewRingtone: () => void;
  resetCustomRingtone: () => void;
  handleRingtoneUpload: (file: File) => Promise<void>;
  dialToneUrl: string;
  dialToneLabel: string;
  dialToneUploading: boolean;
  previewDialTone: () => void;
  resetCustomDialTone: () => void;
  handleDialToneUpload: (file: File) => Promise<void>;

  // Design Settings
  themeAccentColor: string;
  setThemeAccentColor: (val: string) => void;
  themeLayoutColor: string;
  setThemeLayoutColor: (val: string) => void;
  themeTextColor: string;
  setThemeTextColor: (val: string) => void;
  themeBackgroundColor: string;
  setThemeBackgroundColor: (val: string) => void;
  themeInputColor: string;
  setThemeInputColor: (val: string) => void;
  themeProfileName: string;
  setThemeProfileName: (val: string) => void;
  saveCurrentThemeProfileLocally: () => void;
  exportThemeProfilesToFile: () => void;
  importThemeProfilesFromFile: (file: File) => Promise<void>;
  shareCurrentThemeProfile: () => Promise<void>;
  themeProfilesSharing: boolean;
  localThemeProfiles: LocalThemeProfile[];
  setLocalThemeProfiles: React.Dispatch<React.SetStateAction<LocalThemeProfile[]>>;
  communityThemeProfiles: CommunityThemeProfile[];
  themeProfilesLoading: boolean;
  applyThemePalette: (palette: any) => void;
  chatBackgroundImage: string;
  setChatBackgroundImage: (val: string) => void;

  // Security / App Lock
  appLockEnabled: boolean;
  setAppLockEnabled: (val: boolean) => void;
  setAppLocked: (val: boolean) => void;
  autoLockEnabled: boolean;
  setAutoLockEnabled: (val: boolean) => void;
  autoLockMinutes: number;
  setAutoLockMinutes: (val: number) => void;

  // Updates
  appVersion: string;
  setUpdateAvailable: (val: any) => void;
  loadUpdateHistory: () => Promise<void>;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (val: boolean) => void;
  selectedUpdateVersion: string;
  setSelectedUpdateVersion: (val: string) => void;
  isLoadingUpdateHistory: boolean;
  updateHistory: UpdateHistoryEntry[];
  isUpdating: boolean;
  handleUpdateInstall: (version?: string, force?: boolean) => Promise<void>;
  selectedUpdateHistoryItem?: UpdateHistoryEntry | null;

  // Debug / Developer
  runLoopbackCallTest: () => Promise<boolean>;
  probeAllIceServers: () => Promise<IceProbeResult[]>;
  iceProbeResults: IceProbeResult[];
  setIceProbeResults: (val: IceProbeResult[]) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const {
    isOpen,
    onClose,
    currentUser,
    setCurrentUser,
    startupEnabled,
    toggleStartup,
    launchMinimizedOnStartup,
    toggleLaunchMinimizedOnStartup,
    closeToTray,
    setCloseToTray,
    toastPosition,
    setToastPositionState,
    smoothCaret,
    setSmoothCaret,
    cursorBlink,
    setCursorBlink,
    sendSound,
    setSendSound,
    ringtoneUrl,
    ringtoneLabel,
    ringtoneUploading,
    useServerRingtone,
    previewRingtone,
    resetCustomRingtone,
    handleRingtoneUpload,
    dialToneUrl,
    dialToneLabel,
    dialToneUploading,
    previewDialTone,
    resetCustomDialTone,
    handleDialToneUpload,
    themeAccentColor,
    setThemeAccentColor,
    themeLayoutColor,
    setThemeLayoutColor,
    themeTextColor,
    setThemeTextColor,
    themeBackgroundColor,
    setThemeBackgroundColor,
    themeInputColor,
    setThemeInputColor,
    themeProfileName,
    setThemeProfileName,
    saveCurrentThemeProfileLocally,
    exportThemeProfilesToFile,
    importThemeProfilesFromFile,
    shareCurrentThemeProfile,
    themeProfilesSharing,
    localThemeProfiles,
    setLocalThemeProfiles,
    communityThemeProfiles,
    themeProfilesLoading,
    applyThemePalette,
    chatBackgroundImage,
    setChatBackgroundImage,
    appLockEnabled,
    setAppLockEnabled,
    setAppLocked,
    autoLockEnabled,
    setAutoLockEnabled,
    autoLockMinutes,
    setAutoLockMinutes,
    appVersion,
    setUpdateAvailable,
    loadUpdateHistory,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    selectedUpdateVersion,
    setSelectedUpdateVersion,
    isLoadingUpdateHistory,
    updateHistory,
    isUpdating,
    handleUpdateInstall,
    selectedUpdateHistoryItem,
    runLoopbackCallTest,
    probeAllIceServers,
    iceProbeResults,
    setIceProbeResults,
  } = props;

  // Internal tab state
  const [settingsCategory, setSettingsCategory] = useState<
    "general" | "call" | "design" | "security" | "developer"
  >("general");

  // Developer unlock state
  const [developerUnlocked, setDeveloperUnlocked] = useState(
    () => localStorage.getItem("dev_unlocked") === "true",
  );
  const [developerTapCount, setDeveloperTapCount] = useState(0);

  const handleDeveloperTap = useCallback(() => {
    if (developerUnlocked) {
      setSettingsCategory("developer");
      return;
    }
    setDeveloperTapCount((prev) => {
      const next = prev + 1;
      if (next >= 3) {
        setDeveloperUnlocked(true);
        localStorage.setItem("dev_unlocked", "true");
        setSettingsCategory("developer");
        toast.success("Developer mode unlocked!");
        return 0;
      }
      return next;
    });
  }, [developerUnlocked]);

  // Passcode modal internal state
  const [showSetPasscode, setShowSetPasscode] = useState(false);
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");

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

  // 2FA state
  const [twoFAQrDataUrl, setTwoFAQrDataUrl] = useState("");
  const [twoFASetupCode, setTwoFASetupCode] = useState("");
  const [twoFADisableCode, setTwoFADisableCode] = useState("");

  const startTwoFASetup = async () => {
    try {
      const response = await api.post("/auth/2fa/setup");
      setTwoFAQrDataUrl(response.data.qrDataUrl);
      setTwoFASetupCode("");
    } catch {
      toast.error("Failed to start 2FA setup");
    }
  };

  const enableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/enable", { code: twoFASetupCode.trim() });
      setTwoFAQrDataUrl("");
      setTwoFASetupCode("");
      setCurrentUser((prev) => (prev ? { ...prev, isTwoFAEnabled: true } : null));
      toast.success("2FA enabled successfully");
    } catch {
      toast.error("Failed to enable 2FA");
    }
  };

  const disableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/disable", { code: twoFADisableCode.trim() });
      setTwoFADisableCode("");
      setCurrentUser((prev) => (prev ? { ...prev, isTwoFAEnabled: false } : null));
      toast.success("2FA disabled successfully");
    } catch {
      toast.error("Failed to disable 2FA");
    }
  };

  // Network public IP state
  const [publicIp, setPublicIp] = useState<string>("");
  const [ipLoading, setIpLoading] = useState(false);

  const fetchPublicIp = async () => {
    setIpLoading(true);
    try {
      if (isWails) {
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
    } finally {
      setIpLoading(false);
    }
  };

  // Proxy state
  const [proxyLoaded, setProxyLoaded] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<string>("socks5");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  // File input refs
  const ringtoneFileInputRef = useRef<HTMLInputElement>(null);
  const dialToneFileInputRef = useRef<HTMLInputElement>(null);
  const themeProfileImportInputRef = useRef<HTMLInputElement>(null);

  // ICE Probing state
  const [iceProbing, setIceProbing] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      className="lightbox-overlay"
      onClick={() => {
        onClose();
        setProxyLoaded(false);
      }}
    >
      <div
        className="settings-dialog"
        onClick={(e) => e.stopPropagation()}
        ref={(el) => {
          if (el && !proxyLoaded && isWails) {
            setProxyLoaded(true);
            GetProxyConfig()
              .then((cfg: any) => {
                setProxyEnabled(!!cfg.enabled);
                setProxyType(cfg.type || "socks5");
                setProxyHost(cfg.host || "");
                setProxyPort(cfg.port || "");
              })
              .catch(() => {});
            GetToastPosition()
              .then((pos) => {
                const raw = (pos || "bottom-right") as
                  | "top-left"
                  | "top-right"
                  | "bottom-left"
                  | "bottom-right";
                const p =
                  raw === "top-left"
                    ? "bottom-left"
                    : raw === "top-right"
                      ? "bottom-right"
                      : raw;
                setToastPositionState(p);
              })
              .catch(() => {});
          }
        }}
      >
        <div className="settings-header">
          <h3>⚙️ Settings</h3>
          <button
            className="settings-close"
            onClick={() => {
              onClose();
              setProxyLoaded(false);
            }}
          >
            ✕
          </button>
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
                    <input
                      type="checkbox"
                      checked={startupEnabled}
                      onChange={toggleStartup}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              )}

              {isWails && (
                <div className="settings-row">
                  <span>🪟 Start minimized to tray</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={launchMinimizedOnStartup}
                      onChange={() => {
                        void toggleLaunchMinimizedOnStartup();
                      }}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              )}

              {/* Close to tray / Pin to taskbar */}
              {isWails && (
                <div className="settings-row">
                  <span>📌 Close to tray</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={closeToTray}
                      onChange={async () => {
                        const next = !closeToTray;
                        setCloseToTray(next);
                        localStorage.setItem("close_to_tray", String(next));
                        await SetCloseToTray(next);
                        toast.success(
                          next
                            ? "Close to tray enabled"
                            : "App will fully close",
                        );
                      }}
                    />
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
                      const next = e.target.value as
                        | "bottom-left"
                        | "bottom-right";
                      setToastPositionState(next);
                      const ok = await SetToastPosition(next);
                      if (ok) {
                        toast.success("Notification corner saved");
                      } else {
                        toast.error("Could not save corner");
                      }
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--panel-hover)",
                      color: "var(--text)",
                      fontSize: 13,
                    }}
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
                  <input
                    type="checkbox"
                    checked={smoothCaret}
                    onChange={() => {
                      const next = !smoothCaret;
                      setSmoothCaret(next);
                      localStorage.setItem("smooth_caret", String(next));
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Cursor Blinking */}
              <div className="settings-row">
                <span>💫 Cursor blinking (phase)</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={cursorBlink}
                    onChange={() => {
                      const next = !cursorBlink;
                      setCursorBlink(next);
                      localStorage.setItem("cursor_blink", String(next));
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Send Sound */}
              <div className="settings-row">
                <span>🔊 Message send sound</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={sendSound}
                    onChange={() => {
                      const next = !sendSound;
                      setSendSound(next);
                      localStorage.setItem("send_sound", String(next));
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </>
          )}

          {settingsCategory === "call" && (
            <>
              <div
                className="settings-row"
                style={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <span>🎵 Incoming call ringtone</span>
                <small
                  style={{
                    color: "var(--text)",
                    opacity: 0.72,
                    lineHeight: 1.5,
                  }}
                >
                  Server ringtone: {ringtoneLabel || "Server ringtone"}
                </small>
                <small
                  style={{
                    color: "var(--text)",
                    opacity: 0.72,
                    lineHeight: 1.5,
                  }}
                >
                  Active source:{" "}
                  {ringtoneUrl === DEFAULT_RINGTONE_URL
                    ? "server default"
                    : ringtoneUrl}
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="settings-btn primary"
                    type="button"
                    onClick={() => {
                      void useServerRingtone();
                    }}
                    disabled={ringtoneUploading}
                  >
                    ⬇️ Download server ringtone
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() => ringtoneFileInputRef.current?.click()}
                    disabled={ringtoneUploading}
                  >
                    {ringtoneUploading
                      ? "⏳ Uploading..."
                      : "⬆️ Upload own ringtone"}
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={previewRingtone}
                  >
                    ▶️ Preview
                  </button>
                  <button
                    className="settings-btn danger"
                    type="button"
                    onClick={resetCustomRingtone}
                  >
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

              <div
                className="settings-row"
                style={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <span>📞 Outgoing call tone</span>
                <small
                  style={{
                    color: "var(--text)",
                    opacity: 0.72,
                    lineHeight: 1.5,
                  }}
                >
                  Active source:{" "}
                  {dialToneUrl
                    ? dialToneLabel || dialToneUrl
                    : "Default dial tone"}
                </small>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() => dialToneFileInputRef.current?.click()}
                    disabled={dialToneUploading}
                  >
                    {dialToneUploading
                      ? "⏳ Uploading..."
                      : "⬆️ Upload own outgoing tone"}
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={previewDialTone}
                  >
                    ▶️ Preview
                  </button>
                  <button
                    className="settings-btn danger"
                    type="button"
                    onClick={resetCustomDialTone}
                  >
                    ♻️ Reset
                  </button>
                </div>
                <input
                  ref={dialToneFileInputRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    await handleDialToneUpload(file);
                  }}
                />
              </div>
            </>
          )}

          {settingsCategory === "design" && (
            <>
              <div
                className="settings-row"
                style={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <span>🎨 Theme designer (real-time)</span>

                <div className="settings-color-group">
                  <span className="settings-color-label">
                    Accent / Circle colors
                  </span>
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
                      onChange={(e) =>
                        setThemeAccentColor(
                          normalizeHexColor(e.target.value, "#0e7c66"),
                        )
                      }
                    />
                  </label>
                </div>

                <div className="settings-color-group">
                  <span className="settings-color-label">
                    Layout color (panels)
                  </span>
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
                      onChange={(e) =>
                        setThemeLayoutColor(
                          normalizeHexColor(e.target.value, "#1e2c3a"),
                        )
                      }
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
                      onChange={(e) =>
                        setThemeTextColor(
                          normalizeHexColor(e.target.value, "#e1e8ef"),
                        )
                      }
                    />
                  </label>

                  <label className="settings-color-picker-wrap">
                    <span>Main background</span>
                    <input
                      type="color"
                      value={themeBackgroundColor}
                      onChange={(e) =>
                        setThemeBackgroundColor(
                          normalizeHexColor(e.target.value, "#17212b"),
                        )
                      }
                    />
                  </label>

                  <label className="settings-color-picker-wrap">
                    <span>Search/message input</span>
                    <input
                      type="color"
                      value={themeInputColor}
                      onChange={(e) =>
                        setThemeInputColor(
                          normalizeHexColor(e.target.value, "#17212b"),
                        )
                      }
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
                      toast.success(
                        "Theme ranglari default holatga qaytdi",
                      );
                    }}
                  >
                    Reset theme colors
                  </button>
                  <input
                    type="text"
                    className="theme-profile-name-input"
                    placeholder="Profile name (masalan: Night Ocean)"
                    value={themeProfileName}
                    onChange={(e) =>
                      setThemeProfileName(e.target.value.slice(0, 60))
                    }
                  />
                  <button
                    className="settings-btn primary"
                    type="button"
                    onClick={saveCurrentThemeProfileLocally}
                  >
                    Save local
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={exportThemeProfilesToFile}
                  >
                    Export JSON
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() =>
                      themeProfileImportInputRef.current?.click()
                    }
                  >
                    Import JSON
                  </button>
                  <button
                    className="settings-btn primary"
                    type="button"
                    onClick={shareCurrentThemeProfile}
                    disabled={themeProfilesSharing}
                  >
                    {themeProfilesSharing
                      ? "Sharing..."
                      : "Share community"}
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
                    <span className="settings-color-label">
                      Saved local profiles ({localThemeProfiles.length})
                    </span>
                    <div className="theme-profile-list">
                      {localThemeProfiles.slice(0, 20).map((profile) => (
                        <div
                          className="theme-profile-card"
                          key={profile.id}
                        >
                          <div className="theme-profile-main">
                            <strong>{profile.name}</strong>
                            <small>
                              {new Date(profile.createdAt).toLocaleString()}
                            </small>
                            <div className="theme-profile-swatches">
                              {Object.values(profile.palette).map(
                                (color, idx) => (
                                  <span
                                    key={`${profile.id}-${idx}`}
                                    style={{ background: color }}
                                  />
                                ),
                              )}
                            </div>
                          </div>
                          <div className="theme-profile-actions">
                            <button
                              className="settings-btn"
                              type="button"
                              onClick={() => {
                                applyThemePalette(profile.palette);
                                toast.success(`Applied: ${profile.name}`);
                              }}
                            >
                              Apply
                            </button>
                            <button
                              className="settings-btn danger"
                              type="button"
                              onClick={() => {
                                setLocalThemeProfiles((prev) =>
                                  prev.filter((p) => p.id !== profile.id),
                                );
                                toast.success("Profile o'chirildi");
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="theme-profile-list-wrap">
                  <span className="settings-color-label">
                    Community profiles{" "}
                    {themeProfilesLoading
                      ? "(loading...)"
                      : `(${communityThemeProfiles.length})`}
                  </span>
                  <div className="theme-profile-list">
                    {communityThemeProfiles.slice(0, 30).map((profile) => (
                      <div className="theme-profile-card" key={profile.id}>
                        <div className="theme-profile-main">
                          <strong>{profile.name}</strong>
                          <small>
                            by {profile.author.displayName}
                            {profile.author.username
                              ? ` (@${profile.author.username})`
                              : ""}
                          </small>
                          <div className="theme-profile-swatches">
                            {[
                              profile.accentColor,
                              profile.layoutColor,
                              profile.textColor,
                              profile.backgroundColor,
                              profile.inputColor,
                            ].map((color, idx) => (
                              <span
                                key={`${profile.id}-c-${idx}`}
                                style={{ background: color }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="theme-profile-actions">
                          <button
                            className="settings-btn"
                            type="button"
                            onClick={() => {
                              applyThemePalette({
                                accentColor: profile.accentColor,
                                layoutColor: profile.layoutColor,
                                textColor: profile.textColor,
                                backgroundColor: profile.backgroundColor,
                                inputColor: profile.inputColor,
                              });
                              toast.success(
                                `Applied community: ${profile.name}`,
                              );
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    ))}
                    {!themeProfilesLoading &&
                      communityThemeProfiles.length === 0 && (
                        <small style={{ color: "var(--muted)" }}>
                          Hozircha community profile yo'q.
                        </small>
                      )}
                  </div>
                </div>

                <small style={{ color: "var(--muted)", fontSize: 12 }}>
                  Ranglarni local saqlash, JSON import/export va community
                  share/apply qilish mumkin.
                </small>
              </div>

              <div
                className="settings-row"
                style={{
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span>🖼️ Chat background image</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label
                    className="settings-btn primary"
                    style={{ cursor: "pointer" }}
                  >
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
                          const optimizedDataUrl =
                            await compressImageDataUrl(rawDataUrl);
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
                <button
                  className="settings-btn danger"
                  onClick={handleRemovePasscode}
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                {!showSetPasscode ? (
                  <button
                    className="settings-btn primary"
                    onClick={() => setShowSetPasscode(true)}
                  >
                    Set Passcode
                  </button>
                ) : (
                  <div className="settings-passcode-form">
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={PASSCODE_MAX_LENGTH}
                      placeholder="New passcode (min 4 digits)"
                      value={newPasscode}
                      onChange={(e) =>
                        setNewPasscode(
                          sanitizePasscodeInput(e.target.value),
                        )
                      }
                    />
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={PASSCODE_MAX_LENGTH}
                      placeholder="Confirm passcode"
                      value={confirmPasscode}
                      onChange={(e) =>
                        setConfirmPasscode(
                          sanitizePasscodeInput(e.target.value),
                        )
                      }
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="settings-btn primary"
                        onClick={handleSetPasscode}
                      >
                        Save
                      </button>
                      <button
                        className="settings-btn"
                        onClick={() => {
                          setShowSetPasscode(false);
                          setNewPasscode("");
                          setConfirmPasscode("");
                        }}
                      >
                        Cancel
                      </button>
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
                    <input
                      type="checkbox"
                      checked={autoLockEnabled}
                      onChange={() => {
                        const next = !autoLockEnabled;
                        setAutoLockEnabled(next);
                        localStorage.setItem("auto_lock", String(next));
                      }}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                {autoLockEnabled && (
                  <div className="settings-row">
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      Lock after (minutes)
                    </span>
                    <select
                      value={autoLockMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setAutoLockMinutes(val);
                        localStorage.setItem(
                          "auto_lock_minutes",
                          String(val),
                        );
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel-hover)",
                        color: "var(--text)",
                        fontSize: 13,
                      }}
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
                {currentUser?.isTwoFAEnabled ? (
                  <span className="badge-on">Enabled</span>
                ) : (
                  <span className="badge-off">Disabled</span>
                )}
              </div>
              {!currentUser?.isTwoFAEnabled && (
                <>
                  <button
                    className="settings-btn primary"
                    onClick={startTwoFASetup}
                  >
                    Setup 2FA
                  </button>
                  {twoFAQrDataUrl && (
                    <img
                      src={twoFAQrDataUrl}
                      alt="2FA QR"
                      className="qr-image"
                    />
                  )}
                  {twoFAQrDataUrl && (
                    <div className="settings-passcode-form">
                      <input
                        type="text"
                        placeholder="Authenticator code"
                        value={twoFASetupCode}
                        onChange={(e) => setTwoFASetupCode(e.target.value)}
                      />
                      <button
                        className="settings-btn primary"
                        onClick={enableTwoFA}
                      >
                        Enable 2FA
                      </button>
                    </div>
                  )}
                </>
              )}
              {currentUser?.isTwoFAEnabled && (
                <div className="settings-passcode-form">
                  <input
                    type="text"
                    placeholder="Enter 2FA code"
                    value={twoFADisableCode}
                    onChange={(e) => setTwoFADisableCode(e.target.value)}
                  />
                  <button
                    className="settings-btn danger"
                    onClick={disableTwoFA}
                  >
                    Disable 2FA
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── NETWORK INFO ── */}
          {settingsCategory === "general" && (
            <>
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 18,
                  paddingTop: 14,
                }}
              >
                <h4>🌐 Network</h4>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 6,
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    Public IP:{" "}
                    <strong
                      style={{
                        color: "var(--text)",
                        fontFamily: "monospace",
                      }}
                    >
                      {publicIp || "—"}
                    </strong>
                  </span>
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
                <div
                  style={{
                    borderTop: "1px solid var(--border)",
                    marginTop: 18,
                    paddingTop: 14,
                  }}
                >
                  <h4>🔒 Proxy</h4>
                  <div className="settings-row">
                    <span>Enable Proxy</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={proxyEnabled}
                        onChange={() => setProxyEnabled(!proxyEnabled)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  {proxyEnabled && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--muted)",
                            minWidth: 50,
                          }}
                        >
                          Type:
                        </span>
                        <select
                          value={proxyType}
                          onChange={(e) => setProxyType(e.target.value)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <option value="socks5">SOCKS5</option>
                          <option value="http">HTTP</option>
                          <option value="https">HTTPS</option>
                        </select>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--muted)",
                            minWidth: 50,
                          }}
                        >
                          Host:
                        </span>
                        <input
                          type="text"
                          placeholder="127.0.0.1 or proxy.example.com"
                          value={proxyHost}
                          onChange={(e) => setProxyHost(e.target.value)}
                          style={{
                            flex: 1,
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            border: "1px solid var(--border)",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--muted)",
                            minWidth: 50,
                          }}
                        >
                          Port:
                        </span>
                        <input
                          type="text"
                          placeholder="1080"
                          value={proxyPort}
                          onChange={(e) =>
                            setProxyPort(
                              e.target.value.replace(/\D/g, "").slice(0, 5),
                            )
                          }
                          style={{
                            width: 80,
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            border: "1px solid var(--border)",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <button
                          className="settings-btn primary"
                          disabled={proxySaving || !proxyHost.trim()}
                          onClick={async () => {
                            setProxySaving(true);
                            try {
                              await SaveProxyConfig({
                                enabled: proxyEnabled,
                                type: proxyType,
                                host: proxyHost.trim(),
                                port: proxyPort.trim(),
                              });
                              toast.success(
                                "Proxy saved. Restart app to apply.",
                              );
                            } catch {
                              toast.error("Failed to save proxy config");
                            } finally {
                              setProxySaving(false);
                            }
                          }}
                        >
                          {proxySaving ? "Saving..." : "Save Proxy"}
                        </button>
                        <button
                          className="settings-btn"
                          disabled={proxySaving}
                          onClick={async () => {
                            setProxySaving(true);
                            try {
                              await SaveProxyConfig({
                                enabled: proxyEnabled,
                                type: proxyType,
                                host: proxyHost.trim(),
                                port: proxyPort.trim(),
                              });
                              toast.success(
                                "Proxy config saved! Restarting app...",
                              );
                              setTimeout(async () => {
                                try {
                                  await (window as any).go?.main?.App?.RestartApp?.();
                                } catch {}
                              }, 600);
                            } catch {
                              toast.error("Failed to save proxy config");
                            } finally {
                              setProxySaving(false);
                            }
                          }}
                        >
                          Save & Restart App
                        </button>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          opacity: 0.7,
                        }}
                      >
                        Proxy applies after app restart
                      </span>
                    </div>
                  )}
                  {!proxyEnabled && proxyHost && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="settings-btn"
                        onClick={async () => {
                          setProxyHost("");
                          setProxyPort("");
                          await SaveProxyConfig({
                            enabled: false,
                            type: "socks5",
                            host: "",
                            port: "",
                          });
                          toast.success(
                            "Proxy cleared. Restart app to apply.",
                          );
                        }}
                      >
                        Clear Proxy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── UPDATE SECTION ── */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 18,
                  paddingTop: 14,
                }}
              >
                <h4>🔄 Update</h4>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 6,
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    Current version:{" "}
                    <strong style={{ color: "var(--text)" }}>
                      v{appVersion}
                    </strong>
                  </span>
                  <button
                    className="settings-btn primary"
                    onClick={async () => {
                      try {
                        const result: any = await CheckForUpdate();
                        void loadUpdateHistory();
                        if (result.available) {
                          setUpdateAvailable({
                            newVersion: result.newVersion,
                            notes: result.notes || "",
                          });
                          onClose();
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 10,
                  }}
                >
                  <label
                    style={{
                      fontSize: 13,
                      color: "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={autoUpdateEnabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setAutoUpdateEnabled(val);
                        localStorage.setItem(
                          "auto_update",
                          val ? "true" : "false",
                        );
                      }}
                    />
                    Auto-check for updates
                  </label>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <select
                      value={selectedUpdateVersion}
                      onChange={(e) =>
                        setSelectedUpdateVersion(e.target.value)
                      }
                      disabled={
                        isLoadingUpdateHistory ||
                        updateHistory.length === 0 ||
                        isUpdating
                      }
                      style={{ minWidth: 260, flex: "1 1 260px" }}
                    >
                      {updateHistory.length === 0 && (
                        <option value="">No stored versions yet</option>
                      )}
                      {updateHistory.map((item) => (
                        <option key={item.version} value={item.version}>
                          {item.version}
                          {item.isLatest ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="settings-btn primary"
                      onClick={() => {
                        if (!selectedUpdateVersion) {
                          return;
                        }
                        void handleUpdateInstall(
                          selectedUpdateVersion,
                          true,
                        );
                      }}
                      disabled={!selectedUpdateVersion || isUpdating}
                    >
                      Install selected version
                    </button>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      opacity: 0.8,
                    }}
                  >
                    Choose a stored AWS build to rollback or repair.
                  </span>
                  {selectedUpdateHistoryItem ? (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {selectedUpdateHistoryItem.notes ||
                        `Stored build ${selectedUpdateHistoryItem.version} is ready.`}
                    </span>
                  ) : !isLoadingUpdateHistory ? (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      No stored builds found yet.
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          )}

          {/* ── DEBUG SECTION ── */}
          {settingsCategory === "developer" && developerUnlocked && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                marginTop: 18,
                paddingTop: 14,
              }}
            >
              <h4>🐞 Debug</h4>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="settings-btn primary"
                  onClick={async () => {
                    try {
                      const ok = await OpenDevTools();
                      if (!ok)
                        toast(
                          "DevTools faqat debug-build da mavjud (F12 / Ctrl+Shift+I).",
                        );
                    } catch {
                      toast.error("DevTools ochib bo'lmadi.");
                    }
                  }}
                >
                  Open DevTools
                </button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Yoki: F12 / Ctrl+Shift+I / o'ng-klik → Inspect
                </span>
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  className="settings-btn"
                  onClick={async () => {
                    const ok = await runLoopbackCallTest();
                    if (ok)
                      toast.success(
                        "Loopback test ishladi — siz o'z ovozingizni eshitishingiz kerak. Console'da [Loopback] log'larni tekshiring.",
                      );
                    else
                      toast.error(
                        "Loopback test muvaffaqiyatsiz. Console'ni tekshiring.",
                      );
                  }}
                >
                  🔁 Run Loopback Call Test (E2E)
                </button>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 6,
                  }}
                >
                  Mic → RNNoise → RTCPeerConnection → audio element. 5
                  soniya o'zingizni eshitsangiz audio-pipeline OK.
                </div>
              </div>

              {/* ── ICE PROBE ── */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px dashed var(--border)",
                }}
              >
                {/* P2P toggle */}
                <div
                  style={{
                    marginBottom: 10,
                    padding: 10,
                    background: "var(--surface-2)",
                    borderRadius: 6,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      defaultChecked={(() => {
                        try {
                          return (
                            localStorage.getItem("webrtc_force_relay") !==
                            "true"
                          );
                        } catch {
                          return true;
                        }
                      })()}
                      onChange={(e) => {
                        const preferP2P = e.target.checked;
                        try {
                          localStorage.setItem(
                            "webrtc_force_relay",
                            preferP2P ? "false" : "true",
                          );
                          toast.success(
                            preferP2P
                              ? "P2P afzal: keyingi callda direct ulanish sinaladi (past ms)"
                              : "TURN-only: barcha calllar relay orqali (ishonchli, yuqori ms)",
                          );
                        } catch {}
                      }}
                    />
                    <span>
                      <strong>Prefer P2P (lower latency)</strong>
                    </span>
                  </label>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginTop: 4,
                      marginLeft: 24,
                    }}
                  >
                    Yoqilgan: ICE avval direct (host/srflx) sinaydi →
                    ishlasa 30-100ms, ishlamasa avtomatik TURN'ga o'tadi.
                    <br />
                    O'chirilgan: faqat TURN (relay) — ishonchli lekin
                    150-300ms.
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
                      localStorage.setItem(
                        "ice_probe_at",
                        String(Date.now()),
                      );
                      const okCount = res.filter((r) => r.ok).length;
                      if (okCount === 0)
                        toast.error("Hech qaysi server ishlamadi!");
                      else
                        toast.success(
                          `${okCount}/${res.length} ICE server ishlaydi`,
                        );
                    } finally {
                      setIceProbing(false);
                    }
                  }}
                >
                  {iceProbing
                    ? "🔬 Probing..."
                    : "🔬 Run ICE Probe (test STUN/TURN)"}
                </button>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    marginTop: 6,
                  }}
                >
                  Har bir STUN/TURN serverni alohida sinaydi. Ishlaydiganlar
                  call paytida birinchi ishlatiladi.
                </div>
                {iceProbeResults.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  >
                    {iceProbeResults.map((r) => (
                      <div
                        key={r.url}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: r.ok
                            ? "rgba(76,175,80,0.12)"
                            : "rgba(244,67,54,0.12)",
                          color: r.ok ? "#4caf50" : "#f44336",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.ok ? "✅" : "❌"} {r.url}
                        </span>
                        <span style={{ flexShrink: 0 }}>
                          [{r.candidateTypes.join(",") || "none"}] {r.rttMs}
                          ms
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="settings-developer-unlock-row">
            <button
              className="settings-btn"
              type="button"
              onClick={handleDeveloperTap}
            >
              {developerUnlocked
                ? "I am developer"
                : `I am developer (${developerTapCount}/3)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
