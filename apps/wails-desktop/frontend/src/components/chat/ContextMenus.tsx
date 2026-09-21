import React from "react";
import toast from "react-hot-toast";
import { API_URL } from "../../lib/api";
import { Message, GroupMessage } from "../../types";

export interface ChatContextMenuState {
  x: number;
  y: number;
  chatId: string;
  type: "user" | "group";
}

export interface MessageContextMenuState {
  x: number;
  y: number;
  message: Message | GroupMessage;
  isGroup: boolean;
}

export interface ChatContextMenuProps {
  contextMenu: ChatContextMenuState | null;
  onClose: () => void;
  pinnedChats: Set<string>;
  archivedChats: Set<string>;
  onTogglePin: (chatId: string) => void;
  onToggleArchive: (chatId: string) => void;
  onClearHistory: (chatId: string) => Promise<void>;
  onRemoveChat: (chatId: string, type: "user" | "group") => Promise<void>;
}

export function ChatContextMenu({
  contextMenu,
  onClose,
  pinnedChats,
  archivedChats,
  onTogglePin,
  onToggleArchive,
  onClearHistory,
  onRemoveChat,
}: ChatContextMenuProps) {
  if (!contextMenu) return null;

  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} />
      <div
        className="context-menu"
        style={{ top: contextMenu.y, left: contextMenu.x }}
      >
        <button
          onClick={() => {
            onTogglePin(contextMenu.chatId);
            onClose();
          }}
        >
          {pinnedChats.has(contextMenu.chatId) ? "📌 Unpin" : "📌 Pin"}
        </button>
        <button
          onClick={() => {
            onToggleArchive(contextMenu.chatId);
            onClose();
          }}
        >
          {archivedChats.has(contextMenu.chatId)
            ? "📦 Unarchive"
            : "📦 Archive"}
        </button>
        {contextMenu.type === "user" && (
          <button
            className="context-menu-danger"
            onClick={async () => {
              if (
                !window.confirm(
                  "Chat tarixini butunlay o'chirishni xohlaysizmi?",
                )
              ) {
                onClose();
                return;
              }
              const chatId = contextMenu.chatId;
              onClose();
              await onClearHistory(chatId);
            }}
          >
            🧹 Clear chat history
          </button>
        )}
        <button
          className="context-menu-danger"
          onClick={async () => {
            const menu = contextMenu;
            onClose();
            await onRemoveChat(menu.chatId, menu.type);
          }}
        >
          {contextMenu.type === "group"
            ? "🚪 Remove group"
            : "🗑️ Hide chat"}
        </button>
      </div>
    </>
  );
}

export interface MessageContextMenuProps {
  msgContextMenu: MessageContextMenuState | null;
  onClose: () => void;
  onToggleReaction: (
    messageId: string,
    emoji: string,
    isGroup: boolean,
  ) => void;
  onForward: (messageId: string) => void;
  onDelete: (message: Message | GroupMessage, isGroup: boolean) => void;
  copyImageToClipboard: (url: string) => Promise<void>;
}

const REACTION_EMOJIS = ["👍", "❤️", "🔥", "😂", "😮", "😢", "👏", "🎉"];

export function MessageContextMenu({
  msgContextMenu,
  onClose,
  onToggleReaction,
  onForward,
  onDelete,
  copyImageToClipboard,
}: MessageContextMenuProps) {
  if (!msgContextMenu) return null;

  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} />
      <div
        className="context-menu"
        style={{ top: msgContextMenu.y, left: msgContextMenu.x }}
      >
        {/* Quick Emoji Reactions */}
        <div
          className="context-menu-reactions"
          style={{
            display: "flex",
            gap: 4,
            padding: "6px 8px",
            borderBottom: "1px solid var(--line)",
            justifyContent: "space-between",
          }}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reaction-emoji-btn"
              style={{
                background: "transparent",
                border: "none",
                fontSize: "18px",
                padding: "4px 6px",
                cursor: "pointer",
                borderRadius: "6px",
                lineHeight: 1,
              }}
              onClick={() => {
                onToggleReaction(
                  msgContextMenu.message.id,
                  emoji,
                  msgContextMenu.isGroup,
                );
                onClose();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Forward */}
        <button
          onClick={() => {
            onForward(msgContextMenu.message.id);
            onClose();
          }}
        >
          ↪️ Forward message
        </button>

        {msgContextMenu.message.text && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(msgContextMenu.message.text!);
              onClose();
              toast.success("Nusxalandi (Copied)");
            }}
          >
            📋 Copy text
          </button>
        )}
        {msgContextMenu.message.fileUrl && (
          <button
            onClick={() => {
              copyImageToClipboard(
                `${API_URL}${msgContextMenu.message.fileUrl}`,
              );
              onClose();
            }}
          >
            📋 Copy image
          </button>
        )}
        <button
          className="context-menu-danger"
          onClick={() => {
            const { message, isGroup } = msgContextMenu;
            onClose();
            onDelete(message, isGroup);
          }}
        >
          🗑️ Delete message
        </button>
      </div>
    </>
  );
}
