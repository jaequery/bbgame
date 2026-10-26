// Tiny external store shared by the three.js loop and the React HUD.
// The dribble/combo code writes score, combo, chain, callouts and SFX pops here.

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
  tone: "move" | "sloppy" | "lost";
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
}

let state: HudState = { score: 0, best: 0, combo: 0, chain: [], view: "B", callout: null, sfx: null };
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
