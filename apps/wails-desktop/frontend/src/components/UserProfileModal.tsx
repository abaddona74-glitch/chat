import React from "react";
import toast from "react-hot-toast";
import { PublicUser, ZeroTierNetwork } from "../types";

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
  myZeroTierNetworks?: ZeroTierNetwork[];
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
  myZeroTierNetworks = [],
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

          {/* Status message/quote if any */}
          {user.statusText && (
            <div className="user-profile-status-text">
              {user.statusEmoji && <span className="status-emoji">{user.statusEmoji} </span>}
              <span>"{user.statusText}"</span>
            </div>
          )}

          {/* ZeroTier Network section */}
          {user.zerotierNetworks && user.zerotierNetworks.length > 0 && (
            <div className="user-profile-zerotier-box">
              <div className="user-profile-zerotier-title">
                <span>🌐 ZeroTier IP</span>
              </div>
              <div className="user-profile-zerotier-list">
                {user.zerotierNetworks.map((net) => {
                  const matchingMyNet = myZeroTierNetworks.find(
                    (myNet) =>
                      (myNet.id && net.id && myNet.id.toLowerCase() === net.id.toLowerCase()) ||
                      (myNet.name && net.name && myNet.name.toLowerCase() === net.name.toLowerCase())
                  );
                  const isSameNetwork = Boolean(matchingMyNet);
                  const networkDisplayName =
                    net.name && net.name !== net.id
                      ? net.name
                      : matchingMyNet?.name && matchingMyNet.name !== matchingMyNet.id
                        ? matchingMyNet.name
                        : net.name || net.id || "ZeroTier";

                  return (
                    <div
                      key={net.id || net.ip}
                      onClick={() => {
                        if (net.ip) {
                          navigator.clipboard.writeText(net.ip);
                          toast.success(`${net.ip} nusxalandi!`, { icon: "📋" });
                        }
                      }}
                      className={`user-profile-zt-item ${isSameNetwork ? "same-network" : "diff-network"}`}
                      style={{ cursor: net.ip ? "pointer" : "default" }}
                      title={net.ip ? "IP manzilni nusxalash uchun bosing" : undefined}
                    >
                      <div className="user-profile-zt-info" style={{ width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: isSameNetwork ? "#4ade80" : "var(--text)" }}>
                            {isSameNetwork ? "🟢" : "⚪"} {networkDisplayName}
                          </span>
                          <span style={{ fontSize: 11, opacity: 0.7 }}>
                            {isSameNetwork ? "Bir xil tarmoq" : "Boshqa tarmoq"}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <code className="user-profile-zt-ip">{net.ip || "IP kutilmoqda..."}</code>
                          {net.ip && <span style={{ fontSize: 12, opacity: 0.6 }}>📋</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

