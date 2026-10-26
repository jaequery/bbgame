// Tiny external store shared by the three.js loop and the React HUD.
// The dribble/combo/shot code writes score, combo, chain, callouts, SFX pops and the shot meter here.

export type ViewId = "A" | "B" | "C";

export const VIEW_ORDER: ViewId[] = ["B", "A", "C"];

export const VIEW_LABELS: Record<ViewId, string> = {
  A: "Isometric",
  B: "Behind",
  C: "Broadcast",
};

/** A manga callout naming the move ("CROSSOVER!!"); `id` restarts its animation. */
export interface Callout {
  id: number;
  text: string;
  points: number;
  tone: "move" | "sloppy" | "lost" | "shot" | "miss";
  /** Second line, e.g. the combo cash-in "COMBO 700 ×2". */
  detail?: string;
}

/** The manga shot meter next to the player while a jumper is up. */
export interface ShotMeter {
  /** 0…1 through the jump (0.5 = apex). */
  fill: number;
  /** Perfect-release band (0…1). */
  zone: [number, number];
  grade: "perfect" | "early" | "late" | null;
  /** Screen position (0…1 of the viewport) beside the player. */
  x: number;
  y: number;
}

/** A katakana SFX pop at a screen position (0…1 of the viewport). */
export interface SfxPop {
  id: number;
  text: string;
  x: number;
  y: number;
  /** 0…1 — how hard the hit was. */
  strength: number;
}

export interface HudState {
  score: number;
  best: number;
  combo: number;
  chain: string[];
  view: ViewId;
  callout: Callout | null;
  sfx: SfxPop | null;
  meter: ShotMeter | null;
}

let state: HudState = { score: 0, best: 0, combo: 0, chain: [], view: "B", callout: null, sfx: null, meter: null };
const listeners = new Set<() => void>();

export const hudStore = {
  getSnapshot: (): HudState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(patch: Partial<HudState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
};
