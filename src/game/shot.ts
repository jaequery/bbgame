import * as THREE from "three";
import {
  GRAVITY,
  HOOP_X,
  RIM_HEIGHT,
  THREE_POINT_CORNER,
  THREE_POINT_RADIUS,
} from "./dimensions";
import { DRIBBLE, toWorld, type Body, type DribbleController, type DribbleKey, type Hand } from "./dribble";
import type { HoopHit } from "./hoopPhysics";

// A quick tap of Space is a pump fake instead: the ball goes up toward the shot pocket and
// comes back down into the triple-threat hold, feet on the floor. In the hold the ball is
// secured in both hands and stays there until the player acts: K jab step, J / L reach the
// ball out to that side (the hold owns J / L — no palming), I hunches over the ball with the head
// down and shields it from the hoop, Space shoots (or pumps again), and , U O resume dribbling.
//
// Running finishes: sprint at the hoop and press Space within range and it is not a pump fake or a
// jumper but a layup (a running one-hand take-off, released at the top off the glass / rim) or, right
// at the rim, a dunk (the ball is taken over the rim and slammed through).
//
// The jumper: hold Space (moving away from the hoop makes it a fadeaway, leaning back) to gather the ball into both hands and rise, release
// at the top. The release only picks a launch velocity — where the ball goes
// after that (swish, bank, rim out) is the ball physics against the hoop.

/** Tunable shot timing (seconds), jump and aim. */
export const SHOT = {
  /** Ball from the dribble into the shooting pocket while the knees dip. */
  gatherTime: 0.2,
  /** Vertical leap of the jumper (m). */
  jumpHeight: 0.55,
  /** The ball rides from the pocket up to the set point over this much of the rise. */
  setTime: 0.2,
  /** Launch angle (deg) of a release right at the apex. */
  launchAngle: 52,
  /** Per tolerance unit of timing error: early = higher arc, late = flatter (deg). */
  arcPerUnit: 3,
  /** |release − apex| within the tolerance = perfect. It shrinks with distance to the rim. */
  toleranceNear: 0.065,
  toleranceFar: 0.035,
  nearDistance: 3,
  farDistance: 8.5,
  /** Depth miss at the rim (m) per tolerance unit inside the window: early drops short, late sails long. */
  depthPerUnit: 0.05,
  /** Outside the window the miss grows faster (m per unit beyond it)… */
  depthBeyond: 0.09,
  /** …and a late release also pushes the ball off line (m per unit beyond it). */
  lateDrift: 0.05,
  /** The worst release still reaches the iron: the aim error is capped at the far side of the rim (m). */
  maxMiss: 0.27,
  maxUnits: 5,
  /** Random spread at the rim (m), even on a perfect release. */
  scatter: 0.012,
  /** Backspin off the fingertips (rad/s). */
  backspin: 18,
  /** Still holding on the way down: the ball goes up anyway at this height (m). */
  forcedReleaseHeight: 0.12,
  /** A ball that never comes down (stuck on the rim) is a miss after this long. */
  flightTimeout: 5,
  /** Rebound: wait this long after a make / miss, then pass it back. */
  reboundWaitMade: 0.75,
  reboundWaitMiss: 0.5,
  passTime: 0.8,
  /** Space released within this long (s) of going down = a tap, i.e. a pump fake. Shorter than gatherTime, so jumper timing is untouched. */
  tapTime: 0.15,
  /** Pump fake: the ball goes up toward the shot pocket and comes back down over this long (s). */
  pumpTime: 0.5,
  /** Jab step: out and back over this long (s), the lead foot travelling this far (m) toward the rim. */
  jabTime: 0.4,
  jabDistance: 0.32,
  /** Ball extension: arm out to the side and back over this long (s). */
  extTime: 0.5,
  /** Running finishes: Space while sprinting at the hoop (see the header). */
  finish: {
    /** Ground speed to count as running (m/s): a sprint, a walk is not enough. */
    minSpeed: 3.6,
    /** Velocity must point this closely at the rim (cosine; 0.7 ≈ 45°). */
    minAlign: 0.7,
    /** Horizontal distance to the rim centre (m): layup inside `layupRange`, dunk inside `dunkRange`. */
    layupRange: 3.6,
    dunkRange: 1.9,
    /** Vertical leap (m). */
    layupJump: 0.7,
    dunkJump: 0.95,
    /** The take-off carries the player toward the rim: at most this far (m) for the layup… */
    layupTravel: 1.6,
    /** …closest he gets to the rim centre (m) at the top of the layup / the dunk. */
    layupStandoff: 0.95,
    dunkStandoff: 0.5,
    /** Layup: launch angle (deg), aim past the rim centre (m) and random spread of the aim point (m). */
    layupAngle: 62,
    layupAim: 0.05,
    layupScatter: 0.24,
    /** Dunk: the ball is held this far above the rim centre (m) at the top, then slammed down at this speed (m/s). */
    dunkAbove: 0.32,
    dunkSlam: 5,
  },
  /** Ball protect (I): hunch down, shield the ball away from the hoop and come back up over this long (s). */
  protectTime: 1,
  /** The fadeaway (Space while moving away from the hoop): the jumper while falling away. */
  fade: {
    /** Move input must point this closely away from the rim (cosine; 0.5 ≈ 60°). */
    minAlign: 0.5,
    /** Backward travel away from the rim over the whole jump (m). */
    drift: 0.7,
    /** Body tilt back at the apex (rad, torso and ball path). */
    lean: 0.5,
    /** Set point pulled back behind the head at full lean (m). */
    setBack: 0.22,
    /** Perfect window × this: harder to time than the standard jumper. */
    toleranceScale: 0.6,
  },
};

export type ShotPhase = "none" | "pickup" | "gather" | "air" | "rise" | "flight" | "rebound" | "pass" | "pump" | "hold" | "jab" | "ext" | "protect";
/** Moves out of the triple-threat hold. */
export type HoldKind = "pump" | "jab" | "extL" | "extR" | "protect";
export const HOLD_NAMES: Record<HoldKind, string> = {
  pump: "PUMP FAKE!",
  jab: "JAB STEP!",
  extL: "LEFT PROBE!",
  extR: "RIGHT PROBE!",
  protect: "PROTECT!",
};
/** Phases of the triple-threat hold (ball secured in both hands, no dribble). */
const HOLD_PHASES: ShotPhase[] = ["pump", "hold", "jab", "ext", "protect"];
/** What a key did in the hold. */
export type HoldResult = "move" | "exit" | "none";
export type ReleaseGrade = "perfect" | "early" | "late";
/** The running finishes. */
export type FinishKind = "layup" | "dunk";
export type ShotKind = "swish" | "bank" | "rim" | "rim-out" | "board" | "airball";

export interface ShotRelease {
  grade: ReleaseGrade;
  /** Release time − apex time (s): negative = early. */
  error: number;
  tolerance: number;
  /** Horizontal distance from the ball to the rim centre (m). */
  distance: number;
  /** Shooter's feet beyond the arc at release. */
  three: boolean;
  /** Launch angle (deg) and speed (m/s). */
  angle: number;
  speed: number;
  /** Space was held all the way down. */
  forced: boolean;
  /** A fadeaway (Space while moving away), not the standard jumper. */
  fade: boolean;
  /** A running layup or dunk instead of a jumper. */
  finish: FinishKind | null;
}

export interface ShotResult extends ShotRelease {
  made: boolean;
  kind: ShotKind;
  rimHits: number;
  boardHits: number;
}

export interface ShotEvents {
  /** The ball is in both hands: the dribble is over. */
  gather(): void;
  /** The gather was a pump fake after all: no jumper is coming. */
  abort(): void;
  /** A move out of the hold (pump fake, jab, extension). */
  hold(move: { kind: HoldKind; from: Hand; to: Hand; timing: "clean" }): void;
  release(r: ShotRelease): void;
  result(r: ShotResult): void;
}

type V3 = [number, number, number];
/** Chest pocket at the bottom of the dip, and the set point over the forehead (standing; local, x: + left). */
const POCKET: V3 = [-0.04, 1.12, 0.32];
const SET: V3 = [-0.06, 2.02, 0.2];
/** Running finish: the ball in the shooting hand, reaching up and out toward the rim (layup) / over it (dunk). */
const LAYUP_SET: V3 = [-0.12, 2.2, 0.5];
const DUNK_SET: V3 = [-0.06, 2.3, 0.5];
/** Triple threat: ball on the shooting side at the hip, in both hands; the top of a pump fake; and the ball reached out to the left (x: + left). */
const HOLD: V3 = [-0.12, 0.92, 0.4];
const PUMP_TOP: V3 = [-0.06, 1.75, 0.3];
const REACH: V3 = [0.72, 1.0, 0.34];
/** Where the rebound pass is aimed: chest height, on the right. */
const PASS_TO: V3 = [-0.36, 1.0, 0.42];

const RIM = new THREE.Vector3(HOOP_X, RIM_HEIGHT, 0);
const UP = THREE.Object3D.DEFAULT_UP;
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Take-off speed for a jump height. */
const leapFor = (height: number) => Math.sqrt(2 * GRAVITY * height);
const LEAP = leapFor(SHOT.jumpHeight);
/** Feet off the floor for this long. */
export const AIR_TIME = (2 * LEAP) / GRAVITY;

/** Feet at (x, z) are behind the +X hoop's three-point line (corner lines, then the arc). */
export function isThree(x: number, z: number) {
  const dx = HOOP_X - x;
  const cornerDepth = Math.sqrt(THREE_POINT_RADIUS ** 2 - THREE_POINT_CORNER ** 2);
  if (dx < cornerDepth) return Math.abs(z) > THREE_POINT_CORNER;
  return Math.hypot(dx, z) > THREE_POINT_RADIUS;
}

/** Perfect-release half window (s) at a distance from the rim. */
export function shotTolerance(distance: number) {
  const t = THREE.MathUtils.clamp((distance - SHOT.nearDistance) / (SHOT.farDistance - SHOT.nearDistance), 0, 1);
  return THREE.MathUtils.lerp(SHOT.toleranceNear, SHOT.toleranceFar, t);
}

/** Launch velocity that puts the ball's centre through `target` at `angle` (rad) above horizontal. */
export function solveLaunch(from: THREE.Vector3, target: THREE.Vector3, angle: number, out: THREE.Vector3) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.max(0.05, Math.hypot(dx, dz));
  const dy = target.y - from.y;
  let a = angle;
  let denom = 2 * Math.cos(a) ** 2 * (d * Math.tan(a) - dy);
  // Too steep a climb for this angle (right under the rim): loft it more.
  while (denom < 0.05 && a < THREE.MathUtils.degToRad(80)) {
    a += THREE.MathUtils.degToRad(2);
    denom = 2 * Math.cos(a) ** 2 * (d * Math.tan(a) - dy);
  }
  const speed = Math.sqrt((GRAVITY * d * d) / Math.max(denom, 0.05));
  out.set((dx / d) * speed * Math.cos(a), speed * Math.sin(a), (dz / d) * speed * Math.cos(a));
  return { speed, angle: a };
}

export class ShotController {
  phase: ShotPhase = "none";
  /** Height of the feet off the floor (m). */
  jumpY = 0;
  /** Sim time of the last take-off, and when that jump peaks. */
  liftAt = -Infinity;
  apexAt = -Infinity;
  releasedAt = -Infinity;
  lastRelease: ShotRelease | null = null;
  lastResult: ShotResult | null = null;
  attempts = 0;
  makes = 0;

  /** The running finish in progress (null for the jumper and everything else). */
  finish: FinishKind | null = null;
  /** The jump in progress is a fadeaway. */
  fade = false;
  /** 0…1 how far the fadeaway has leaned back (follows the jump). */
  lean = 0;

  /** 0…1 how far the lead foot is stepped out (jab), for the legs. */
  jabAmount = 0;
  /** Reaching side of the extension in progress. */
  extSide: Hand = "L";
  /** 0…1 how far the hunch over the ball (I) has come down. */
  protectAmount = 0;

  private spaceDown = false;
  private pressAt = -Infinity;
  private pumpFrom = new THREE.Vector3();
  private moveAt = 0;
  /** Where the stepped-out foot has carried the body from its planted spot (m). */
  private readonly jabOffset = new THREE.Vector3();
  /** I / K held down in the triple-threat hold: the hunch and the stepped-out foot stay for as long as they are. */
  private iHeld = false;
  private kHeld = false;
  /** A tap of I / K still lasts until then (s). */
  private iUntil = -Infinity;
  private kUntil = -Infinity;
  private nextKey: "J" | "L" | null = null;
  private driftT = 0;
  private lastUpdate = 0;
  private lastStance = 0;
  private airborne = false;
  /** Take-off speed of the jump in progress. */
  private leap = LEAP;
  private readonly finishFrom = new THREE.Vector3();
  private readonly finishTo = new THREE.Vector3();
  private gatherStart = 0;
  private readonly gatherFrom = new THREE.Vector3();
  private rimHits = 0;
  private boardHits = 0;
  private scored = false;
  private resolvedAt = 0;
  private passStart = 0;
  private now = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly dribble: DribbleController,
    private readonly body: Body,
    private readonly events: ShotEvents,
    private readonly random: () => number = Math.random,
  ) {}

  /** Both hands are on the ball (gathering or rising with it). */
  get holding() {
    return this.phase === "gather" || this.phase === "air" || this.phase === "rise";
  }

  /** The triple-threat hold, including the pump fake, jab and reaches that return to it. */
  get inHold() {
    return HOLD_PHASES.includes(this.phase);
  }

  /** The feet are planted for the jump or off the floor: no walking. */
  get feetLocked() {
    return this.holding || this.airborne || this.inHold;
  }

  /** Seconds until the apex of the current jump (null when not rising with the ball). */
  apexIn(now: number): number | null {
    return this.phase === "air" || this.phase === "rise" ? this.apexAt - now : null;
  }

  /** Horizontal distance from the player to the rim centre (m). */
  distanceToRim() {
    return Math.hypot(RIM.x - this.body.position.x, RIM.z - this.body.position.z);
  }

  /** New run: drop any shot in progress and put the feet back on the floor. */
  restart() {
    this.phase = "none";
    this.jumpY = 0;
    this.airborne = false;
    this.spaceDown = false;
    this.jabAmount = 0;
    this.jabOffset.set(0, 0, 0);
    this.protectAmount = 0;
    this.iHeld = this.kHeld = false;
    this.iUntil = this.kUntil = -Infinity;
    this.nextKey = null;
    this.fade = false;
    this.finish = null;
    this.lean = 0;
    this.scored = false;
    this.rimHits = 0;
    this.boardHits = 0;
  }

  /** Space went down. Holding a move input that points away from the hoop makes it a fadeaway (and not a pump fake). */
  press(now: number, move?: THREE.Vector3) {
    const fromHold = this.inHold;
    if (this.phase !== "none" && !fromHold) return;
    const s = this.dribble.state;
    if (!fromHold && (s === "loose" || s === "shot" || this.dribble.spinMoving)) return; // no jumper out of a spin
    this.spaceDown = true;
    this.pressAt = now;
    this.fade = move ? this.movingAway(move) : false;
    this.nextKey = null;
    this.finish = null;
    // Sprinting at the hoop within range wins over the pump fake and the jumper.
    const finish = !fromHold && !this.fade ? this.finishKind() : null;
    if (finish) return this.startFinish(now, finish);
    if (fromHold) this.gather(now);
    else if (s === "flight") this.phase = "pickup";
    else this.gather(now);
  }

  /** Running at the rim (fast enough, pointing at it) and close enough: which finish Space would be. */
  finishKind(): FinishKind | null {
    const F = SHOT.finish;
    const v = this.body.velocity;
    const speed = Math.hypot(v.x, v.z);
    const distance = this.distanceToRim();
    if (speed < F.minSpeed || distance > F.layupRange || distance < 1e-3) return null;
    const toRim = (RIM.x - this.body.position.x) * v.x + (RIM.z - this.body.position.z) * v.z;
    if (toRim / (speed * distance) < F.minAlign) return null;
    return distance <= F.dunkRange ? "dunk" : "layup";
  }

  /** The move input points away from the rim (within ~60° of directly away). */
  private movingAway(move: THREE.Vector3) {
    const away = this.tmp.set(this.body.position.x - RIM.x, 0, this.body.position.z - RIM.z);
    if (move.lengthSq() < 0.01 || away.lengthSq() < 1e-6) return false;
    return move.dot(away.normalize()) / move.length() > SHOT.fade.minAlign;
  }

  /** Space came up: the ball goes at the next substep (or as soon as the feet leave the floor); a quick tap is a pump fake instead. */
  lift(now: number) {
    this.spaceDown = false;
    const early = now - this.pressAt < SHOT.tapTime;
    if (!early || this.fade) return;
    if (this.phase === "pickup") this.gather(now);
    if (this.phase !== "gather") return;
    this.phase = "pump";
    this.moveAt = now;
    this.pumpFrom.copy(this.dribble.ball.position);
    this.events.abort();
    this.events.hold({ kind: "pump", from: "R", to: "R", timing: "clean" });
  }

  /** A dribble key while in the hold: I / J / K / L are moves out of it, , U O go back to dribbling. */
  holdKey(key: DribbleKey, now: number): HoldResult {
    if (!this.inHold) return "none";
    if (key === "I" || key === "K") {
      // Held modifiers: they combine with each other and with the J / L reaches.
      const first = key === "I" ? now > this.iUntil && !this.iHeld : now > this.kUntil && !this.kHeld;
      if (key === "I") {
        this.iHeld = true;
        this.iUntil = now + SHOT.protectTime / 2;
      } else {
        this.kHeld = true;
        this.kUntil = now + SHOT.jabTime;
      }
      if (first) this.events.hold({ kind: key === "I" ? "protect" : "jab", from: key === "I" ? "R" : "L", to: key === "I" ? "R" : "L", timing: "clean" });
      return "move";
    }
    if (key === "J" || key === "L") {
      if (this.phase === "hold") this.startHoldMove(key, now);
      else if (this.phase !== "pump") this.nextKey = key; // mid-reach: acts when the ball is back
      return "move";
    }
    // A way out: the ball goes back to the hand and the key is the dribble move.
    this.phase = "none";
    this.iHeld = this.kHeld = false;
    this.iUntil = this.kUntil = -Infinity;
    this.nextKey = null;
    this.spaceDown = false;
    this.dribble.receive("R");
    return "exit";
  }

  /** A key went up: I / K let go of the hunch / the stepped-out foot. */
  holdKeyUp(key: DribbleKey) {
    if (key === "I") this.iHeld = false;
    else if (key === "K") this.kHeld = false;
  }

  private startHoldMove(key: "J" | "L", now: number) {
    this.moveAt = now;
    this.phase = "ext";
    this.extSide = key === "J" ? "L" : "R";
    this.events.hold({ kind: key === "J" ? "extL" : "extR", from: this.extSide, to: this.extSide, timing: "clean" });
  }

  /** A hoop contact during the shot. */
  onHoopHit(hit: HoopHit) {
    if (this.phase !== "flight") return;
    if (hit.part === "rim") this.rimHits++;
    else this.boardHits++;
  }

  /** The ball dropped through a ring. */
  onScore() {
    if (this.phase === "flight") this.scored = true;
  }

  update(now: number) {
    this.now = now;
    if (this.airborne) {
      const t = now - this.liftAt;
      this.jumpY = this.leap * t - 0.5 * GRAVITY * t * t;
      if (this.jumpY <= 0 && t > 0) {
        this.jumpY = 0;
        this.airborne = false;
      }
      // Fadeaway: float away from the rim over the jump, tilting back as the body rises.
      if (this.fade) {
        const away = this.tmp.set(this.body.position.x - RIM.x, 0, this.body.position.z - RIM.z);
        if (away.lengthSq() > 1e-6) {
          const step = Math.max(0, Math.min(t, AIR_TIME) - this.driftT);
          this.body.position.addScaledVector(away.normalize(), (SHOT.fade.drift / AIR_TIME) * step);
          this.driftT = Math.max(this.driftT, Math.min(t, AIR_TIME));
        }
      }
    }
    const leanTo = this.fade && this.airborne ? 1 : 0;
    this.lean += (leanTo - this.lean) * Math.min(1, (this.fade ? 14 : 8) * (now - this.lastUpdate || 0));
    if (this.lean < 1e-3 && !this.airborne) this.lean = 0;
    this.lastUpdate = now;
    const ball = this.dribble.ball;
    this.updateStance(now);

    switch (this.phase) {
      case "pump": {
        const u = (now - this.moveAt) / SHOT.pumpTime;
        const top = this.local(PUMP_TOP, 0, this.tmp);
        const home = this.local(HOLD, 0, this.tmp2);
        if (u < 0.5) ball.carryTo(home.copy(this.pumpFrom).lerp(top, smooth(u * 2)), 1 / 240);
        else ball.carryTo(top.lerp(home, smooth(Math.min(1, (u - 0.5) * 2))), 1 / 240);
        if (u >= 1) this.phase = "hold";
        break;
      }
      case "hold": {
        ball.carryTo(this.local(this.protectLocal(this.protectAmount), 0, this.tmp), 1 / 240);
        break;
      }
      case "ext": {
        const u = Math.min(1, (now - this.moveAt) / SHOT.extTime);
        const reach = smooth(Math.sin(Math.PI * u));
        const side = this.extSide === "L" ? 1 : -1;
        const base = this.protectLocal(this.protectAmount);
        const to: V3 = [base[0] + (side * REACH[0] - base[0]) * reach, base[1] + (REACH[1] - base[1]) * reach, base[2] + (REACH[2] - base[2]) * reach];
        ball.carryTo(this.local(to, 0, this.tmp), 1 / 240);
        if (u >= 1) this.endHoldMove(now);
        break;
      }
      case "pickup": {
        const s = this.dribble.state;
        if (s === "held" || s === "carry") this.gather(now);
        else if (s !== "flight") this.phase = "none";
        // Take it on the way up, as the hand would have.
        else if (now >= this.dribble.catchAt - DRIBBLE.okWindow) this.gather(now);
        break;
      }
      case "gather": {
        const u = Math.min(1, (now - this.gatherStart) / SHOT.gatherTime);
        this.local(POCKET, 0, this.tmp);
        ball.carryTo(this.tmp2.lerpVectors(this.gatherFrom, this.tmp, smooth(u)), 1 / 240);
        if (u >= 1) {
          this.phase = "air";
          this.airborne = true;
          this.liftAt = now;
          this.driftT = 0;
          this.leap = LEAP;
          this.apexAt = now + LEAP / GRAVITY;
        }
        break;
      }
      case "air": {
        const u = Math.min(1, (now - this.liftAt) / SHOT.setTime);
        const a = this.local(POCKET, this.jumpY, this.tmp);
        const b = this.local(SET, this.jumpY, this.tmp2);
        ball.carryTo(a.lerp(b, smooth(u)), 1 / 240);
        const falling = now > this.apexAt;
        if (!this.spaceDown) this.release(now, false);
        else if (falling && this.jumpY < SHOT.forcedReleaseHeight) this.release(now, true);
        break;
      }
      case "rise": {
        this.updateRise(now);
        break;
      }
      case "flight": {
        if (this.scored) {
          this.resolve(now, true);
          break;
        }
        const t = now - this.releasedAt;
        const p = ball.position;
        if ((t > 0.3 && p.y < RIM_HEIGHT - 1.4 && ball.velocity.y < 0) || t > SHOT.flightTimeout) this.resolve(now, false);
        break;
      }
      case "rebound": {
        const t = now - this.resolvedAt;
        const wait = this.lastResult?.made ? SHOT.reboundWaitMade : SHOT.reboundWaitMiss;
        if ((t >= wait && ball.position.y < 2) || t > 2.5) this.pass(now);
        break;
      }
      case "pass": {
        if (now - this.passStart >= SHOT.passTime) {
          this.phase = "none";
          this.dribble.receive("R" satisfies Hand);
        }
        break;
      }
    }
  }

  /** A reach is over: back to the hold, and a key pressed meanwhile goes next. */
  private endHoldMove(now: number) {
    this.phase = "hold";
    const next = this.nextKey;
    this.nextKey = null;
    if (next) this.startHoldMove(next, now);
  }

  /** Space while sprinting at the rim: no dip, the feet leave the floor now and carry on toward the basket. */
  private startFinish(now: number, kind: FinishKind) {
    const F = SHOT.finish;
    this.dribble.surrender();
    this.events.gather();
    this.finish = kind;
    this.phase = "rise";
    this.airborne = true;
    this.liftAt = now;
    this.driftT = 0;
    this.leap = leapFor(kind === "dunk" ? F.dunkJump : F.layupJump);
    this.apexAt = now + this.leap / GRAVITY;
    this.gatherFrom.copy(this.dribble.ball.position);
    // Where the feet are at the top: toward the rim, stopping short of it by the stand-off.
    const from = this.finishFrom.copy(this.body.position).setY(0);
    const to = this.finishTo;
    const dx = RIM.x - from.x;
    const dz = RIM.z - from.z;
    const d = Math.hypot(dx, dz);
    const stop = kind === "dunk" ? F.dunkStandoff : Math.max(F.layupStandoff, d - F.layupTravel);
    const travel = Math.max(0, d - stop);
    to.set(from.x + (dx / d) * travel, 0, from.z + (dz / d) * travel);
  }

  /** The running take-off: glide toward the rim and carry the ball up; at the top, shoot the layup / slam the dunk. */
  private updateRise(now: number) {
    const F = SHOT.finish;
    const ball = this.dribble.ball;
    const rise = this.apexAt - this.liftAt;
    const t = now - this.liftAt;
    const u = THREE.MathUtils.clamp(t / rise, 0, 1);
    // Momentum carries the body in, easing off as it reaches the top.
    this.body.position.lerpVectors(this.finishFrom, this.finishTo, u * (2 - u));
    const dunk = this.finish === "dunk";
    const a = this.local(POCKET, this.jumpY, this.tmp);
    const b = this.local(dunk ? DUNK_SET : LAYUP_SET, this.jumpY, this.tmp2);
    const path = a.lerp(b, smooth(THREE.MathUtils.clamp(t / (rise * 0.8), 0, 1)));
    if (dunk) {
      // Over the last of the climb the hand takes the ball to just above the rim.
      const over = smooth(THREE.MathUtils.clamp((u - 0.45) / 0.55, 0, 1));
      path.lerp(this.tmp2.set(RIM.x, RIM.y + F.dunkAbove, RIM.z), over);
    }
    // The first few tenths of a second the ball comes up from where the hand had it.
    const grab = smooth(THREE.MathUtils.clamp(t / 0.12, 0, 1));
    ball.carryTo(path.lerpVectors(this.gatherFrom, path, grab), 1 / 240);
    if (now >= this.apexAt) this.releaseFinish(now);
  }

  private releaseFinish(now: number) {
    const F = SHOT.finish;
    const ball = this.dribble.ball;
    const dunk = this.finish === "dunk";
    const from = ball.position;
    const distance = Math.hypot(RIM.x - from.x, RIM.z - from.z);
    const velocity = new THREE.Vector3();
    let angle = 90;
    let speed = F.dunkSlam;
    if (dunk) {
      velocity.set(0, -F.dunkSlam, 0);
      ball.release(velocity);
    } else {
      const dir = this.tmp.set(RIM.x - from.x, 0, RIM.z - from.z).normalize();
      const target = this.tmp2.copy(RIM).addScaledVector(dir, F.layupAim + (this.random() * 2 - 1) * F.layupScatter);
      const side = (this.random() * 2 - 1) * F.layupScatter;
      target.x += -dir.z * side;
      target.z += dir.x * side;
      const launch = solveLaunch(from, target, THREE.MathUtils.degToRad(F.layupAngle), velocity);
      angle = THREE.MathUtils.radToDeg(launch.angle);
      speed = launch.speed;
      ball.release(velocity, new THREE.Vector3().crossVectors(dir, UP).multiplyScalar(SHOT.backspin * 0.5));
    }
    this.phase = "flight";
    this.releasedAt = now;
    this.rimHits = 0;
    this.boardHits = 0;
    this.scored = false;
    this.lastRelease = {
      grade: "perfect",
      error: 0,
      tolerance: 0,
      distance: +distance.toFixed(3),
      three: false,
      angle: +angle.toFixed(2),
      speed: +speed.toFixed(3),
      forced: false,
      fade: false,
      finish: this.finish,
    };
    this.events.release(this.lastRelease);
  }

  private gather(now: number) {
    this.dribble.surrender();
    this.phase = "gather";
    this.gatherStart = now;
    this.gatherFrom.copy(this.dribble.ball.position);
    this.events.gather();
  }

  private release(now: number, forced: boolean) {
    const ball = this.dribble.ball;
    const from = ball.position;
    const dir = this.tmp.set(RIM.x - from.x, 0, RIM.z - from.z);
    const distance = dir.length();
    if (distance < 1e-3) dir.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw));
    dir.normalize();
    const tolerance = this.tolerance(distance);
    const error = now - this.apexAt;
    const units = THREE.MathUtils.clamp(error / tolerance, -SHOT.maxUnits, SHOT.maxUnits);
    const grade: ReleaseGrade = Math.abs(error) <= tolerance ? "perfect" : error < 0 ? "early" : "late";

    // Aim point: the rim centre, pushed short/long by the timing and a hair of human spread.
    const beyond = Math.max(0, Math.abs(units) - 1);
    const depth =
      Math.sign(units) * Math.min(SHOT.maxMiss, SHOT.depthPerUnit * Math.min(1, Math.abs(units)) + SHOT.depthBeyond * beyond) +
      (this.random() * 2 - 1) * SHOT.scatter;
    const drift = units > 0 ? Math.min(SHOT.maxMiss, SHOT.lateDrift * beyond) * (this.random() < 0.5 ? -1 : 1) : 0;
    const side = drift + (this.random() * 2 - 1) * SHOT.scatter;
    const target = this.tmp2.copy(RIM).addScaledVector(dir, depth);
    target.x += -dir.z * side;
    target.z += dir.x * side;
    const velocity = new THREE.Vector3();
    const angle = THREE.MathUtils.degToRad(SHOT.launchAngle - SHOT.arcPerUnit * units);
    const launch = solveLaunch(from, target, angle, velocity);
    // Backspin: the top of the ball turns back toward the shooter.
    const spin = new THREE.Vector3().crossVectors(dir, UP).multiplyScalar(SHOT.backspin);
    ball.release(velocity, spin);

    this.phase = "flight";
    this.releasedAt = now;
    this.rimHits = 0;
    this.boardHits = 0;
    this.scored = false;
    this.lastRelease = {
      grade,
      error: +error.toFixed(4),
      tolerance: +tolerance.toFixed(4),
      distance: +distance.toFixed(3),
      three: isThree(this.body.position.x, this.body.position.z),
      angle: +THREE.MathUtils.radToDeg(launch.angle).toFixed(2),
      speed: +launch.speed.toFixed(3),
      forced,
      fade: this.fade,
      finish: null,
    };
    this.events.release(this.lastRelease);
  }

  private resolve(now: number, made: boolean) {
    const kind: ShotKind = made
      ? this.boardHits > 0
        ? "bank"
        : this.rimHits > 0
          ? "rim"
          : "swish"
      : this.rimHits > 0
        ? "rim-out"
        : this.boardHits > 0
          ? "board"
          : "airball";
    this.attempts++;
    if (made) this.makes++;
    this.lastResult = { ...this.lastRelease!, made, kind, rimHits: this.rimHits, boardHits: this.boardHits };
    this.phase = "rebound";
    this.resolvedAt = now;
    this.events.result(this.lastResult);
  }

  /** Perfect-release half window (s) for this jump: tighter on a fadeaway. */
  private tolerance(distance: number) {
    return shotTolerance(distance) * (this.fade ? SHOT.fade.toleranceScale : 1);
  }

  /** The rebounder's short pass back: a ballistic lob to where the player will be. */
  private pass(now: number) {
    const ball = this.dribble.ball;
    const T = SHOT.passTime;
    const ahead = this.tmp2.copy(this.body.position).addScaledVector(this.body.velocity, T);
    const to = toWorld(PASS_TO, ahead, this.body.yaw, this.tmp);
    const v = to.sub(ball.position).divideScalar(T);
    v.y += (GRAVITY * T) / 2;
    ball.release(v);
    this.phase = "pass";
    this.passStart = now;
  }

  /** The ball held low on the side of the body away from the hoop, eased out from the hold by `amount`. */
  /** Eases the hunch (I) and the stepped-out foot (K) toward held / off; the foot goes where the body points. */
  private updateStance(now: number) {
    const dt = Math.min(0.05, Math.max(0, now - this.lastStance));
    this.lastStance = now;
    const hold = this.inHold;
    const hunch = hold && (this.iHeld || now < this.iUntil) ? 1 : 0;
    const foot = hold && (this.kHeld || now < this.kUntil) ? 1 : 0;
    this.protectAmount += (hunch - this.protectAmount) * (1 - Math.exp(-dt * 14));
    this.jabAmount += (foot - this.jabAmount) * (1 - Math.exp(-dt * 20));
    if (this.protectAmount < 1e-3 && !hunch) this.protectAmount = 0;
    if (this.jabAmount < 1e-3 && !foot) this.jabAmount = 0;
    const out = this.tmp2.set(Math.sin(this.body.yaw), 0, Math.cos(this.body.yaw)).multiplyScalar(this.jabAmount * SHOT.jabDistance);
    this.body.position.add(out).sub(this.jabOffset);
    this.jabOffset.copy(out);
  }

  /** Body-local ball spot in the hold, hunched over by `amount`: on the hip farther from the rim. */
  private protectLocal(amount: number): V3 {
    const ax = this.body.position.x - RIM.x;
    const az = this.body.position.z - RIM.z;
    const side = Math.sign(Math.cos(this.body.yaw) * ax - Math.sin(this.body.yaw) * az) || 1;
    const to: V3 = [side * 0.5, 0.62, 0.3];
    return [HOLD[0] + (to[0] - HOLD[0]) * amount, HOLD[1] + (to[1] - HOLD[1]) * amount, HOLD[2] + (to[2] - HOLD[2]) * amount];
  }

  /** A body-local point (x: + left, y: height above the floor + `lift`) in world space. */
  private local(p: V3, lift: number, out: THREE.Vector3) {
    // Leaning back pulls the ball behind the head and the set point down a touch.
    const l = this.lean;
    return toWorld([p[0], p[1] + lift - 0.12 * l * (p[1] / SET[1]), p[2] - SHOT.fade.setBack * l * (p[1] / SET[1])], this.body.position, this.body.yaw, out);
  }

  /** Snapshot for the shot meter: 0…1 through the jump, the perfect zone, and the last grade. */
  meter() {
    const tol = this.tolerance(this.distanceToRim());
    const fill = this.phase === "gather" || this.phase === "pickup" ? 0 : THREE.MathUtils.clamp((this.now - this.liftAt) / AIR_TIME, 0, 1);
    const half = tol / AIR_TIME;
    return {
      fill: this.phase === "air" ? fill : this.lastRelease ? THREE.MathUtils.clamp((this.releasedAt - this.liftAt) / AIR_TIME, 0, 1) : 0,
      zone: [0.5 - half, 0.5 + half] as [number, number],
      grade: this.phase === "air" || this.holding ? null : (this.lastRelease?.grade ?? null),
    };
  }
}
