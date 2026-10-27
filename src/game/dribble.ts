import * as THREE from "three";
import { BallBody, planDribble, predictCatch, type BounceEvent } from "./ballPhysics";

// Dribble controller: turns J / L / I / K / , / U / O presses into hand contacts
// with a physically simulated ball. Dribbling is fully manual: the ball only
// moves when a key says so. A caught ball rests in the hand until the next
// press (or dribbles itself once after IDLE_TIME). Holding J / L palms the ball (after PALM_TIME it drops and bounces back
// by itself; releasing the key sooner dribbles it); the opposite hand key while
// palming is a hold-cross. A key acts the moment it is pressed: in the air the
// hand goes and gets the ball (the flight is cut short) and starts the move at
// once. Timing against the natural catch only decides whether the move is clean
// or sloppy, i.e. how it scores — it never delays the motion.

/** The player's hands. J dribbles with the left hand, L with the right. */
export type Hand = "L" | "R";
export type DribbleKey = "J" | "L" | "I" | "K" | "," | "U" | "O";
export type MoveKind = "pound" | "high" | "switch" | "crossover" | "between" | "behind" | "spinL" | "spinR";
/** `shot`: the jumper has the ball (gathered, in the air, or on its way back from the rebound). */
export type DribbleState = "held" | "carry" | "flight" | "loose" | "shot";
export type Timing = "clean" | "sloppy";

/** Tunable timing windows (seconds) and dribble geometry (metres). */
export const DRIBBLE = {
  /** |press − ideal catch| within this = clean move (full points); outside it the move is sloppy. */
  cleanWindow: 0.075,
  /** Within this a sloppy push is only a little weaker (early) or wild (late); the jumper takes the ball this early. */
  okWindow: 0.15,
  /** After a path move (I / K / ,) the receiving hand's key is optional: pressed this soon it is absorbed, not a new dribble. */
  rollWindow: 0.35,
  /** The ball peaks this far above the catch height, so the hand meets it just before the top. */
  apexMargin: 0.07,
  /** Basic low switch: least forgiving. */
  switchWindowScale: 0.8,
  /** Sprinting while dribbling shrinks the windows and adds push scatter (m/s). */
  sprintWindowScale: 0.7,
  sprintScatter: 0.45,
  /** Holding J / L palms the ball this long (s), then it is let go and drops. */
  palmTime: 3,
  /** A palmed ball is held this much higher (m), cocked up ready to cross over. */
  palmLift: 0.14,
  /** A ball left in the hand with no key pressed dribbles once after this long (s). */
  idleTime: 3,
  /** The dropped ball peaks this far above the catch height (a lazy bounce). */
  dropApexMargin: 0.03,
  /** Hold-cross: the player slides this far (m) toward the receiving side. */
  slideDistance: 0.55,
  /** Crossover: tap one hand key twice, then the other, all within this long (s). */
  crossTapWindow: 0.9,
  /** A spin move turns the player a full circle in this long (s). */
  spinTime: 0.55,
  /** A forced pound (the ball hand's key) is pushed harder: caught faster, so quicker. */
  powerApexMargin: 0.4,
  /** Presses buffered during a move's carry (they act the moment the ball is released); more are dropped. */
  bufferSize: 3,
  /** The only way to lose the ball: this many sloppy hand changes within spamWindow while sprinting. */
  spamCount: 4,
  spamWindow: 1.5,
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
  spinL: "LEFT SPIN!!",
  spinR: "RIGHT SPIN!!",
};

const HAND_KEY: Record<Hand, DribbleKey> = { L: "J", R: "L" };
const KEY_HAND: Partial<Record<DribbleKey, Hand>> = { J: "L", L: "R" };
const PATH_MOVE: Record<string, MoveKind> = { I: "crossover", K: "between", ",": "behind", U: "spinR", O: "spinL" };

export interface Move {
  kind: MoveKind;
  from: Hand;
  to: Hand;
  keys: DribbleKey[];
  timing: Timing;
  /** A forced pound: harder and quicker. */
  power?: boolean;
  /** A palm let go of: the ball just drops and bounces back to the hand. */
  drop?: boolean;
}

/** Where the player is and how it moves — the controller predicts the catch point with it. */
export interface Body {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Rotation about Y; local +Z faces forward, local +X is the player's left. */
  yaw: number;
  /** Heading the body is turning to (differs from `yaw` while it squares up to the hoop); the ball is aimed at it. */
  aimYaw?: number;
  sprinting: boolean;
}

export interface DribbleEvents {
  move(move: Move): void;
  lost(reason: "spam"): void;
  /** A dribble key was accepted — fires on the press itself, before the move it triggers. */
  press(key: DribbleKey, hand: Hand): void;
  pickup(hand: Hand): void;
  /** A hold-cross moves the player sideways toward `side` (the receiving hand's side). */
  slide(side: Hand): void;
  /** A spin move turns the player a full circle toward `side` over `time` seconds. */
  spin(side: Hand, time: number): void;
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
    case "spinL":
    case "spinR": {
      // Pivot with the ball kept on the outside hip, swung across to the catching hand at the end.
      const side = (h: Hand) => (h === "L" ? 1 : -1);
      const to: Hand = from === "L" ? "R" : "L";
      return {
        carry: [
          [side(from) * 0.44, 0.78, 0.08],
          [side(to) * 0.4, 0.74, 0.22],
        ],
        carryTime: DRIBBLE.spinTime,
        catch: anchor(to, H.lowHeight),
        split: 0,
      };
    }
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
  lastTiming: { error: number; timing: Timing } | null = null;
  lastMove: Move | null = null;
  moves = 0;
  lost = 0;

  /** Sim time of the last accepted press. */
  private lastPressAt = -Infinity;
  /** The receiving hand's key right after a path move is absorbed until this sim time. */
  private absorb: { key: DribbleKey; until: number } | null = null;
  /** Contact began from a catch with this timing (a pickup/hold counts as clean). */
  private contactTiming: Timing = "clean";
  private contactError = 0;
  /** The hand key being held down on the ball (palming), and the sim time it went down. */
  private palmKey: DribbleKey | null = null;
  private palmAt = 0;
  /** Recent hand-key taps, for the double-tap crossover sequences (J J L / L L J). */
  private taps: { key: DribbleKey; at: number }[] = [];
  /** The press being handled completes a crossover sequence. */
  private crossArmed = false;
  /** 0…1 how far the palm pose has eased in (ball raised, player hunched). */
  palmEase = 0;
  /** Sim time the hand took the ball (NaN = the next update). */
  private caughtAt = NaN;
  /** Presses made while the ball was away, applied at the next contact (err = press − ideal catch). */
  private buffered: { key: DribbleKey; err: number }[] = [];
  /** Sim times of recent sloppy hand changes made while sprinting. */
  private spam: number[] = [];
  private catchLocal: V3 = anchor("R", DRIBBLE.lowHeight);
  private holdHeight = DRIBBLE.lowHeight;
  private spinning = false;
  private apexMargin = DRIBBLE.apexMargin;
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

  /** Start of a run: ball back in the right hand, nothing in flight. Call after moving the body. */
  restart() {
    this.lastPressAt = -Infinity;
    this.state = "held";
    this.hand = "R";
    this.heightMode = "low";
    this.split = 0;
    this.splitUntil = 0;
    this.absorb = null;
    this.palmKey = null;
    this.spinning = false;
    this.buffered = [];
    this.pending = null;
    this.lastMove = null;
    this.lastTiming = null;
    this.contactTiming = "clean";
    this.contactError = 0;
    this.windowScale = 1;
    this.looseAt = -Infinity;
    this.catchLocal = anchor("R", DRIBBLE.lowHeight);
    this.ball.velocity.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    this.ball.kinematic = true;
    this.holdPoint(this.ball.position);
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

  /** A hand key is held down on the ball. */
  get palming(): boolean {
    return this.palmKey !== null;
  }

  /** A spin move is under way (the ball rides with the turning body). */
  get spinMoving(): boolean {
    return this.spinning;
  }

  /** Presses waiting for the next contact. */
  get queued(): DribbleKey[] {
    return this.buffered.map((b) => b.key);
  }

  press(key: DribbleKey, now: number) {
    if (this.state === "loose" || this.state === "shot") return;
    this.events.press(key, this.hand);
    const sincePress = now - this.lastPressAt;
    this.lastPressAt = now;
    // The receiving hand's key right after a path move is optional: part of that move, not a new dribble.
    const absorb = this.absorb;
    this.absorb = null;
    if (absorb && key === absorb.key && now <= absorb.until) return;
    this.crossArmed = false;
    if (KEY_HAND[key]) {
      this.taps.push({ key, at: now });
      if (this.taps.length > 3) this.taps.shift();
      const [a, b, c] = this.taps;
      if (this.taps.length === 3 && a.key === b.key && c.key !== a.key && c.at - a.at <= DRIBBLE.crossTapWindow) {
        this.crossArmed = true;
        this.taps = [];
      }
    } else this.taps = [];
    switch (this.state) {
      case "held":
        if (this.palmKey) {
          // Pressing another key lets go of the palm; holding no longer crosses over.
          this.palmKey = null;
        }
        this.touch(key, now);
        return;
      case "carry":
        this.buffer(key, -1); // mid-move: far too early to be clean; it acts the moment the ball is released
        return;
      case "flight":
        // The hand goes and gets the ball right now instead of waiting for the natural catch.
        this.state = "held";
        this.caughtAt = now;
        // hand → path is one roll: the path key keeps the grade of the key it follows.
        if (KEY_HAND[key] || sincePress > DRIBBLE.rollWindow) this.setTiming(now - this.catchAt);
        this.touch(key, now);
        return;
    }
  }

  /** A key went up: letting go of a palmed ball before it times out dribbles it. */
  keyUp(key: DribbleKey, now: number) {
    if (this.palmKey !== key) return;
    this.palmKey = null;
    if (this.state !== "held") return;
    const from = this.hand;
    this.startMove({ kind: "pound", from, to: from, keys: [key], timing: "clean", power: true }, now);
  }

  update(now: number, dt: number) {
    this.ball.step(dt, (e) => this.events.bounce(e));
    this.palmEase += ((this.palmKey && this.state === "held" ? 1 : 0) - this.palmEase) * (1 - Math.exp(-dt * 12));
    if (now > this.splitUntil) this.split = 0;

    switch (this.state) {
      case "held": {
        // Settle the ball into the palm (a caught ball arrives a little off the anchor).
        this.holdPoint(this.tmp).lerp(this.ball.position, Math.exp(-dt * 30));
        this.ball.carryTo(this.tmp, dt);
        if (Number.isNaN(this.caughtAt)) this.caughtAt = now;
        // Palmed too long: let it go and it drops back into the hand.
        // Left alone just as long, the ball dribbles itself once.
        const idle = !this.palmKey && now - this.caughtAt >= DRIBBLE.idleTime;
        if ((this.palmKey && now - this.palmAt >= DRIBBLE.palmTime) || idle) {
          const hand = this.hand;
          this.palmKey = null;
          this.startMove({ kind: "pound", from: hand, to: hand, keys: [], timing: "clean", drop: true }, now);
        }
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
        if (now >= this.catchAt) this.catchBall(now);
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
    this.palmKey = null;
    this.spinning = false;
    this.absorb = null;
    this.buffered = [];
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
    this.holdHeight = DRIBBLE.lowHeight;
    this.absorb = null;
    this.buffered = [];
    this.contactTiming = "clean";
    this.contactError = 0;
    this.palmKey = null;
    this.caughtAt = NaN;
    this.events.pickup(hand);
  }

  // ── Input ──────────────────────────────────────────────────────────────

  /** A key lands on a ball in the hand: a hand key on the ball hand palms it, anything else is a move. */
  private touch(key: DribbleKey, now: number) {
    if (KEY_HAND[key] === this.hand) {
      this.palmKey = key;
      this.palmAt = now;
      return;
    }
    this.act(key, now);
  }

  /** What a key means right now: the hand keys dribble or switch, the path keys cross over to the other hand. */
  private act(key: DribbleKey, now: number) {
    const from = this.hand;
    const keyHand = KEY_HAND[key];
    // A spin always ends with the ball in the other hand, whichever way it turns.
    const to: Hand = keyHand ?? (from === "L" ? "R" : "L");
    const kind: MoveKind = keyHand
      ? keyHand === from
        ? this.heightMode === "high"
          ? "high"
          : "pound"
        : this.crossArmed
          ? "crossover"
          : "switch"
      : PATH_MOVE[key];
    this.crossArmed = false;
    this.startMove({ kind, from, to, keys: [key], timing: this.contactTiming, ...(kind === "pound" ? { power: true } : {}) }, now);
  }

  private buffer(key: DribbleKey, err: number) {
    if (this.buffered.length < DRIBBLE.bufferSize) this.buffered.push({ key, err });
  }

  /** The hand meets the ball on its way up and keeps it until the next press. */
  private catchBall(now: number) {
    this.state = "held";
    this.caughtAt = now;
    this.contactTiming = "clean";
    this.contactError = 0;
  }

  /** Grades this contact's press: only scoring depends on it. */
  private setTiming(err: number) {
    const timing: Timing = Math.abs(err) <= DRIBBLE.cleanWindow * this.windowScale ? "clean" : "sloppy";
    this.lastTiming = { error: +err.toFixed(3), timing };
    this.contactTiming = timing;
    this.contactError = THREE.MathUtils.clamp(err, -DRIBBLE.okWindow, DRIBBLE.okWindow);
  }

  // ── Moves ──────────────────────────────────────────────────────────────

  private startMove(move: Move, now: number) {
    // The move counts the moment it starts (callout, score, HUD), not when the ball leaves the hand.
    this.lastMove = move;
    this.moves++;
    this.events.move(move);
    this.absorb = move.keys.length && !KEY_HAND[move.keys[0]] ? { key: HAND_KEY[move.to], until: now + DRIBBLE.rollWindow } : null;
    this.heightMode = move.kind === "high" ? "high" : move.kind === "pound" ? this.heightMode : "low";
    const height = this.heightMode === "high" ? DRIBBLE.highHeight : DRIBBLE.lowHeight;
    this.holdHeight = height;
    this.apexMargin = move.drop ? DRIBBLE.dropApexMargin : move.power ? DRIBBLE.powerApexMargin : DRIBBLE.apexMargin;
    const g = geometry(move.kind, move.from, height);
    // Hand moves are drawn for a move from the right hand and mirrored; pounds and spins are already absolute.
    const spin = move.kind === "spinL" || move.kind === "spinR";
    const absolute = spin || move.kind === "pound" || move.kind === "high";
    this.catchLocal = absolute ? g.catch : mirror(g.catch, move.from);
    this.spinning = spin;
    if (spin) this.events.spin(move.kind === "spinL" ? "L" : "R", DRIBBLE.spinTime);
    this.split = g.split * (move.to === "L" ? 1 : -1);
    this.splitUntil = now + g.carryTime + 0.55;
    this.pending = move;
    this.carryLocal = absolute ? g.carry : g.carry.map((p) => mirror(p, move.from));
    this.carryTime = g.carryTime;
    this.carryStart = now;
    this.carryPath = [this.ball.position.clone()];
    this.state = "carry";
    if (g.carryTime === 0) this.release(move, now);
  }

  private release(move: Move, now: number) {
    this.pending = null;
    this.spinning = false;
    const b = this.body;
    const catchLocal = this.catchLocal;
    // Aim where the receiving hand will be when the ball comes back up.
    const guess = planDribble(this.ball.position, toWorld(catchLocal, b.position, b.yaw, this.tmp), this.apexMargin);
    const future = this.tmp2.copy(b.position).addScaledVector(b.velocity, guess.tCatch);
    future.y = 0;
    const plan = planDribble(this.ball.position, toWorld(catchLocal, future, b.aimYaw ?? b.yaw, this.tmp), this.apexMargin);
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

    // Sprinting while frantically slapping it hand to hand is the one way to lose it.
    if (move.timing === "sloppy" && move.from !== move.to && b.sprinting) {
      this.spam = [...this.spam.filter((t) => now - t <= DRIBBLE.spamWindow), now];
      if (this.spam.length >= DRIBBLE.spamCount) {
        this.spam = [];
        this.nudge(1.6 + this.random() * 0.9, 0.6);
        this.ball.spin.set((this.random() - 0.5) * 30, (this.random() - 0.5) * 20, (this.random() - 0.5) * 30);
        this.loseBall("spam", now);
        return;
      }
    }

    // A key pressed during the carry acts as soon as the ball is out of the hand.
    const next = this.buffered.shift();
    if (next) {
      this.state = "held";
      this.caughtAt = now;
      this.setTiming(next.err);
      this.act(next.key, now);
    }
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
    const y = this.holdHeight + 0.06 + DRIBBLE.palmLift * this.palmEase;
    return toWorld(anchor(this.hand, y), this.body.position, this.body.yaw, out);
  }

  // ── Losing it ──────────────────────────────────────────────────────────

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
    this.palmKey = null;
    this.spinning = false;
    this.absorb = null;
    this.buffered = [];
    this.pending = null;
    this.lost++;
    this.events.lost(reason);
  }
}
