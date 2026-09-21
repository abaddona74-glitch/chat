import { API_URL } from "../lib/api";

// ── URL detection regex ──
export const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/gi;

// ── Mention detection regex: @[DisplayName](userId) ──
export const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

export type OgMeta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  type: string | null;
  video: string | null;
};

// ── OG Metadata cache (persists across re-renders) ──
export const ogMetaCache = new Map<string, OgMeta | null>();
export const ogMetaFetching = new Set<string>();

export function getSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return "";
  }
}

/** Extract YouTube video ID from various URL formats */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.has("v")) {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (
      u.hostname.includes("youtube.com") &&
      u.pathname.startsWith("/embed/")
    ) {
      return u.pathname.split("/")[2] || null;
    }
    if (
      u.hostname.includes("youtube.com") &&
      u.pathname.startsWith("/shorts/")
    ) {
      return u.pathname.split("/")[2] || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isYouTubeShortsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes("youtube.com") && u.pathname.startsWith("/shorts/")
    );
  } catch {
    return false;
  }
}

/** Extract Instagram post/reel URL for embeddable iframe endpoint */
export function getInstagramEmbedUrl(url: string): string | null {
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
export const inlineLinkOpenListeners = new Set<(url: string) => void>();
export function requestInlineLinkOpen(url: string) {
  inlineLinkOpenListeners.forEach((fn) => fn(url));
}
