const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'App.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

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

// 1. Insert `micVolume` effects
insertAfter('const [speakerVolume, setSpeakerVolume] = useState<number>(1);', `
  useEffect(() => {
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = micVolume;
    }
  }, [micVolume]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.volume = speakerVolume;
    if (remoteVideoRef.current) remoteVideoRef.current.volume = speakerVolume;
  }, [speakerVolume]);
`);

// 2. Insert processMicStream before stopCall
insertAfter('const stopCall = useCallback((keepRemoteState = false) => {', `
  const processMicStream = (rawStream: MediaStream) => {
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
`);

// Move the processMicStream definition to be right above stopCall safely, no wait, the above inserted INSIDE stopCall. Let's fix that.
// Let's replace the whole block again in the string.
