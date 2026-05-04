const fs = require('fs');
const path = require('path');

const tsxPath = path.join(__dirname, 'src', 'App.tsx');
let c = fs.readFileSync(tsxPath, 'utf8');

c = c.replace(
    'const [callPeerId, setCallPeerId] = useState<string | null>(null);',
    'const [callPeerId, setCallPeerId] = useState<string | null>(null);\n  const [isScreenSharing, setIsScreenSharing] = useState(false);'
);

c = c.replace(
    'const localCallStreamRef = useRef<MediaStream | null>(null);',
    'const localCallStreamRef = useRef<MediaStream | null>(null);\n  const localScreenStreamRef = useRef<MediaStream | null>(null);\n  const localVideoRef = useRef<HTMLVideoElement>(null);\n  const remoteVideoRef = useRef<HTMLVideoElement>(null);'
);

c = c.replace(
    'localCallStreamRef.current?.getTracks().forEach((track) => track.stop());\n    localCallStreamRef.current = null;',
    'localCallStreamRef.current?.getTracks().forEach((track) => track.stop());\n    localCallStreamRef.current = null;\n    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());\n    localScreenStreamRef.current = null;\n    setIsScreenSharing(false);'
);

c = c.replace(
    'socket.on("call:end", () => {',
    'socket.on("call:renegotiate", async (payload: { fromUserId: string; type: string; sdp: any }) => {\n        if (!peerConnectionRef.current) return;\n        if (payload.type === "offer") {\n          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));\n          const answer = await peerConnectionRef.current.createAnswer();\n          await peerConnectionRef.current.setLocalDescription(answer);\n          socket.emit("call:renegotiate", { recipientId: payload.fromUserId, type: "answer", sdp: answer });\n        } else if (payload.type === "answer") {\n          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));\n        }\n      });\n\n      socket.on("call:end", () => {'
);

const onTrackReplace = 'peer.ontrack = (event) => {\n      if (event.track.kind === "video") {\n        const video = remoteVideoRef.current;\n        if (video) {\n          if (video.srcObject !== event.streams[0]) video.srcObject = event.streams[0];\n          video.play().catch(() => {});\n        }\n      }\n      const audio = remoteAudioRef.current;\n      if (audio) {\n        if (audio.srcObject !== event.streams[0]) audio.srcObject = event.streams[0];\n        if (selectedAudioOutput && typeof (audio as any).setSinkId === "function") {\n          (audio as any).setSinkId(selectedAudioOutput).catch(() => {});\n        }\n        audio.play().catch(() => {});\n      }\n    };';

c = c.replace(
    /peer\.ontrack = \(event\) => \{([^}]|\n)*audio\.play\(\)\.catch\(\(\) => \{\}\);\n    \};/g,
    onTrackReplace
);

const displayBlock = `
  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current || !socketRef.current || !callPeerIdRef.current) return;

    if (isScreenSharing) {
      localScreenStreamRef.current?.getTracks().forEach(t => t.stop());
      localScreenStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === "video");
      if (videoSender) peerConnectionRef.current.removeTrack(videoSender);
      
      setIsScreenSharing(false);
      
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => null);
        if (!stream) return;
        
        localScreenStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        stream.getTracks().forEach(t => {
          peerConnectionRef.current!.addTrack(t, stream);
          t.onended = () => {
            if (isScreenSharing) toggleScreenShare();
          };
        });

        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        socketRef.current.emit("call:renegotiate", { recipientId: callPeerIdRef.current, type: "offer", sdp: offer });

        setIsScreenSharing(true);
      } catch (err) {
        console.error(err);
      }
    }
  };

`;

c = c.replace(
    'const acceptCall = async () => {',
    displayBlock + '  const acceptCall = async () => {'
);


const uiReplace = `
      {callStatus === "in-call" && (
        <div className="in-call-overlay" style={{ position: 'fixed', bottom: 20, right: 20, width: 340, background: 'var(--bg-card)', borderRadius: 12, padding: 16, border: '1px solid var(--line)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--text)' }}>Qo\\'ng\\'iroq jarayonda</strong>
            <span style={{ color: 'var(--primary)' }}>Jonli</span>
          </div>
          
          <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', minHeight: 180 }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {isScreenSharing && (
              <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 100, position: 'absolute', bottom: 10, right: 10, borderRadius: 6, border: '2px solid var(--primary)', background: '#000', objectFit: 'cover' }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ flex: 1, padding: '10px 0', background: isScreenSharing ? 'var(--danger)' : 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={toggleScreenShare}>
               {isScreenSharing ? "Ekranni yopish" : "Oyna ulashish"}
            </button>
            <button style={{ flex: 1, padding: '10px 0', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }} onClick={() => stopCall(false)}>
               Yakunlash
            </button>
          </div>
        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay />`;

c = c.replace('<audio ref={remoteAudioRef} autoPlay />', uiReplace);

fs.writeFileSync(tsxPath, c);
console.log("App.tsx modified");
