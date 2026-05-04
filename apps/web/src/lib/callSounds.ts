/**
 * Call sound effects using Web Audio API
 * - Ringtone: plays when receiving an incoming call
 * - Dial tone: plays when making an outgoing call (tuuut...tuuut)
 */

let audioCtx: AudioContext | null = null;
let ringtoneInterval: ReturnType<typeof setInterval> | null = null;
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

  // Fade out to avoid click
  gain.gain.setValueAtTime(volume, now + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + duration);
}

/**
 * Play ringtone pattern: two-tone ring (like a phone ringing)
 * Pattern: ring 1s, pause 2s, repeat
 */
export function startRingtone() {
  stopRingtone();

  const playRing = () => {
    // Classic ring: alternating 440Hz and 480Hz
    playToneOnce(440, 480, 0.4, 0.2);
    setTimeout(() => playToneOnce(440, 480, 0.4, 0.2), 500);
  };

  playRing();
  ringtoneInterval = setInterval(playRing, 3000);
}

export function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}

/**
 * Play dial tone pattern: tuuut...tuuut (outgoing call waiting)
 * Pattern: 425Hz tone for 1s, pause 3s, repeat
 */
export function startDialTone() {
  stopDialTone();

  const playBeep = () => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 425; // Standard European dial tone
    gain.gain.value = 0.12;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 1.0);

    // Fade in/out
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

export function stopDialTone() {
  if (dialToneInterval) {
    clearInterval(dialToneInterval);
    dialToneInterval = null;
  }
  if (activeOscillator) {
    try { activeOscillator.stop(); } catch { /* already stopped */ }
    activeOscillator = null;
  }
  activeGain = null;
}

/**
 * Play a short "end call" beep sound (descending two-tone)
 */
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

/** Stop all call sounds */
export function stopAllCallSounds() {
  stopRingtone();
  stopDialTone();
}

/**
 * Play a "message sent" sound — deeper frequency sweep with dual oscillator
 * Lower frequency sweep with longer sustain for a richer tone
 */
export function playMessageSentSound() {
  const ctx = getAudioContext();

  // Main tone - deeper sweep
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  gain1.gain.value = 0.12;
  osc1.connect(gain1);
  gain1.connect(ctx.destination);

  const now = ctx.currentTime;
  // Deeper ascending sweep: 300Hz → 500Hz → 650Hz over 0.35s
  osc1.frequency.setValueAtTime(300, now);
  osc1.frequency.linearRampToValueAtTime(500, now + 0.15);
  osc1.frequency.linearRampToValueAtTime(650, now + 0.35);

  osc1.start(now);
  osc1.stop(now + 0.4);

  // Smooth fade out
  gain1.gain.setValueAtTime(0.12, now);
  gain1.gain.setValueAtTime(0.12, now + 0.2);
  gain1.gain.linearRampToValueAtTime(0, now + 0.4);

  // Harmonic overtone for richness
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
