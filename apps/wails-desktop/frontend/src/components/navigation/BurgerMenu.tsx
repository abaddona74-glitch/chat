import React from "react";
import toast from "react-hot-toast";
import {
  Profile2User,
  Bookmark2,
  Setting2,
  Lock1,
  LogoutCurve,
} from "iconsax-react";
import { OpenInstagramWindow } from "../../platform/bridge";
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
  onOpenSecurityPasscode?: () => void;
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
    onOpenSecurityPasscode,
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
            <Profile2User size="20" variant="Linear" />
            <span>Create Group</span>
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              onOpenSavedMessages();
              onClose();
            }}
          >
            <Bookmark2 size="20" variant="Linear" />
            <span>Saved Messages</span>
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            <Setting2 size="20" variant="Linear" />
            <span>Settings</span>
          </button>
          <button
            className="sidebar-menu-item"
            onClick={() => {
              if (appLockEnabled) {
                onLockApp();
                onClose();
              } else {
                onClose();
                onOpenSecurityPasscode?.();
              }
            }}
            title={appLockEnabled ? "Ilovani qulflash" : "Parol o'rnatish"}
          >
            <Lock1 size="20" variant="Linear" />
            <span>Lock</span>
          </button>
          <button className="sidebar-menu-item" onClick={onLogout}>
            <LogoutCurve size="20" variant="Linear" color="#f43f5e" />
            <span style={{ color: "#f43f5e" }}>Logout</span>
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
