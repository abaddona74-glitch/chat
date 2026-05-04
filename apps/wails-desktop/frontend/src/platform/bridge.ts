import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { API_URL } from "../lib/api";
import * as WailsApp from "../../wailsjs/go/main/App";
import * as WailsRuntime from "../../wailsjs/runtime/runtime";

type ProxyConfig = {
  enabled: boolean;
  type: string;
  host: string;
  port: string;
};

function hasWailsWindowRuntime() {
  if (typeof window === "undefined") return false;
  const win = window as typeof window & {
    go?: { main?: { App?: unknown } };
    runtime?: { BrowserOpenURL?: unknown };
  };
  return Boolean(win.go?.main?.App && win.runtime?.BrowserOpenURL);
}

export const isWailsRuntime = hasWailsWindowRuntime();
export const isNativeMobileRuntime = Capacitor.isNativePlatform();

const MOBILE_UPDATE_LAST_SEEN_KEY = "mobile_update_last_seen_version";

function getStorageValue(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(key: string, value: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

function removeStorageValue(key: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

function compareVersions(a: string, b: string) {
  const parsePart = (part: string) => {
    const matched = part.match(/\d+/);
    return matched ? Number.parseInt(matched[0], 10) || 0 : 0;
  };

  const aParts = a.split(".").map(parsePart);
  const bParts = b.split(".").map(parsePart);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

export function getClientType() {
  if (isWailsRuntime) return "desktop";
  if (isNativeMobileRuntime) return "mobile";
  return "web";
}

function browserOpenFallback(url: string) {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function browserDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function GetStartupEnabled(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.GetStartupEnabled() : false;
}

export async function SetStartupEnabled(enabled: boolean): Promise<boolean> {
  return isWailsRuntime ? WailsApp.SetStartupEnabled(enabled) : false;
}

export async function MinimizeToTray(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.MinimizeToTray() : false;
}

export async function ShowWindow(): Promise<void> {
  if (isWailsRuntime) {
    return WailsApp.ShowWindow();
  }
}

export async function SetCloseToTray(enabled: boolean): Promise<boolean> {
  return isWailsRuntime ? WailsApp.SetCloseToTray(enabled) : false;
}

export async function SetWindowCaptionTheme(captionHex: string, textHex: string, useDarkMode: boolean): Promise<boolean> {
  if (!isWailsRuntime) return false;
  const dynamicApp = (window as any)?.go?.main?.App;
  if (typeof dynamicApp?.SetWindowCaptionTheme !== "function") return false;
  return dynamicApp.SetWindowCaptionTheme(captionHex, textHex, useDarkMode);
}

export async function ShowCallNotif(name: string): Promise<boolean> {
  return isWailsRuntime ? WailsApp.ShowCallNotif(name) : false;
}

export async function HideCallNotif(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.HideCallNotif() : false;
}

export async function CallNotifRespond(action: string): Promise<boolean> {
  return isWailsRuntime ? WailsApp.CallNotifRespond(action) : false;
}

export async function ShowOSNotification(title: string, body: string): Promise<boolean> {
  if (isWailsRuntime) return WailsApp.ShowOSNotification(title, body);
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return true;
  }
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission().catch(() => "denied");
    if (permission === "granted") {
      new Notification(title, { body });
      return true;
    }
  }
  return false;
}

export async function ShowCustomToast(title: string, body: string, target?: Record<string, unknown>): Promise<boolean> {
  if (isWailsRuntime) {
    const dynamicApp = (window as any)?.go?.main?.App;
    if (target && typeof dynamicApp?.ShowCustomToastWithTarget === "function") {
      return dynamicApp.ShowCustomToastWithTarget(title, body, JSON.stringify(target));
    }
    return WailsApp.ShowCustomToast(title, body);
  }
  return ShowOSNotification(title, body);
}

export async function ConsumePendingNotificationTarget(): Promise<string> {
  if (!isWailsRuntime) return "";
  const dynamicApp = (window as any)?.go?.main?.App;
  if (typeof dynamicApp?.ConsumePendingNotificationTarget !== "function") {
    return "";
  }
  const value = await dynamicApp.ConsumePendingNotificationTarget();
  return typeof value === "string" ? value : "";
}

export async function GetToastData(): Promise<Record<string, any>> {
  if (isWailsRuntime) return WailsApp.GetToastData();
  return { isToast: false, title: "", body: "" };
}

export async function GetToastPosition(): Promise<string> {
  if (isWailsRuntime) return WailsApp.GetToastPosition();
  return "bottom-right";
}

export async function SetToastPosition(position: string): Promise<boolean> {
  if (isWailsRuntime) return WailsApp.SetToastPosition(position);
  return false;
}

export async function PlayNotificationSound(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.PlayNotificationSound() : false;
}

export async function CheckForUpdate(): Promise<Record<string, any>> {
  if (isWailsRuntime) {
    return WailsApp.CheckForUpdate();
  }

  if (!isNativeMobileRuntime) {
    return { available: false };
  }

  try {
    const currentVersion = await GetAppVersionInfo();
    const timestamp = Date.now();
    const response = await fetch(`${API_URL}/update/android/check?cv=${encodeURIComponent(currentVersion)}&ts=${timestamp}`, {
      cache: "no-store",
    });
    const info = await response.json() as { update?: boolean; version?: string; notes?: string };

    if (!info.update || !info.version || compareVersions(info.version, currentVersion) <= 0) {
      removeStorageValue(MOBILE_UPDATE_LAST_SEEN_KEY);
      return { available: false, currentVersion };
    }

    setStorageValue(MOBILE_UPDATE_LAST_SEEN_KEY, info.version);

    return {
      available: true,
      currentVersion,
      newVersion: info.version,
      notes: info.notes || "",
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Update check failed.",
    };
  }
}

export async function DownloadAndUpdate(): Promise<{ success?: boolean; error?: string; external?: boolean }> {
  if (isWailsRuntime) {
    return WailsApp.DownloadAndUpdate();
  }

  if (isNativeMobileRuntime) {
    const downloadUrl = `${API_URL}/update/android/download?ts=${Date.now()}`;
    // Prefer system browser/download manager for APK so Android can hand off to installer reliably.
    browserOpenFallback(downloadUrl);
    return { success: true, external: true };
  }

  return { success: false, error: "Unsupported on this platform." };
}

export async function GetAppVersionInfo(): Promise<string> {
  if (isWailsRuntime) {
    return WailsApp.GetAppVersionInfo();
  }

  if (isNativeMobileRuntime) {
    try {
      const info = await CapacitorApp.getInfo();
      return info.version || "mobile";
    } catch {
      return "mobile";
    }
  }

  return "web";
}

export async function ShowInExplorer(path: string): Promise<boolean> {
  return isWailsRuntime ? WailsApp.ShowInExplorer(path) : false;
}

export async function SaveFileFromURL(url: string, fileName: string): Promise<string> {
  if (isWailsRuntime) return WailsApp.SaveFileFromURL(url, fileName);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    browserDownload(blobUrl, fileName);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return fileName;
  } catch {
    browserDownload(url, fileName);
    return fileName;
  }
}

export async function FileExistsInDownloads(fileName: string): Promise<boolean> {
  return isWailsRuntime ? WailsApp.FileExistsInDownloads(fileName) : false;
}

export async function GetDownloadPath(fileName: string): Promise<string> {
  return isWailsRuntime ? WailsApp.GetDownloadPath(fileName) : "";
}

export async function GetGeoLocation(): Promise<Record<string, any>> {
  if (isWailsRuntime) return WailsApp.GetGeoLocation();

  try {
    if (isNativeMobileRuntime) {
      const current = await Geolocation.checkPermissions();
      const status = current.location === "prompt"
        ? await Geolocation.requestPermissions()
        : current;

      if (status.location !== "granted") {
        return {
          error: "Location permission denied.",
        };
      }
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Location unavailable.",
    };
  }
}

export async function BringToFrontForCall(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.BringToFrontForCall() : false;
}

export async function RestoreNormalWindow(): Promise<boolean> {
  return isWailsRuntime ? WailsApp.RestoreNormalWindow() : false;
}

export async function OpenDevTools(): Promise<boolean> {
  return isWailsRuntime && (WailsApp as any).OpenDevTools ? (WailsApp as any).OpenDevTools() : false;
}

export async function GetProxyConfig(): Promise<ProxyConfig> {
  return isWailsRuntime
    ? WailsApp.GetProxyConfig()
    : { enabled: false, type: "socks5", host: "", port: "" };
}

export async function SaveProxyConfig(config: ProxyConfig): Promise<boolean> {
  return isWailsRuntime ? WailsApp.SaveProxyConfig(config) : false;
}

export async function RestartApp(): Promise<boolean> {
  if (isWailsRuntime) {
    return WailsApp.RestartApp();
  }
  return false;
}

export async function FetchPublicIp(): Promise<{ ip?: string; error?: string }> {
  return isWailsRuntime ? WailsApp.FetchPublicIp() : { error: "Unsupported on this platform." };
}

export async function GetAppliedProxy(): Promise<string> {
  return isWailsRuntime ? WailsApp.GetAppliedProxy() : "";
}

export function EventsOn(eventName: string, callback: (...args: any[]) => void) {
  if (isWailsRuntime) {
    return WailsRuntime.EventsOn(eventName, callback);
  }
}

export function EventsOff(eventName: string) {
  if (isWailsRuntime) {
    return WailsRuntime.EventsOff(eventName);
  }
}

export function BrowserOpenURL(url: string): void {
  if (isWailsRuntime) {
    WailsRuntime.BrowserOpenURL(url);
    return;
  }

  if (isNativeMobileRuntime) {
    void Browser.open({ url }).catch(() => browserOpenFallback(url));
    return;
  }

  browserOpenFallback(url);
}
