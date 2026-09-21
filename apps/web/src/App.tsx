import { FormEvent, MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { api, API_URL, persistToken, readPersistedToken } from "./lib/api";
import { startRingtone, startDialTone, stopAllCallSounds, playEndCallSound, playMessageSentSound } from "./lib/callSounds";
import { createSocket } from "./lib/socket";
import { Group, GroupMessage, Message, MessageType, PublicUser } from "./types";

type AuthStep = "login" | "register" | "verify" | "forgot" | "reset" | "login2fa";
type CallStatus = "idle" | "calling" | "ringing" | "in-call";
type MobileTab = "contacts" | "chat" | "settings";
type ChatMode = "user" | "group";
type SidebarTab = "contacts" | "groups";
const MAX_LOCATION_ACCURACY_M = 500;

type UploadResponse = {
  url: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
};

/** Convert old absolute file URLs to relative paths */
function normalizeFileUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  // If already relative, return as-is
  if (url.startsWith("/")) return url;
  // Strip any old domain prefix to get /uploads/... path
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

type PresencePayload = {
  userId: string;
  isOnline: boolean;
  lastSeenAt?: string;
};

type IncomingCallPayload = {
  fromUserId: string;
  sdp: RTCSessionDescriptionInit;
};

function App() {
  const [token, setToken] = useState<string | null>(() => readPersistedToken());
  const [authStep, setAuthStep] = useState<AuthStep>("login");
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // ── GROUP STATE ──
  const [chatMode, setChatMode] = useState<ChatMode>("user");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("contacts");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [isLoadingGroupMessages, setIsLoadingGroupMessages] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [groupTypingUserId, setGroupTypingUserId] = useState<string | null>(null);

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

  const [messageType, setMessageType] = useState<MessageType>("TEXT");
  const [messageText, setMessageText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [locationLat, setLocationLat] = useState("");
  const [locationLng, setLocationLng] = useState("");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [typingFromUserId, setTypingFromUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(300);
  const resizingRef = useRef<"left" | "right" | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const [twoFAQrDataUrl, setTwoFAQrDataUrl] = useState("");
  const [twoFASetupCode, setTwoFASetupCode] = useState("");
  const [twoFADisableCode, setTwoFADisableCode] = useState("");

  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number | null>(null);

  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callPeerId, setCallPeerId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [screenFullscreen, setScreenFullscreen] = useState(false);
  const [callMinimized, setCallMinimized] = useState(false);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [showForwardModal, setShowForwardModal] = useState(false);

  // ── AUDIO DEVICE SELECTION ──
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>("");
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>("");
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);

  // ── SETTINGS / DARK MODE ──
  const [nightMode, setNightMode] = useState(() => localStorage.getItem("night_mode") === "true");
  const [smoothCaret, setSmoothCaret] = useState(() => localStorage.getItem("smooth_caret") === "true");
  const [cursorBlink, setCursorBlink] = useState(() => localStorage.getItem("cursor_blink") !== "false");
  const [sendSound, setSendSound] = useState(() => localStorage.getItem("send_sound") !== "false");

  // ── CHAT ORDER & PIN/ARCHIVE ──
  const [chatOrder, setChatOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("chat_order") ?? "[]"); } catch { return []; }
  });
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pinned_chats") ?? "[]")); } catch { return new Set(); }
  });
  const [archivedChats, setArchivedChats] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("archived_chats") ?? "[]")); } catch { return new Set(); }
  });
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{x:number;y:number;chatId:string}|null>(null);
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [showMyProfile, setShowMyProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Mobile navigation
  const [mobileTab, setMobileTab] = useState<MobileTab>("contacts");

  const socketRef = useRef<Socket | null>(null);
  const selectedUserIdRef = useRef("");
  const currentUserIdRef = useRef("");
  const selectedGroupIdRef = useRef("");
  const usersRef = useRef<PublicUser[]>([]);
  const typingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callStatusRef = useRef<CallStatus>("idle");
  const callPeerIdRef = useRef<string | null>(null);
  const callGroupIdRef = useRef<string | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteIceCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  // ── GROUP CALL PARTICIPANTS ──
  const [groupCallParticipants, setGroupCallParticipants] = useState<{ userId: string; speaking: boolean }[]>([]);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("participant_volumes") ?? "{}"); } catch { return {}; }
  });
  const vadIntervalRef = useRef<number | null>(null);
  const wasSpeakingRef = useRef(false);

  selectedUserIdRef.current = selectedUserId;
  currentUserIdRef.current = currentUser?.id ?? "";
  selectedGroupIdRef.current = selectedGroupId;
  usersRef.current = users;
  callStatusRef.current = callStatus;
  callPeerIdRef.current = callPeerId;

  // ── Enumerate audio devices ──
  const enumerateAudioDevices = useCallback(async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);

      if (!selectedAudioInput && inputs.length > 0) {
        setSelectedAudioInput(inputs[0].deviceId);
      }
      if (!selectedAudioOutput && outputs.length > 0) {
        setSelectedAudioOutput(outputs[0].deviceId);
      }
    } catch (err) {
      console.error("Cannot enumerate audio devices:", err);
    }
  }, [selectedAudioInput, selectedAudioOutput]);

  useEffect(() => {
    navigator.mediaDevices.addEventListener("devicechange", enumerateAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateAudioDevices);
    };
  }, [enumerateAudioDevices]);

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (audio && selectedAudioOutput && typeof (audio as any).setSinkId === "function") {
      (audio as any).setSinkId(selectedAudioOutput).catch((err: Error) => {
        console.error("Cannot set audio output device:", err);
      });
    }
  }, [selectedAudioOutput]);

  // Play call sounds based on status
  useEffect(() => {
    if (callStatus === "ringing") {
      startRingtone();
    } else if (callStatus === "calling") {
      startDialTone();
    } else {
      stopAllCallSounds();
    }
    return () => { stopAllCallSounds(); };
  }, [callStatus]);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", nightMode);
    localStorage.setItem("night_mode", String(nightMode));
  }, [nightMode]);

  const activeUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const applySession = useCallback((nextToken: string, user: PublicUser) => {
    persistToken(nextToken);
    setToken(nextToken);
    setCurrentUser(user);
    setAuthStep("login");
    setTempTwoFAToken("");
    setTwoFALoginCode("");
  }, []);

  const clearSession = useCallback(() => {
    persistToken(null);
    setToken(null);
    setCurrentUser(null);
    setUsers([]);
    setSelectedUserId("");
    setMessages([]);
    setTwoFAQrDataUrl("");
    setTwoFASetupCode("");
    setTwoFADisableCode("");
    disconnectSocket(socketRef);
  }, []);

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const msg =
        customEvent.detail?.message ||
        "Sessiya eskirgan yoki bekor qilingan. Iltimos, qaytadan kiring.";
      toast.error(msg);
      clearSession();
    };

    window.addEventListener("chat:auth:expired", handleAuthExpired);
    return () => {
      window.removeEventListener("chat:auth:expired", handleAuthExpired);
    };
  }, [clearSession]);

  // ── GOOGLE SIGN-IN ──
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const handleGoogleResponse = useCallback(async (resp: { credential: string }) => {
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>("/auth/google", {
        credential: resp.credential
      });
      applySession(response.data.token, response.data.user);
      toast.success("Google orqali kirdingiz!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Google login xatosi."));
    } finally {
      setIsSubmittingAuth(false);
    }
  }, [applySession]);

  useEffect(() => {
    if (token || currentUser) return;
    if (authStep !== "login" && authStep !== "register") return;
    const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) return;

    const tryRender = () => {
      const g = (window as unknown as { google?: { accounts: { id: { initialize: (config: object) => void; renderButton: (el: HTMLElement, config: object) => void } } } }).google;
      if (!g?.accounts?.id || !googleBtnRef.current) return false;
      googleBtnRef.current.innerHTML = "";
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
      });
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        width: 352,
        text: "signin_with",
      });
      return true;
    };

    if (tryRender()) return;
    const interval = setInterval(() => {
      if (tryRender()) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
  }, [token, currentUser, authStep, handleGoogleResponse]);

  const fetchUsers = useCallback(async () => {
    const response = await api.get<{ users: PublicUser[] }>("/users");
    const fetchedUsers = response.data.users;
    setUsers(fetchedUsers);
  }, []);

  const fetchMessages = useCallback(async (otherUserId: string) => {
    if (!otherUserId) {
      setMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    try {
      const response = await api.get<{ messages: Message[] }>(`/messages/${otherUserId}?limit=50`);
      setMessages(response.data.messages);
      // Mark messages from the other user as read
      api.post(`/messages/read/${otherUserId}`).catch(() => {});
      if (socketRef.current) {
        socketRef.current.emit("message:read", { senderId: otherUserId });
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await api.get<{ groups: Group[] }>("/groups");
      setGroups(response.data.groups ?? []);
    } catch {
      // silent
    }
  }, []);

  const fetchGroupMessages = useCallback(async (groupId: string) => {
    if (!groupId) {
      setGroupMessages([]);
      return;
    }
    setIsLoadingGroupMessages(true);
    try {
      const response = await api.get<{ messages: GroupMessage[] }>(`/groups/${groupId}/messages?limit=50`);
      setGroupMessages(response.data.messages ?? []);
    } finally {
      setIsLoadingGroupMessages(false);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    const response = await api.get<{ user: PublicUser }>("/auth/me");
    setCurrentUser(response.data.user);
  }, []);

  const withSocketAck = useCallback(
    <T,>(event: string, payload: unknown) => {
      const socket = socketRef.current;
      if (!socket) {
        return Promise.reject(new Error("Socket ulanmagan."));
      }
      return new Promise<T>((resolve, reject) => {
        socket.emit(event, payload, (ack: { ok: boolean; message?: T; error?: string }) => {
          if (!ack?.ok) {
            reject(new Error(ack?.error ?? "Socket xatosi."));
            return;
          }
          resolve(ack.message as T);
        });
      });
    },
    []
  );

  const notifyIncoming = useCallback(async (title: string, body: string) => {
    toast(title);
    if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png" });
    }
  }, []);

  const stopCall = useCallback((keepRemoteState = false) => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop());
    localCallStreamRef.current = null;
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    setScreenFullscreen(false);
    setCallMinimized(false);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (!keepRemoteState && socketRef.current && callPeerIdRef.current) {
      socketRef.current.emit("call:end", { recipientId: callPeerIdRef.current });
    }
    callGroupIdRef.current = null;
    pendingIceCandidatesRef.current = [];
    remoteIceCandidatesBufferRef.current = [];
    remoteDescriptionSetRef.current = false;
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    wasSpeakingRef.current = false;
    setGroupCallParticipants([]);
    playEndCallSound();
    setCallStatus("idle");
    setCallPeerId(null);
    setIncomingCall(null);
  }, []);

  /** Start Voice Activity Detection — emits group:call:speaking events */
  const startVAD = useCallback((stream: MediaStream, groupId: string) => {
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
    try {
      const actx = new AudioContext();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      vadIntervalRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const isSpeaking = avg > 12;
        if (isSpeaking !== wasSpeakingRef.current) {
          wasSpeakingRef.current = isSpeaking;
          socketRef.current?.emit("group:call:speaking", { groupId, speaking: isSpeaking });
        }
      }, 150);
    } catch (e) {
      console.warn("[VAD] failed:", e);
    }
  }, []);

  const attachCallHandlers = useCallback(
    (socket: Socket) => {
      socket.on("call:offer", async (payload: IncomingCallPayload) => {
        if (!payload?.fromUserId || !payload?.sdp) return;
        if (callStatusRef.current !== "idle") {
          socket.emit("call:end", { recipientId: payload.fromUserId });
          return;
        }
        setIncomingCall(payload);
        setCallPeerId(payload.fromUserId);
        setCallStatus("ringing");
        await notifyIncoming("Kiruvchi qo'ng'iroq", `${payload.fromUserId} sizga qo'ng'iroq qilmoqda.`);
      });

      socket.on("call:answer", async (payload: { fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (!peerConnectionRef.current || !payload?.sdp) return;
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        remoteDescriptionSetRef.current = true;
        // Flush any ICE candidates that arrived before remote description was set
        const buffered = remoteIceCandidatesBufferRef.current;
        remoteIceCandidatesBufferRef.current = [];
        for (const c of buffered) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        setCallStatus("in-call");
        if (payload.fromUserId) {
          callPeerIdRef.current = payload.fromUserId;
          setCallPeerId(payload.fromUserId);
          const queued = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];
          for (const c of queued) {
            socketRef.current?.emit("call:ice-candidate", { recipientId: payload.fromUserId, candidate: c });
          }
        }
      });

      socket.on("call:ice-candidate", async (payload: { fromUserId: string; candidate: RTCIceCandidateInit }) => {
        if (!peerConnectionRef.current || !payload?.candidate) return;
        if (!remoteDescriptionSetRef.current) {
          // Buffer candidates that arrive before remote description is set
          remoteIceCandidatesBufferRef.current.push(payload.candidate);
          return;
        }
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch((err) => {
          console.warn("[WebRTC] addIceCandidate failed:", err);
        });
      });

      socket.on("call:renegotiate", async (payload: { fromUserId: string; type: string; sdp: RTCSessionDescriptionInit }) => {
        if (!peerConnectionRef.current || !payload?.sdp) return;
        if (payload.type === "offer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          socket.emit("call:renegotiate", { recipientId: payload.fromUserId, type: "answer", sdp: answer });
          // Check if remote started/stopped screen sharing
          const hasVideo = peerConnectionRef.current.getReceivers().some(r => r.track && r.track.kind === "video" && r.track.readyState === "live" && !r.track.muted);
          if (hasVideo) {
            setIsRemoteScreenSharing(true);
          } else {
            setIsRemoteScreenSharing(false);
            setScreenFullscreen(false);
          }
        } else if (payload.type === "answer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      });

      socket.on("call:end", () => {
        stopCall(true);
        playEndCallSound();
        toast("Qo'ng'iroq yakunlandi.");
      });
    },
    [notifyIncoming, stopCall]
  );

  const attachChatHandlers = useCallback(
    (socket: Socket) => {
      socket.on("presence:update", (payload: PresencePayload) => {
        const isKnown = usersRef.current.some((user) => user.id === payload.userId);
        if (!isKnown && payload.userId !== currentUser?.id) {
          fetchUsers().catch(() => undefined);
          return;
        }
        setUsers((prev) =>
          prev.map((user) =>
            user.id === payload.userId
              ? { ...user, isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt ?? user.lastSeenAt }
              : user
          )
        );
      });

      socket.on("status:changed", (payload: { userId: string; statusText: string | null; statusEmoji: string | null }) => {
        setUsers((prev) =>
          prev.map((user) =>
            user.id === payload.userId
              ? { ...user, statusText: payload.statusText, statusEmoji: payload.statusEmoji }
              : user
          )
        );
        setCurrentUser((prev) =>
          prev && prev.id === payload.userId
            ? { ...prev, statusText: payload.statusText, statusEmoji: payload.statusEmoji }
            : prev
        );
      });

      socket.on("user:profile-updated", (payload: { userId: string; displayName: string; username: string | null; avatarUrl: string | null }) => {
        const isKnown = usersRef.current.some((user) => user.id === payload.userId);
        if (!isKnown && payload.userId !== currentUser?.id) {
          fetchUsers().catch(() => undefined);
        }
        setUsers((prev) =>
          prev.map((user) =>
            user.id === payload.userId
              ? { ...user, displayName: payload.displayName, username: payload.username, avatarUrl: payload.avatarUrl }
              : user
          )
        );
        setCurrentUser((prev) =>
          prev && prev.id === payload.userId
            ? { ...prev, displayName: payload.displayName, username: payload.username, avatarUrl: payload.avatarUrl }
            : prev
        );
      });

      socket.on("typing:start", (payload: { fromUserId: string }) => {
        setTypingFromUserId(payload.fromUserId);
      });

      socket.on("typing:stop", (payload: { fromUserId: string }) => {
        setTypingFromUserId((prev) => (prev === payload.fromUserId ? null : prev));
      });

      socket.on("message:new", async (message: Message) => {
        const me = currentUserIdRef.current;
        const selected = selectedUserIdRef.current;
        const isActiveConversation =
          selected &&
          ((message.senderId === selected && message.recipientId === me) ||
            (message.senderId === me && message.recipientId === selected));

        if (isActiveConversation) {
          setMessages((prev) => {
            if (prev.some((item) => item.id === message.id)) return prev;
            return [...prev, message];
          });
          // If the incoming message is from the other user, mark it as read immediately
          if (message.senderId === selected && message.recipientId === me) {
            socket.emit("message:read", { senderId: selected });
          }
        }

        if (message.senderId !== me) {
          // Track unread count if not the active conversation
          if (!isActiveConversation) {
            setUnreadCounts(prev => ({ ...prev, [message.senderId]: (prev[message.senderId] || 0) + 1 }));
          }
          const senderName =
            usersRef.current.find((item) => item.id === message.senderId)?.displayName ?? "Yangi xabar";
          const body = buildMessagePreview(message);
          await notifyIncoming(senderName, body);
        }
      });

      socket.on("messages:deleted", (payload: { messageIds: string[] }) => {
        const deletedSet = new Set(payload.messageIds);
        setMessages((prev) => prev.filter((m) => !deletedSet.has(m.id)));
      });

      socket.on("message:read", (payload: { readByUserId: string; readAt: string; fromSenderId?: string }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.senderId === currentUserIdRef.current && m.recipientId === payload.readByUserId && !m.readAt) {
              return { ...m, readAt: payload.readAt };
            }
            if (payload.fromSenderId && m.senderId === payload.fromSenderId && m.recipientId === payload.readByUserId && !m.readAt) {
              return { ...m, readAt: payload.readAt };
            }
            return m;
          })
        );
      });
    },
    [notifyIncoming]
  );

  const attachGroupHandlers = useCallback(
    (socket: Socket) => {
      socket.on("group:created", (group: Group) => {
        setGroups((prev) => {
          if (prev.some((g) => g.id === group.id)) {
            return prev.map((g) => (g.id === group.id ? group : g));
          }
          return [group, ...prev];
        });
      });

      socket.on("group:updated", (group: Group) => {
        setGroups((prev) => {
          const exists = prev.some((g) => g.id === group.id);
          if (!exists) {
            return [group, ...prev];
          }
          return prev.map((g) => (g.id === group.id ? group : g));
        });
      });

      socket.on("group:removed", (payload: { groupId: string }) => {
        setGroups((prev) => prev.filter((g) => g.id !== payload.groupId));
        if (selectedGroupIdRef.current === payload.groupId) {
          setSelectedGroupId("");
          setGroupMessages([]);
        }
      });

      socket.on("group:message:new", async (message: GroupMessage) => {
        const me = currentUserIdRef.current;
        const selectedGrp = selectedGroupIdRef.current;

        if (message.groupId === selectedGrp) {
          setGroupMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        }

        if (message.senderId !== me) {
          if (message.groupId !== selectedGrp) {
            setUnreadCounts(prev => ({ ...prev, [message.groupId]: (prev[message.groupId] || 0) + 1 }));
          }
          const senderName = message.sender?.displayName ?? "Group message";
          const body = buildMessagePreview(message as unknown as Message);
          await notifyIncoming(senderName, body);
        }
      });

      socket.on("group:typing:start", (payload: { groupId: string; fromUserId: string }) => {
        if (payload.groupId === selectedGroupIdRef.current) {
          setGroupTypingUserId(payload.fromUserId);
        }
      });

      socket.on("group:typing:stop", (payload: { groupId: string; fromUserId: string }) => {
        setGroupTypingUserId((prev) => (prev === payload.fromUserId ? null : prev));
      });

      socket.on("group:call:offer", async (payload: { groupId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (callStatusRef.current !== "idle") return;
        callGroupIdRef.current = payload.groupId;
        setIncomingCall({ fromUserId: payload.fromUserId, sdp: payload.sdp });
        setCallPeerId(payload.fromUserId);
        setCallStatus("ringing");
        const callerUser = usersRef.current.find(u => u.id === payload.fromUserId);
        const callerName = callerUser?.displayName ?? "Group call";
        await notifyIncoming("Group Call", `${callerName} - Kiruvchi guruh qo'ng'iroq.`);
      });

      socket.on("group:call:answer", async (payload: { groupId: string; fromUserId: string; sdp: RTCSessionDescriptionInit }) => {
        if (!peerConnectionRef.current || !payload?.sdp) return;
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        remoteDescriptionSetRef.current = true;
        // Flush any ICE candidates that arrived before remote description was set
        const buffered = remoteIceCandidatesBufferRef.current;
        remoteIceCandidatesBufferRef.current = [];
        for (const c of buffered) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        setCallStatus("in-call");
        setCallMinimized(false);
        if (payload.fromUserId) {
          setCallPeerId(payload.fromUserId);
          const queued = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];
          for (const c of queued) {
            socketRef.current?.emit("group:call:ice-candidate", { groupId: payload.groupId, toUserId: payload.fromUserId, candidate: c });
          }
        }
      });

      socket.on("group:call:ice-candidate", async (payload: { groupId: string; fromUserId: string; candidate: RTCIceCandidateInit }) => {
        if (!peerConnectionRef.current || !payload?.candidate) return;
        if (!remoteDescriptionSetRef.current) {
          remoteIceCandidatesBufferRef.current.push(payload.candidate);
          return;
        }
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch((err) => {
          console.warn("[WebRTC] group addIceCandidate failed:", err);
        });
      });

      socket.on("group:call:end", () => {
        stopCall(true);
        playEndCallSound();
        toast("Guruh qo'ng'iroq yakunlandi.");
      });

      // ── GROUP CALL PARTICIPANT TRACKING ──
      socket.on("group:call:join", (payload: { groupId: string; userId: string }) => {
        setGroupCallParticipants(prev => {
          if (prev.some(p => p.userId === payload.userId)) return prev;
          return [...prev, { userId: payload.userId, speaking: false }];
        });
      });

      socket.on("group:call:leave", (payload: { groupId: string; userId: string }) => {
        setGroupCallParticipants(prev => prev.filter(p => p.userId !== payload.userId));
      });

      socket.on("group:call:speaking", (payload: { groupId: string; userId: string; speaking: boolean }) => {
        setGroupCallParticipants(prev => prev.map(p => p.userId === payload.userId ? { ...p, speaking: payload.speaking } : p));
      });
    },
    [notifyIncoming]
  );

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const run = async () => {
      try {
        await fetchMe();
        await fetchUsers();
        await fetchGroups();
        if (cancelled) return;
        const socket = createSocket(token);
        socketRef.current = socket;
        attachChatHandlers(socket);
        attachCallHandlers(socket);
        attachGroupHandlers(socket);
      } catch (error) {
        console.error(error);
        toast.error("Sessiya eskirgan. Qayta login qiling.");
        clearSession();
      }
    };

    run();

    return () => {
      cancelled = true;
      disconnectSocket(socketRef);
    };
  }, [attachCallHandlers, attachChatHandlers, attachGroupHandlers, clearSession, fetchMe, fetchGroups, fetchUsers, token]);

  useEffect(() => {
    if (!selectedUserId || !token) return;
    fetchMessages(selectedUserId).catch((error) => {
      console.error(error);
      toast.error("Xabarlarni yuklab bo'lmadi.");
    });
  }, [fetchMessages, selectedUserId, token]);

  useEffect(() => {
    if (!selectedGroupId || !token) return;
    fetchGroupMessages(selectedGroupId).catch(() => {});
  }, [fetchGroupMessages, selectedGroupId, token]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, groupMessages]);

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/register", {
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
        displayName: registerDisplayName.trim()
      });
      setVerifyEmail(registerEmail.trim().toLowerCase());
      setAuthStep("verify");
      toast.success("Tasdiqlash kodi emailingizga yuborildi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Ro'yxatdan o'tishda xatolik."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleVerifyEmail = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>("/auth/verify-email", {
        email: verifyEmail.trim().toLowerCase(),
        code: verifyCode.trim()
      });
      applySession(response.data.token, response.data.user);
      toast.success("Email tasdiqlandi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Tasdiqlash amalga oshmadi."));
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
        password: loginPassword
      });

      if ("requiresTwoFA" in response.data && response.data.requiresTwoFA) {
        setTempTwoFAToken(response.data.tempToken);
        setAuthStep("login2fa");
        toast("2FA kodni kiriting.");
        return;
      }

      applySession(response.data.token, response.data.user);
      toast.success("Xush kelibsiz!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Login xatosi."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handle2FALogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      const response = await api.post<{ token: string; user: PublicUser }>("/auth/login/2fa", {
        tempToken: tempTwoFAToken,
        code: twoFALoginCode.trim()
      });
      applySession(response.data.token, response.data.user);
      toast.success("2FA muvaffaqiyatli.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA login xatosi."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingAuth(true);
    try {
      await api.post("/auth/forgot-password", {
        email: forgotEmail.trim().toLowerCase()
      });
      setVerifyEmail(forgotEmail.trim().toLowerCase());
      setAuthStep("reset");
      toast.success("Parol tiklash kodi yuborildi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Forgot password xatosi."));
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
        newPassword: resetPassword
      });
      setAuthStep("login");
      toast.success("Parol yangilandi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Parolni yangilash xatosi."));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const startTwoFASetup = async () => {
    try {
      const response = await api.post<{ qrDataUrl: string }>("/auth/2fa/setup");
      setTwoFAQrDataUrl(response.data.qrDataUrl);
      setTwoFASetupCode("");
      toast("Authenticator ilovasida QR ni skaner qiling.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA setup xatosi."));
    }
  };

  const enableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/enable", { code: twoFASetupCode.trim() });
      setTwoFAQrDataUrl("");
      setTwoFASetupCode("");
      await fetchMe();
      toast.success("2FA yoqildi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA ni yoqishda xatolik."));
    }
  };

  const disableTwoFA = async () => {
    try {
      await api.post("/auth/2fa/disable", { code: twoFADisableCode.trim() });
      setTwoFADisableCode("");
      await fetchMe();
      toast.success("2FA o'chirildi.");
    } catch (error) {
      toast.error(readAxiosMessage(error, "2FA ni o'chirishda xatolik."));
    }
  };

  const sendTypingSignal = useCallback(
    (isTyping: boolean) => {
      if (!selectedUserId || !socketRef.current) return;
      socketRef.current.emit(isTyping ? "typing:start" : "typing:stop", { recipientId: selectedUserId });
    },
    [selectedUserId]
  );

  const handleTextChange = (value: string) => {
    setMessageText(value);
    sendTypingSignal(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => sendTypingSignal(false), 800);
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setVoiceBlob(blob);
        const duration = Math.max(1, Math.round((Date.now() - recordStartedAtRef.current) / 1000));
        setVoiceDurationSec(duration);
      };

      recordStartedAtRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      recorder.start();
      setIsRecordingVoice(true);
      toast("Yozuv boshlandi.");
    } catch {
      toast.error("Mikrofonni yoqib bo'lmadi.");
    }
  };

  const stopVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    setIsRecordingVoice(false);
    toast.success("Voice yozuv tayyor.");
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    setUploadProgress(0);
    const response = await api.post<UploadResponse>("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      }
    });
    setUploadProgress(0);
    return response.data;
  };

  const sendMessage = async () => {
    if (chatMode === "user" && !selectedUserId) {
      toast("Avval user tanlang.");
      return;
    }
    if (chatMode === "group" && !selectedGroupId) {
      toast("Avval guruh tanlang.");
      return;
    }
    if (isSending) return;

    setIsSending(true);
    try {
      if (chatMode === "group") {
        // ── GROUP MESSAGE ──
        let groupPayload: Record<string, unknown> = {
          groupId: selectedGroupId,
          type: messageType
        };

        if (messageType === "TEXT") {
          const text = messageText.trim();
          if (!text) { toast.error("Xabar bo'sh."); return; }
          groupPayload.text = text;
        } else if (messageType === "LOCATION") {
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) { toast.error("Lokatsiya qiymatlari noto'g'ri."); return; }
          if (locationAccuracy !== null && locationAccuracy > MAX_LOCATION_ACCURACY_M) {
            toast.error(`Lokatsiya aniqligi past (~${Math.round(locationAccuracy)}m). Qaytadan urining.`);
            return;
          }
          groupPayload.latitude = latitude;
          groupPayload.longitude = longitude;
        } else {
          let file = selectedFile;
          if (!file && messageType === "VOICE" && voiceBlob) {
            file = new File([voiceBlob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
          }
          if (!file) { toast.error("Fayl tanlanmagan."); return; }
          const uploaded = await uploadFile(file);
          groupPayload = {
            ...groupPayload,
            fileUrl: uploaded.url,
            fileName: uploaded.fileName,
            fileMime: uploaded.fileMime,
            fileSize: uploaded.fileSize,
            durationSec: messageType === "VOICE" ? voiceDurationSec ?? undefined : undefined
          };
        }

        await withSocketAck<GroupMessage>("group:message:send", groupPayload);
      } else {
        // ── USER MESSAGE ──
        let payload:
        | { recipientId: string; type: MessageType; text: string }
        | {
            recipientId: string;
            type: MessageType;
            fileUrl: string;
            fileName: string;
            fileMime: string;
            fileSize: number;
            durationSec?: number;
          }
        | { recipientId: string; type: MessageType; latitude: number; longitude: number };

      if (messageType === "TEXT") {
        const text = messageText.trim();
        if (!text) {
          toast.error("Xabar bo'sh.");
          return;
        }
        payload = { recipientId: selectedUserId, type: "TEXT", text };
      } else if (messageType === "LOCATION") {
        // Try to get current GPS location on mobile
        if (!locationLat && !locationLng && "geolocation" in navigator) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
              })
            );
            if (typeof pos.coords.accuracy === "number" && pos.coords.accuracy > MAX_LOCATION_ACCURACY_M) {
              toast.error(`Aniqlik past (~${Math.round(pos.coords.accuracy)}m). GPS ni yoqing va qaytadan urining.`);
              return;
            }
            setLocationLat(String(pos.coords.latitude));
            setLocationLng(String(pos.coords.longitude));
            setLocationAccuracy(typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null);
            payload = {
              recipientId: selectedUserId,
              type: "LOCATION",
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude
            };
          } catch {
            toast.error("Lokatsiyani olish imkoni bo'lmadi.");
            return;
          }
        } else {
          const latitude = Number(locationLat);
          const longitude = Number(locationLng);
          if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            toast.error("Lokatsiya qiymatlari noto'g'ri.");
            return;
          }
          if (locationAccuracy !== null && locationAccuracy > MAX_LOCATION_ACCURACY_M) {
            toast.error(`Lokatsiya aniqligi past (~${Math.round(locationAccuracy)}m). Qaytadan urining.`);
            return;
          }
          payload = { recipientId: selectedUserId, type: "LOCATION", latitude, longitude };
        }
      } else {
        let file = selectedFile;
        if (!file && messageType === "VOICE" && voiceBlob) {
          file = new File([voiceBlob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        }
        if (!file) {
          toast.error("Fayl tanlanmagan.");
          return;
        }
        const uploaded = await uploadFile(file);
        payload = {
          recipientId: selectedUserId,
          type: messageType,
          fileUrl: uploaded.url,
          fileName: uploaded.fileName,
          fileMime: uploaded.fileMime,
          fileSize: uploaded.fileSize,
          durationSec: messageType === "VOICE" ? voiceDurationSec ?? undefined : undefined
        };
      }

      await withSocketAck<Message>("message:send", payload);
      }
      if (sendSound) playMessageSentSound();
      setMessageText("");
      setSelectedFile(null);
      setVoiceBlob(null);
      setVoiceDurationSec(null);
      setLocationLat("");
      setLocationLng("");
      setLocationAccuracy(null);
      sendTypingSignal(false);
    } catch (error) {
      toast.error(readAxiosMessage(error, "Xabar yuborilmadi."));
    } finally {
      setIsSending(false);
      setUploadProgress(0);
    }
  };

  const setupPeerConnection = useCallback(async (recipientId: string) => {
    if (peerConnectionRef.current) peerConnectionRef.current.close();

    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:mytelegramchat.ddns.net:3478" },
        // Own TURN server
        {
          urls: "turn:mytelegramchat.ddns.net:3478",
          username: "chatuser",
          credential: "ChatTurnPass2026"
        },
        {
          urls: "turn:mytelegramchat.ddns.net:3478?transport=tcp",
          username: "chatuser",
          credential: "ChatTurnPass2026"
        },
        {
          urls: "turns:mytelegramchat.ddns.net:5349",
          username: "chatuser",
          credential: "ChatTurnPass2026"
        }
      ],
      iceCandidatePoolSize: 10
    });

    peer.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current) return;
      const target = callPeerIdRef.current;
      if (!target || target === callGroupIdRef.current) {
        pendingIceCandidatesRef.current.push(event.candidate.toJSON());
        return;
      }
      socketRef.current.emit("call:ice-candidate", {
        recipientId: target,
        candidate: event.candidate.toJSON()
      });
    };

    peer.ontrack = (event) => {
      console.log("[WebRTC] ontrack fired:", event.track.kind);
      if (event.track.kind === "video") {
        const video = remoteVideoRef.current;
        if (video) {
          video.srcObject = event.streams[0] || new MediaStream([event.track]);
          video.play().catch(() => {});
        }
        setIsRemoteScreenSharing(true);
        event.track.onended = () => {
          setIsRemoteScreenSharing(false);
          setScreenFullscreen(false);
        };
        event.track.onmute = () => {
          console.log("[WebRTC] Remote video track muted temporarily");
        };
        event.track.onunmute = () => {
          setIsRemoteScreenSharing(true);
        };
      }
      if (event.track.kind === "audio") {
        const audio = remoteAudioRef.current;
        if (!audio) {
          console.warn("[WebRTC] remoteAudioRef is null!");
          return;
        }
        // Check if we already have this exact track playing — skip if same
        const existing = audio.srcObject as MediaStream | null;
        if (existing && existing.getAudioTracks().some(t => t.id === event.track.id && t.readyState === "live")) {
          console.log("[WebRTC] Same audio track already active, skipping");
          return;
        }
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        if (selectedAudioOutput && typeof (audio as any).setSinkId === "function") {
          (audio as any).setSinkId(selectedAudioOutput).catch(() => {});
        }
        let attempts = 0;
        const tryPlay = () => {
          if (callStatusRef.current === "idle") return;
          attempts++;
          audio.play().then(() => {
            console.log(`[WebRTC] Remote audio playing (attempt ${attempts})`);
          }).catch((err) => {
            console.warn(`[WebRTC] audio.play() failed:`, err);
            if (attempts < 20) {
              setTimeout(tryPlay, 300);
            }
          });
        };
        tryPlay();
        event.track.onunmute = () => { attempts = 0; tryPlay(); };
      }
    };

    peer.oniceconnectionstatechange = () => {
      const state = peer.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);
      if (state === "failed") {
        toast.error("Aloqa uzildi. Qayta ulanish...");
        peer.restartIce();
      } else if (state === "disconnected") {
        toast("Aloqa vaqtincha uzildi...");
      } else if (state === "connected" || state === "completed") {
        const audio = remoteAudioRef.current;
        if (audio && audio.srcObject) audio.play().catch(() => {});
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("Connection state:", peer.connectionState);
      if (peer.connectionState === "failed") {
        toast.error("Qo'ng'iroq aloqasi uzildi.");
        stopCall(false);
      }
    };

    peerConnectionRef.current = peer;
    return peer;
  }, [selectedAudioOutput, stopCall]);

  const getCallMicStream = useCallback(async () => {
    const audioConstraints: boolean | MediaTrackConstraints = selectedAudioInput
      ? { deviceId: { exact: selectedAudioInput } }
      : true;

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (err) {
      if (!selectedAudioInput) {
        throw err;
      }
      // Saved deviceId can become invalid after device changes; fallback to default input.
      console.warn("[Call] Selected mic unavailable, retrying with default input", err);
      setSelectedAudioInput("");
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }, [selectedAudioInput]);

  const startCall = async () => {
    if (!selectedUserId) {
      toast("Avval chat userini tanlang.");
      return;
    }
    if (!socketRef.current) {
      toast.error("Socket ulanmagan.");
      return;
    }

    try {
      // Unlock audio element within user gesture context
      const audioEl = remoteAudioRef.current;
      if (audioEl) {
        audioEl.muted = true;
        audioEl.srcObject = new MediaStream();
        audioEl.play().then(() => { audioEl.muted = false; }).catch(() => { audioEl.muted = false; });
      }

      const stream = await getCallMicStream();
      localCallStreamRef.current = stream;
      remoteDescriptionSetRef.current = false;
      remoteIceCandidatesBufferRef.current = [];
      setCallPeerId(selectedUserId);
      callPeerIdRef.current = selectedUserId;
      const peer = await setupPeerConnection(selectedUserId);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socketRef.current.emit("call:offer", { recipientId: selectedUserId, sdp: offer });
      setCallStatus("calling");
      toast("Qo'ng'iroq yuborildi.");
    } catch (err) {
      console.error("Call start error:", err);
      toast.error("Qo'ng'iroqni boshlab bo'lmadi. Mikrofon ruxsatini tekshiring.");
      stopCall(true);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !socketRef.current) return;
    try {
      // Unlock audio element within user gesture context
      const audioEl = remoteAudioRef.current;
      if (audioEl) {
        audioEl.muted = true;
        audioEl.srcObject = new MediaStream();
        audioEl.play().then(() => { audioEl.muted = false; }).catch(() => { audioEl.muted = false; });
      }

      const stream = await getCallMicStream();
      localCallStreamRef.current = stream;

      remoteDescriptionSetRef.current = false;
      remoteIceCandidatesBufferRef.current = [];
      setCallPeerId(incomingCall.fromUserId);
      callPeerIdRef.current = incomingCall.fromUserId;
      const peer = await setupPeerConnection(incomingCall.fromUserId);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      remoteDescriptionSetRef.current = true;
      // Flush any ICE candidates that arrived while setting up
      const buffered = remoteIceCandidatesBufferRef.current;
      remoteIceCandidatesBufferRef.current = [];
      for (const c of buffered) {
        await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socketRef.current.emit("call:answer", { recipientId: incomingCall.fromUserId, sdp: answer });

      // If this is a group call, emit join and start VAD
      if (callGroupIdRef.current) {
        socketRef.current.emit("group:call:join", { groupId: callGroupIdRef.current });
        setGroupCallParticipants(prev => {
          const uid = currentUserIdRef.current;
          if (prev.some(p => p.userId === uid)) return prev;
          return [...prev, { userId: uid, speaking: false }];
        });
        startVAD(stream, callGroupIdRef.current);
      }

      setCallPeerId(incomingCall.fromUserId);
      setCallStatus("in-call");
      setIncomingCall(null);
      toast.success("Qo'ng'iroq qabul qilindi.");
    } catch (err) {
      console.error("Call accept error:", err);
      toast.error("Qo'ng'iroqni qabul qilib bo'lmadi. Mikrofon ruxsatini tekshiring.");
      stopCall(true);
    }
  };

  const declineCall = () => {
    if (incomingCall && socketRef.current) {
      socketRef.current.emit("call:end", { recipientId: incomingCall.fromUserId });
    }
    stopCall(true);
  };

  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current || !socketRef.current || !callPeerIdRef.current) return;

    if (isScreenSharing) {
      localScreenStreamRef.current?.getTracks().forEach(t => t.stop());
      localScreenStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;

      // Remove all screenshare senders (video and any leftover audio)
      const senders = peerConnectionRef.current.getSenders();
      const micTrack = localCallStreamRef.current?.getAudioTracks()[0] ?? null;
      for (const sender of senders) {
        if (sender.track && sender.track !== micTrack && (sender.track.kind === "video" || sender.track.kind === "audio")) {
          peerConnectionRef.current.removeTrack(sender);
        }
      }

      setIsScreenSharing(false);

      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => null);
        if (!stream) return;

        localScreenStreamRef.current = stream;
        setIsScreenSharing(true);

        // Only add video track — keep call audio separate from screenshare
        stream.getTracks().forEach(t => {
          if (t.kind === "video") {
            peerConnectionRef.current!.addTrack(t, stream);
            t.onended = () => {
              if (localScreenStreamRef.current) toggleScreenShare();
            };
          } else {
            t.stop(); // Stop screen audio track — not needed
          }
        });

        // Set srcObject after a tick so the video element is rendered
        requestAnimationFrame(() => {
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        });

        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const selectUserAndOpenChat = (userId: string) => {
    setSelectedUserId(userId);
    setUnreadCounts(prev => { const next = { ...prev }; delete next[userId]; return next; });
    setMobileTab("chat");
  };

  const selectGroupAndOpenChat = (groupId: string) => {
    setChatMode("group");
    setSelectedGroupId(groupId);
    setSelectedUserId("");
    setUnreadCounts(prev => { const next = { ...prev }; delete next[groupId]; return next; });
    setMobileTab("chat");
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error("Guruh nomini kiriting.");
      return;
    }
    if (newGroupMembers.length === 0) {
      toast.error("Kamida 1 ta a'zo tanlang.");
      return;
    }
    try {
      const response = await api.post<{ group: Group }>("/groups", {
        name: newGroupName.trim(),
        memberIds: newGroupMembers
      });
      setGroups((prev) => {
        if (prev.some((g) => g.id === response.data.group.id)) return prev;
        return [response.data.group, ...prev];
      });
      setShowCreateGroup(false);
      setNewGroupName("");
      setNewGroupMembers([]);
      setChatMode("group");
      setSelectedGroupId(response.data.group.id);
      setSelectedUserId("");
      setSidebarTab("groups");
      setMobileTab("chat");
      toast.success("Guruh yaratildi!");
    } catch (error) {
      toast.error(readAxiosMessage(error, "Guruh yaratib bo'lmadi."));
    }
  };

  // ── Chat order, pin, archive, drag helpers ──
  const saveChatOrder = (order: string[]) => {
    setChatOrder(order);
    localStorage.setItem("chat_order", JSON.stringify(order));
  };

  const togglePin = (chatId: string) => {
    setPinnedChats(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      localStorage.setItem("pinned_chats", JSON.stringify([...next]));
      return next;
    });
  };

  const toggleArchive = (chatId: string) => {
    setArchivedChats(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
  };

  const removeChat = (chatId: string) => {
    setArchivedChats(prev => {
      const next = new Set(prev);
      next.add(chatId);
      localStorage.setItem("archived_chats", JSON.stringify([...next]));
      return next;
    });
    if (selectedUserId === chatId) setSelectedUserId("");
  };

  const handleDragStart = (chatId: string) => setDraggedChatId(chatId);
  const handleDragOver = (e: React.DragEvent, chatId: string) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if (draggedChatId && chatId !== draggedChatId) setDragOverId(chatId);
  };
  const handleDragLeave = () => setDragOverId(null);
  const handleDrop = (targetChatId: string, items: { id: string }[]) => {
    if (!draggedChatId || draggedChatId === targetChatId) return;
    const ids = items.map(i => i.id);
    const fromIdx = ids.indexOf(draggedChatId);
    const toIdx = ids.indexOf(targetChatId);
    if (fromIdx < 0 || toIdx < 0) return;
    const newOrder = [...ids];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedChatId);
    saveChatOrder(newOrder);
    setDraggedChatId(null); setDragOverId(null);
  };
  const handleDragEnd = () => { setDraggedChatId(null); setDragOverId(null); };

  const sortChats = <T extends { id: string }>(list: T[]): T[] => {
    const pinned = list.filter(i => pinnedChats.has(i.id));
    const unpinned = list.filter(i => !pinnedChats.has(i.id));
    const sortByOrder = (a: {id:string}, b: {id:string}) => {
      const ai = chatOrder.indexOf(a.id);
      const bi = chatOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    };
    pinned.sort(sortByOrder);
    unpinned.sort(sortByOrder);
    return [...pinned, ...unpinned];
  };

  // Filtered/sorted users for the sidebar
  const sortedUsers = useMemo(() => {
    const visible = showArchived
      ? users.filter(u => archivedChats.has(u.id))
      : users.filter(u => !archivedChats.has(u.id));
    return sortChats(visible);
  }, [users, showArchived, archivedChats, pinnedChats, chatOrder]);

  const activeGroup = useMemo(
    () => (groups ?? []).find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const filteredGroups = useMemo(() => {
    const list = groups.filter(g => !archivedChats.has(g.id) || showArchived);
    return sortChats(list);
  }, [groups, pinnedChats, archivedChats, chatOrder, showArchived]);

  // ─────────── AUTH SCREEN ───────────
  if (!token || !currentUser) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">💬</div>
          <h1>Chat</h1>
          <p>Xush kelibsiz!</p>

          {authStep === "login" && (
            <form className="form" onSubmit={handleLogin}>
              <input type="email" placeholder="Email" value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)} required />
              <input type="password" placeholder="Parol" value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)} required />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">Kirish</button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("register")}>
                Ro'yxatdan o'tish
              </button>
              <button disabled={isSubmittingAuth} type="button" className="btn-link"
                onClick={() => setAuthStep("forgot")}>
                Parolni unutdingizmi?
              </button>
              <div className="auth-divider"><span>yoki</span></div>
              <div ref={googleBtnRef} className="google-btn-container"></div>
            </form>
          )}

          {authStep === "register" && (
            <form className="form" onSubmit={handleRegister}>
              <input type="text" placeholder="Ism" value={registerDisplayName}
                onChange={(e) => setRegisterDisplayName(e.target.value)} required />
              <input type="email" placeholder="name@gmail.com" value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)} required />
              <input type="password" placeholder="Parol" value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)} required />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">
                Ro'yxatdan o'tish
              </button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                Orqaga
              </button>
            </form>
          )}

          {authStep === "verify" && (
            <form className="form" onSubmit={handleVerifyEmail}>
              <input type="email" placeholder="Email" value={verifyEmail}
                onChange={(e) => setVerifyEmail(e.target.value)} required />
              <input type="text" placeholder="6-raqamli kod" value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)} required inputMode="numeric" />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">Tasdiqlash</button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                Orqaga
              </button>
            </form>
          )}

          {authStep === "login2fa" && (
            <form className="form" onSubmit={handle2FALogin}>
              <input type="text" placeholder="Authenticator kodi" value={twoFALoginCode}
                onChange={(e) => setTwoFALoginCode(e.target.value)} required inputMode="numeric" />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">Tasdiqlash</button>
              <button disabled={isSubmittingAuth} type="button"
                onClick={() => { setAuthStep("login"); setTempTwoFAToken(""); }}>
                Orqaga
              </button>
            </form>
          )}

          {authStep === "forgot" && (
            <form className="form" onSubmit={handleForgotPassword}>
              <input type="email" placeholder="Email" value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)} required />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">
                Kodni yuborish
              </button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                Orqaga
              </button>
            </form>
          )}

          {authStep === "reset" && (
            <form className="form" onSubmit={handleResetPassword}>
              <input type="email" placeholder="Email" value={verifyEmail}
                onChange={(e) => setVerifyEmail(e.target.value)} required />
              <input type="text" placeholder="Tiklash kodi" value={resetCode}
                onChange={(e) => setResetCode(e.target.value)} required />
              <input type="password" placeholder="Yangi parol" value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)} required />
              <button disabled={isSubmittingAuth} type="submit" className="btn-primary">
                Parolni yangilash
              </button>
              <button disabled={isSubmittingAuth} type="button" onClick={() => setAuthStep("login")}>
                Orqaga
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const onResizeMouseDown = (side: "left" | "right", e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = side;
    startXRef.current = e.clientX;
    startWidthRef.current = side === "left" ? leftWidth : rightWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startXRef.current;
      if (resizingRef.current === "left") {
        setLeftWidth(Math.max(200, Math.min(500, startWidthRef.current + delta)));
      } else {
        setRightWidth(Math.max(200, Math.min(500, startWidthRef.current - delta)));
      }
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // ─────────── MAIN APP ───────────
  return (
    <div className={`app${nightMode ? " dark" : ""}`}>
      {/* Incoming call overlay */}
      {callStatus === "ringing" && incomingCall && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-avatar">📞</div>
            <p className="call-title">Kiruvchi qo'ng'iroq</p>
            <p className="call-subtitle">
              {users.find((u) => u.id === incomingCall.fromUserId)?.displayName ?? "Noma'lum"}
            </p>
            <div className="call-buttons">
              <button className="btn-accept" onClick={acceptCall}>Qabul qilish</button>
              <button className="btn-decline" onClick={declineCall}>Rad etish</button>
            </div>
          </div>
        </div>
      )}

      {/* Active call bar (minimized) */}
      {callStatus !== "idle" && callStatus !== "ringing" && callMinimized && (
        <div className="active-call-bar" onClick={() => setCallMinimized(false)} style={{ cursor: 'pointer' }}>
          <span>
            {callStatus === "calling" ? "Qo'ng'iroq..." : "Suhbatda"} —{" "}
            {users.find((u) => u.id === callPeerId)?.displayName ?? groups.find((g) => g.id === callPeerId)?.name ?? ""}
            {callGroupIdRef.current && groupCallParticipants.length > 0 && (
              <> ({groupCallParticipants.length} kishi{groupCallParticipants.some(p => p.speaking) ? " • 🎤" : ""})</>
            )}
          </span>
          <button onClick={(e) => { e.stopPropagation(); stopCall(false); }}>Tugatish</button>
        </div>
      )}

      {/* Full call overlay */}
      {callStatus !== "idle" && callStatus !== "ringing" && !callMinimized && (
        <div className="in-call-overlay" style={{ position: 'fixed', bottom: 20, right: 20, width: 340, background: 'var(--bg-card)', borderRadius: 12, padding: 16, border: '1px solid var(--line)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--text)' }}>
              {callStatus === "calling" ? "Qo'ng'iroq..." : "Suhbatda"} — {users.find((u) => u.id === callPeerId)?.displayName ?? groups.find((g) => g.id === callPeerId)?.name ?? ""}
            </strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {callStatus === "in-call" && <span style={{ color: 'var(--primary)', fontSize: 13 }}>Live</span>}
              <button onClick={() => setCallMinimized(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }} title="Yopish">✕</button>
            </div>
          </div>

          {/* ── GROUP CALL PARTICIPANTS LIST ── */}
          {callGroupIdRef.current && groupCallParticipants.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>
                Ishtirokchilar ({groupCallParticipants.length})
              </div>
              {groupCallParticipants.map(p => {
                const u = users.find(x => x.id === p.userId);
                const isMe = p.userId === currentUser?.id;
                const vol = participantVolumes[p.userId] ?? 100;
                return (
                  <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 8, background: p.speaking ? 'rgba(76,175,80,0.12)' : 'transparent', border: p.speaking ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent', transition: 'all 0.2s' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, border: p.speaking ? '2px solid #4caf50' : '2px solid transparent', transition: 'border 0.2s' }}>
                        {(u?.displayName ?? "?").charAt(0).toUpperCase()}
                      </div>
                      {p.speaking && (
                        <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#4caf50', border: '2px solid var(--bg-card)', animation: 'pulse 1s infinite' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u?.displayName ?? p.userId.slice(0, 8)}{isMe ? " (siz)" : ""}
                      </div>
                      <div style={{ fontSize: 10, color: p.speaking ? '#4caf50' : 'var(--text-muted)' }}>
                        {p.speaking ? "🎤 Gapirmoqda" : "🔇 Tinglamoqda"}
                      </div>
                    </div>
                    {!isMe && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>{vol}%</span>
                        <input
                          type="range" min="0" max="200" value={vol}
                          onChange={e => {
                            const v = Number(e.target.value);
                            setParticipantVolumes(prev => {
                              const next = { ...prev, [p.userId]: v };
                              localStorage.setItem("participant_volumes", JSON.stringify(next));
                              return next;
                            });
                            const audio = remoteAudioRef.current;
                            if (audio) audio.volume = Math.min(v / 100, 1);
                          }}
                          style={{ width: 60, height: 4, accentColor: 'var(--primary)', cursor: 'pointer' }}
                          title={`Ovoz balandligi: ${vol}%`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div
            style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', minHeight: 180, cursor: ((remoteVideoRef.current?.srcObject as MediaStream | null)?.getVideoTracks().some(track => track.readyState === 'live') || isRemoteScreenSharing) ? 'pointer' : 'default' }}
            onClick={() => {
              const remoteStream = remoteVideoRef.current?.srcObject as MediaStream | null;
              const hasRemoteVideo = !!remoteStream?.getVideoTracks().some(track => track.readyState === 'live');
              if (isRemoteScreenSharing || hasRemoteVideo) {
                setScreenFullscreen(true);
              }
            }}
            title={isRemoteScreenSharing ? 'Katta qilish' : ''}
          >
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 100, position: 'absolute', bottom: 10, right: 10, borderRadius: 6, border: '2px solid var(--primary)', background: '#000', objectFit: 'cover', display: isScreenSharing ? 'block' : 'none' }} />
            {isRemoteScreenSharing && (
              <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>⛶ Katta qilish</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ flex: 1, padding: '10px 0', background: isScreenSharing ? 'var(--danger)' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={toggleScreenShare}>
              {isScreenSharing ? "To'xtatish" : "Ekran ulashish"}
            </button>
            <button style={{ flex: 1, padding: '10px 0', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={() => stopCall(false)}>
              Tugatish
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen screenshare overlay */}
      {screenFullscreen && ((remoteVideoRef.current?.srcObject as MediaStream | null)?.getVideoTracks().some(track => track.readyState === 'live') || isRemoteScreenSharing) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <video
            autoPlay playsInline
            ref={(el) => {
              if (el && remoteVideoRef.current) {
                el.srcObject = remoteVideoRef.current.srcObject;
              }
            }}
            style={{ flex: 1, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => setScreenFullscreen(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, backdropFilter: 'blur(8px)' }}>✕ Yopish</button>
            <button onClick={() => stopCall(false)} style={{ padding: '8px 16px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Tugatish</button>
          </div>
        </div>
      )}

      {/* CONTACTS TAB */}
      <div className={`tab-panel contacts-panel ${mobileTab === "contacts" ? "active" : ""}`}
        style={{ width: window.innerWidth >= 768 ? leftWidth : undefined }}>
        <div className="panel-header">
          <div className="profile-card clickable" onClick={() => {
            setShowMyProfile(true);
            setEditDisplayName(currentUser.displayName);
            setEditUsername(currentUser.username ?? "");
          }}>
            {currentUser.avatarUrl ? (
              <img src={`${API_URL}${currentUser.avatarUrl}`} alt="Avatar" className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar">{currentUser.displayName.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <strong>{currentUser.displayName}</strong>
              {currentUser.username && <small>@{currentUser.username}</small>}
              {!currentUser.username && <small>{currentUser.email}</small>}
            </div>
          </div>
        </div>

        <div className="sidebar-tabs">
          <button className={`sidebar-tab${sidebarTab === "contacts" ? " active" : ""}`} onClick={() => setSidebarTab("contacts")}>
            Kontaktlar ({sortedUsers.length})
          </button>
          <button className={`sidebar-tab${sidebarTab === "groups" ? " active" : ""}`} onClick={() => setSidebarTab("groups")}>
            Guruhlar ({groups.length})
          </button>
          <button className="archive-toggle-btn" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "📋" : "📦"}
          </button>
        </div>

        {sidebarTab === "contacts" && (
        <div className="contacts-list">
          {sortedUsers.map((user) => (
            <button
              key={user.id}
              className={`contact-item ${chatMode === "user" && user.id === selectedUserId ? "active" : ""}${pinnedChats.has(user.id) ? " pinned" : ""}${draggedChatId === user.id ? " dragging" : ""}${dragOverId === user.id ? " drag-over" : ""}`}
              onClick={() => { setChatMode("user"); selectUserAndOpenChat(user.id); }}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: user.id }); }}
              draggable
              onDragStart={() => handleDragStart(user.id)}
              onDragOver={(e) => handleDragOver(e, user.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(user.id, sortedUsers)}
              onDragEnd={handleDragEnd}
            >
              <div className="contact-avatar">
                {user.avatarUrl ? (
                  <img src={`${API_URL}${user.avatarUrl}`} alt="" className="contact-avatar-img" />
                ) : (
                  <>
                    {user.displayName.charAt(0).toUpperCase()}
                  </>
                )}
                {user.isOnline && <span className="online-dot" />}
              </div>
              <div className="contact-info">
                <span className="contact-name">{user.displayName}</span>
                <small className="contact-status">
                  {user.statusEmoji || user.statusText
                    ? `${user.statusEmoji ?? ""} ${user.statusText ?? ""}`.trim()
                    : user.isOnline ? "Online" : formatLastSeen(user.lastSeenAt)}
                </small>
              </div>
              {pinnedChats.has(user.id) && <span className="pin-badge">📌</span>}
              {(unreadCounts[user.id] || 0) > 0 && <span className="unread-badge">{unreadCounts[user.id]}</span>}
            </button>
          ))}
        </div>
        )}

        {sidebarTab === "groups" && (
        <div className="contacts-list">
          <button className="contact-item create-group-btn" onClick={() => setShowCreateGroup(true)}>
            ➕ Yangi guruh yaratish
          </button>
          {filteredGroups.map((group) => (
            <button
              key={group.id}
              className={`contact-item${chatMode === "group" && group.id === selectedGroupId ? " active" : ""}${pinnedChats.has(group.id) ? " pinned" : ""}${draggedChatId === group.id ? " dragging" : ""}${dragOverId === group.id ? " drag-over" : ""}`}
              onClick={() => selectGroupAndOpenChat(group.id)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: group.id }); }}
              draggable
              onDragStart={() => handleDragStart(group.id)}
              onDragOver={(e) => handleDragOver(e, group.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(group.id, filteredGroups)}
              onDragEnd={handleDragEnd}
            >
              <div className="contact-avatar group-avatar">
                {group.name.charAt(0).toUpperCase()}
              </div>
              <div className="contact-info">
                <span className="contact-name">{group.name}</span>
                <small className="contact-status">{group._count?.members ?? group.members?.length ?? 0} a'zo</small>
              </div>
              {pinnedChats.has(group.id) && <span className="pin-badge">📌</span>}
              {(unreadCounts[group.id] || 0) > 0 && <span className="unread-badge">{unreadCounts[group.id]}</span>}
            </button>
          ))}
          {filteredGroups.length === 0 && <p style={{ padding: "16px", color: "var(--muted)", fontSize: 13 }}>Hali guruh yo'q</p>}
        </div>
        )}

        <div className="theme-toggle-row">
          <span className="theme-toggle-label">{nightMode ? "🌙 Tungi rejim" : "☀️ Kunduzgi rejim"}</span>
          <label className="theme-switch">
            <input type="checkbox" checked={nightMode} onChange={() => setNightMode(!nightMode)} />
            <span className="theme-switch-slider" />
          </label>
        </div>
      </div>

      <div className="resizer resizer-left" onMouseDown={(e) => onResizeMouseDown("left", e)} />

      {/* CHAT TAB */}
      <div className={`tab-panel chat-panel ${mobileTab === "chat" ? "active" : ""}`}>
        {(chatMode === "user" && activeUser) || (chatMode === "group" && activeGroup) ? (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={() => setMobileTab("contacts")}>
                ←
              </button>
              {chatMode === "user" && activeUser && (
                <>
                  <div className="chat-header-avatar-wrapper">
                    {activeUser.avatarUrl ? (
                      <img src={`${API_URL}${activeUser.avatarUrl}`} alt="" className="chat-header-avatar-img" />
                    ) : (
                      <div className="chat-header-avatar">
                        {activeUser.displayName.charAt(0).toUpperCase()}
                        {activeUser.isOnline && <span className="online-dot" />}
                      </div>
                    )}
                  </div>
                  <div className="chat-header-info">
                    <strong>{activeUser.displayName}</strong>
                    <small>{activeUser.statusEmoji || activeUser.statusText
                      ? `${activeUser.statusEmoji ?? ""} ${activeUser.statusText ?? ""}`.trim()
                      : activeUser.isOnline ? "Online" : formatLastSeen(activeUser.lastSeenAt)}</small>
                  </div>
                  <div className="chat-header-actions">
                    {callStatus === "idle" && (
                      <button className="icon-btn" onClick={startCall} title="Qo'ng'iroq">📞</button>
                    )}
                    {callStatus !== "idle" && (
                      <button className="icon-btn end-call" onClick={() => stopCall(false)}>
                        ✕
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => { enumerateAudioDevices(); setShowDeviceSettings(!showDeviceSettings); }} title="Audio sozlamalari">
                      🎧
                    </button>
                  </div>
                </>
              )}
              {chatMode === "group" && activeGroup && (
                <>
                  <div className="chat-header-avatar-wrapper">
                    <div className="chat-header-avatar group-avatar">
                      {activeGroup.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="chat-header-info">
                    <strong>{activeGroup.name}</strong>
                    <small>{activeGroup._count?.members ?? activeGroup.members?.length ?? 0} a'zo</small>
                  </div>
                  <div className="chat-header-actions">
                    {callStatus === "idle" && (
                      <button className="icon-btn" onClick={async () => {
                        if (!socketRef.current) return;
                        try {
                          const audioConstraints: boolean | MediaTrackConstraints = selectedAudioInput
                            ? { deviceId: { exact: selectedAudioInput } }
                            : true;
                          const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                          localCallStreamRef.current = stream;
                          callGroupIdRef.current = selectedGroupId;
                          pendingIceCandidatesRef.current = [];
                          remoteDescriptionSetRef.current = false;
                          remoteIceCandidatesBufferRef.current = [];
                          const peer = await setupPeerConnection("");
                          stream.getTracks().forEach((t) => peer.addTrack(t, stream));
                          const offer = await peer.createOffer();
                          await peer.setLocalDescription(offer);
                          socketRef.current.emit("group:call:offer", {
                            groupId: selectedGroupId,
                            sdp: peer.localDescription?.toJSON()
                          });
                          socketRef.current.emit("group:call:join", { groupId: selectedGroupId });
                          setGroupCallParticipants([{ userId: currentUser!.id, speaking: false }]);
                          startVAD(stream, selectedGroupId);
                          setCallPeerId(selectedGroupId);
                          setCallStatus("calling");
                          toast("Guruh qo'ng'iroq yuborildi.");
                        } catch (err) {
                          console.error("Group call start error:", err);
                          toast.error("Mikrofon ruxsatini tekshiring.");
                          stopCall(true);
                        }
                      }} title="Guruh qo'ng'iroq">📞</button>
                    )}
                    {callStatus !== "idle" && (
                      <button className="icon-btn end-call" onClick={() => {
                        if (socketRef.current) {
                          socketRef.current.emit("group:call:leave", { groupId: selectedGroupId });
                          socketRef.current.emit("group:call:end", { groupId: selectedGroupId });
                        }
                        stopCall(false);
                      }}>✕</button>
                    )}
                    <button className="icon-btn" onClick={() => { enumerateAudioDevices(); setShowDeviceSettings(!showDeviceSettings); }} title="Audio sozlamalari">
                      🎧
                    </button>
                  </div>
                </>
              )}
              {showDeviceSettings && (
                <div className="device-settings-dropdown">
                  <div className="device-settings-header">
                    <strong>🎙️ Audio sozlamalari</strong>
                    <button className="device-settings-close" onClick={() => setShowDeviceSettings(false)}>✕</button>
                  </div>
                  <div className="device-select-group">
                    <label>Mikrofon (kirish):</label>
                    <select value={selectedAudioInput} onChange={(e) => setSelectedAudioInput(e.target.value)}>
                      {audioInputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mikrofon ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="device-select-group">
                    <label>Dinamik (chiqish):</label>
                    <select value={selectedAudioOutput} onChange={(e) => setSelectedAudioOutput(e.target.value)}>
                      {audioOutputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Dinamik ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn-test-audio" onClick={async () => {
                    try {
                      const audioConstraints: boolean | MediaTrackConstraints = selectedAudioInput
                        ? { deviceId: { exact: selectedAudioInput } }
                        : true;
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                      toast.success("Mikrofon ishlayapti!");
                      setTimeout(() => { stream.getTracks().forEach((t) => t.stop()); }, 2000);
                    } catch {
                      toast.error("Mikrofonga ruxsat berilmagan!");
                    }
                  }}>
                    🔊 Mikrofonni test qilish
                  </button>
                </div>
              )}
            </div>

            <div className={`messages-area${isSelectionMode ? " selection-active" : ""}`}>
              {chatMode === "user" && (
              <>
              {isLoadingMessages && <p className="loading-text">Yuklanmoqda...</p>}
              {!isLoadingMessages && messages.map((msg, idx) => {
                const isMine = msg.senderId === currentUser.id;
                return (
                  <div
                    key={msg.id}
                    className={`msg ${isMine ? "mine" : "theirs"}${isSelectionMode ? " selectable" : ""}${selectedMessageIds.has(msg.id) ? " selected" : ""}`}
                    onClick={(e) => {
                      if (isSelectionMode) {
                        if (e.shiftKey && lastSelectedIndexRef.current !== null) {
                          const start = Math.min(lastSelectedIndexRef.current, idx);
                          const end = Math.max(lastSelectedIndexRef.current, idx);
                          setSelectedMessageIds(prev => {
                            const next = new Set(prev);
                            for (let i = start; i <= end; i++) { next.add(messages[i].id); }
                            return next;
                          });
                        } else {
                          setSelectedMessageIds(prev => {
                            const next = new Set(prev);
                            if (next.has(msg.id)) next.delete(msg.id);
                            else next.add(msg.id);
                            return next;
                          });
                          lastSelectedIndexRef.current = idx;
                        }
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!isSelectionMode) {
                        setIsSelectionMode(true);
                        setSelectedMessageIds(new Set([msg.id]));
                        lastSelectedIndexRef.current = idx;
                      }
                    }}
                  >
                    {isSelectionMode && (
                      <label className="msg-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedMessageIds.has(msg.id)} onChange={(e) => {
                          if (e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey && lastSelectedIndexRef.current !== null) {
                            const start = Math.min(lastSelectedIndexRef.current, idx);
                            const end = Math.max(lastSelectedIndexRef.current, idx);
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              for (let i = start; i <= end; i++) { next.add(messages[i].id); }
                              return next;
                            });
                          } else {
                            setSelectedMessageIds(prev => {
                              const next = new Set(prev);
                              if (next.has(msg.id)) next.delete(msg.id);
                              else next.add(msg.id);
                              return next;
                            });
                            lastSelectedIndexRef.current = idx;
                          }
                        }} />
                      </label>
                    )}
                    <div className="msg-body">
                      <div className="msg-content">{renderMessage(msg)}</div>
                      <time className="msg-time">{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{isMine && <span className={`msg-check${msg.readAt ? " read" : ""}`}>{msg.readAt ? "✓✓" : "✓"}</span>}</time>
                    </div>
                  </div>
                );
              })}
              {typingFromUserId === selectedUserId && (
                <div className="typing-indicator">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              )}
              </>
              )}

              {chatMode === "group" && (
              <>
              {isLoadingGroupMessages && <p className="loading-text">Yuklanmoqda...</p>}
              {!isLoadingGroupMessages && groupMessages.map((msg) => {
                const isMine = msg.senderId === currentUser.id;
                return (
                  <div key={msg.id} className={`msg ${isMine ? "mine" : "theirs"}`}>
                    <div className="msg-body">
                      {!isMine && <small className="group-sender">{msg.sender?.displayName ?? "?"}</small>}
                      <div className="msg-content">{renderMessage(msg as unknown as Message)}</div>
                      <time className="msg-time">{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                    </div>
                  </div>
                );
              })}
              {groupTypingUserId && (
                <div className="typing-indicator">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                  <small style={{ marginLeft: 4, color: "var(--muted)" }}>{users.find(u => u.id === groupTypingUserId)?.displayName ?? ""}</small>
                </div>
              )}
              </>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Selection action bar ── */}
            {isSelectionMode && (
              <div className="selection-bar">
                <button className="sel-btn sel-forward" onClick={() => setShowForwardModal(true)}>
                  ⤳ Forward ({selectedMessageIds.size})
                </button>
                <button className="sel-btn sel-delete" onClick={async () => {
                  if (selectedMessageIds.size === 0) return;
                  try {
                    await api.delete("/messages", { data: { messageIds: [...selectedMessageIds] } });
                    setMessages(prev => prev.filter(m => !selectedMessageIds.has(m.id)));
                    toast.success(`${selectedMessageIds.size} ta xabar o'chirildi`);
                  } catch (err) {
                    toast.error(readAxiosMessage(err, "O'chirishda xato"));
                  }
                  setSelectedMessageIds(new Set());
                  setIsSelectionMode(false);
                }}>
                  🗑 Delete ({selectedMessageIds.size})
                </button>
                <button className="sel-btn sel-cancel" onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedMessageIds(new Set());
                }}>
                  ✕ Cancel
                </button>
              </div>
            )}

            {/* ── Forward modal ── */}
            {showForwardModal && (
              <div className="forward-modal-overlay" onClick={() => setShowForwardModal(false)}>
                <div className="forward-modal" onClick={(e) => e.stopPropagation()}>
                  <h3>Forward to</h3>
                  <div className="forward-user-list">
                    {users.filter(u => u.id !== currentUser.id).map(u => (
                      <button key={u.id} className="forward-user-item" onClick={async () => {
                        try {
                          await api.post("/messages/forward", {
                            messageIds: [...selectedMessageIds],
                            recipientId: u.id
                          });
                          toast.success(`${selectedMessageIds.size} ta xabar ${u.displayName} ga yuborildi`);
                        } catch (err) {
                          toast.error(readAxiosMessage(err, "Forward qilishda xato"));
                        }
                        setShowForwardModal(false);
                        setSelectedMessageIds(new Set());
                        setIsSelectionMode(false);
                      }}>
                        {u.avatarUrl ? (
                          <img src={`${API_URL}${u.avatarUrl}`} alt="" className="forward-user-avatar-img" />
                        ) : (
                          <span className="forward-user-avatar">{u.displayName.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="forward-user-name">{u.displayName}</span>
                      </button>
                    ))}
                  </div>
                  <button className="forward-close-btn" onClick={() => setShowForwardModal(false)}>Bekor qilish</button>
                </div>
              </div>
            )}

            <div className="composer">
              <div className="composer-row">
                <select
                  className="msg-type-select"
                  value={messageType}
                  onChange={(e) => setMessageType(e.target.value as MessageType)}
                >
                  <option value="TEXT">💬</option>
                  <option value="FILE">📎</option>
                  <option value="VOICE">🎤</option>
                  <option value="LOCATION">📍</option>
                </select>

                {messageType === "TEXT" && (
                  <input
                    className={`msg-input${smoothCaret ? " smooth-caret" : ""}${cursorBlink ? " cursor-blink-phase" : " cursor-no-blink"}`}
                    type="text"
                    placeholder="Xabar yozing..."
                    value={messageText}
                    onChange={(e) => handleTextChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  />
                )}

                {messageType === "LOCATION" && (
                  <div className="location-inputs">
                    <input type="text" placeholder="Lat" value={locationLat}
                      onChange={(e) => { setLocationLat(e.target.value); setLocationAccuracy(null); }} inputMode="decimal" />
                    <input type="text" placeholder="Lng" value={locationLng}
                      onChange={(e) => { setLocationLng(e.target.value); setLocationAccuracy(null); }} inputMode="decimal" />
                  </div>
                )}

                {(messageType === "FILE" || messageType === "VOICE") && (
                  <input className="msg-input" type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
                )}

                <button className="send-btn" onClick={sendMessage} disabled={isSending}>
                  {isSending ? (uploadProgress > 0 ? `${uploadProgress}%` : "…") : "➤"}
                </button>
              </div>

              {messageType === "VOICE" && (
                <div className="voice-row">
                  {!isRecordingVoice ? (
                    <button className="voice-btn" onClick={startVoiceRecording}>🎙 Yozish</button>
                  ) : (
                    <button className="voice-btn recording" onClick={stopVoiceRecording}>⏹ To'xtatish</button>
                  )}
                  {voiceDurationSec ? <small>{voiceDurationSec}s</small> : null}
                </div>
              )}

              {messageType === "LOCATION" && (
                <button className="gps-btn" onClick={() => {
                  setLocationLat("");
                  setLocationLng("");
                  setLocationAccuracy(null);
                  sendMessage();
                }}>
                  📍 Joriy joylashuvni yuborish
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="empty-chat">
            <p>Chat boshlash uchun kontakt tanlang</p>
            <button onClick={() => setMobileTab("contacts")}>Kontaktlar</button>
          </div>
        )}
      </div>

      <div className="resizer resizer-right" onMouseDown={(e) => onResizeMouseDown("right", e)} />

      {/* SETTINGS TAB */}
      <div className={`tab-panel settings-panel ${mobileTab === "settings" ? "active" : ""}`}
        style={{ width: window.innerWidth >= 768 ? rightWidth : undefined }}>
        <div className="panel-header">
          <strong>Sozlamalar</strong>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-avatar" onClick={() => {
              setShowMyProfile(true);
              setEditDisplayName(currentUser.displayName);
              setEditUsername(currentUser.username ?? "");
            }} style={{ cursor: "pointer" }}>
              {currentUser.avatarUrl ? (
                <img src={`${API_URL}${currentUser.avatarUrl}`} alt="Avatar" className="settings-avatar-img" />
              ) : (
                currentUser.displayName.charAt(0).toUpperCase()
              )}
            </div>
            <h3>{currentUser.displayName}</h3>
            {currentUser.username && <p className="settings-username">@{currentUser.username}</p>}
            <p className="settings-email">{currentUser.email}</p>
          </div>

          <div className="settings-section">
            <h4>Sozlamalar</h4>

            {/* Night Mode */}
            <div className="settings-row">
              <span>🌙 Tungi rejim</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={nightMode} onChange={() => setNightMode(!nightMode)} />
                <span className="toggle-slider" />
              </label>
            </div>

            {/* Smooth Caret */}
            <div className="settings-row">
              <span>✨ Smooth caret animation</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={smoothCaret} onChange={() => {
                  const next = !smoothCaret;
                  setSmoothCaret(next);
                  localStorage.setItem("smooth_caret", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>

            {/* Cursor Blink */}
            <div className="settings-row">
              <span>💫 Cursor blinking (phase)</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={cursorBlink} onChange={() => {
                  const next = !cursorBlink;
                  setCursorBlink(next);
                  localStorage.setItem("cursor_blink", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>

            {/* Send Sound */}
            <div className="settings-row">
              <span>🔊 Xabar jo'natish ovozi</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={sendSound} onChange={() => {
                  const next = !sendSound;
                  setSendSound(next);
                  localStorage.setItem("send_sound", String(next));
                }} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h4>Xavfsizlik</h4>
            <div className="settings-row">
              <span>2FA</span>
              <span className={currentUser.isTwoFAEnabled ? "badge-on" : "badge-off"}>
                {currentUser.isTwoFAEnabled ? "Yoqilgan" : "O'chirilgan"}
              </span>
            </div>

            {!currentUser.isTwoFAEnabled && (
              <div className="settings-actions">
                <button onClick={startTwoFASetup}>2FA sozlash</button>
                {twoFAQrDataUrl && (
                  <>
                    <img src={twoFAQrDataUrl} alt="2FA QR" className="qr-image" />
                    <input type="text" placeholder="Authenticator kodi" value={twoFASetupCode}
                      onChange={(e) => setTwoFASetupCode(e.target.value)} inputMode="numeric" />
                    <button className="btn-primary" onClick={enableTwoFA}>2FA yoqish</button>
                  </>
                )}
              </div>
            )}

            {currentUser.isTwoFAEnabled && (
              <div className="settings-actions">
                <input type="text" placeholder="2FA kodi" value={twoFADisableCode}
                  onChange={(e) => setTwoFADisableCode(e.target.value)} inputMode="numeric" />
                <button onClick={disableTwoFA}>2FA o'chirish</button>
              </div>
            )}
          </div>

          <div className="settings-section">
            <button className="logout-btn" onClick={clearSession}>
              Chiqish
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM TAB BAR */}
      <nav className="tab-bar">
        <button className={mobileTab === "contacts" ? "active" : ""} onClick={() => setMobileTab("contacts")}>
          <span className="tab-icon">👥</span>
          <span className="tab-label">Kontaktlar</span>
        </button>
        <button className={mobileTab === "chat" ? "active" : ""} onClick={() => setMobileTab("chat")}>
          <span className="tab-icon">💬</span>
          <span className="tab-label">Chat</span>
        </button>
        <button className={mobileTab === "settings" ? "active" : ""} onClick={() => setMobileTab("settings")}>
          <span className="tab-icon">⚙️</span>
          <span className="tab-label">Sozlama</span>
        </button>
      </nav>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button onClick={() => { togglePin(contextMenu.chatId); setContextMenu(null); }}>
              {pinnedChats.has(contextMenu.chatId) ? "📌 Pin olib tashlash" : "📌 Pin qilish"}
            </button>
            <button onClick={() => { toggleArchive(contextMenu.chatId); setContextMenu(null); }}>
              {archivedChats.has(contextMenu.chatId) ? "📦 Arxivdan chiqarish" : "📦 Arxivga qo'shish"}
            </button>
            <button className="context-menu-danger" onClick={() => { removeChat(contextMenu.chatId); setContextMenu(null); }}>
              🗑️ O'chirish
            </button>
          </div>
        </>
      )}

      {/* ── My Profile Modal ── */}
      {showMyProfile && currentUser && (
        <div className="lightbox-overlay" onClick={() => setShowMyProfile(false)}>
          <div className="my-profile-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>👤 Mening profilim</h3>
              <button className="settings-close" onClick={() => setShowMyProfile(false)}>✕</button>
            </div>
            <div className="my-profile-avatar-section">
              <div className="my-profile-avatar-wrapper">
                {currentUser.avatarUrl ? (
                  <img src={`${API_URL}${currentUser.avatarUrl}`} alt="Avatar" className="my-profile-avatar-img" />
                ) : (
                  <div className="my-profile-avatar-placeholder">
                    {currentUser.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <label className="my-profile-avatar-edit" title="Rasm o'zgartirish">
                  📷
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append("file", file);
                    try {
                      const uploadRes = await api.post<{ url: string }>("/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
                      const avatarUrl = uploadRes.data.url;
                      const profileRes = await api.put<{ user: PublicUser }>("/auth/profile", { avatarUrl });
                      setCurrentUser(profileRes.data.user);
                      toast.success("Profil rasmi yangilandi!");
                    } catch { toast.error("Rasmni yuklashda xatolik"); }
                  }} />
                </label>
              </div>
            </div>
            <div className="my-profile-form">
              <div className="my-profile-field">
                <label>Ism</label>
                <input type="text" value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="Display name" maxLength={40} />
              </div>
              <div className="my-profile-field">
                <label>Username</label>
                <div className="username-input-wrapper">
                  <span className="username-at">@</span>
                  <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="username" maxLength={30} />
                </div>
              </div>
              <div className="my-profile-field">
                <label>Email</label>
                <input type="text" value={currentUser.email} disabled className="profile-disabled-input" />
              </div>
              <button className="btn-primary profile-save-btn" disabled={profileSaving} onClick={async () => {
                setProfileSaving(true);
                try {
                  const data: Record<string, string | null> = {};
                  if (editDisplayName.trim() && editDisplayName !== currentUser.displayName) data.displayName = editDisplayName.trim();
                  if (editUsername !== (currentUser.username ?? "")) data.username = editUsername || null;
                  if (Object.keys(data).length === 0) { toast("O'zgarish yo'q"); setProfileSaving(false); return; }
                  const res = await api.put<{ user: PublicUser }>("/auth/profile", data);
                  setCurrentUser(res.data.user);
                  toast.success("Profil yangilandi!");
                  setShowMyProfile(false);
                } catch (err: any) {
                  toast.error(err?.response?.data?.message ?? "Xatolik yuz berdi");
                } finally { setProfileSaving(false); }
              }}>
                {profileSaving ? "Saqlanmoqda..." : "💾 Saqlash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Group Modal ── */}
      {showCreateGroup && (
        <div className="lightbox-overlay" onClick={() => setShowCreateGroup(false)}>
          <div className="create-group-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Yangi guruh yaratish</h3>
            <input
              type="text"
              placeholder="Guruh nomi"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
            />
            <div className="group-member-select">
              <h4>A'zolarni tanlang:</h4>
              {users.map((user) => (
                <label key={user.id} className="group-member-checkbox">
                  <input
                    type="checkbox"
                    checked={newGroupMembers.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewGroupMembers([...newGroupMembers, user.id]);
                      } else {
                        setNewGroupMembers(newGroupMembers.filter((id) => id !== user.id));
                      }
                    }}
                  />
                  <span>{user.displayName}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, padding: 10, borderRadius: 10 }} onClick={createGroup}>
                Yaratish ({newGroupMembers.length} a'zo)
              </button>
              <button style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }} onClick={() => setShowCreateGroup(false)}>
                Bekor qilish
              </button>
            </div>
          </div>
        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}

function disconnectSocket(socketRef: { current: Socket | null }) {
  socketRef.current?.removeAllListeners();
  socketRef.current?.disconnect();
  socketRef.current = null;
}

function formatLastSeen(lastSeenAt?: string | null) {
  if (!lastSeenAt) {
    return "offline";
  }

  const seenAt = new Date(lastSeenAt);
  if (Number.isNaN(seenAt.getTime())) {
    return "offline";
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seenStart = new Date(seenAt.getFullYear(), seenAt.getMonth(), seenAt.getDate());
  const dayDiff = Math.round((todayStart.getTime() - seenStart.getTime()) / 86400000);
  const time = seenAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (dayDiff < 0) {
    return time;
  }

  const relativeDay = new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-dayDiff, "day");
  return `${relativeDay} ${time}`;
}

function buildMessagePreview(message: Message) {
  if (message.type === "TEXT") return message.text ?? "Text";
  if (message.type === "LOCATION") return "📍 Lokatsiya";
  if (message.type === "VOICE") return "🎤 Voice";
  return message.fileName ?? "📎 Fayl";
}

function isImageFile(message: Message): boolean {
  if (message.fileMime?.startsWith("image/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext ?? "");
}

function isVideoFile(message: Message): boolean {
  if (message.fileMime?.startsWith("video/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext ?? "");
}

function isMusicFile(message: Message): boolean {
  if (message.type === "VOICE") return false;
  if (message.fileMime?.startsWith("audio/")) return true;
  const ext = (message.fileName ?? "").split(".").pop()?.toLowerCase();
  return ["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma"].includes(ext ?? "");
}

function renderMessage(message: Message) {
  if (message.type === "TEXT") return renderTextWithMentions(message.text ?? "");
  if (message.type === "LOCATION") {
    const lat = message.latitude;
    const lng = message.longitude;
    return (
      <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
        📍 Location: {lat}, {lng}
      </a>
    );
  }
  if (message.type === "VOICE") {
    return <audio controls src={normalizeFileUrl(message.fileUrl)} style={{ maxWidth: "100%" }} />;
  }
  // Video preview
  if (isVideoFile(message)) {
    return (
      <div style={{ maxWidth: 360, borderRadius: 12, overflow: "hidden", background: "#000" }}>
        <video
          controls
          src={normalizeFileUrl(message.fileUrl)}
          style={{ display: "block", width: "100%", maxHeight: 280 }}
          preload="metadata"
        />
        {message.fileName && <div style={{ padding: "4px 10px 6px", fontSize: 11, color: "rgba(255,255,255,0.5)", background: "rgba(0,0,0,0.5)" }}>{message.fileName}</div>}
      </div>
    );
  }
  // Music preview
  if (isMusicFile(message)) {
    const name = (message.fileName ?? "").replace(/\.[^.]+$/, "");
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", minWidth: 240 }}>
        <span style={{ fontSize: 24 }}>🎵</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name || message.fileName}</div>
          <audio controls src={normalizeFileUrl(message.fileUrl)} style={{ width: "100%", height: 32, marginTop: 4 }} preload="metadata" />
        </div>
      </div>
    );
  }
  // Image preview inline
  if (isImageFile(message)) {
    return (
      <a href={normalizeFileUrl(message.fileUrl)} target="_blank" rel="noreferrer">
        <img
          src={normalizeFileUrl(message.fileUrl)}
          alt={message.fileName ?? "Image"}
          style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 10, display: "block" }}
        />
      </a>
    );
  }
  return (
    <a href={normalizeFileUrl(message.fileUrl)} target="_blank" rel="noreferrer">
      📎 {message.fileName ?? "Download file"}
    </a>
  );
}

const MENTION_REGEX_SPLIT = /@\[([^\]]+)\]\(([^)]+)\)/g;

function renderTextWithMentions(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  MENTION_REGEX_SPLIT.lastIndex = 0;
  while ((match = MENTION_REGEX_SPLIT.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, match.index)}</span>);
    }
    parts.push(
      <span key={`m-${match.index}`} className="mention-badge">
        @{match[1]}
      </span>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
  }
  return <>{parts}</>;
}

function readAxiosMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default App;
