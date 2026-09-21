import React from "react";
import { Message } from "../types";
import {
  normalizeLegacyCallLogText,
  normalizeFileUrl,
} from "./formatters";
import {
  URL_REGEX,
  MENTION_REGEX,
  requestInlineLinkOpen,
} from "./linkUtils";
import { BrowserOpenURL } from "../platform/bridge";
import { FileMessageBubble } from "../components/media/FileMessageBubble";
import { LinkPreview } from "../components/media/LinkPreview";
import { VideoMessagePlayer } from "../components/media/VideoMessagePlayer";
import { AudioWaveformPlayer } from "../components/media/AudioWaveformPlayer";
import {
  MusicMessagePlayer,
  extractMusicTitle,
} from "../components/media/MusicMessagePlayer";

export { extractMusicTitle };

export function buildMessagePreview(message: Message) {
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

export function isImageFile(message: Message): boolean {
  if (message.fileMime?.startsWith("image/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(
    ext ?? "",
  );
}

export function isVideoFile(message: Message): boolean {
  if (message.fileMime?.startsWith("video/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext ?? "");
}

export function isMusicFile(message: Message): boolean {
  if (message.type === "VOICE") return false;
  if (message.fileMime?.startsWith("audio/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma"].includes(ext ?? "");
}

/** Parse markdown formatting: **bold**, *italic*, ~~strike~~, `code`, ||spoiler||, __underline__, [link](url) */
export function parseMarkdownFormatting(
  text: string,
  keyPrefix: string,
): React.ReactNode[] {
  if (!text) return [];

  const tokenRegex =
    /(`[^`\n]+`)|(\|\|[\s\S]+?\|\|)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(text.slice(lastIndex, m.index));
    }
    const token = m[0];
    const key = `${keyPrefix}-${m.index}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("||") && token.endsWith("||")) {
      nodes.push(
        <span
          key={key}
          className="msg-spoiler"
          title="Spoiler (ko'rish uchun bosing)"
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.classList.toggle("revealed");
          }}
        >
          {token.slice(2, -2)}
        </span>,
      );
    } else if (m[3] && m[4] && m[5]) {
      const linkText = m[4];
      const linkUrl = m[5];
      nodes.push(
        <a
          key={key}
          href="#"
          className="msg-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (/youtube\.com|youtu\.be|instagram\.com/i.test(linkUrl)) {
              requestInlineLinkOpen(linkUrl);
            } else {
              BrowserOpenURL(linkUrl);
            }
          }}
        >
          {linkText}
        </a>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("__") && token.endsWith("__")) {
      nodes.push(<u key={key}>{token.slice(2, -2)}</u>);
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else {
      nodes.push(token);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/** Render text with clickable links, OG previews, @mentions, and markdown formatting */
export function renderTextWithLinks(
  text: string,
  onMentionClick?: (userId: string) => void,
): React.ReactNode {
  const MENTION_SPLIT = /@\[([^\]]+)\]\(([^)]+)\)/g;

  const mentionParts: (
    | string
    | { type: "mention"; name: string; userId: string }
  )[] = [];
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

    const urlParts = part.split(URL_REGEX);
    if (urlParts.length === 1) {
      return (
        <span key={i}>{parseMarkdownFormatting(part, `p-${i}`)}</span>
      );
    }

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
      return (
        <span key={`${i}-${j}`}>
          {parseMarkdownFormatting(urlPart, `${i}-${j}`)}
        </span>
      );
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

export function renderMessage(
  message: Message,
  onImageClick?: (url: string) => void,
  isMine?: boolean,
  onMentionClick?: (userId: string) => void,
  voiceQueue?: { id: string; src: string; durationSec?: number | null }[],
) {
  if (message.type === "TEXT") {
    return renderTextWithLinks(
      normalizeLegacyCallLogText(message.text ?? ""),
      onMentionClick,
    );
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
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          className="location-preview-caption"
        >
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
  if (isVideoFile(message)) {
    return (
      <VideoMessagePlayer
        src={normalizeFileUrl(message.fileUrl) ?? ""}
        fileName={message.fileName}
        isMine={isMine}
      />
    );
  }
  if (isMusicFile(message)) {
    return (
      <MusicMessagePlayer
        src={normalizeFileUrl(message.fileUrl) ?? ""}
        fileName={message.fileName}
        isMine={isMine}
      />
    );
  }
  if (isImageFile(message)) {
    const imgUrl = normalizeFileUrl(message.fileUrl) ?? "";
    return (
      <img
        src={imgUrl}
        alt={message.fileName ?? "Image"}
        style={{
          maxWidth: "100%",
          maxHeight: 300,
          borderRadius: 10,
          display: "block",
          cursor: "pointer",
        }}
        onClick={() => onImageClick?.(imgUrl)}
      />
    );
  }
  return <FileMessageBubble message={message} />;
}
