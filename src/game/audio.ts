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

/** The hand slapping the ball on a dribble key press: a short, punchy snap, higher for the fancier path keys. */
export function playPress(key: string) {
  if (!ctx || !noise || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const path = key === "I" || key === "K" || key === "," || key === "U" || key === "O";
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);

  const snap = ctx.createBufferSource();
  snap.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = path ? 3200 : 2000;
  bp.Q.value = 1.2;
  const snapGain = ctx.createGain();
  snapGain.gain.setValueAtTime(0.9, t);
  snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  snap.connect(bp).connect(snapGain).connect(out);
  snap.start(t, Math.random() * 0.9, 0.08);

  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(path ? 520 : 340, t);
  tone.frequency.exponentialRampToValueAtTime(path ? 180 : 120, t + 0.09);
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0.5, t);
  toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  tone.connect(toneGain).connect(out);
  tone.start(t);
  tone.stop(t + 0.12);
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

/** Gym scoreboard buzzer: a nasal square-wave honk. */
export function playBuzzer() {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.02);
  g.gain.setValueAtTime(0.18, t + 0.85);
  g.gain.linearRampToValueAtTime(0, t + 0.95);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  lp.connect(g).connect(ctx.destination);
  for (const f of [196, 247]) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f;
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + 1);
  }
}

/** Ball through the net: a soft brushed-noise "shhk" sweeping down. */
export function playSwish() {
  if (!ctx || !noise || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(1800, t + 0.32);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.45, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t, Math.random() * 0.5, 0.4);
}

/** Ball on the iron: inharmonic metallic partials ringing out over a click. */
export function playRim(speed: number) {
  if (!ctx || !noise || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const k = Math.min(1, speed / 7);
  const out = ctx.createGain();
  out.gain.value = 0.08 + 0.32 * k;
  out.connect(ctx.destination);
  for (const [f, decay, level] of [
    [612, 0.5, 1],
    [1453, 0.32, 0.6],
    [2387, 0.2, 0.45],
    [3311, 0.12, 0.3],
  ]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = f * (0.98 + Math.random() * 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }
  const click = ctx.createBufferSource();
  click.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.6, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  click.connect(hp).connect(cg).connect(out);
  click.start(t, Math.random() * 0.9, 0.04);
}

/** Ball off the glass: a dull low thud with a hollow box resonance. */
export function playBoard(speed: number) {
  if (!ctx || !noise || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const k = Math.min(1, speed / 7);
  const out = ctx.createGain();
  out.gain.value = 0.2 + 0.55 * k;
  out.connect(ctx.destination);
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(130, t);
  body.frequency.exponentialRampToValueAtTime(70, t + 0.15);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(1, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  body.connect(bg).connect(out);
  body.start(t);
  body.stop(t + 0.25);
  const knock = ctx.createBufferSource();
  knock.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 420;
  bp.Q.value = 3;
  const kg = ctx.createGain();
  kg.gain.setValueAtTime(0.9, t);
  kg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  knock.connect(bp).connect(kg).connect(out);
  knock.start(t, Math.random() * 0.8, 0.14);
}

export function disposeAudio() {
  void ctx?.close();
  ctx = null;
  noise = null;
}
