import React, { useState, useEffect } from "react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (forEveryone: boolean) => Promise<void> | void;
  canDeleteForEveryone: boolean;
  recipientName?: string;
  messageCount?: number;
}

const PREF_KEY = "chat_delete_also_for_everyone_pref";

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  canDeleteForEveryone,
  recipientName = "suhbatdosh",
  messageCount = 1,
}) => {
  // Telegram-style memory: remember checkbox state in localStorage
  const [alsoForEveryone, setAlsoForEveryone] = useState<boolean>(() => {
    const saved = localStorage.getItem(PREF_KEY);
    return saved !== null ? saved === "true" : true;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const willDeleteForEveryone = canDeleteForEveryone ? alsoForEveryone : false;
        void handleConfirm(willDeleteForEveryone);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, canDeleteForEveryone, alsoForEveryone]);

  if (!isOpen) return null;

  const handleToggleCheckbox = (checked: boolean) => {
    setAlsoForEveryone(checked);
    localStorage.setItem(PREF_KEY, String(checked));
  };

  const handleConfirm = async (forEveryone: boolean) => {
    setIsSubmitting(true);
    try {
      await onConfirm(forEveryone);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.48)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 390,
          background: "var(--panel, #252329)",
          color: "var(--text, #ffffff)",
          borderRadius: 12,
          padding: "24px 26px 20px 26px",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.55)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: "0 0 18px 0",
            fontSize: 16,
            fontWeight: 500,
            color: "var(--text, #ffffff)",
            lineHeight: 1.35,
          }}
        >
          {messageCount > 1
            ? `Do you want to delete these ${messageCount} messages?`
            : "Do you want to delete this message?"}
        </h3>

        {canDeleteForEveryone && (
          <label
            onClick={(e) => {
              e.preventDefault();
              handleToggleCheckbox(!alsoForEveryone);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              userSelect: "none",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: alsoForEveryone
                  ? "var(--accent, #d07088)"
                  : "transparent",
                border: alsoForEveryone
                  ? "none"
                  : "2px solid rgba(255, 255, 255, 0.38)",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            >
              {alsoForEveryone && (
                <svg
                  width="13"
                  height="10"
                  viewBox="0 0 13 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1.5 5L4.8 8.3L11.5 1.5"
                    stroke="#ffffff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span
              style={{
                fontSize: 14,
                color: "var(--text, #ffffff)",
                fontWeight: 400,
              }}
            >
              Also delete for {recipientName}
            </span>
          </label>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            marginTop: canDeleteForEveryone ? 0 : 20,
          }}
        >
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent, #e57373)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              padding: "7px 14px",
              borderRadius: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() =>
              handleConfirm(canDeleteForEveryone ? alsoForEveryone : false)
            }
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent, #e57373)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              padding: "7px 14px",
              borderRadius: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            {isSubmitting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};
