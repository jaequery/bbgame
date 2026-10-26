// Tiny external store shared by the three.js loop and the React HUD.
// Later tickets (dribbling, jumper, sessions) write score/combo/chain here.

export type ViewId = "A" | "B" | "C";

export const VIEW_ORDER: ViewId[] = ["B", "A", "C"];

export const VIEW_LABELS: Record<ViewId, string> = {
  A: "Isometric",
  B: "Behind",
  C: "Broadcast",
};

export interface HudState {
  score: number;
  best: number;
  combo: number;
  chain: string[];
  view: ViewId;
}

let state: HudState = { score: 0, best: 0, combo: 0, chain: [], view: "B" };
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
