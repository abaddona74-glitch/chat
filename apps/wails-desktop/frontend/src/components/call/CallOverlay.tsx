import React, { MutableRefObject, RefObject } from "react";
import { CallStatus, Group, PublicUser } from "../../types";
import {
  formatCallDuration,
  getInitialLetter,
  normalizeFileUrl,
} from "../../utils/formatters";

export interface CallStatsInfo {
  upKbps: number;
  downKbps: number;
  rttMs: number | null;
  lossPct: number | null;
  durationSec: number;
  jitterMs: number | null;
  codec: string | null;
  iceState: string;
  connState: string;
  bytesSentTotal: number;
  bytesRecvTotal: number;
  isReconnecting: boolean;
}

export interface CallEventLog {
  t: number;
  msg: string;
  level: "info" | "warn" | "ok" | "err";
}

interface CallOverlayProps {
  callStatus: CallStatus;
  callMinimized: boolean;
  setCallMinimized: (v: boolean) => void;
  isMobileViewport: boolean;
  sidebarWidth: number;
  callStats: CallStatsInfo;
  isSocketConnected: boolean;
  networkOnline: boolean;
  callGroupId: string | null;
  groupCallParticipants: { userId: string; speaking: boolean }[];
  callMicMuted: boolean;
  toggleCallMicMute: () => void;
  stopCall: (keepRemoteState?: boolean) => void;
  callEvents: CallEventLog[];
  currentUser: PublicUser | null;
  users: PublicUser[];
  micVolume: number;
  setMicVolume: (v: number) => void;
  participantVolumes: Record<string, number>;
  setParticipantVolumes: React.Dispatch<
    React.SetStateAction<Record<string, number>>
  >;
  participantLatencyMs: Record<string, number>;
  brokenAvatarIds: Record<string, true>;
  setBrokenAvatarIds: React.Dispatch<
    React.SetStateAction<Record<string, true>>
  >;
  micGainNodeRef: MutableRefObject<GainNode | null>;
  groupAudioNodesRef: MutableRefObject<
    Map<
      string,
      {
        source: MediaStreamAudioSourceNode;
        gain: GainNode;
        stream: MediaStream;
        track: MediaStreamTrack;
      }
    >
  >;
  groupAudioContextRef: MutableRefObject<AudioContext | null>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
  localVideoRef: RefObject<HTMLVideoElement>;
  localScreenStreamRef: MutableRefObject<MediaStream | null>;
  isScreenSharing: boolean;
  isRemoteScreenSharing: boolean;
  toggleScreenShare: () => void;
  screenFullscreen: boolean;
  setScreenFullscreen: (v: boolean) => void;
  localScreenFullscreen: boolean;
  setLocalScreenFullscreen: (v: boolean) => void;
}

export function CallOverlay({
  callStatus,
  callMinimized,
  setCallMinimized,
  isMobileViewport,
  sidebarWidth,
  callStats,
  isSocketConnected,
  networkOnline,
  callGroupId,
  groupCallParticipants,
  callMicMuted,
  toggleCallMicMute,
  stopCall,
  callEvents,
  currentUser,
  users,
  micVolume,
  setMicVolume,
  participantVolumes,
  setParticipantVolumes,
  participantLatencyMs,
  brokenAvatarIds,
  setBrokenAvatarIds,
  micGainNodeRef,
  groupAudioNodesRef,
  groupAudioContextRef,
  remoteVideoRef,
  localVideoRef,
  localScreenStreamRef,
  isScreenSharing,
  isRemoteScreenSharing,
  toggleScreenShare,
  screenFullscreen,
  setScreenFullscreen,
  localScreenFullscreen,
  setLocalScreenFullscreen,
}: CallOverlayProps) {
  if (callStatus !== "in-call") {
    return null;
  }

  const isCallFailed =
    callStats.iceState === "failed" || callStats.connState === "failed";
  const isCallDegraded =
    !isCallFailed &&
    (callStats.isReconnecting ||
      callStats.iceState === "disconnected" ||
      callStats.connState === "disconnected" ||
      !isSocketConnected ||
      !networkOnline);
  const statusColor = isCallFailed
    ? "#f44336"
    : isCallDegraded
      ? "#ff9800"
      : "#4caf50";

  return (
    <>
      {/* Minimized call strip - centered, not blocking edges */}
      {callMinimized && (
        <div
          style={{
            position: "fixed",
            top: 84,
            left: isMobileViewport
              ? "50%"
              : `calc(${sidebarWidth}px + 4px + (100vw - ${sidebarWidth}px - 4px) / 2)`,
            transform: "translateX(-50%)",
            background: "var(--bg)",
            padding: "5px 18px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            zIndex: 9990,
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
            whiteSpace: "nowrap",
            maxWidth: "calc(100vw - 24px)",
          }}
        >
          <span style={{ fontSize: 14 }}>📞</span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              animation: "pulse 1.5s infinite",
            }}
          />
          <span
            style={{
              fontSize: 12,
              color: "var(--text)",
              fontFamily: "monospace",
              fontWeight: 600,
            }}
          >
            {formatCallDuration(callStats.durationSec)}
          </span>
          {isCallFailed ? (
            <span
              style={{
                fontSize: 11,
                color: "#f44336",
                fontWeight: 600,
              }}
            >
              Aloqa uzildi
            </span>
          ) : isCallDegraded ? (
            <span
              style={{
                fontSize: 11,
                color: "#ff9800",
                fontWeight: 600,
              }}
            >
              Qayta ulanmoqda...
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "monospace",
              }}
            >
              ⬆{callStats.upKbps.toFixed(0)}/⬇{callStats.downKbps.toFixed(0)}{" "}
              kbps{callStats.rttMs != null ? ` · ${callStats.rttMs}ms` : ""}
            </span>
          )}
          {callGroupId && groupCallParticipants.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {groupCallParticipants.length} kishi
              {groupCallParticipants.some((p) => p.speaking) && " • 🎤"}
            </span>
          )}
          <button
            style={{
              padding: "3px 10px",
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
            onClick={() => setCallMinimized(false)}
          >
            Open
          </button>
          <button
            style={{
              padding: "3px 10px",
              background: callMicMuted
                ? "var(--danger)"
                : "var(--panel-hover)",
              color: callMicMuted ? "#fff" : "var(--text)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
            onClick={toggleCallMicMute}
            title={callMicMuted ? "Unmute mic" : "Mute mic"}
          >
            {callMicMuted ? "Unmute" : "Mute"}
          </button>
          <button
            style={{
              padding: "3px 10px",
              background: "var(--danger)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
            onClick={(e) => {
              e.stopPropagation();
              stopCall(false);
            }}
          >
            End
          </button>
        </div>
      )}

      {/* Full call overlay - always mounted for video refs */}
      <div
        className="in-call-overlay"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 340,
          background: "var(--bg-card)",
          borderRadius: 12,
          padding: 16,
          border: "1px solid var(--line)",
          zIndex: 9999,
          display: callMinimized ? "none" : "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <strong style={{ color: "var(--text)" }}>Call in progress</strong>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--primary)", fontSize: 13 }}>
              {formatCallDuration(callStats.durationSec)}
            </span>
            <button
              onClick={() => setCallMinimized(true)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 2px",
              }}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── CALL STATS BAR ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            padding: "6px 8px",
            background: "rgba(0,0,0,0.15)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "monospace",
          }}
        >
          <span>⬆ {callStats.upKbps.toFixed(1)} kbps</span>
          <span>⬇ {callStats.downKbps.toFixed(1)} kbps</span>
          <span>
            RTT: {callStats.rttMs != null ? `${callStats.rttMs} ms` : "--"}
          </span>
          <span>
            Loss:{" "}
            {callStats.lossPct != null
              ? `${callStats.lossPct.toFixed(2)}%`
              : "--"}
          </span>
          <span>
            Jitter:{" "}
            {callStats.jitterMs != null ? `${callStats.jitterMs} ms` : "--"}
          </span>
          <span>Codec: {callStats.codec ?? "--"}</span>
          <span
            style={{
              color:
                callStats.iceState === "connected" ||
                callStats.iceState === "completed"
                  ? "#4caf50"
                  : callStats.iceState === "failed"
                    ? "#f44336"
                    : "#ff9800",
            }}
          >
            ICE: {callStats.iceState}
          </span>
          <span
            style={{
              color:
                callStats.connState === "connected"
                  ? "#4caf50"
                  : callStats.connState === "failed"
                    ? "#f44336"
                    : "#ff9800",
            }}
          >
            Conn: {callStats.connState}
          </span>
        </div>
        {callStats.bytesSentTotal === 0 && callStats.durationSec > 5 && (
          <div
            style={{
              padding: "6px 8px",
              background: "rgba(244,67,54,0.15)",
              border: "1px solid rgba(244,67,54,0.4)",
              borderRadius: 6,
              fontSize: 11,
              color: "#f44336",
            }}
          >
            ⚠ Hech qanday audio jonatilmayapti! Mikrofon yoki ICE muammosi.
          </div>
        )}
        {(callStats.iceState === "failed" ||
          callStats.connState === "failed") && (
          <div
            style={{
              padding: "6px 8px",
              background: "rgba(244,67,54,0.15)",
              border: "1px solid rgba(244,67,54,0.4)",
              borderRadius: 6,
              fontSize: 11,
              color: "#f44336",
            }}
          >
            ⚠ ICE/Conn FAILED — TURN server yoki tarmoq muammosi.
          </div>
        )}
        {!callGroupId &&
          callStats.isReconnecting &&
          callStats.iceState !== "failed" &&
          callStats.connState !== "failed" && (
            <div
              style={{
                padding: "6px 8px",
                background: "rgba(255,152,0,0.15)",
                border: "1px solid rgba(255,152,0,0.4)",
                borderRadius: 6,
                fontSize: 11,
                color: "#ff9800",
              }}
            >
              ⏳ Aloqa vaqtincha uzildi. Qayta ulanish kutilmoqda...
            </div>
          )}
        {callGroupId && (!isSocketConnected || !networkOnline) && (
          <div
            style={{
              padding: "6px 8px",
              background: "rgba(255,152,0,0.15)",
              border: "1px solid rgba(255,152,0,0.4)",
              borderRadius: 6,
              fontSize: 11,
              color: "#ff9800",
            }}
          >
            ⏳ Internet yoki server bilan aloqa uzildi...
          </div>
        )}

        {/* ── LIVE EVENT LOG ── */}
        {callEvents.length > 0 && (
          <details
            style={{
              background: "rgba(0,0,0,0.35)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 6px",
            }}
          >
            <summary
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              📜 Event log ({callEvents.length})
            </summary>
            <div
              style={{
                marginTop: 6,
                maxHeight: 140,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                fontFamily: "monospace",
                fontSize: 10,
              }}
            >
              {callEvents
                .slice()
                .reverse()
                .map((ev, i) => {
                  const color =
                    ev.level === "ok"
                      ? "#4caf50"
                      : ev.level === "warn"
                        ? "#ff9800"
                        : ev.level === "err"
                          ? "#f44336"
                          : "var(--text-muted)";
                  const time = new Date(ev.t).toLocaleTimeString("en-GB", {
                    hour12: false,
                  });
                  return (
                    <div
                      key={`${ev.t}-${i}`}
                      style={{ color, lineHeight: 1.3 }}
                    >
                      <span style={{ opacity: 0.6 }}>{time.slice(3)}</span>{" "}
                      {ev.msg}
                    </div>
                  );
                })}
            </div>
          </details>
        )}

        {/* ── GROUP CALL PARTICIPANTS LIST ── */}
        {callGroupId && groupCallParticipants.length > 0 && (
          <div
            style={{
              maxHeight: 200,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              Ishtirokchilar ({groupCallParticipants.length})
            </div>
            {groupCallParticipants.map((p) => {
              const isMe = p.userId === currentUser?.id;
              const u = isMe
                ? currentUser
                : users.find((x) => x.id === p.userId);
              const vol = isMe
                ? Math.round(micVolume * 100)
                : (participantVolumes[p.userId] ?? 100);
              const latencyMs = participantLatencyMs[p.userId];
              const latencyLabel = isMe
                ? "local"
                : typeof latencyMs === "number"
                  ? `${latencyMs}ms`
                  : "--";

              return (
                <div
                  key={p.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 6px",
                    borderRadius: 8,
                    background: p.speaking
                      ? "rgba(76,175,80,0.12)"
                      : "transparent",
                    border: p.speaking
                      ? "1px solid rgba(76,175,80,0.3)"
                      : "1px solid transparent",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {(() => {
                      const avatarSrc = normalizeFileUrl(u?.avatarUrl);
                      const isBroken =
                        !avatarSrc ||
                        Boolean(u?.id && brokenAvatarIds[u.id]);
                      if (avatarSrc && !isBroken) {
                        return (
                          <img
                            src={avatarSrc}
                            alt=""
                            onError={() => {
                              if (u?.id) {
                                setBrokenAvatarIds((prev) => ({
                                  ...prev,
                                  [u.id]: true,
                                }));
                              }
                            }}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              objectFit: "cover",
                              border: p.speaking
                                ? "2px solid #4caf50"
                                : "2px solid transparent",
                              transition: "border 0.2s",
                            }}
                          />
                        );
                      }
                      return (
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "var(--primary)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            border: p.speaking
                              ? "2px solid #4caf50"
                              : "2px solid transparent",
                            transition: "border 0.2s",
                          }}
                        >
                          {getInitialLetter(u?.displayName)}
                        </div>
                      );
                    })()}
                    {p.speaking && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: -2,
                          right: -2,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: "#4caf50",
                          border: "2px solid var(--bg-card)",
                          animation: "pulse 1s infinite",
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      minWidth: 0,
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {u?.displayName ?? "Unknown"}
                        {isMe ? " (me)" : ""}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          fontFamily: "monospace",
                          flexShrink: 0,
                        }}
                      >
                        {latencyLabel}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          userSelect: "none",
                          lineHeight: 1,
                          flexShrink: 0,
                        }}
                        title={
                          isMe
                            ? "Mikrofoningiz balandligi"
                            : "Ishtirokchi ovozi balandligi"
                        }
                      >
                        {isMe ? "🎤" : "🔊"}
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        step="1"
                        value={vol}
                        onDoubleClick={() => {
                          if (isMe) {
                            setMicVolume(1.0);
                            if (micGainNodeRef.current) {
                              micGainNodeRef.current.gain.value = 1.0;
                            }
                            localStorage.setItem("mic_volume", "1.0");
                          } else {
                            setParticipantVolumes((prev) => {
                              const next = { ...prev, [p.userId]: 100 };
                              localStorage.setItem(
                                "participant_volumes",
                                JSON.stringify(next),
                              );
                              return next;
                            });
                            const node = groupAudioNodesRef.current.get(
                              p.userId,
                            );
                            if (node) {
                              node.gain.gain.value = 1.0;
                            }
                          }
                        }}
                        onChange={(e) => {
                          const nextVolume = Number(e.target.value);
                          if (isMe) {
                            const nextGain = nextVolume / 100;
                            setMicVolume(nextGain);
                            if (micGainNodeRef.current) {
                              micGainNodeRef.current.gain.value = nextGain;
                            }
                            localStorage.setItem(
                              "mic_volume",
                              String(nextGain),
                            );
                          } else {
                            setParticipantVolumes((prev) => {
                              const next = {
                                ...prev,
                                [p.userId]: nextVolume,
                              };
                              localStorage.setItem(
                                "participant_volumes",
                                JSON.stringify(next),
                              );
                              return next;
                            });
                            const node = groupAudioNodesRef.current.get(
                              p.userId,
                            );
                            if (node) {
                              node.gain.gain.value = Math.max(
                                0,
                                nextVolume / 100,
                              );
                            }
                            if (
                              groupAudioContextRef.current &&
                              groupAudioContextRef.current.state ===
                                "suspended"
                            ) {
                              groupAudioContextRef.current
                                .resume()
                                .catch(() => {});
                            }
                          }
                        }}
                        style={{
                          flex: 1,
                          minWidth: 90,
                          height: 14,
                          accentColor: "var(--primary)",
                          cursor: "pointer",
                        }}
                      />
                      <span
                        onClick={() => {
                          if (isMe) {
                            setMicVolume(1.0);
                            if (micGainNodeRef.current) {
                              micGainNodeRef.current.gain.value = 1.0;
                            }
                            localStorage.setItem("mic_volume", "1.0");
                          } else {
                            setParticipantVolumes((prev) => {
                              const next = { ...prev, [p.userId]: 100 };
                              localStorage.setItem(
                                "participant_volumes",
                                JSON.stringify(next),
                              );
                              return next;
                            });
                            const node = groupAudioNodesRef.current.get(
                              p.userId,
                            );
                            if (node) {
                              node.gain.gain.value = 1.0;
                            }
                          }
                        }}
                        title="Bosilsa 100% ga qaytaradi"
                        style={{
                          fontSize: 10,
                          color:
                            vol === 100
                              ? "var(--text-muted)"
                              : "var(--primary)",
                          fontWeight: vol === 100 ? 500 : 700,
                          fontFamily: "monospace",
                          minWidth: 36,
                          textAlign: "right",
                          cursor: "pointer",
                          userSelect: "none",
                          flexShrink: 0,
                        }}
                      >
                        {vol}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            position: "relative",
            width: "100%",
            borderRadius: 8,
            overflow: "hidden",
            background: "#000",
            minHeight: 180,
            cursor:
              (remoteVideoRef.current?.srcObject as MediaStream | null)
                ?.getVideoTracks()
                .some((track) => track.readyState === "live") ||
              isRemoteScreenSharing
                ? "pointer"
                : "default",
          }}
          onClick={() => {
            const remoteStream = remoteVideoRef.current
              ?.srcObject as MediaStream | null;
            const hasRemoteVideo = !!remoteStream
              ?.getVideoTracks()
              .some((track) => track.readyState === "live");
            if (isRemoteScreenSharing || hasRemoteVideo) {
              setScreenFullscreen(true);
            }
          }}
          title={isRemoteScreenSharing ? "Katta qilish" : ""}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            onClick={(e) => {
              if (isScreenSharing) {
                e.stopPropagation();
                setLocalScreenFullscreen(true);
              }
            }}
            style={{
              width: 100,
              position: "absolute",
              bottom: 10,
              right: 10,
              borderRadius: 6,
              border: "2px solid var(--primary)",
              background: "#000",
              objectFit: "cover",
              display: isScreenSharing ? "block" : "none",
              cursor: isScreenSharing ? "pointer" : "default",
            }}
          />
          {isScreenSharing && (
            <div
              style={{
                position: "absolute",
                bottom: 6,
                right: 6,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
                pointerEvents: "none",
              }}
            >
              ⛶ Katta qilish
            </div>
          )}
          {isRemoteScreenSharing && (
            <div
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              ⛶ Katta qilish
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{
              flex: 1,
              padding: "10px 0",
              background: callMicMuted
                ? "var(--danger)"
                : "var(--panel-hover)",
              color: callMicMuted ? "#fff" : "var(--text)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
            }}
            onClick={toggleCallMicMute}
          >
            {callMicMuted ? "Unmute" : "Mute"}
          </button>
          <button
            style={{
              flex: 1,
              padding: "10px 0",
              background: isScreenSharing
                ? "var(--danger)"
                : "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
            }}
            onClick={toggleScreenShare}
          >
            {isScreenSharing ? "Stop sharing" : "Share screen"}
          </button>
          <button
            style={{
              flex: 1,
              padding: "10px 0",
              background: "var(--danger)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
            }}
            onClick={() => stopCall(false)}
          >
            End call
          </button>
        </div>
      </div>

      {/* Dark notification bar when local user is sharing screen */}
      {isScreenSharing && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100000,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.85)",
              color: "#fff",
              padding: "8px 20px",
              borderRadius: "0 0 12px 12px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              pointerEvents: "auto",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ fontSize: 14 }}>🖥️</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Ekran ulashilmoqda
            </span>
            <button
              onClick={toggleScreenShare}
              style={{
                padding: "4px 14px",
                background: "var(--danger)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              To'xtatish
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen local screenshare overlay */}
      {localScreenFullscreen && isScreenSharing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "#000",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <video
            autoPlay
            playsInline
            muted
            ref={(el) => {
              if (el && localScreenStreamRef.current) {
                el.srcObject = localScreenStreamRef.current;
              }
            }}
            style={{
              flex: 1,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#000",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              display: "flex",
              gap: 8,
            }}
          >
            <button
              onClick={() => setLocalScreenFullscreen(false)}
              style={{
                padding: "8px 16px",
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                backdropFilter: "blur(8px)",
              }}
            >
              ✕ Yopish
            </button>
            <button
              onClick={toggleScreenShare}
              style={{
                padding: "8px 16px",
                background: "var(--danger)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              To'xtatish
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen screenshare overlay */}
      {screenFullscreen &&
        ((remoteVideoRef.current?.srcObject as MediaStream | null)
          ?.getVideoTracks()
          .some((track) => track.readyState === "live") ||
          isRemoteScreenSharing) && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              background: "#000",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <video
              autoPlay
              playsInline
              ref={(el) => {
                if (el && remoteVideoRef.current) {
                  el.srcObject = remoteVideoRef.current.srcObject;
                }
              }}
              style={{
                flex: 1,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                background: "#000",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={() => setScreenFullscreen(false)}
                style={{
                  padding: "8px 16px",
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                  backdropFilter: "blur(8px)",
                }}
              >
                ✕ Yopish
              </button>
              <button
                onClick={() => stopCall(false)}
                style={{
                  padding: "8px 16px",
                  background: "var(--danger)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                End call
              </button>
            </div>
          </div>
        )}
    </>
  );
}
