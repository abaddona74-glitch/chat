import React from "react";

export interface UpdateModalProps {
  updateAvailable: { newVersion: string; notes?: string } | null;
  onClose: () => void;
  onInstall: (version: string) => Promise<void> | void;
  isUpdating: boolean;
  updateActionLabel: string;
  updateProgress: number;
  updateSpeedLabel?: string;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  updateAvailable,
  onClose,
  onInstall,
  isUpdating,
  updateActionLabel,
  updateProgress,
  updateSpeedLabel,
}) => {
  if (!updateAvailable) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div
        className="create-group-dialog update-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="update-dialog-header">
          <span className="update-dialog-icon">🔄</span>
          <h3>New version available!</h3>
          <p>
            Version <strong>{updateAvailable.newVersion}</strong> is ready to
            download
          </p>
          {updateAvailable.notes && (
            <p className="update-dialog-notes">{updateAvailable.notes}</p>
          )}
        </div>
        <div className="update-dialog-actions">
          <button
            className="btn-primary update-dialog-primary-btn"
            disabled={isUpdating}
            onClick={() => {
              void onInstall(updateAvailable.newVersion);
            }}
          >
            {isUpdating ? "Downloading..." : updateActionLabel}
          </button>
          <div className="update-progress-panel">
            <div className="update-progress-head">
              <span>Download progress</span>
              <strong>{updateProgress}%</strong>
            </div>
            <div className="update-progress-track" aria-hidden="true">
              <div
                className="update-progress-fill"
                style={{
                  width: `${updateProgress}%`,
                  animation: isUpdating
                    ? "update-flow 1.15s linear infinite"
                    : "none",
                }}
              />
            </div>
            <div className="update-progress-foot">
              <span>0%</span>
              <span>{updateSpeedLabel || "Waiting..."}</span>
              <span>100%</span>
            </div>
          </div>
          <button
            className="update-dialog-secondary-btn"
            onClick={onClose}
            disabled={isUpdating}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};
