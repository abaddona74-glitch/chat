import React from "react";
import toast from "react-hot-toast";
import { API_URL } from "../../lib/api";
import { PublicUser } from "../../types";
import { getInitialLetter, hasUsableAvatar } from "../../utils/formatters";

export interface BurgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser | null;
  brokenAvatarIds: Record<string, true>;
  setBrokenAvatarIds: React.Dispatch<
    React.SetStateAction<Record<string, true>>
  >;
  onOpenMyProfile: () => void;
  onOpenCreateGroup: () => void;
  onOpenSavedMessages: () => void;
  onOpenSettings: () => void;
  appLockEnabled: boolean;
  onLockApp: () => void;
  onLogout: () => void;
  appVersion: string;
}

export function BurgerMenu(props: BurgerMenuProps) {
  const {
    isOpen,
    onClose,
    currentUser,
    brokenAvatarIds,
    setBrokenAvatarIds,
    onOpenMyProfile,
    onOpenCreateGroup,
    onOpenSavedMessages,
    onOpenSettings,
    appLockEnabled,
    onLockApp,
    onLogout,
    appVersion,
  } = props;

  if (!currentUser) return null;

  return (
    <>
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} />
      )}
      <aside className={`left-panel${isOpen ? " open" : ""}`}>
        <div
          className="profile-card clickable"
          onClick={() => {
            onClose();
            onOpenMyProfile();
          }}
        >
          {hasUsableAvatar(currentUser.avatarUrl) &&
          !brokenAvatarIds[currentUser.id] ? (
            <img
              src={`${API_URL}${currentUser.avatarUrl}`}
              alt="Avatar"
              className="profile-avatar-img"
              onError={() =>
                setBrokenAvatarIds((prev) => ({
                  ...prev,
                  [currentUser.id]: true,
                }))
              }
            />
          ) : (
            <div className="profile-avatar">
              {getInitialLetter(currentUser.displayName)}
            </div>
          )}
          <div className="profile-info">
            <strong>{currentUser.displayName}</strong>
            <small>
              {currentUser.statusEmoji || currentUser.statusText
                ? `${currentUser.statusEmoji ?? ""} ${currentUser.statusText ?? ""}`.trim()
                : currentUser.username
                  ? `@${currentUser.username}`
                  : currentUser.email}
            </small>
          </div>
        </div>

        <div className="sidebar-menu">
          <button
            className="sidebar-menu-item"
            onClick={() => {
              onOpenCreateGroup();
              onClose();
            }}
          >
            ➕ Create Group
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              onOpenSavedMessages();
              onClose();
            }}
          >
            🔖 Saved Messages
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            ⚙️ Settings
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              if (appLockEnabled) {
                onLockApp();
                onClose();
              } else {
                toast("Set a passcode in settings first.");
              }
            }}
          >
            🔒 Lock
          </button>
          <button className="sidebar-menu-item" onClick={onLogout}>
            🚪 Logout
          </button>
        </div>

        <div className="sidebar-bottom">
          <div className="theme-toggle-row">
            <span className="theme-toggle-label">
              Current version: v{appVersion}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
