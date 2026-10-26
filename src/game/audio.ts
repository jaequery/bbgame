// Generated sound: everything is synthesised with WebAudio at runtime, no
// recorded assets. Browsers only start audio after a user gesture, so the
// context is created on the first key press (`unlock`).

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    // One second of white noise, reused for every thump's slap.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Ball on hardwood: a pitched-down body thump plus a short slap; louder and brighter with `speed` (m/s). */
export function playBounce(speed: number) {
  if (!ctx || !noise || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const k = Math.min(1, speed / 6);
  const out = ctx.createGain();
  out.gain.value = 0.15 + 0.6 * k;
  out.connect(ctx.destination);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(150 + 40 * k, t);
  body.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(1, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  body.connect(bodyGain).connect(out);
  body.start(t);
  body.stop(t + 0.2);

  const slap = ctx.createBufferSource();
  slap.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900 + 1800 * k;
  const slapGain = ctx.createGain();
  slapGain.gain.setValueAtTime(0.5, t);
  slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  slap.connect(lp).connect(slapGain).connect(out);
  slap.start(t, Math.random() * 0.9, 0.06);
}

/** Sneaker squeak on a hard cut: a rubbery chirp sweeping up. */
export function playSqueak(speed: number) {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const dur = 0.11 + Math.random() * 0.05;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const f0 = 1900 + Math.random() * 500;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f0 * 1.45, t + dur * 0.6);
  osc.frequency.linearRampToValueAtTime(f0 * 1.25, t + dur);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2800;
  bp.Q.value = 6;
  const g = ctx.createGain();
  const vol = 0.05 + 0.06 * Math.min(1, speed / 5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(bp).connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function disposeAudio() {
  void ctx?.close();
  ctx = null;
  noise = null;
}
