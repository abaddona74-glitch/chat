interface EditGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  editGroupName: string;
  setEditGroupName: (name: string) => void;
  onSaveGroupName: () => void | Promise<void>;
}

export function EditGroupModal({
  isOpen,
  onClose,
  editGroupName,
  setEditGroupName,
  onSaveGroupName,
}: EditGroupModalProps) {
  if (!isOpen) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Group</h3>
        <input
          type="text"
          placeholder="Group name"
          value={editGroupName}
          onChange={(e) => setEditGroupName(e.target.value)}
          autoFocus
          maxLength={100}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: 10, borderRadius: 10 }}
            onClick={() => void onSaveGroupName()}
          >
            Save
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
