import { MOVE_NAMES, type Move, type MoveKind } from "./dribble";
import { hudStore, type Callout } from "./hudStore";
import type { ShotKind, ShotResult } from "./shot";

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
  /** Made jumper: base points, and what the combo's points are multiplied by when it cashes in. */
  shot: { two: 200, three: 300, cashTwo: 2, cashThree: 3 },
};

export const SHOT_CALLOUTS: Record<ShotKind, string> = {
  swish: "SWISH!!",
  bank: "BANK!!",
  rim: "IN!!",
  "rim-out": "RIM OUT…",
  board: "OFF THE BOARD…",
  airball: "AIRBALL…",
};

export interface ComboSnapshot {
  score: number;
  best: number;
  /** Multiplier shown as ×N. */
  combo: number;
  /** Keys of the recent moves, oldest first. */
  chain: string[];
  /** Points the moves of the current combo have scored — what a made jumper cashes in. */
  comboPoints: number;
  lastMove: { kind: MoveKind; from: string; to: string; points: number; timing: string } | null;
  moves: number;
  lastShot: { made: boolean; kind: ShotKind; three: boolean; base: number; cashed: number; multiplier: number; points: number } | null;
}

/**
 * Combo scoring: the multiplier climbs one step for every clean move that is
 * different from the last one (variety + rhythm); repeating the same move keeps
 * it but scores less each time; sloppy timing scores half; losing the ball or
 * going quiet resets it. A made jumper cashes the combo in (its points × 2,
 * × 3 from beyond the arc); any shot ends the combo.
 */
export class ComboScorer {
  score = 0;
  best = 0;
  combo = 0;
  chain: string[] = [];
  lastMove: ComboSnapshot["lastMove"] = null;
  moves = 0;
  comboPoints = 0;
  lastShot: ComboSnapshot["lastShot"] = null;
  /** A jumper is up: the combo doesn't cool off while the ball is in the air. */
  private shotUp = false;
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
    this.comboPoints += points;
    this.best = Math.max(this.best, this.score);
    this.chain = [...this.chain, ...move.keys].slice(-8);
    this.lastMove = { kind: move.kind, from: move.from, to: move.to, points, timing: move.timing };
    this.publish({ text: MOVE_NAMES[move.kind], points, tone: move.timing === "clean" ? "move" : "sloppy" });
  }

  onLost() {
    this.reset();
    this.publish({ text: "LOOSE BALL!!", points: 0, tone: "lost" });
  }

  /** The ball was gathered for a jumper. */
  onShotStart() {
    this.shotUp = true;
  }

  onShot(r: ShotResult, now: number) {
    this.shotUp = false;
    this.lastAt = now;
    const S = COMBO.shot;
    const base = r.made ? (r.three ? S.three : S.two) : 0;
    const multiplier = r.three ? S.cashThree : S.cashTwo;
    const pending = this.comboPoints;
    const cashed = r.made ? pending : 0;
    const points = base + cashed * multiplier;
    this.score += points;
    this.best = Math.max(this.best, this.score);
    this.lastShot = { made: r.made, kind: r.kind, three: r.three, base, cashed, multiplier, points };
    this.reset();
    const fmt = (n: number) => n.toLocaleString("en-US");
    const detail = !r.made
      ? this.comboLostText(pending)
      : cashed > 0
        ? `${r.three ? "3PT" : "2PT"} ${fmt(base)} + COMBO ${fmt(cashed)} ×${multiplier}`
        : `${r.three ? "3PT" : "2PT"}`;
    this.publish({ text: SHOT_CALLOUTS[r.kind], points, tone: r.made ? "shot" : "miss", detail });
  }

  update(now: number) {
    if (!this.shotUp && this.combo > 0 && now - this.lastAt > COMBO.timeout) {
      this.reset();
      this.publish(null);
    }
  }

  snapshot(): ComboSnapshot {
    return {
      score: this.score,
      best: this.best,
      combo: this.combo,
      chain: [...this.chain],
      comboPoints: this.comboPoints,
      lastMove: this.lastMove,
      moves: this.moves,
      lastShot: this.lastShot,
    };
  }

  private comboLostText(points: number) {
    return points > 0 ? `COMBO ${points.toLocaleString("en-US")} LOST` : "MISS";
  }

  private reset() {
    this.combo = 0;
    this.comboPoints = 0;
    this.repeats = 0;
    this.lastKind = null;
    this.chain = [];
  }

  private publish(callout: Omit<Callout, "id"> | null) {
    hudStore.set({
      score: this.score,
      best: this.best,
      combo: this.combo,
      chain: this.chain,
      ...(callout ? { callout: { ...callout, id: ++this.calloutId } } : {}),
    });
  }
}
