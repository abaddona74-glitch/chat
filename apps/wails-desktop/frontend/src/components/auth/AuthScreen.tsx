import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import { isNativeMobileRuntime, isWailsRuntime } from "../../platform/bridge";
import { PublicUser } from "../../types";
import { readAxiosMessage } from "../../utils/formatters";

const isWails = isWailsRuntime;

export type AuthStep =
  | "login"
  | "register"
  | "verify"
  | "login2fa"
  | "forgot"
  | "reset";

interface AuthScreenProps {
  token: string | null;
  isSessionBootstrapping: boolean;
  sessionBootstrapError: string | null;
  onRetryBootstrap: () => void;
  onAuthSuccess: (token: string, user: PublicUser) => void;
  startGoogleLogin: () => void;
  googleAuthLoading: boolean;
  appVersion: string;
  onCheckForUpdate: () => void | Promise<void>;
}

export function AuthScreen({
  token,
  isSessionBootstrapping,
  sessionBootstrapError,
  onRetryBootstrap,
  onAuthSuccess,
  startGoogleLogin,
  googleAuthLoading,
  appVersion,
  onCheckForUpdate,
}: AuthScreenProps) {
  const [authStep, setAuthStep] = useState<AuthStep>("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [tempTwoFAToken, setTempTwoFAToken] = useState("");
  const [twoFALoginCode, setTwoFALoginCode] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // If bootstrapping session from stored token
  if (token && (isSessionBootstrapping || sessionBootstrapError)) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="session-loader-mark" aria-hidden="true">
            <div className="session-loader-ring" />
            <div className="session-loader-core">CD</div>
          </div>
          <h1>Session tiklanmoqda</h1>
          <p>
            {isSessionBootstrapping
              ? "Avvalgi login ma'lumotlari tekshirilmoqda..."
              : sessionBootstrapError}
          </p>
          {!isSessionBootstrapping && (
            <button
              className="btn-primary"
              type="button"
              onClick={onRetryBootstrap}
            >
              Qayta urinish
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/register", {
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
        displayName: registerDisplayName.trim(),
      });
      setVerifyEmail(registerEmail.trim().toLowerCase());
      setAuthStep("verify");
      toast.success("Verification code sent to your email.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Registration error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleVerifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>(
        "/auth/verify-email",
        {
          email: verifyEmail.trim().toLowerCase(),
          code: verifyCode.trim(),
        },
      );
      onAuthSuccess(response.data.token, response.data.user);
      toast.success("Email verified.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Verification failed."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<
        | { token: string; user: PublicUser; requiresTwoFA?: false }
        | { requiresTwoFA: true; tempToken: string }
      >("/auth/login", {
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      });

      if ("requiresTwoFA" in response.data && response.data.requiresTwoFA) {
        setTempTwoFAToken(response.data.tempToken);
        setAuthStep("login2fa");
        toast("Enter 2FA code.");
        return;
      }

      onAuthSuccess(response.data.token, response.data.user);
      toast.success("Welcome.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Login error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handle2FALogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>(
        "/auth/login/2fa",
        {
          tempToken: tempTwoFAToken,
          code: twoFALoginCode.trim(),
        },
      );
      onAuthSuccess(response.data.token, response.data.user);
      toast.success("2FA verified.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA login error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/forgot-password", {
        email: forgotEmail.trim().toLowerCase(),
      });
      setVerifyEmail(forgotEmail.trim().toLowerCase());
      setAuthStep("reset");
      toast.success("Password reset code sent.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Forgot password error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/reset-password", {
        email: verifyEmail.trim().toLowerCase(),
        code: resetCode.trim(),
        newPassword: resetPassword,
      });
      setAuthStep("login");
      toast.success("Password updated.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Password update error."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">💬</div>
        <h1>Chat Desktop</h1>
        <p>Secure real-time messaging</p>

        {authStep === "login" && (
          <form className="form" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email address"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Sign In
            </button>
            <button
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("register")}
            >
              Create Account
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("forgot")}
            >
              Forgot password?
            </button>
            <div className="auth-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="google-desktop-btn"
              onClick={startGoogleLogin}
              disabled={googleAuthLoading}
            >
              {googleAuthLoading
                ? "⏳ Browserda kiring..."
                : "🔵 Google bilan kirish"}
            </button>
          </form>
        )}

        {authStep === "register" && (
          <form className="form" onSubmit={handleRegister}>
            <input
              type="text"
              placeholder="Display name"
              value={registerDisplayName}
              onChange={(event) => setRegisterDisplayName(event.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email address"
              value={registerEmail}
              onChange={(event) => setRegisterEmail(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={registerPassword}
              onChange={(event) => setRegisterPassword(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Sign Up
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("login")}
            >
              ← Back to Sign In
            </button>
          </form>
        )}

        {authStep === "verify" && (
          <form className="form" onSubmit={handleVerifyEmail}>
            <input
              type="email"
              placeholder="Email address"
              value={verifyEmail}
              onChange={(event) => setVerifyEmail(event.target.value)}
              required
            />
            <input
              type="text"
              placeholder="6-digit verification code"
              value={verifyCode}
              onChange={(event) => setVerifyCode(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Verify & Sign In
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("login")}
            >
              ← Back to Sign In
            </button>
          </form>
        )}

        {authStep === "login2fa" && (
          <form className="form" onSubmit={handle2FALogin}>
            <input
              type="text"
              placeholder="Authenticator code"
              value={twoFALoginCode}
              onChange={(event) => setTwoFALoginCode(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Verify 2FA
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => {
                setAuthStep("login");
                setTempTwoFAToken("");
              }}
            >
              ← Back
            </button>
          </form>
        )}

        {authStep === "forgot" && (
          <form className="form" onSubmit={handleForgotPassword}>
            <input
              type="email"
              placeholder="Email address"
              value={forgotEmail}
              onChange={(event) => setForgotEmail(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Send Reset Code
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("login")}
            >
              ← Back to Sign In
            </button>
          </form>
        )}

        {authStep === "reset" && (
          <form className="form" onSubmit={handleResetPassword}>
            <input
              type="email"
              placeholder="Email address"
              value={verifyEmail}
              onChange={(event) => setVerifyEmail(event.target.value)}
              required
            />
            <input
              type="text"
              placeholder="Reset code"
              value={resetCode}
              onChange={(event) => setResetCode(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              required
            />
            <button
              className="btn-primary"
              disabled={isSubmittingAuth}
              type="submit"
            >
              Reset Password
            </button>
            <button
              className="btn-link"
              disabled={isSubmittingAuth}
              type="button"
              onClick={() => setAuthStep("login")}
            >
              ← Back to Sign In
            </button>
          </form>
        )}

        {/* Login Page Update Check */}
        {(isWails || isNativeMobileRuntime) && (
          <div
            style={{
              marginTop: 20,
              textAlign: "center",
              borderTop: "1px solid var(--border)",
              paddingTop: 15,
            }}
          >
            <div
              style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}
            >
              Version: <strong>v{appVersion}</strong>
            </div>
            <button
              className="btn-link"
              type="button"
              disabled={isSubmittingAuth}
              onClick={() => void onCheckForUpdate()}
            >
              Check for updates
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
