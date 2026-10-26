import * as THREE from "three";
import { BallBody, planDribble, predictCatch, type BounceEvent } from "./ballPhysics";

// Dribble controller: turns J / L / I / K / , presses into hand contacts with a
// physically simulated ball. Every dribble is a push; the hand has to meet the
// ball on its way back up inside the catch window or the ball gets loose.

/** The player's hands. J dribbles with the left hand, L with the right. */
export type Hand = "L" | "R";
export type DribbleKey = "J" | "L" | "I" | "K" | ",";
export type MoveKind = "pound" | "high" | "switch" | "crossover" | "between" | "behind";
/** `shot`: the jumper has the ball (gathered, in the air, or on its way back from the rebound). */
export type DribbleState = "held" | "carry" | "flight" | "loose" | "shot";
export type Timing = "clean" | "sloppy";

/** Tunable timing windows (seconds) and dribble geometry (metres). */
export const DRIBBLE = {
  /** |press − ideal catch| within this = clean dribble. */
  cleanWindow: 0.075,
  /** Within this = caught, but the next push is weaker (early) or wild (late). */
  okWindow: 0.15,
  /** Earlier than −okWindow but within this = slapped the ball away (fumble). Earlier still is ignored. */
  badWindow: 0.26,
  /** A lone hand key pushes the ball if nothing follows within this. */
  holdDecide: 0.13,
  /** hand → path → hand must complete within this (from the first key). */
  rollWindow: 0.35,
  /** The ball peaks this far above the catch height, so the hand meets it just before the top. */
  apexMargin: 0.07,
  /** How far from the body's centre line (horizontally) a ball can still be caught. */
  catchReach: 0.8,
  /** Basic low switch: least forgiving. */
  switchWindowScale: 0.8,
  /** Sprinting while dribbling shrinks the windows and adds push scatter (m/s). */
  sprintWindowScale: 0.7,
  sprintScatter: 0.45,
  /** After losing the ball, wait this long before it can be picked up again. */
  pickupDelay: 0.5,
  pickupRadius: 0.6,
  lowHeight: 0.62,
  highHeight: 0.95,
};

export const MOVE_NAMES: Record<MoveKind, string> = {
  pound: "DRIBBLE",
  high: "HIGH DRIBBLE!",
  switch: "SWITCH!",
  crossover: "CROSSOVER!!",
  between: "BETWEEN THE LEGS!!",
  behind: "BEHIND THE BACK!!",
};

const HAND_KEY: Record<Hand, DribbleKey> = { L: "J", R: "L" };
const KEY_HAND: Partial<Record<DribbleKey, Hand>> = { J: "L", L: "R" };
const PATH_MOVE: Record<string, MoveKind> = { I: "crossover", K: "between", ",": "behind" };

export interface Move {
  kind: MoveKind;
  from: Hand;
  to: Hand;
  keys: DribbleKey[];
  timing: Timing;
}

/** Where the player is and how it moves — the controller predicts the catch point with it. */
export interface Body {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Rotation about Y; local +Z faces forward, local +X is the player's left. */
  yaw: number;
  sprinting: boolean;
}

export interface DribbleEvents {
  move(move: Move): void;
  lost(reason: "fumble" | "missed" | "reach" | "wrong-hand"): void;
  pickup(hand: Hand): void;
  bounce(e: BounceEvent): void;
}

type V3 = [number, number, number];

/** Local hand point for a ball held at height `y` (x: + left). */
const anchor = (hand: Hand, y: number): V3 => [hand === "L" ? 0.36 : -0.36, y, 0.27];

interface MoveGeometry {
  /** Carry waypoints (local, for a move from the right hand), ending at the release point. */
  carry: V3[];
  carryTime: number;
  /** Catch point for the receiving hand (local, mirrored for a move from the left). */
  catch: V3;
  /** Split stance while it happens: + = foot on the receiving side forward. */
  split: number;
}

function geometry(kind: MoveKind, from: Hand, height: number): MoveGeometry {
  const H = DRIBBLE;
  switch (kind) {
    case "pound":
      return { carry: [], carryTime: 0, catch: anchor(from, height), split: 0 };
    case "high":
      return { carry: [], carryTime: 0, catch: anchor(from, H.highHeight), split: 0 };
    case "switch":
      // Low V in front: straight across from the current hand.
      return { carry: [[-0.26, 0.5, 0.32]], carryTime: 0.05, catch: [0.36, H.lowHeight, 0.3], split: 0 };
    case "crossover":
      // Up high in front, bounced across at waist-to-chest height.
      return { carry: [[-0.3, 0.88, 0.38]], carryTime: 0.09, catch: [0.36, 0.88, 0.32], split: 0 };
    case "between":
      // Split stance, receiving-side foot forward; through the stance, front-out to back-in.
      return { carry: [[-0.33, 0.6, 0.24]], carryTime: 0.1, catch: [0.34, 0.62, -0.14], split: 1 };
    case "behind":
      // Wrap around the hip and bounce it behind the back.
      return {
        carry: [
          [-0.44, 0.72, 0.02],
          [-0.32, 0.7, -0.48],
        ],
        carryTime: 0.17,
        catch: [0.34, 0.68, -0.3],
        split: 0,
      };
  }
}

const mirror = (p: V3, hand: Hand): V3 => (hand === "R" ? p : [-p[0], p[1], p[2]]);

/** Local (player) point → world, for a body at `pos` turned by `yaw`. */
export function toWorld(p: V3, pos: THREE.Vector3, yaw: number, out: THREE.Vector3) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(pos.x + p[0] * c + p[2] * s, p[1], pos.z - p[0] * s + p[2] * c);
}

export class DribbleController {
  state: DribbleState = "held";
  /** Hand holding the ball, or the hand it is flying to. */
  hand: Hand = "R";
  heightMode: "low" | "high" = "low";
  /** Split-stance target for the legs (−1…1, + = left foot forward). */
  split = 0;
  /** Sim time the ball should reach the catching hand (flight only). */
  catchAt = 0;
  lastTiming: { error: number; timing: Timing | "fumble" } | null = null;
  lastMove: Move | null = null;
  moves = 0;
  lost = 0;

  private roll: DribbleKey[] = [];
  private rollStart = 0;
  /** Contact began from a catch with this timing (a pickup/hold counts as clean). */
  private contactTiming: Timing = "clean";
  private contactError = 0;
  private catchLocal: V3 = anchor("R", DRIBBLE.lowHeight);
  private windowScale = 1;
  /** Sim time of the last push (the pushing hand follows through after it). */
  releasedAt = 0;
  private looseAt = -Infinity;
  private pending: Move | null = null;
  private carryPath: THREE.Vector3[] = [];
  private carryLocal: V3[] = [];
  private carryStart = 0;
  private carryTime = 0;
  private splitUntil = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    readonly ball: BallBody,
    private readonly body: Body,
    private readonly events: DribbleEvents,
    private readonly random: () => number = Math.random,
  ) {
    this.holdPoint(this.ball.position);
    this.ball.kinematic = true;
  }

  /** Seconds until the ideal catch (flight only). */
  catchIn(now: number): number | null {
    return this.state === "flight" ? this.catchAt - now : null;
  }

  /** The hand touching the ball right now, or null while it is in the air or loose. */
  get contactHand(): Hand | null {
    return this.state === "held" || this.state === "carry" ? this.hand : null;
  }

  /** Where the catching hand waits for the ball (world). */
  catchPoint(out: THREE.Vector3) {
    return toWorld(this.catchLocal, this.body.position, this.body.yaw, out);
  }

  press(key: DribbleKey, now: number) {
    switch (this.state) {
      case "loose":
      case "carry":
      case "shot":
        return;
      case "held":
        this.addRollKey(key, now);
        return;
      case "flight":
        this.tryCatch(key, now);
        return;
    }
  }

  update(now: number, dt: number) {
    this.ball.step(dt, (e) => this.events.bounce(e));
    if (now > this.splitUntil) this.split = 0;

    switch (this.state) {
      case "held": {
        // Settle the ball into the palm (a caught ball arrives a little off the anchor).
        this.holdPoint(this.tmp).lerp(this.ball.position, Math.exp(-dt * 30));
        this.ball.carryTo(this.tmp, dt);
        this.resolveRoll(now);
        break;
      }
      case "carry": {
        const u = Math.min(1, (now - this.carryStart) / this.carryTime);
        this.carryPoint(u, this.tmp);
        this.ball.carryTo(this.tmp, dt);
        if (u >= 1 && this.pending) this.release(this.pending, now);
        break;
      }
      case "flight": {
        if (now > this.catchAt + DRIBBLE.okWindow * this.windowScale) {
          // Nobody met it: it pops past the hand and gets away.
          this.nudge(1.1 + this.random() * 0.5, 0.2);
          this.loseBall("missed", now);
        }
        break;
      }
      case "loose": {
        const b = this.ball.position;
        const p = this.body.position;
        if (
          now - this.looseAt > DRIBBLE.pickupDelay &&
          b.y < 0.8 &&
          Math.hypot(b.x - p.x, b.z - p.z) < DRIBBLE.pickupRadius
        ) {
          // Grab it with whichever hand is on the ball's side.
          const c = Math.cos(this.body.yaw);
          const s = Math.sin(this.body.yaw);
          const localX = (b.x - p.x) * c - (b.z - p.z) * s;
          this.receive(localX >= 0 ? "L" : "R");
        }
        break;
      }
      case "shot":
        break; // the shot controller moves the ball
    }
  }

  /** Gives the ball up to the jumper: no more dribble input until `receive`. */
  surrender() {
    this.state = "shot";
    this.roll = [];
    this.pending = null;
    this.split = 0;
    this.ball.kinematic = true;
    this.ball.spin.set(0, 0, 0);
  }

  /** The ball comes into `hand` (a pickup or a pass): back to dribbling from a hold. */
  receive(hand: Hand) {
    this.hand = hand;
    this.state = "held";
    this.heightMode = "low";
    this.roll = [];
    this.contactTiming = "clean";
    this.contactError = 0;
    this.events.pickup(hand);
  }

  // ── Input ──────────────────────────────────────────────────────────────

  private addRollKey(key: DribbleKey, now: number) {
    if (this.roll.length === 0) {
      this.rollStart = now;
      // A path key first means "with the hand that has it".
      if (!KEY_HAND[key]) this.roll.push(HAND_KEY[this.hand]);
      else if (KEY_HAND[key] !== this.hand) {
        // Straight to the other hand: basic low switch.
        this.roll.push(HAND_KEY[this.hand]);
      }
    }
    this.roll.push(key);
    this.resolveRoll(now);
  }

  /** Decides what the current roll means, or keeps waiting for more keys. */
  private resolveRoll(now: number) {
    const keys = this.roll;
    if (keys.length === 0) return;
    const from = this.hand;
    const age = now - this.rollStart;
    const done = (kind: MoveKind, to: Hand) => this.startMove({ kind, from, to, keys: [...keys], timing: this.contactTiming }, now);
    const plain = () => done(this.heightMode === "high" ? "high" : "pound", from);

    if (keys.length === 1) {
      if (age > DRIBBLE.holdDecide) plain();
      return;
    }
    const second = keys[1];
    const secondHand = KEY_HAND[second];
    if (secondHand) {
      if (secondHand === from) plain();
      else done("switch", secondHand);
      return;
    }
    // Path key: wait for the receiving hand.
    if (keys.length >= 3) {
      const third = KEY_HAND[keys[2]];
      if (third && third !== from) return done(PATH_MOVE[second], third);
      if (third === from) return second === "I" ? done("high", from) : plain();
      keys.splice(2); // extra path key: ignore it
    }
    if (age > DRIBBLE.rollWindow) {
      if (second === "I") done("high", from);
      else plain();
    }
  }

  private tryCatch(key: DribbleKey, now: number) {
    const err = now - this.catchAt;
    const w = this.windowScale;
    if (err < -DRIBBLE.badWindow * w) return; // nowhere near: ignore
    const keyHand = KEY_HAND[key];
    if (keyHand && keyHand !== this.hand) {
      this.fumble(now, err, "wrong-hand");
      return;
    }
    if (Math.abs(err) > DRIBBLE.okWindow * w) {
      this.fumble(now, err, "fumble");
      return;
    }
    const b = this.ball.position;
    const p = this.body.position;
    if (Math.hypot(b.x - p.x, b.z - p.z) > DRIBBLE.catchReach) {
      this.fumble(now, err, "reach");
      return;
    }
    const timing: Timing = Math.abs(err) <= DRIBBLE.cleanWindow * w ? "clean" : "sloppy";
    this.lastTiming = { error: +err.toFixed(3), timing };
    this.contactTiming = timing;
    this.contactError = err;
    this.state = "held";
    this.roll = [];
    this.addRollKey(key, now);
  }

  // ── Moves ──────────────────────────────────────────────────────────────

  private startMove(move: Move, now: number) {
    this.roll = [];
    this.heightMode = move.kind === "high" ? "high" : move.kind === "pound" ? this.heightMode : "low";
    const height = this.heightMode === "high" ? DRIBBLE.highHeight : DRIBBLE.lowHeight;
    const g = geometry(move.kind, move.from, height);
    this.catchLocal = move.kind === "pound" || move.kind === "high" ? g.catch : mirror(g.catch, move.from);
    this.split = g.split * (move.to === "L" ? 1 : -1);
    this.splitUntil = now + g.carryTime + 0.55;
    this.pending = move;
    this.carryLocal = g.carry.map((p) => mirror(p, move.from));
    this.carryTime = g.carryTime;
    this.carryStart = now;
    this.carryPath = [this.ball.position.clone()];
    this.state = "carry";
    if (g.carryTime === 0) this.release(move, now);
  }

  private release(move: Move, now: number) {
    this.pending = null;
    const b = this.body;
    const catchLocal = this.catchLocal;
    // Aim where the receiving hand will be when the ball comes back up.
    const guess = planDribble(this.ball.position, toWorld(catchLocal, b.position, b.yaw, this.tmp), DRIBBLE.apexMargin);
    const future = this.tmp2.copy(b.position).addScaledVector(b.velocity, guess.tCatch);
    future.y = 0;
    const plan = planDribble(this.ball.position, toWorld(catchLocal, future, b.yaw, this.tmp), DRIBBLE.apexMargin);
    const v = plan.velocity;

    // Imperfect contact: early = a weaker push, late = it squirts sideways.
    let scatter = 0;
    if (move.timing === "sloppy") {
      const f = Math.min(1, Math.abs(this.contactError) / DRIBBLE.okWindow);
      if (this.contactError < 0) v.y *= 1 - 0.28 * f;
      else scatter += 0.55 * f;
    }
    if (move.kind === "switch") scatter += 0.12;
    if (b.sprinting) scatter += DRIBBLE.sprintScatter;
    if (scatter > 0) {
      const a = this.random() * Math.PI * 2;
      const m = scatter * this.random();
      v.x += Math.cos(a) * m;
      v.z += Math.sin(a) * m;
    }
    this.ball.release(v);

    const predicted = predictCatch(this.ball.position, v, catchLocal[1]);
    this.catchAt = now + predicted.tCatch;
    this.releasedAt = now;
    this.windowScale = (move.kind === "switch" ? DRIBBLE.switchWindowScale : 1) * (b.sprinting ? DRIBBLE.sprintWindowScale : 1);
    this.hand = move.to;
    this.state = "flight";
    this.lastMove = move;
    this.moves++;
    this.events.move(move);
  }

  private carryPoint(u: number, out: THREE.Vector3) {
    // Waypoints follow the body; the first one is where the contact started.
    const pts = [this.carryPath[0], ...this.carryLocal.map((p) => toWorld(p, this.body.position, this.body.yaw, new THREE.Vector3()))];
    const seg = Math.min(pts.length - 2, Math.floor(u * (pts.length - 1)));
    const local = u * (pts.length - 1) - seg;
    const e = local * local * (3 - 2 * local);
    return out.lerpVectors(pts[seg], pts[seg + 1], e);
  }

  /** Where a held ball sits under the hand, between pushes. */
  private holdPoint(out: THREE.Vector3) {
    const y = (this.heightMode === "high" ? DRIBBLE.highHeight : DRIBBLE.lowHeight) + 0.06;
    return toWorld(anchor(this.hand, y), this.body.position, this.body.yaw, out);
  }

  // ── Losing it ──────────────────────────────────────────────────────────

  private fumble(now: number, err: number, reason: "fumble" | "reach" | "wrong-hand") {
    this.lastTiming = { error: +err.toFixed(3), timing: "fumble" };
    this.nudge(1.6 + this.random() * 0.9, 0.6);
    this.ball.spin.set((this.random() - 0.5) * 30, (this.random() - 0.5) * 20, (this.random() - 0.5) * 30);
    this.loseBall(reason, now);
  }

  /** Knocks the ball away from the body, off to one side. */
  private nudge(speed: number, up: number) {
    const b = this.ball.position;
    const p = this.body.position;
    const away = this.tmp.set(b.x - p.x, 0, b.z - p.z);
    if (away.lengthSq() < 1e-6) away.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw));
    away.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, (this.random() - 0.5) * 1.2);
    this.ball.kinematic = false;
    this.ball.velocity.addScaledVector(away, speed);
    this.ball.velocity.y = Math.max(this.ball.velocity.y, up);
  }

  private loseBall(reason: Parameters<DribbleEvents["lost"]>[0], now: number) {
    this.state = "loose";
    this.looseAt = now;
    this.roll = [];
    this.pending = null;
    this.lost++;
    this.events.lost(reason);
  }
}
