import toast from "react-hot-toast";
import { api } from "../../lib/api";
import { PublicUser } from "../../types";
import { readAxiosMessage } from "../../utils/formatters";

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: PublicUser | null;
  users: PublicUser[];
  selectedMessageIds: Set<string>;
  onForwardComplete: () => void;
}

export function ForwardModal({
  isOpen,
  onClose,
  currentUser,
  users,
  selectedMessageIds,
  onForwardComplete,
}: ForwardModalProps) {
  if (!isOpen || !currentUser) return null;

  const handleForwardToUser = async (targetUserId: string, targetName: string, isSaved: boolean = false) => {
    try {
      await api.post("/messages/forward", {
        messageIds: [...selectedMessageIds],
        recipientId: targetUserId,
      });
      if (isSaved) {
        toast.success(`${selectedMessageIds.size} message(s) saved`);
      } else {
        toast.success(`${selectedMessageIds.size} message(s) forwarded to ${targetName}`);
      }
    } catch (err) {
      toast.error(readAxiosMessage(err, isSaved ? "Failed to save" : "Failed to forward"));
    }
    onForwardComplete();
    onClose();
  };

  return (
    <div className="forward-modal-overlay" onClick={onClose}>
      <div className="forward-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Forward to</h3>
        <div className="forward-user-list">
          {/* Saved Messages (self) */}
          <button
            className="forward-user-item"
            onClick={() => void handleForwardToUser(currentUser.id, "Saved Messages", true)}
          >
            <span className="forward-user-avatar saved-avatar" style={{ fontSize: 16 }}>
              🔖
            </span>
            <span className="forward-user-name">Saved Messages</span>
          </button>
          {users
            .filter((u) => u.id !== currentUser.id)
            .map((u) => (
              <button
                key={u.id}
                className="forward-user-item"
                onClick={() => void handleForwardToUser(u.id, u.displayName, false)}
              >
                <span className="forward-user-avatar">
                  {u.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="forward-user-name">{u.displayName}</span>
              </button>
            ))}
        </div>
        <button className="forward-close-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
