import { MutableRefObject, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { api, API_URL } from "../../lib/api";
import { PublicUser } from "../../types";
import { getInitialLetter, hasUsableAvatar } from "../../utils/formatters";

interface MyProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser | null;
  setCurrentUser: (user: PublicUser) => void;
  socketRef: MutableRefObject<Socket | null>;
  setLightboxUrl: (url: string | null) => void;
  brokenAvatarIds: Record<string, true>;
  setBrokenAvatarIds: React.Dispatch<React.SetStateAction<Record<string, true>>>;
}

export function MyProfileModal({
  isOpen,
  onClose,
  currentUser,
  setCurrentUser,
  socketRef,
  setLightboxUrl,
  brokenAvatarIds,
  setBrokenAvatarIds,
}: MyProfileModalProps) {
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editStatusText, setEditStatusText] = useState("");
  const [editStatusEmoji, setEditStatusEmoji] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    if (currentUser && isOpen) {
      setEditDisplayName(currentUser.displayName ?? "");
      setEditUsername(currentUser.username ?? "");
      setEditStatusText(currentUser.statusText ?? "");
      setEditStatusEmoji(currentUser.statusEmoji ?? "");
    }
  }, [currentUser, isOpen]);

  if (!isOpen || !currentUser) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="my-profile-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>👤 My Profile</h3>
          <button className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="my-profile-avatar-section">
          <div className="my-profile-avatar-wrapper">
            {hasUsableAvatar(currentUser.avatarUrl) && !brokenAvatarIds[currentUser.id] ? (
              <img
                src={`${API_URL}${currentUser.avatarUrl}`}
                alt="Avatar"
                className="my-profile-avatar-img clickable"
                onClick={() => setLightboxUrl(`${API_URL}${currentUser.avatarUrl}`)}
                onError={() =>
                  setBrokenAvatarIds((prev) => ({
                    ...prev,
                    [currentUser.id]: true,
                  }))
                }
              />
            ) : (
              <div className="my-profile-avatar-placeholder">
                {getInitialLetter(currentUser.displayName)}
              </div>
            )}
            <label className="my-profile-avatar-edit" title="Change photo">
              📷
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  try {
                    const uploadRes = await api.post<{ url: string }>(
                      "/upload",
                      formData,
                      {
                        headers: { "Content-Type": "multipart/form-data" },
                      },
                    );
                    const avatarUrl = uploadRes.data.url;
                    const profileRes = await api.put<{ user: PublicUser }>(
                      "/auth/profile",
                      { avatarUrl },
                    );
                    setCurrentUser(profileRes.data.user);
                    toast.success("Profile photo updated!");
                  } catch {
                    toast.error("Failed to upload photo");
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="my-profile-form">
          <div className="my-profile-field">
            <label>Name</label>
            <input
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              placeholder="Display name"
              maxLength={40}
            />
          </div>
          <div className="my-profile-field">
            <label>Status</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={editStatusEmoji}
                onChange={(e) => setEditStatusEmoji(e.target.value)}
                placeholder="😊"
                maxLength={4}
                style={{ width: 50, textAlign: "center", fontSize: 20 }}
              />
              <input
                type="text"
                value={editStatusText}
                onChange={(e) => setEditStatusText(e.target.value)}
                placeholder="What are you up to?"
                maxLength={100}
                style={{ flex: 1 }}
              />
            </div>
            {(currentUser.statusEmoji || currentUser.statusText) && (
              <small style={{ color: "var(--text-muted)", marginTop: 4 }}>
                Current: {currentUser.statusEmoji} {currentUser.statusText}
              </small>
            )}
          </div>
          <div className="my-profile-field">
            <label>Username</label>
            <div className="username-input-wrapper">
              <span className="username-at">@</span>
              <input
                type="text"
                value={editUsername}
                onChange={(e) =>
                  setEditUsername(
                    e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                  )
                }
                placeholder="username"
                maxLength={30}
              />
            </div>
            {currentUser.username && (
              <small className="username-preview">
                @{currentUser.username}
              </small>
            )}
          </div>
          <div className="my-profile-field">
            <label>Email</label>
            <input
              type="text"
              value={currentUser.email}
              disabled
              className="profile-disabled-input"
            />
          </div>
          <button
            className="settings-btn primary"
            disabled={profileSaving}
            onClick={async () => {
              setProfileSaving(true);
              try {
                const data: Record<string, string | null> = {};
                if (
                  editDisplayName.trim() &&
                  editDisplayName !== currentUser.displayName
                )
                  data.displayName = editDisplayName.trim();
                if (editUsername !== (currentUser.username ?? ""))
                  data.username = editUsername || null;

                // Update status via socket (real-time broadcast)
                const newStatusText = editStatusText.trim() || null;
                const newStatusEmoji = editStatusEmoji.trim() || null;
                const statusChanged =
                  newStatusText !== (currentUser.statusText ?? null) ||
                  newStatusEmoji !== (currentUser.statusEmoji ?? null);
                if (statusChanged && socketRef.current) {
                  socketRef.current.emit("status:update", {
                    statusText: newStatusText,
                    statusEmoji: newStatusEmoji,
                  });
                }

                if (Object.keys(data).length === 0 && !statusChanged) {
                  toast("No changes");
                  setProfileSaving(false);
                  return;
                }
                if (Object.keys(data).length > 0) {
                  const res = await api.put<{ user: PublicUser }>(
                    "/auth/profile",
                    data,
                  );
                  setCurrentUser(res.data.user);
                }
                toast.success("Profile updated!");
                onClose();
              } catch (err: any) {
                toast.error(
                  err?.response?.data?.message ?? "An error occurred",
                );
              } finally {
                setProfileSaving(false);
              }
            }}
          >
            {profileSaving ? "Saving..." : "💾 Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
