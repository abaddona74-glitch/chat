import React from "react";
import { UpdateModal, UpdateModalProps } from "./UpdateModal";

export interface AppLockScreenProps {
  lockPasscodeInputRef: React.RefObject<HTMLInputElement>;
  lockPasscodeInput: string;
  setLockPasscodeInput: (val: string) => void;
  unlockKeyboardMode: "numeric" | "text";
  setUnlockKeyboardMode: React.Dispatch<React.SetStateAction<"numeric" | "text">>;
  handleUnlock: () => void;
  sanitizeUnlockInput: (value: string, mode: "numeric" | "text") => string;
  passcodeMaxLength: number;
  updateModalProps?: UpdateModalProps;
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  lockPasscodeInputRef,
  lockPasscodeInput,
  setLockPasscodeInput,
  unlockKeyboardMode,
  setUnlockKeyboardMode,
  handleUnlock,
  sanitizeUnlockInput,
  passcodeMaxLength,
  updateModalProps,
}) => {
  return (
    <div className="layout dark">
      <div className="auth-page" style={{ gridColumn: "1 / -1" }}>
        <div
          className="auth-card"
          onClick={() => lockPasscodeInputRef.current?.focus()}
        >
          <div className="auth-logo">🔒</div>
          <h1>App Locked</h1>
          <p>Enter passcode to continue</p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              handleUnlock();
            }}
          >
            <input
              ref={lockPasscodeInputRef}
              type="password"
              placeholder="Enter passcode"
              value={lockPasscodeInput}
              onChange={(e) =>
                setLockPasscodeInput(
                  sanitizeUnlockInput(e.target.value, unlockKeyboardMode),
                )
              }
              inputMode={unlockKeyboardMode === "numeric" ? "numeric" : "text"}
              pattern={unlockKeyboardMode === "numeric" ? "[0-9]*" : undefined}
              maxLength={passcodeMaxLength}
              autoFocus
              required
            />
            <button
              className="btn-link"
              type="button"
              onClick={() =>
                setUnlockKeyboardMode((prev) =>
                  prev === "numeric" ? "text" : "numeric",
                )
              }
            >
              {unlockKeyboardMode === "numeric"
                ? "Old passcode (harf) uchun ABC keyboard"
                : "Raqamli keyboardga qaytish (123)"}
            </button>
            <button className="btn-primary" type="submit">
              Unlock
            </button>
          </form>
        </div>
      </div>
      {updateModalProps && <UpdateModal {...updateModalProps} />}
    </div>
  );
};
