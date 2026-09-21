import { PublicUser } from "../../types";

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  users: PublicUser[];
  newGroupMembers: string[];
  setNewGroupMembers: (members: string[]) => void;
  onCreateGroup: () => void;
}

export function CreateGroupModal({
  isOpen,
  onClose,
  newGroupName,
  setNewGroupName,
  users,
  newGroupMembers,
  setNewGroupMembers,
  onCreateGroup,
}: CreateGroupModalProps) {
  if (!isOpen) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Group</h3>
        <input
          type="text"
          placeholder="Group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          autoFocus
        />
        <div className="group-member-select">
          <h4>Select members:</h4>
          {users.map((user) => (
            <label key={user.id} className="group-member-checkbox">
              <input
                type="checkbox"
                checked={newGroupMembers.includes(user.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setNewGroupMembers([...newGroupMembers, user.id]);
                  } else {
                    setNewGroupMembers(
                      newGroupMembers.filter((id) => id !== user.id),
                    );
                  }
                }}
              />
              <span>{user.displayName}</span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
            onClick={onCreateGroup}
          >
            Create ({newGroupMembers.length} members)
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
