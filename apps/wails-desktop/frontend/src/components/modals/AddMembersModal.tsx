import { Group, PublicUser } from "../../types";
import {
  hasUsableAvatar,
  normalizeFileUrl,
  getInitialLetter,
} from "../../utils/formatters";

interface AddMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeGroup: Group | null;
  users: PublicUser[];
  addMemberIds: string[];
  setAddMemberIds: (ids: string[]) => void;
  brokenAvatarIds: Record<string, true>;
  setBrokenAvatarIds: React.Dispatch<
    React.SetStateAction<Record<string, true>>
  >;
  onAddMembers: () => void;
}

export function AddMembersModal({
  isOpen,
  onClose,
  activeGroup,
  users,
  addMemberIds,
  setAddMemberIds,
  brokenAvatarIds,
  setBrokenAvatarIds,
  onAddMembers,
}: AddMembersModalProps) {
  if (!isOpen || !activeGroup) return null;

  const availableUsers = users.filter(
    (u) => !activeGroup.members?.some((m) => m.userId === u.id),
  );

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add Members to {activeGroup.name}</h3>
        <div className="group-member-select">
          {availableUsers.map((user) => (
            <label key={user.id} className="group-member-checkbox">
              <input
                type="checkbox"
                checked={addMemberIds.includes(user.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setAddMemberIds([...addMemberIds, user.id]);
                  } else {
                    setAddMemberIds(
                      addMemberIds.filter((id) => id !== user.id),
                    );
                  }
                }}
              />
              {hasUsableAvatar(user.avatarUrl) && !brokenAvatarIds[user.id] ? (
                <img
                  src={normalizeFileUrl(user.avatarUrl)}
                  alt=""
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                  onError={() =>
                    setBrokenAvatarIds((prev) => ({
                      ...prev,
                      [user.id]: true,
                    }))
                  }
                />
              ) : (
                <div
                  className="user-avatar"
                  style={{
                    width: 24,
                    height: 24,
                    fontSize: 10,
                    flexShrink: 0,
                  }}
                >
                  {getInitialLetter(user.displayName)}
                </div>
              )}
              <span>{user.displayName}</span>
            </label>
          ))}
          {availableUsers.length === 0 && (
            <p style={{ color: "var(--text-muted)", textAlign: "center" }}>
              No users available to add
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
            onClick={onAddMembers}
          >
            Add ({addMemberIds.length})
          </button>
          <button
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--line)",
            }}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
