const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'App.tsx');
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('micGainNodeRef.current.gain.value = micVolume')) {
    // Add volume effect
    content = content.replace(
        '  // ── GROUP STATE ──',
        `  useEffect(() => {
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = micVolume;
    }
  }, [micVolume]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.volume = speakerVolume;
    if (remoteVideoRef.current) remoteVideoRef.current.volume = speakerVolume;
  }, [speakerVolume]);

  // ── GROUP STATE ──`
    );
}

if (!content.includes('const processMicStream =')) {
    content = content.replace(
        '  const stopCall = useCallback((keepRemoteState = false) => {',
        `  const processMicStream = (rawStream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!micAudioContextRef.current) {
        micAudioContextRef.current = new AudioCtx();
      }
      const ctx = micAudioContextRef.current;
      const source = ctx.createMediaStreamSource(rawStream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = micVolume;
      micGainNodeRef.current = gainNode;
      source.connect(gainNode);
      const dest = ctx.createMediaStreamDestination();
      gainNode.connect(dest);
      return dest.stream;
    } catch(err) {
      console.warn("AudioContext setup failed:", err);
      return rawStream;
    }
  };

  const stopCall = useCallback((keepRemoteState = false) => {`
    );
}

content = content.replace(
    '    setIsScreenSharing(false);',
    `    setIsScreenSharing(false);\n    if (micAudioContextRef.current) {\n      micAudioContextRef.current.close().catch(() => {});\n      micAudioContextRef.current = null;\n      micGainNodeRef.current = null;\n    }`
);

// startCall replace
content = content.replace(
    `localCallStreamRef.current = stream;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));`,
    `localCallStreamRef.current = stream;
      const processedStream = processMicStream(stream);
      processedStream.getTracks().forEach((track) => peer.addTrack(track, processedStream));`
);

// acceptCall replace
content = content.replace(
    `localCallStreamRef.current = stream;

      const peer = await setupPeerConnection(incomingCall.fromUserId);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));`,
    `localCallStreamRef.current = stream;

      const peer = await setupPeerConnection(incomingCall.fromUserId);
      const processedStream = processMicStream(stream);
      processedStream.getTracks().forEach((track) => peer.addTrack(track, processedStream));`
);

// group call replace
content = content.replace(
    `localCallStreamRef.current = stream;
                stream.getTracks().forEach((t) => peer.addTrack(t, stream));`,
    `localCallStreamRef.current = stream;
                const processedStream = processMicStream(stream);
                processedStream.getTracks().forEach((t) => peer.addTrack(t, processedStream));`
);

// inject UI controls for sliders in device-settings-dropdown
content = content.replace(
    `              <div className="device-select-group">
                <label>Dinamik (chiqish):</label>
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => setSelectedAudioOutput(e.target.value)}
                >
                  {audioOutputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || \`Dinamik \${d.deviceId.slice(0, 8)}\`}
                    </option>
                  ))}
                </select>
              </div>`,
    `              <div className="device-select-group">
                <label>Dinamik (chiqish):</label>
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => setSelectedAudioOutput(e.target.value)}
                >
                  {audioOutputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || \`Dinamik \${d.deviceId.slice(0, 8)}\`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="device-select-group">
                <label>Mikrofon ovozi: {Math.round(micVolume * 100)}%</label>
                <input type="range" min="0" max="2" step="0.1" value={micVolume} onChange={(e) => setMicVolume(parseFloat(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div className="device-select-group">
                <label>Dinamik ovozi (Suhbatdosh): {Math.round(speakerVolume * 100)}%</label>
                <input type="range" min="0" max="1" step="0.05" value={speakerVolume} onChange={(e) => setSpeakerVolume(parseFloat(e.target.value))} style={{ width: '100%' }} />
              </div>`
);


fs.writeFileSync(file, content);
console.log("Updated App.tsx with sliders.");
