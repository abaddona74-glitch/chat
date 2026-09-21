import { useRef, useState, useEffect } from "react";

/** Custom Video Player component */
export function VideoMessagePlayer({
  src,
  fileName,
  isMine,
}: {
  src: string;
  fileName?: string | null;
  isMine?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState(1);
  const animRef = useRef<number>(0);
  const hideTimerRef = useRef<number>(0);

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (isFullscreen && isPlaying) {
      hideTimerRef.current = window.setTimeout(
        () => setShowControls(false),
        3000,
      );
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      cancelAnimationFrame(animRef.current);
      setIsPlaying(false);
    } else {
      v.play();
      setIsPlaying(true);
      const tick = () => {
        if (v.duration) {
          setProgress(v.currentTime / v.duration);
          setCurrentTime(v.currentTime);
        }
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
    setCurrentTime(v.currentTime);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return (
    <div
      className={`video-player${isMine ? " mine" : ""}${isFullscreen ? " fullscreen" : ""}`}
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => {
        if (isFullscreen && isPlaying) setShowControls(false);
      }}
    >
      <div className="video-container" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={() => {
            if (videoRef.current) setDuration(videoRef.current.duration);
          }}
          onEnded={() => {
            cancelAnimationFrame(animRef.current);
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
          }}
        />
        {!isPlaying && (
          <div className="video-play-overlay">
            <div className="video-play-circle">▶</div>
          </div>
        )}
      </div>
      {
        <div
          className={`video-controls${!showControls && isFullscreen ? " hidden" : ""}`}
        >
          <button className="video-ctrl-btn" onClick={togglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <div className="video-progress-bar" onClick={handleSeek}>
            <div
              className="video-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="video-time">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <button
            className="video-ctrl-btn"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.volume > 0) {
                v.volume = 0;
                setVolume(0);
              } else {
                v.volume = 1;
                setVolume(1);
              }
            }}
            title="Volume"
          >
            {volume > 0 ? "🔊" : "🔇"}
          </button>
          <input
            type="range"
            className="video-volume-slider"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (videoRef.current) videoRef.current.volume = v;
            }}
          />
          <button
            className="video-ctrl-btn video-fullscreen-btn"
            onClick={toggleFullscreen}
            title="Fullscreen"
          >
            {isFullscreen ? "⛶" : "⛶"}
          </button>
        </div>
      }
      {fileName && <div className="video-filename">{fileName}</div>}
    </div>
  );
}
