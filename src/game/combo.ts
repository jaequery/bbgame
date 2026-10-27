import { MOVE_NAMES, type Move, type MoveKind } from "./dribble";
import { hudStore, type Callout } from "./hudStore";
import type { FinishKind, HoldKind, ShotKind, ShotResult } from "./shot";
import { HOLD_NAMES } from "./shot";

/** Anything that scores as a combo move: a dribble move or a move out of the triple-threat hold. */
export type ScoredKind = MoveKind | HoldKind;
/** The part of a move the scorer reads. */
export interface ScoredMove {
  kind: ScoredKind;
  from: string;
  to: string;
  timing: Move["timing"];
}

/** Scoring tuning. */
export const COMBO = {
  /** Base points per move: switch < crossover < spins < between legs < behind back. */
  points: {
    pound: 0,
    high: 20,
    switch: 40,
    crossover: 100,
    between: 150,
    behind: 200,
    spinL: 180,
    spinR: 180,
    pump: 60,
    jab: 90,
    extL: 70,
    extR: 70,
    protect: 50,
  } satisfies Record<ScoredKind, number>,
  /** Each straight repeat of the same move scores this much of the last one. */
  repeatFactor: 0.5,
  /** Early/late (sloppy) contact scores this fraction and does not grow the combo. */
  sloppyFactor: 0.5,
  /** No new move for this long and the combo cools off to zero. */
  timeout: 4,
  /** Made jumper: base points, and what the combo's points are multiplied by when it cashes in. */
  shot: { two: 200, three: 300, cashTwo: 2, cashThree: 3 },
};

const moveName = (kind: ScoredKind) => (kind in HOLD_NAMES ? HOLD_NAMES[kind as HoldKind] : MOVE_NAMES[kind as MoveKind]);

export const SHOT_CALLOUTS: Record<ShotKind, string> = {
  swish: "SWISH!!",
  bank: "BANK!!",
  rim: "IN!!",
  "rim-out": "RIM OUT…",
  board: "OFF THE BOARD…",
  airball: "AIRBALL…",
};

/** A made running finish is named for what it was, not how the ball went in. */
const FINISH_CALLOUTS: Record<FinishKind, string> = { layup: "LAYUP!!", dunk: "SLAM DUNK!!" };

export interface ComboSnapshot {
  score: number;
  best: number;
  /** Multiplier shown as ×N. */
  combo: number;
  /** Keys of the recent moves, oldest first. */
  chain: string[];
  /** Points the moves of the current combo have scored — what a made jumper cashes in. */
  comboPoints: number;
  lastMove: { kind: ScoredKind; from: string; to: string; points: number; timing: string } | null;
  moves: number;
  lastShot: { made: boolean; kind: ShotKind; three: boolean; base: number; cashed: number; multiplier: number; points: number } | null;
}

/**
 * Combo scoring: the multiplier climbs one step for every clean move that is
 * different from the last one (variety + rhythm); repeating the same move keeps
 * it but scores less each time; sloppy timing scores half (and shows SLOPPY); losing the ball or
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
  private lastKind: ScoredKind | null = null;
  private lastAt = -Infinity;
  private calloutId = 0;

  /** A dribble key was pressed: it lights up in the HUD chain the same frame. */
  onPress(key: string) {
    this.chain = [...this.chain, key].slice(-8);
    hudStore.set({ chain: this.chain });
  }

  onMove(move: ScoredMove, now: number) {
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
    this.lastMove = { kind: move.kind, from: move.from, to: move.to, points, timing: move.timing };
    this.publish(
      move.timing === "clean"
        ? { text: moveName(move.kind), points, tone: "move" }
        : { text: moveName(move.kind), points, tone: "sloppy", detail: "SLOPPY" },
    );
  }

  onLost() {
    this.reset();
    this.publish({ text: "LOOSE BALL!!", points: 0, tone: "lost" });
  }

  /** The gather turned out to be a pump fake: no jumper is coming after all. */
  onShotAbort(now: number) {
    this.shotUp = false;
    this.lastAt = now;
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
    const text = r.made && r.finish ? FINISH_CALLOUTS[r.finish] : SHOT_CALLOUTS[r.kind];
    this.publish({ text, points, tone: r.made ? "shot" : "miss", detail });
  }

  update(now: number) {
    if (!this.shotUp && this.combo > 0 && now - this.lastAt > COMBO.timeout) {
      this.reset();
      this.publish(null);
    }
  }

  /** Fresh run: score, combo, chain and shot state back to zero. */
  resetRun() {
    this.reset();
    this.score = 0;
    this.best = 0;
    this.lastMove = null;
    this.lastShot = null;
    this.moves = 0;
    this.shotUp = false;
    this.lastAt = -Infinity;
    this.publish(null);
    hudStore.set({ callout: null });
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
