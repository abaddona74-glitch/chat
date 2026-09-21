import { useState, useEffect, useMemo, useCallback, useRef } from "react";

export type MusicTrack = {
  src: string;
  fileName: string;
  artist: string;
  title: string;
  isVoice?: boolean;
  durationHintSec?: number;
  voiceQueue?: {
    items: { id: string; src: string; durationSec?: number | null }[];
    index: number;
  };
};

export type MusicPlaybackState = {
  track: MusicTrack | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
};

export type MusicCommand =
  | { type: "play"; track: MusicTrack }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggle"; track: MusicTrack }
  | { type: "seek"; ratio: number }
  | { type: "seekRelative"; delta: number }
  | { type: "setVolume"; volume: number }
  | { type: "setRepeat"; repeat: boolean }
  | { type: "stop" };

const musicStateListeners: Set<(state: MusicPlaybackState) => void> = new Set();
const musicCommandListeners: Set<(cmd: MusicCommand) => void> = new Set();

let globalMusicState: MusicPlaybackState = {
  track: null,
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 0,
};

export function emitMusicState(state: MusicPlaybackState) {
  globalMusicState = state;
  musicStateListeners.forEach((fn) => fn(state));
}

export function sendMusicCommand(cmd: MusicCommand) {
  musicCommandListeners.forEach((fn) => fn(cmd));
}

export function useMusicPlaybackState() {
  const [state, setState] = useState<MusicPlaybackState>(globalMusicState);
  useEffect(() => {
    const handler = (s: MusicPlaybackState) => setState(s);
    musicStateListeners.add(handler);
    return () => {
      musicStateListeners.delete(handler);
    };
  }, []);
  return state;
}

export function getEffectiveDuration(mediaDuration: number, hintDuration?: number) {
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
    return mediaDuration;
  }
  if (Number.isFinite(hintDuration) && (hintDuration ?? 0) > 0) {
    return hintDuration as number;
  }
  return 0;
}

/** Extract music title from filename */
export function extractMusicTitle(fileName: string | null | undefined): {
  artist: string;
  title: string;
} {
  if (!fileName) return { artist: "Unknown", title: "Unknown" };
  const name = fileName.replace(/\.[^.]+$/, "");
  const separators = [" – ", " - ", " — "];
  for (const sep of separators) {
    const idx = name.indexOf(sep);
    if (idx > 0) {
      return {
        artist: name.slice(0, idx).trim(),
        title: name.slice(idx + sep.length).trim(),
      };
    }
  }
  return { artist: "", title: name };
}

/** Telegram-style Music Player in message bubble (UI only — no <audio>) */
export function MusicMessagePlayer({
  src,
  fileName,
  isMine,
}: {
  src: string;
  fileName?: string | null;
  isMine?: boolean;
}) {
  const { artist, title } = useMemo(
    () => extractMusicTitle(fileName),
    [fileName],
  );
  const playback = useMusicPlaybackState();

  const isActiveTrack = playback.track?.src === src;
  const isPlaying = isActiveTrack && playback.isPlaying;
  const progress = isActiveTrack ? playback.progress : 0;
  const currentTime = isActiveTrack ? playback.currentTime : 0;
  const duration = isActiveTrack ? playback.duration : 0;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const togglePlay = () => {
    sendMusicCommand({
      type: "toggle",
      track: { src, fileName: fileName ?? "", artist, title },
    });
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActiveTrack) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    sendMusicCommand({ type: "seek", ratio });
  };

  return (
    <div className={`music-player${isMine ? " mine" : ""}`}>
      <button className="music-play-btn" onClick={togglePlay}>
        {isPlaying ? "⏸" : "▶"}
      </button>
      <div className="music-info">
        <div className="music-title">{title || fileName}</div>
        {artist && <div className="music-artist">{artist}</div>}
        <div className="music-progress-row">
          <div className="music-progress-bar" onClick={handleSeek}>
            <div
              className="music-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="music-time">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
        </div>
      </div>
      <div className="music-icon">🎵</div>
    </div>
  );
}

/** Global Music Controller Bar (top of screen) — owns the single <audio> element */
export function GlobalMusicController() {
  const playback = useMusicPlaybackState();
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animRef = useRef<number>(0);
  const currentSrcRef = useRef<string>("");

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const startProgressLoop = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const effectiveDuration = getEffectiveDuration(
          a.duration,
          globalMusicState.track?.durationHintSec,
        );
        emitMusicState({
          ...globalMusicState,
          isPlaying: !a.paused,
          progress:
            effectiveDuration > 0
              ? Math.max(0, Math.min(1, a.currentTime / effectiveDuration))
              : 0,
          currentTime: a.currentTime,
          duration: effectiveDuration,
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const handler = (cmd: MusicCommand) => {
      const a = audioRef.current;
      if (!a) return;

      switch (cmd.type) {
        case "play": {
          if (currentSrcRef.current !== cmd.track.src) {
            a.src = cmd.track.src;
            a.load();
            currentSrcRef.current = cmd.track.src;
          }
          a.volume = volume;
          a.play()
            .then(() => {
              const effectiveDuration = getEffectiveDuration(
                a.duration,
                cmd.track.durationHintSec,
              );
              emitMusicState({
                track: cmd.track,
                isPlaying: true,
                progress: 0,
                currentTime: 0,
                duration: effectiveDuration,
              });
              startProgressLoop();
            })
            .catch(() => {});
          break;
        }
        case "pause": {
          a.pause();
          cancelAnimationFrame(animRef.current);
          emitMusicState({ ...globalMusicState, isPlaying: false });
          break;
        }
        case "resume": {
          a.play()
            .then(() => {
              emitMusicState({ ...globalMusicState, isPlaying: true });
              startProgressLoop();
            })
            .catch(() => {});
          break;
        }
        case "toggle": {
          const isCurrentTrack = globalMusicState.track?.src === cmd.track.src;
          if (isCurrentTrack && globalMusicState.isPlaying) {
            a.pause();
            cancelAnimationFrame(animRef.current);
            emitMusicState({ ...globalMusicState, isPlaying: false });
          } else if (isCurrentTrack && !globalMusicState.isPlaying) {
            a.play()
              .then(() => {
                emitMusicState({ ...globalMusicState, isPlaying: true });
                startProgressLoop();
              })
              .catch(() => {});
          } else {
            a.src = cmd.track.src;
            a.load();
            currentSrcRef.current = cmd.track.src;
            a.volume = volume;
            a.play()
              .then(() => {
                const effectiveDuration = getEffectiveDuration(
                  a.duration,
                  cmd.track.durationHintSec,
                );
                emitMusicState({
                  track: cmd.track,
                  isPlaying: true,
                  progress: 0,
                  currentTime: 0,
                  duration: effectiveDuration,
                });
                startProgressLoop();
              })
              .catch(() => {});
          }
          break;
        }
        case "seek": {
          if (a.duration) {
            a.currentTime = cmd.ratio * a.duration;
            emitMusicState({
              ...globalMusicState,
              progress: cmd.ratio,
              currentTime: a.currentTime,
            });
          }
          break;
        }
        case "seekRelative": {
          a.currentTime = Math.max(
            0,
            Math.min(a.duration || 0, a.currentTime + cmd.delta),
          );
          break;
        }
        case "setVolume": {
          a.volume = cmd.volume;
          break;
        }
        case "setRepeat": {
          a.loop = cmd.repeat;
          break;
        }
        case "stop": {
          a.pause();
          a.src = "";
          currentSrcRef.current = "";
          cancelAnimationFrame(animRef.current);
          emitMusicState({
            track: null,
            isPlaying: false,
            progress: 0,
            currentTime: 0,
            duration: 0,
          });
          break;
        }
      }
    };

    musicCommandListeners.add(handler);
    return () => {
      musicCommandListeners.delete(handler);
    };
  }, [volume, startProgressLoop]);

  const handleEnded = useCallback(() => {
    if (!repeat) {
      cancelAnimationFrame(animRef.current);
      emitMusicState({
        track: null,
        isPlaying: false,
        progress: 0,
        currentTime: 0,
        duration: 0,
      });
    }
  }, [repeat]);

  const track = playback.track;

  const togglePlay = () => {
    if (playback.isPlaying) {
      sendMusicCommand({ type: "pause" });
    } else {
      sendMusicCommand({ type: "resume" });
    }
  };

  const playVoiceFromQueue = useCallback((dir: -1 | 1) => {
    const t = globalMusicState.track;
    const queue = t?.voiceQueue;
    if (!t?.isVoice || !queue || queue.items.length === 0) {
      sendMusicCommand({ type: "seekRelative", delta: dir === -1 ? -10 : 10 });
      return;
    }

    const nextIndex = queue.index + dir;
    if (nextIndex < 0 || nextIndex >= queue.items.length) {
      return;
    }

    const nextItem = queue.items[nextIndex];
    sendMusicCommand({
      type: "play",
      track: {
        src: nextItem.src,
        fileName: "voice",
        artist: "",
        title: "Voice message",
        isVoice: true,
        durationHintSec: nextItem.durationSec ?? undefined,
        voiceQueue: {
          items: queue.items,
          index: nextIndex,
        },
      },
    });
  }, []);

  const seekBackward = () => playVoiceFromQueue(-1);
  const seekForward = () => playVoiceFromQueue(1);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    sendMusicCommand({ type: "setVolume", volume: v });
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    sendMusicCommand({ type: "seek", ratio });
  };

  const close = () => sendMusicCommand({ type: "stop" });

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={() => {
          const a = audioRef.current;
          if (a) {
            emitMusicState({
              ...globalMusicState,
              duration: getEffectiveDuration(
                a.duration,
                globalMusicState.track?.durationHintSec,
              ),
            });
          }
        }}
        onEnded={handleEnded}
        style={{ display: "none" }}
      />
      {track && (
        <div className="global-music-bar">
          <div className="gmb-controls">
            <button
              className="gmb-btn"
              onClick={seekBackward}
              title="10s orqaga"
            >
              ⏪
            </button>
            <button className="gmb-btn gmb-play" onClick={togglePlay}>
              {playback.isPlaying ? "⏸" : "▶"}
            </button>
            <button
              className="gmb-btn"
              onClick={seekForward}
              title="10s oldinga"
            >
              ⏩
            </button>
          </div>
          <div className="gmb-info">
            <span className="gmb-title">
              {track.isVoice
                ? "🎙️ Voice message"
                : track.artist
                  ? `${track.artist} – ${track.title}`
                  : track.title}
            </span>
            <span className="gmb-time">{fmtTime(playback.currentTime)}</span>
          </div>
          <div className="gmb-progress" onClick={handleSeek}>
            <div
              className="gmb-progress-fill"
              style={{ width: `${playback.progress * 100}%` }}
            />
          </div>
          <div className="gmb-right">
            <button
              className="gmb-btn"
              onClick={() => {
                if (volume > 0) {
                  setPrevVolume(volume);
                  setVolume(0);
                  sendMusicCommand({ type: "setVolume", volume: 0 });
                } else {
                  const restore = prevVolume > 0 ? prevVolume : 1;
                  setVolume(restore);
                  sendMusicCommand({ type: "setVolume", volume: restore });
                }
              }}
              title="Volume"
            >
              {volume > 0 ? "🔊" : "🔇"}
            </button>
            <input
              type="range"
              className="gmb-volume"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
            />
            <button
              className={`gmb-btn${repeat ? " active" : ""}`}
              onClick={() => {
                const next = !repeat;
                setRepeat(next);
                sendMusicCommand({ type: "setRepeat", repeat: next });
              }}
              title="Repeat"
            >
              🔁
            </button>
            <button className="gmb-btn gmb-close" onClick={close} title="Close">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
