import React, { useRef } from "react";
import toast from "react-hot-toast";
import { API_URL } from "../../lib/api";
import {
  PublicUser,
  Group,
  GroupRole,
  CallStatus,
  ZeroTierNetwork,
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
  myZeroTierNetworks?: ZeroTierNetwork[];
  onRefreshZeroTier?: () => void;
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
    myZeroTierNetworks,
    onRefreshZeroTier,
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
            {activeUser.statusText && (
              <div
                style={{
                  fontSize: 12,
                  fontStyle: "italic",
                  marginTop: 6,
                  color: "var(--text)",
                  opacity: 0.85,
                }}
              >
                {activeUser.statusEmoji && `${activeUser.statusEmoji} `}
                "{activeUser.statusText}"
              </div>
            )}
          </div>
        )}

        {/* ── ZEROTIER NETWORK INFO (DO'STINGIZNING ZEROTIER IP MANZILI) ── */}
        {chatMode === "user" && activeUser && (
          <div className="right-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h4 style={{ margin: 0 }}>🌐 ZeroTier IP</h4>
              {onRefreshZeroTier && (
                <button
                  type="button"
                  className="settings-btn"
                  style={{ padding: "2px 6px", fontSize: 11 }}
                  onClick={onRefreshZeroTier}
                  title="ZeroTier IP yangilash"
                >
                  🔄
                </button>
              )}
            </div>
            {activeUser.zerotierNetworks && activeUser.zerotierNetworks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeUser.zerotierNetworks.map((net) => {
                  const matchingMyNet = (myZeroTierNetworks || []).find(
                    (myNet) =>
                      (myNet.id &&
                        net.id &&
                        myNet.id.toLowerCase() === net.id.toLowerCase()) ||
                      (myNet.name &&
                        net.name &&
                        myNet.name.toLowerCase() === net.name.toLowerCase()),
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
                          toast.success(`${net.ip} nusxalandi!`, {
                            icon: "📋",
                          });
                        }
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        background: isSameNetwork
                          ? "rgba(34, 197, 94, 0.12)"
                          : "rgba(255, 255, 255, 0.04)",
                        border: isSameNetwork
                          ? "1px solid rgba(34, 197, 94, 0.35)"
                          : "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        cursor: net.ip ? "pointer" : "default",
                        transition: "all 0.16s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (net.ip) {
                          e.currentTarget.style.transform = "translateY(-1px)";
                          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
                          e.currentTarget.style.borderColor = isSameNetwork
                            ? "#22c55e"
                            : "rgba(255, 255, 255, 0.2)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (net.ip) {
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.borderColor = isSameNetwork
                            ? "rgba(34, 197, 94, 0.35)"
                            : "rgba(255, 255, 255, 0.08)";
                        }
                      }}
                      title={net.ip ? "IP manzilni nusxalash uchun bosing" : undefined}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span style={{ fontSize: 12, lineHeight: 1 }}>
                            {isSameNetwork ? "🟢" : "⚪"}
                          </span>
                          <strong
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: isSameNetwork ? "#4ade80" : "var(--text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {networkDisplayName}
                          </strong>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: isSameNetwork ? "#4ade80" : "var(--muted)",
                            opacity: 0.8,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isSameNetwork ? "Bir xil tarmoq" : "Boshqa tarmoq"}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                          background: "rgba(0,0,0,0.22)",
                          padding: "5px 8px",
                          borderRadius: 6,
                        }}
                      >
                        <code
                          style={{
                            fontSize: 13,
                            fontFamily: "monospace",
                            color: "#38bdf8",
                            fontWeight: 600,
                            letterSpacing: 0.3,
                          }}
                        >
                          {net.ip || "IP kutilmoqda..."}
                        </code>
                        {net.ip && (
                          <span
                            style={{
                              fontSize: 12,
                              opacity: 0.65,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            title="Nusxalash"
                          >
                            📋
                          </span>
                        )}
                      </div>

                      {net.id && net.id !== networkDisplayName && (
                        <span
                          style={{
                            fontSize: 10,
                            opacity: 0.45,
                            fontFamily: "monospace",
                            letterSpacing: 0.5,
                          }}
                        >
                          ID: {net.id}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  background: "rgba(0,0,0,0.18)",
                  padding: "8px 10px",
                  borderRadius: 8,
                  lineHeight: 1.4,
                }}
              >
                ZeroTier IP aniqlanmagan yoki do'stingiz hali ZeroTier tarmog'iga ulanmagan.
              </div>
            )}
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
