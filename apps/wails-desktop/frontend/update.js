const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'App.tsx');
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

function insertAfter(lineMatch, newContent) {
    let idx = lines.findIndex(l => l.includes(lineMatch));
    if (idx !== -1) {
        if (!lines[idx + 1].includes(newContent.split('\n')[0].trim())) {
            lines.splice(idx + 1, 0, newContent);
        }
    } else {
        console.log("NOT FOUND:", lineMatch);
    }
}

function replaceBetween(startMatch, endMatch, newContent) {
    let idx1 = lines.findIndex(l => l.includes(startMatch));
    let idx2 = lines.findIndex((l, i) => i > idx1 && l.includes(endMatch));
    if (idx1 !== -1 && idx2 !== -1) {
        lines.splice(idx1, idx2 - idx1 + 1, newContent);
    } else {
        console.log("NOT FOUND RANGE:", startMatch, endMatch);
    }
}

insertAfter('const [callPeerId, setCallPeerId] = useState<string | null>(null);', '  const [isScreenSharing, setIsScreenSharing] = useState(false);');

insertAfter('const localCallStreamRef = useRef<MediaStream | null>(null);', '  const localScreenStreamRef = useRef<MediaStream | null>(null);\n  const localVideoRef = useRef<HTMLVideoElement>(null);\n  const remoteVideoRef = useRef<HTMLVideoElement>(null);');

replaceBetween('localCallStreamRef.current?.getTracks().forEach((track) => track.stop());', 'localCallStreamRef.current = null;', '    localCallStreamRef.current?.getTracks().forEach((track) => track.stop());\n    localCallStreamRef.current = null;\n    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());\n    localScreenStreamRef.current = null;\n    setIsScreenSharing(false);');

replaceBetween('socket.on("call:renegotiate"', '});', `      socket.on("call:renegotiate", async (payload: { fromUserId: string; type: string; sdp: any }) => {
        if (!peerConnectionRef.current) return;
        if (payload.type === "offer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          socket.emit("call:renegotiate", { recipientId: payload.fromUserId, type: "answer", sdp: answer });
        } else if (payload.type === "answer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      });`);
// Actually wait, call:renegotiate doesn't exist yet, I have to insert it before call:end
insertAfter('socket.on("call:end"', `      socket.on("call:renegotiate", async (payload: { fromUserId: string; type: string; sdp: any }) => {
        if (!peerConnectionRef.current) return;
        if (payload.type === "offer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          socketRef.current?.emit("call:renegotiate", { recipientId: payload.fromUserId, type: "answer", sdp: answer });
        } else if (payload.type === "answer") {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      });`);


replaceBetween('peer.ontrack = (event) => {', 'audio.play().catch(() => {});', `    peer.ontrack = (event) => {
      if (event.track.kind === "video") {
        const video = remoteVideoRef.current;
        if (video) {
          if (video.srcObject !== event.streams[0]) video.srcObject = event.streams[0];
          video.play().catch(() => {});
        }
      }
      const audio = remoteAudioRef.current;
      if (audio) {
        if (audio.srcObject !== event.streams[0]) audio.srcObject = event.streams[0];
        if (selectedAudioOutput && typeof (audio as any).setSinkId === "function") {
          (audio as any).setSinkId(selectedAudioOutput).catch(() => {});
        }
        audio.play().catch(() => {});`);

insertAfter('const acceptCall = async () => {', `
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
  };`);

replaceBetween('<audio ref={remoteAudioRef} autoPlay />', '<audio ref={remoteAudioRef} autoPlay />', `      {callStatus === "in-call" && (
        <div className="in-call-overlay" style={{ position: 'fixed', bottom: 20, right: 20, width: 440, background: 'var(--bg-card)', borderRadius: 12, padding: 16, border: '1px solid var(--line)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--text)' }}>Qo'ng'iroq jarayonda</strong>
            <span style={{ color: 'var(--primary)' }}>Jonli</span>
          </div>
          
          <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', minHeight: 280, display: 'flex', justifyContent: 'center' }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            {isScreenSharing && (
              <video ref={localVideoRef} autoPlay playsInline muted style={{ width: 120, position: 'absolute', bottom: 10, right: 10, borderRadius: 6, border: '2px solid var(--primary)', background: '#000', objectFit: 'cover' }} />
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
      <audio ref={remoteAudioRef} autoPlay />`);

fs.writeFileSync(file, lines.join('\n'));
console.log("UPDATED");
