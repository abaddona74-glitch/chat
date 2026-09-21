import { useRef, useState, useEffect } from "react";
import {
  useMusicPlaybackState,
  sendMusicCommand,
} from "./MusicMessagePlayer";

/** Voice message player with waveform visualisation — uses global audio engine */
export function AudioWaveformPlayer({
  src,
  durationSec,
  isMine,
  messageId,
  voiceQueue,
}: {
  src: string;
  durationSec?: number | null;
  isMine?: boolean;
  messageId: string;
  voiceQueue?: { id: string; src: string; durationSec?: number | null }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const playback = useMusicPlaybackState();

  const isActiveTrack = playback.track?.src === src;
  const isPlaying = isActiveTrack && playback.isPlaying;
  const progress = isActiveTrack ? playback.progress : 0;
  const currentTime = isActiveTrack ? playback.currentTime : 0;

  // Decode audio and generate waveform data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(src);
        const buffer = await resp.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buffer);
        const raw = decoded.getChannelData(0);
        const bars = 48;
        const step = Math.floor(raw.length / bars);
        const peaks: number[] = [];
        for (let i = 0; i < bars; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) {
            const abs = Math.abs(raw[i * step + j]);
            if (abs > max) max = abs;
          }
          peaks.push(max);
        }
        const peakMax = Math.max(...peaks, 0.01);
        if (!cancelled) setWaveformData(peaks.map((p) => p / peakMax));
        ctx.close();
      } catch {
        if (!cancelled)
          setWaveformData(
            Array.from({ length: 48 }, () => 0.2 + Math.random() * 0.6),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const barW = Math.max(2, w / waveformData.length - 1.5);
    const gap =
      (w - barW * waveformData.length) / (waveformData.length - 1 || 1);
    const progressBars = Math.floor(progress * waveformData.length);

    const playedColor = isMine ? "#ffffff" : "#0e7c66";
    const unplayedColor = isMine
      ? "rgba(255,255,255,0.35)"
      : "rgba(14,124,102,0.3)";

    for (let i = 0; i < waveformData.length; i++) {
      const barH = Math.max(3, waveformData[i] * (h - 4));
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      ctx.fillStyle = i < progressBars ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      ctx.fill();
    }
  }, [waveformData, progress, isMine]);

  const togglePlay = () => {
    const queueIndex =
      voiceQueue?.findIndex((item) => item.id === messageId) ?? -1;
    sendMusicCommand({
      type: "toggle",
      track: {
        src,
        fileName: "voice",
        artist: "",
        title: "Voice message",
        isVoice: true,
        durationHintSec: durationSec ?? undefined,
        voiceQueue:
          queueIndex >= 0 && voiceQueue
            ? { items: voiceQueue, index: queueIndex }
            : undefined,
      },
    });
  };

  const dur = durationSec ?? 0;
  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className={`voice-waveform-player${isMine ? " mine" : ""}`}>
      <button className="wave-play-btn" onClick={togglePlay}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <canvas ref={canvasRef} className="wave-canvas" />
      <span className="wave-time">
        {isPlaying ? fmtTime(Math.floor(currentTime)) : fmtTime(dur)}
      </span>
    </div>
  );
}
