import { MOVE_NAMES, type Move, type MoveKind } from "./dribble";
import { hudStore } from "./hudStore";

/** Scoring tuning. */
export const COMBO = {
  /** Base points per move: switch < crossover < between legs < behind back. */
  points: {
    pound: 0,
    high: 20,
    switch: 40,
    crossover: 100,
    between: 150,
    behind: 200,
  } satisfies Record<MoveKind, number>,
  /** Each straight repeat of the same move scores this much of the last one. */
  repeatFactor: 0.5,
  /** Early/late (sloppy) contact scores this fraction and does not grow the combo. */
  sloppyFactor: 0.5,
  /** No new move for this long and the combo cools off to zero. */
  timeout: 4,
};

export interface ComboSnapshot {
  score: number;
  best: number;
  /** Multiplier shown as ×N. */
  combo: number;
  /** Keys of the recent moves, oldest first. */
  chain: string[];
  lastMove: { kind: MoveKind; from: string; to: string; points: number; timing: string } | null;
  moves: number;
}

/**
 * Combo scoring: the multiplier climbs one step for every clean move that is
 * different from the last one (variety + rhythm); repeating the same move keeps
 * it but scores less each time; sloppy timing scores half; losing the ball or
 * going quiet resets it.
 */
export class ComboScorer {
  score = 0;
  best = 0;
  combo = 0;
  chain: string[] = [];
  lastMove: ComboSnapshot["lastMove"] = null;
  moves = 0;
  private repeats = 0;
  private lastKind: MoveKind | null = null;
  private lastAt = -Infinity;
  private calloutId = 0;

  onMove(move: Move, now: number) {
    if (move.kind === "pound") return; // plain dribbles keep the rhythm, nothing more
    const base = COMBO.points[move.kind];
    let points: number;
    if (move.timing === "sloppy") {
      points = base * Math.max(1, this.combo) * COMBO.sloppyFactor;
    } else if (move.kind === this.lastKind) {
      this.repeats++;
      points = base * Math.max(1, this.combo) * Math.pow(COMBO.repeatFactor, this.repeats);
    } else {
      this.combo++;
      this.repeats = 0;
      points = base * this.combo;
    }
    points = Math.round(points);
    this.lastKind = move.kind;
    this.lastAt = now;
    this.moves++;
    this.score += points;
    this.best = Math.max(this.best, this.score);
    this.chain = [...this.chain, ...move.keys].slice(-8);
    this.lastMove = { kind: move.kind, from: move.from, to: move.to, points, timing: move.timing };
    this.publish({ text: MOVE_NAMES[move.kind], points, tone: move.timing === "clean" ? "move" : "sloppy" });
  }

  onLost() {
    this.combo = 0;
    this.repeats = 0;
    this.lastKind = null;
    this.chain = [];
    this.publish({ text: "LOOSE BALL!!", points: 0, tone: "lost" });
  }

  update(now: number) {
    if (this.combo > 0 && now - this.lastAt > COMBO.timeout) {
      this.combo = 0;
      this.repeats = 0;
      this.lastKind = null;
      this.chain = [];
      this.publish(null);
    }
  }

  snapshot(): ComboSnapshot {
    return {
      score: this.score,
      best: this.best,
      combo: this.combo,
      chain: [...this.chain],
      lastMove: this.lastMove,
      moves: this.moves,
    };
  }

  private publish(callout: { text: string; points: number; tone: "move" | "sloppy" | "lost" } | null) {
    hudStore.set({
      score: this.score,
      best: this.best,
      combo: this.combo,
      chain: this.chain,
      ...(callout ? { callout: { ...callout, id: ++this.calloutId } } : {}),
    });
  }
}
