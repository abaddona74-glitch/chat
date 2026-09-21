import { useState, useEffect, useCallback, useRef } from "react";
import { API_URL } from "../../lib/api";
import { BrowserOpenURL } from "../../platform/bridge";
import {
  OgMeta,
  ogMetaCache,
  ogMetaFetching,
  getSiteName,
  getYouTubeVideoId,
  isYouTubeShortsUrl,
  getInstagramEmbedUrl,
  inlineLinkOpenListeners,
} from "../../utils/linkUtils";

/** Link preview card (Telegram-style) with inline YouTube / Instagram player */
export function LinkPreview({ url }: { url: string }) {
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
    const message = JSON.stringify({
      event: "command",
      func: "setVolume",
      args: [pct],
    });
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
  }, [
    inlineVolume,
    ytPlaying,
    isYouTube,
    applyYouTubeVolume,
    igPlaying,
    canUseNativeInstagramVideo,
  ]);

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
      <div
        className="link-preview youtube-embed"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`youtube-player-wrap${isYouTubeShorts ? " shorts" : ""}`}
        >
          <iframe
            ref={ytIframeRef}
            src={ytSrc}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={meta.title || "YouTube video"}
            onLoad={() => applyYouTubeVolume(inlineVolume)}
          />
        </div>
        <div
          className="link-preview-body"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {meta.title && (
              <div className="link-preview-title" style={{ fontSize: 12 }}>
                {meta.title}
              </div>
            )}
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
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              className="yt-inline-btn"
              onClick={(e) => {
                e.stopPropagation();
                setYtPlaying(false);
              }}
              title="Close player"
            >
              ✕
            </button>
            <button
              className="yt-inline-btn"
              onClick={(e) => {
                e.stopPropagation();
                BrowserOpenURL(url);
              }}
              title="Open in browser"
            >
              ↗
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Instagram inline embed mode
  if (isInstagram && instagramEmbedUrl && igPlaying) {
    return (
      <div
        className="link-preview instagram-embed"
        onClick={(e) => e.stopPropagation()}
      >
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
            <button
              className="yt-inline-btn"
              onClick={(e) => {
                e.stopPropagation();
                BrowserOpenURL("https://www.instagram.com/accounts/login/");
              }}
              title="Login Instagram"
            >
              Login
            </button>
          </div>
        )}
        <div
          className="link-preview-body"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {meta.title && (
              <div className="link-preview-title" style={{ fontSize: 12 }}>
                {meta.title}
              </div>
            )}
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
              <small className="inline-media-volume-note">
                Instagram iframe rejimida ovoz boshqaruvi cheklangan.
              </small>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              className="yt-inline-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIgPlaying(false);
              }}
              title="Close player"
            >
              ✕
            </button>
            <button
              className="yt-inline-btn"
              onClick={(e) => {
                e.stopPropagation();
                BrowserOpenURL(url);
              }}
              title="Open in browser"
            >
              ↗
            </button>
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
        <div
          className={`link-preview-image${isYouTube ? " youtube" : ""}${isInstagram ? " instagram" : ""}`}
        >
          <img src={meta.image} alt="" onError={() => setImgError(true)} />
          {isYouTube && (
            <div className="link-preview-play">
              <svg viewBox="0 0 68 48" width="48" height="34">
                <path
                  d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.63-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z"
                  fill="red"
                />
                <path d="M45 24L27 14v20" fill="white" />
              </svg>
            </div>
          )}
          {isInstagram && (
            <div className="link-preview-play">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="5"
                  fill="rgba(0,0,0,0.55)"
                />
                <path
                  d="M12 8.2C14.1 8.2 15.8 9.9 15.8 12C15.8 14.1 14.1 15.8 12 15.8C9.9 15.8 8.2 14.1 8.2 12C8.2 9.9 9.9 8.2 12 8.2Z"
                  fill="white"
                />
                <circle cx="16.7" cy="7.3" r="1" fill="white" />
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
