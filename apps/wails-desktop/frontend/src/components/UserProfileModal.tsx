import React from "react";
import { PublicUser } from "../types";

export interface UserProfileModalProps {
  user: PublicUser | null;
  onClose: () => void;
  apiUrl: string;
  onSendMessage: (user: PublicUser) => void;
  onOpenLightbox?: (url: string) => void;
  brokenAvatars: Record<string, boolean>;
  onAvatarError: (userId: string) => void;
  hasUsableAvatar: (url?: string | null) => boolean;
  getInitialLetter: (name?: string | null) => string;
  formatLastSeen: (date?: string | null) => string;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  user,
  onClose,
  apiUrl,
  onSendMessage,
  onOpenLightbox,
  brokenAvatars,
  onAvatarError,
  hasUsableAvatar,
  getInitialLetter,
  formatLastSeen,
}) => {
  if (!user) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="user-profile-popup" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>👤 Profile</h3>
          <button className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="user-profile-popup-body">
          {hasUsableAvatar(user.avatarUrl) && !brokenAvatars[user.id] ? (
            <img
              src={`${apiUrl}${user.avatarUrl}`}
              alt="Avatar"
              className="user-profile-popup-avatar-img clickable"
              onClick={() => onOpenLightbox?.(`${apiUrl}${user.avatarUrl}`)}
              onError={() => onAvatarError(user.id)}
            />
          ) : (
            <div className="user-profile-popup-avatar">
              {getInitialLetter(user.displayName)}
            </div>
          )}
          <h3 className="user-profile-popup-name">{user.displayName}</h3>
          {user.username && (
            <span className="user-profile-popup-username">
              @{user.username}
            </span>
          )}
          <small className="user-profile-popup-status">
            {user.isOnline ? "🟢 Online" : formatLastSeen(user.lastSeenAt)}
          </small>
          <div className="user-profile-popup-actions">
            <button
              className="action-btn"
              onClick={() => {
                onSendMessage(user);
                onClose();
              }}
            >
              💬 Send message
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
