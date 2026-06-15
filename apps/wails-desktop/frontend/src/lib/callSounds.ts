/**
 * Call sound effects using Web Audio API
 * - Ringtone: plays when receiving an incoming call
 * - Dial tone: plays when making an outgoing call (tuuut...tuuut)
 */

import { API_URL } from "./api";

const RINGTONE_SOURCE_KEY = "ringtone_source_url";
const RINGTONE_LABEL_KEY = "ringtone_source_label";
const DIAL_TONE_SOURCE_KEY = "dialtone_source_url";
const DIAL_TONE_LABEL_KEY = "dialtone_source_label";

export const DEFAULT_RINGTONE_URL = `${API_URL}/uploads/ringtones/ringtone.mp3`;
const DEFAULT_DIAL_TONE_LABEL = "Default dial tone";

let audioCtx: AudioContext | null = null;
let ringtoneInterval: ReturnType<typeof setInterval> | null = null;
let ringtoneAudio: HTMLAudioElement | null = null;
let dialToneInterval: ReturnType<typeof setInterval> | null = null;
let activeOscillator: OscillatorNode | null = null;
let activeGain: GainNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function resolveMediaUrl(sourceUrl: string) {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed, API_URL).toString();
  } catch {
    return trimmed;
  }
}

function playToneOnce(freq1: number, freq2: number, duration: number, volume = 0.15) {
  const ctx = getAudioContext();
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = "sine";
  osc1.frequency.value = freq1;
  osc2.type = "sine";
  osc2.frequency.value = freq2;

  gain.gain.value = volume;

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + duration);
  osc2.stop(now + duration);

  gain.gain.setValueAtTime(volume, now + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + duration);
}

function stopClassicRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}

function stopLoopingAudio() {
  if (ringtoneAudio) {
    try {
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
    } catch {
      // ignore stop failures
    }
    ringtoneAudio = null;
  }
}

function getStoredRingtoneUrl() {
  try {
    return resolveMediaUrl(localStorage.getItem(RINGTONE_SOURCE_KEY) ?? "") || DEFAULT_RINGTONE_URL;
  } catch {
    return DEFAULT_RINGTONE_URL;
  }
}

function playClassicRingtone() {
  stopRingtone();

  const playRing = () => {
    playToneOnce(440, 480, 0.4, 0.2);
    setTimeout(() => playToneOnce(440, 480, 0.4, 0.2), 500);
  };

  playRing();
  ringtoneInterval = setInterval(playRing, 3000);
}

function playLoopingAudio(sourceUrl: string, fallback: () => void) {
  stopClassicRingtone();
  stopLoopingAudio();

  const audio = new Audio(sourceUrl);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 1;
  ringtoneAudio = audio;

  void audio.play().catch(() => {
    ringtoneAudio = null;
    fallback();
  });
}

function playAudioRingtone(sourceUrl: string) {
  playLoopingAudio(sourceUrl, playClassicRingtone);
}

function playDialTonePattern() {
  stopDialTone();

  const playBeep = () => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 425;
    gain.gain.value = 0.12;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 1.0);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
    gain.gain.setValueAtTime(0.12, now + 0.9);
    gain.gain.linearRampToValueAtTime(0, now + 1.0);

    activeOscillator = osc;
    activeGain = gain;
  };

  playBeep();
  dialToneInterval = setInterval(playBeep, 4000);
}

export function setRingtoneSource(sourceUrl: string, label?: string) {
  const safeUrl = resolveMediaUrl(sourceUrl) || DEFAULT_RINGTONE_URL;
  try {
    localStorage.setItem(RINGTONE_SOURCE_KEY, safeUrl);
    if (label?.trim()) {
      localStorage.setItem(RINGTONE_LABEL_KEY, label.trim());
    } else {
      localStorage.removeItem(RINGTONE_LABEL_KEY);
    }
  } catch {
    // ignore storage failures
  }
  return safeUrl;
}

export function setDialToneSource(sourceUrl: string, label?: string) {
  const safeUrl = resolveMediaUrl(sourceUrl);
  try {
    if (safeUrl) {
      localStorage.setItem(DIAL_TONE_SOURCE_KEY, safeUrl);
    } else {
      localStorage.removeItem(DIAL_TONE_SOURCE_KEY);
    }
    if (label?.trim()) {
      localStorage.setItem(DIAL_TONE_LABEL_KEY, label.trim());
    } else {
      localStorage.removeItem(DIAL_TONE_LABEL_KEY);
    }
  } catch {
    // ignore storage failures
  }
  return safeUrl;
}

export function resetRingtoneSource() {
  try {
    localStorage.removeItem(RINGTONE_SOURCE_KEY);
    localStorage.removeItem(RINGTONE_LABEL_KEY);
  } catch {
    // ignore storage failures
  }
}

export function resetDialToneSource() {
  try {
    localStorage.removeItem(DIAL_TONE_SOURCE_KEY);
    localStorage.removeItem(DIAL_TONE_LABEL_KEY);
  } catch {
    // ignore storage failures
  }
}

export function getRingtoneSourceInfo() {
  const url = getStoredRingtoneUrl();
  let label = DEFAULT_RINGTONE_URL;
  try {
    label = localStorage.getItem(RINGTONE_LABEL_KEY)?.trim() || DEFAULT_RINGTONE_URL;
  } catch {
    label = DEFAULT_RINGTONE_URL;
  }
  return { url, label, isDefault: url === DEFAULT_RINGTONE_URL };
}

export function getDialToneSourceInfo() {
  let url = "";
  let label = DEFAULT_DIAL_TONE_LABEL;
  try {
    url = resolveMediaUrl(localStorage.getItem(DIAL_TONE_SOURCE_KEY) ?? "");
    label = localStorage.getItem(DIAL_TONE_LABEL_KEY)?.trim() || DEFAULT_DIAL_TONE_LABEL;
  } catch {
    url = "";
    label = DEFAULT_DIAL_TONE_LABEL;
  }
  return { url, label, isDefault: !url };
}

export function startRingtone(sourceUrl?: string) {
  stopRingtone();
  playAudioRingtone(sourceUrl?.trim() ? resolveMediaUrl(sourceUrl) : getStoredRingtoneUrl());
}

export function stopRingtone() {
  stopLoopingAudio();
  stopClassicRingtone();
}

export function startDialTone(sourceUrl?: string) {
  stopDialTone();

  const customSource = sourceUrl?.trim()
    ? resolveMediaUrl(sourceUrl)
    : resolveMediaUrl(localStorage.getItem(DIAL_TONE_SOURCE_KEY) ?? "");

  if (customSource) {
    playLoopingAudio(customSource, playDialTonePattern);
    return;
  }

  playDialTonePattern();
}

export function stopDialTone() {
  if (dialToneInterval) {
    clearInterval(dialToneInterval);
    dialToneInterval = null;
  }
  stopLoopingAudio();
  if (activeOscillator) {
    try {
      activeOscillator.stop();
    } catch {
      // already stopped
    }
    activeOscillator = null;
  }
  activeGain = null;
}

export function playEndCallSound() {
  const ctx = getAudioContext();

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.value = 480;
  gain1.gain.value = 0.15;
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  const now = ctx.currentTime;
  osc1.start(now);
  osc1.stop(now + 0.15);
  gain1.gain.setValueAtTime(0.15, now + 0.1);
  gain1.gain.linearRampToValueAtTime(0, now + 0.15);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.value = 350;
  gain2.gain.value = 0.15;
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.18);
  osc2.stop(now + 0.45);
  gain2.gain.setValueAtTime(0.15, now + 0.35);
  gain2.gain.linearRampToValueAtTime(0, now + 0.45);
}

export function playMessageSentSound() {
  const ctx = getAudioContext();

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  gain1.gain.value = 0.12;
  osc1.connect(gain1);
  gain1.connect(ctx.destination);

  const now = ctx.currentTime;
  osc1.frequency.setValueAtTime(300, now);
  osc1.frequency.linearRampToValueAtTime(500, now + 0.15);
  osc1.frequency.linearRampToValueAtTime(650, now + 0.35);

  osc1.start(now);
  osc1.stop(now + 0.4);

  gain1.gain.setValueAtTime(0.12, now);
  gain1.gain.setValueAtTime(0.12, now + 0.2);
  gain1.gain.linearRampToValueAtTime(0, now + 0.4);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "triangle";
  gain2.gain.value = 0.06;
  osc2.connect(gain2);
  gain2.connect(ctx.destination);

  osc2.frequency.setValueAtTime(450, now);
  osc2.frequency.linearRampToValueAtTime(700, now + 0.15);
  osc2.frequency.linearRampToValueAtTime(900, now + 0.35);

  osc2.start(now);
  osc2.stop(now + 0.4);

  gain2.gain.setValueAtTime(0.06, now);
  gain2.gain.setValueAtTime(0.06, now + 0.2);
  gain2.gain.linearRampToValueAtTime(0, now + 0.4);
}

export function stopAllCallSounds() {
  stopRingtone();
  stopDialTone();
}
