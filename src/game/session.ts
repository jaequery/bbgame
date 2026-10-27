// Timed Session vs Free Practice. The clock runs on the game's sim time (so
// `setTimeScale` freezes it too); the React screens start and quit runs through
// `runControl`, which `createGame` binds. No three.js here — the screens import it.

import type { Move, MoveKind } from "./dribble";
import { RUNS } from "@/lib/runs";

export type PlayMode = "session" | "practice";

/** What the results screen shows when the buzzer goes. */
export interface SessionResult {
  score: number;
  bestCombo: number;
  moves: number;
  moveCounts: Partial<Record<MoveKind, number>>;
}

export class SessionClock {
  mode: PlayMode | null = null;
  endsAt = 0;
  bestCombo = 0;
  moves = 0;
  moveCounts: Partial<Record<MoveKind, number>> = {};

  start(mode: PlayMode, now: number) {
    this.mode = mode;
    this.endsAt = now + RUNS.sessionSeconds;
    this.bestCombo = 0;
    this.moves = 0;
    this.moveCounts = {};
  }

  /** Seconds left in a Session; null in practice or between runs. */
  timeLeft(now: number): number | null {
    return this.mode === "session" ? Math.max(0, this.endsAt - now) : null;
  }

  onMove(move: Move) {
    if (!this.mode || move.kind === "pound") return;
    this.moves++;
    this.moveCounts[move.kind] = (this.moveCounts[move.kind] ?? 0) + 1;
  }

  onCombo(combo: number) {
    if (this.mode) this.bestCombo = Math.max(this.bestCombo, combo);
  }

  /** Stops the run; returns the result if it was a Session. */
  finish(score: number): SessionResult | null {
    const result =
      this.mode === "session"
        ? { score, bestCombo: this.bestCombo, moves: this.moves, moveCounts: { ...this.moveCounts } }
        : null;
    this.mode = null;
    return result;
  }
}

interface RunHandlers {
  start(mode: PlayMode): void;
  quit(): void;
}

let handlers: RunHandlers | null = null;

/** Screens → game loop. A no-op until the game has mounted. */
export const runControl = {
  bind(h: RunHandlers) {
    handlers = h;
    return () => {
      if (handlers === h) handlers = null;
    };
  },
  start: (mode: PlayMode) => handlers?.start(mode),
  quit: () => handlers?.quit(),
};
