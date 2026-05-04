import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./styles.css";
import * as WailsApp from "../wailsjs/go/main/App";
import { Quit } from "../wailsjs/runtime/runtime";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React Error Boundary:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "red", fontFamily: "monospace" }}>
          <h2>App crashed!</h2>
          <pre>{this.state.error.message}</pre>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type ToastBootstrapData = { isToast: boolean; title: string; body: string; target: string };

async function focusMainWindowFromToast() {
  try {
    const mainApp = (window as any)?.go?.main?.App;
    if (typeof mainApp?.FocusMainWindow === "function") {
      await mainApp.FocusMainWindow();
      return;
    }
    if (typeof mainApp?.ShowWindow === "function") {
      await mainApp.ShowWindow();
    }
  } catch {
    // Keep toast dismiss behavior even if focus fails.
  }
}

function ToastWindow({ title, body, target }: { title: string; body: string; target: string }) {
  let parsedTarget: any = null;
  try {
    parsedTarget = target ? JSON.parse(target) : null;
  } catch {
    parsedTarget = null;
  }
  const isIncomingCall = parsedTarget?.kind === "incoming-call";
  const callUserId = typeof parsedTarget?.userId === "string" ? parsedTarget.userId : undefined;

  const openTargetAndQuit = () => {
    const mainApp = (window as any)?.go?.main?.App;
    if (target && typeof mainApp?.SetPendingNotificationTarget === "function") {
      void mainApp.SetPendingNotificationTarget(target);
    }
    void focusMainWindowFromToast();
    Quit();
  };

  const sendCallActionAndQuit = (action: "accept" | "decline") => {
    const mainApp = (window as any)?.go?.main?.App;
    if (typeof mainApp?.SetPendingNotificationTarget === "function") {
      const payload = JSON.stringify({ kind: "call-action", action, userId: callUserId });
      void mainApp.SetPendingNotificationTarget(payload);
    }
    void focusMainWindowFromToast();
    Quit();
  };

  return (
    <div
      className="desktop-toast-window"
      role="button"
      tabIndex={0}
      title="Open chat"
      onClick={openTargetAndQuit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTargetAndQuit();
        }
      }}
    >
      <button
        className="desktop-toast-close"
        type="button"
        title="Hide"
        aria-label="Hide notification"
        onClick={(event) => {
          event.stopPropagation();
          Quit();
        }}
      >
        ×
      </button>
      <div className="desktop-toast-title">{title || "New notification"}</div>
      <div className="desktop-toast-body">{body || "Sanga notification keldi"}</div>
      {isIncomingCall && (
        <div className="desktop-toast-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="desktop-toast-action accept"
            type="button"
            onClick={() => sendCallActionAndQuit("accept")}
          >
            Accept
          </button>
          <button
            className="desktop-toast-action decline"
            type="button"
            onClick={() => sendCallActionAndQuit("decline")}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

async function resolveToastMode(): Promise<ToastBootstrapData> {
  try {
    if (typeof window === "undefined") {
      return { isToast: false, title: "", body: "", target: "" };
    }
    const hasWails = Boolean((window as any).go?.main?.App);
    if (!hasWails) {
      return { isToast: false, title: "", body: "", target: "" };
    }
    const data = await WailsApp.GetToastData();
    return {
      isToast: Boolean(data?.isToast),
      title: String(data?.title ?? ""),
      body: String(data?.body ?? ""),
      target: String(data?.target ?? ""),
    };
  } catch {
    return { isToast: false, title: "", body: "", target: "" };
  }
}

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  const toast = await resolveToastMode();
  if (toast.isToast) {
    document.body.classList.add("toast-mode");
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <ToastWindow title={toast.title} body={toast.body} target={toast.target} />
        </ErrorBoundary>
      </React.StrictMode>
    );
    return;
  }

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster position="bottom-right" />
    </React.StrictMode>
  );
}

void bootstrap();
