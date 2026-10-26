import * as THREE from "three";
import {
  GRAVITY,
  HOOP_X,
  RIM_HEIGHT,
  THREE_POINT_CORNER,
  THREE_POINT_RADIUS,
} from "./dimensions";
import { DRIBBLE, toWorld, type Body, type DribbleController, type Hand } from "./dribble";
import type { HoopHit } from "./hoopPhysics";

// The jumper: hold Space to gather the ball into both hands and rise, release
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
};

export type ShotPhase = "none" | "pickup" | "gather" | "air" | "flight" | "rebound" | "pass";
export type ReleaseGrade = "perfect" | "early" | "late";
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
  release(r: ShotRelease): void;
  result(r: ShotResult): void;
}

type V3 = [number, number, number];
/** Chest pocket at the bottom of the dip, and the set point over the forehead (standing; local, x: + left). */
const POCKET: V3 = [-0.04, 1.12, 0.32];
const SET: V3 = [-0.06, 2.02, 0.2];
/** Where the rebound pass is aimed: chest height, on the right. */
const PASS_TO: V3 = [-0.36, 1.0, 0.42];

const RIM = new THREE.Vector3(HOOP_X, RIM_HEIGHT, 0);
const UP = THREE.Object3D.DEFAULT_UP;
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Take-off speed for the jump height. */
const LEAP = Math.sqrt(2 * GRAVITY * SHOT.jumpHeight);
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

  private spaceDown = false;
  private airborne = false;
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
    return this.phase === "gather" || this.phase === "air";
  }

  /** The feet are planted for the jump or off the floor: no walking. */
  get feetLocked() {
    return this.holding || this.airborne;
  }

  /** Seconds until the apex of the current jump (null when not rising with the ball). */
  apexIn(now: number): number | null {
    return this.phase === "air" ? this.apexAt - now : null;
  }

  /** Horizontal distance from the player to the rim centre (m). */
  distanceToRim() {
    return Math.hypot(RIM.x - this.body.position.x, RIM.z - this.body.position.z);
  }

  /** Space went down. */
  press(now: number) {
    if (this.phase !== "none") return;
    const s = this.dribble.state;
    if (s === "loose" || s === "shot") return;
    this.spaceDown = true;
    if (s === "flight") this.phase = "pickup";
    else this.gather(now);
  }

  /** Space came up: the ball goes at the next substep (or as soon as the feet leave the floor). */
  lift() {
    this.spaceDown = false;
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
      this.jumpY = LEAP * t - 0.5 * GRAVITY * t * t;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.airborne = false;
      }
    }
    const ball = this.dribble.ball;

    switch (this.phase) {
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
    const tolerance = shotTolerance(distance);
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

  /** A body-local point (x: + left, y: height above the floor + `lift`) in world space. */
  private local(p: V3, lift: number, out: THREE.Vector3) {
    return toWorld([p[0], p[1] + lift, p[2]], this.body.position, this.body.yaw, out);
  }

  /** Snapshot for the shot meter: 0…1 through the jump, the perfect zone, and the last grade. */
  meter() {
    const tol = shotTolerance(this.distanceToRim());
    const fill = this.phase === "gather" || this.phase === "pickup" ? 0 : THREE.MathUtils.clamp((this.now - this.liftAt) / AIR_TIME, 0, 1);
    const half = tol / AIR_TIME;
    return {
      fill: this.phase === "air" ? fill : this.lastRelease ? THREE.MathUtils.clamp((this.releasedAt - this.liftAt) / AIR_TIME, 0, 1) : 0,
      zone: [0.5 - half, 0.5 + half] as [number, number],
      grade: this.phase === "air" || this.holding ? null : (this.lastRelease?.grade ?? null),
    };
  }
}
