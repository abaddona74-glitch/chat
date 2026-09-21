import React, { useRef } from "react";
import { API_URL } from "../../lib/api";
import {
  PublicUser,
  Group,
  GroupRole,
  CallStatus,
} from "../../types";
import {
  formatLastSeen,
  getInitialLetter,
  hasUsableAvatar,
  normalizeFileUrl,
} from "../../utils/formatters";

export interface RightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chatMode: "user" | "group" | "saved";
  activeUser: PublicUser | null;
  activeGroup: Group | null;
  currentUser: PublicUser | null;
  users: PublicUser[];
  brokenAvatarIds: Record<string, true>;
  setBrokenAvatarIds: React.Dispatch<
    React.SetStateAction<Record<string, true>>
  >;
  setLightboxUrl: (url: string | null) => void;
  setProfileViewUser: (user: PublicUser) => void;
  canManageGroupMembers: boolean;
  canAssignGroupAdmins: boolean;
  myGroupRole: GroupRole | null;
  setShowEditGroup: (val: boolean) => void;
  setShowAddGroupMembers: (val: boolean) => void;
  setAddMemberIds: React.Dispatch<React.SetStateAction<string[]>>;
  removeGroupAvatar: () => Promise<void>;
  handleGroupAvatarChange: (file: File) => Promise<void>;
  updateGroupMemberRole: (
    userId: string,
    role: "ADMIN" | "MEMBER",
  ) => Promise<void>;
  kickGroupMember: (userId: string) => Promise<void>;
  setShowSettings: (val: boolean) => void;
  callStatus: CallStatus;
  incomingCall: any;
  acceptCall: () => void;
  declineCall: () => void;
}

export function RightPanel(props: RightPanelProps) {
  const {
    isOpen,
    onClose,
    chatMode,
    activeUser,
    activeGroup,
    currentUser,
    users,
    brokenAvatarIds,
    setBrokenAvatarIds,
    setLightboxUrl,
    setProfileViewUser,
    canManageGroupMembers,
    canAssignGroupAdmins,
    myGroupRole,
    setShowEditGroup,
    setShowAddGroupMembers,
    setAddMemberIds,
    removeGroupAvatar,
    handleGroupAvatarChange,
    updateGroupMemberRole,
    kickGroupMember,
    setShowSettings,
    callStatus,
    incomingCall,
    acceptCall,
    declineCall,
  } = props;

  const groupAvatarInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {isOpen && (
        <div
          className="sidebar-overlay right"
          onClick={onClose}
        />
      )}
      <aside className={`right-panel${isOpen ? " open" : ""}`}>
        {chatMode === "user" && activeUser && (
          <div className="right-profile">
            {hasUsableAvatar(activeUser.avatarUrl) &&
            !brokenAvatarIds[activeUser.id] ? (
              <img
                src={`${API_URL}${activeUser.avatarUrl}`}
                alt="Avatar"
                className="right-profile-avatar-img clickable"
                onClick={() =>
                  setLightboxUrl(`${API_URL}${activeUser.avatarUrl}`)
                }
                onError={() =>
                  setBrokenAvatarIds((prev) => ({
                    ...prev,
                    [activeUser.id]: true,
                  }))
                }
              />
            ) : (
              <div className="right-profile-avatar">
                {getInitialLetter(activeUser.displayName)}
              </div>
            )}
            <h3>{activeUser.displayName}</h3>
            {activeUser.username && (
              <span className="right-profile-username">
                @{activeUser.username}
              </span>
            )}
            <small>
              {activeUser.isOnline
                ? "🟢 Online"
                : formatLastSeen(activeUser.lastSeenAt)}
            </small>
          </div>
        )}

        {chatMode === "group" && activeGroup && (
          <>
            <div className="right-profile">
              {activeGroup.avatarUrl ? (
                <img
                  src={normalizeFileUrl(activeGroup.avatarUrl) ?? ""}
                  alt="Group avatar"
                  className="right-profile-avatar-img clickable"
                  onClick={() => {
                    const imageUrl = normalizeFileUrl(activeGroup.avatarUrl);
                    if (imageUrl) setLightboxUrl(imageUrl);
                  }}
                />
              ) : (
                <div className="right-profile-avatar group-avatar">
                  {activeGroup.name.charAt(0).toUpperCase()}
                </div>
              )}
              <h3>{activeGroup.name}</h3>
              <small>
                {activeGroup._count?.members ??
                  activeGroup.members?.length ??
                  0}{" "}
                members
              </small>
            </div>
            {canManageGroupMembers && (
              <div className="right-section">
                <h4>Group management</h4>
                <button
                  className="action-btn"
                  onClick={() => setShowEditGroup(true)}
                >
                  ✏️ Edit group name
                </button>
                <button
                  className="action-btn"
                  onClick={() => groupAvatarInputRef.current?.click()}
                >
                  🖼️ Change group photo
                </button>
                {activeGroup.avatarUrl && (
                  <button
                    className="action-btn"
                    onClick={() => {
                      void removeGroupAvatar();
                    }}
                  >
                    🗑️ Remove group photo
                  </button>
                )}
                <input
                  ref={groupAvatarInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleGroupAvatarChange(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>
            )}
            <div className="right-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <h4 style={{ margin: 0 }}>Members</h4>
                <button
                  className="btn-primary"
                  style={{ padding: "4px 12px", fontSize: 12, borderRadius: 6 }}
                  onClick={() => {
                    setShowAddGroupMembers(true);
                    setAddMemberIds([]);
                  }}
                  disabled={!canManageGroupMembers}
                >
                  + Add
                </button>
              </div>
              {activeGroup.members?.map((m) => {
                const memberUser = m.user ?? users.find((u) => u.id === m.userId);
                const avatarUrl = memberUser?.avatarUrl;
                const displayName = memberUser?.displayName ?? m.userId;
                const isAvatarBroken =
                  brokenAvatarIds[m.userId] ||
                  (memberUser?.id ? brokenAvatarIds[memberUser.id] : false);

                return (
                  <div
                    key={m.id}
                    className="group-member-row clickable"
                    onClick={() => {
                      if (memberUser) setProfileViewUser(memberUser);
                    }}
                  >
                    {hasUsableAvatar(avatarUrl) && !isAvatarBroken ? (
                      <img
                        src={normalizeFileUrl(avatarUrl)}
                        alt=""
                        className="group-member-avatar-img"
                        onError={() =>
                          setBrokenAvatarIds((prev) => ({
                            ...prev,
                            [m.userId]: true,
                            ...(memberUser?.id ? { [memberUser.id]: true } : {}),
                          }))
                        }
                      />
                    ) : (
                      <div
                        className="user-avatar"
                        style={{
                          width: 32,
                          height: 32,
                          fontSize: 13,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {getInitialLetter(displayName)}
                      </div>
                    )}
                    <span>{displayName}</span>
                    {m.role === "OWNER" && (
                      <small className="badge-owner">Owner</small>
                    )}
                    {m.role === "ADMIN" && (
                      <small className="badge-on">Admin</small>
                    )}
                    {m.role === "MEMBER" && (
                      <small className="badge-member">Member</small>
                    )}
                    {(canAssignGroupAdmins || canManageGroupMembers) &&
                      currentUser?.id !== m.userId && (
                        <div
                          className="group-member-actions"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {canAssignGroupAdmins && m.role !== "OWNER" && (
                            <button
                              className="member-action-btn"
                              onClick={() =>
                                void updateGroupMemberRole(
                                  m.userId,
                                  m.role === "ADMIN" ? "MEMBER" : "ADMIN",
                                )
                              }
                            >
                              {m.role === "ADMIN" ? "Revoke admin" : "Make admin"}
                            </button>
                          )}
                          {((myGroupRole === "OWNER" && m.role !== "OWNER") ||
                            (myGroupRole === "ADMIN" && m.role === "MEMBER")) && (
                            <button
                              className="member-action-btn danger"
                              onClick={() => void kickGroupMember(m.userId)}
                            >
                              Kick
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="right-section">
          <h4>Security</h4>
          <div className="security-row">
            <span>Two-Factor Auth</span>
            {currentUser?.isTwoFAEnabled ? (
              <span className="badge-on">Enabled</span>
            ) : (
              <span className="badge-off">Disabled</span>
            )}
          </div>
          <button
            className="action-btn"
            onClick={() => {
              setShowSettings(true);
              onClose();
            }}
          >
            ⚙️ Open Settings
          </button>
        </div>

        {callStatus === "ringing" && incomingCall && (
          <div className="right-section">
            <div className="incoming-call">
              <p>📞 Incoming call</p>
              <div className="call-buttons">
                <button className="accept-btn" onClick={acceptCall}>
                  Accept
                </button>
                <button className="decline-btn" onClick={declineCall}>
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
