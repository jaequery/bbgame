import * as THREE from "three";
import {
  BALL_FLOOR_FRICTION,
  BALL_MASS,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_ROLLING_DECEL,
  BALL_WALL_RESTITUTION,
  FLOOR_MAX_X,
  FLOOR_MAX_Z,
  FLOOR_MIN_X,
  FLOOR_MIN_Z,
  GRAVITY,
} from "./dimensions";

/** Thin-shelled sphere: I = 2/3 m r². */
export const INERTIA = (2 / 3) * BALL_MASS * BALL_RADIUS * BALL_RADIUS;
/** Below this rebound speed the ball stops bouncing and rolls. */
const SETTLE_SPEED = 0.35;

/** Something the free ball can hit besides the floor (the hoops). */
export interface BallObstacle {
  collide(ball: BallBody, dt: number): void;
}

export interface BounceEvent {
  position: THREE.Vector3;
  /** Normal impact speed (m/s) — drives the thump volume. */
  speed: number;
}

/**
 * The ball as a rigid body: gravity, floor bounce with restitution, Coulomb
 * friction at the contact patch coupling spin and slide, rolling resistance and
 * the gym bounds. While a hand is in contact the dribble controller drives the
 * position instead (`kinematic`).
 */
export class BallBody {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Angular velocity (rad/s, world axes). */
  readonly spin = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  kinematic = true;
  rolling = false;
  /** Checked after every free substep. */
  obstacles: BallObstacle[] = [];

  private readonly prev = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  /** Advances one fixed substep. Kinematic: derive velocity from the hand's motion. */
  step(dt: number, onBounce: (e: BounceEvent) => void) {
    if (this.kinematic) {
      this.integrateSpin(dt);
      return;
    }
    const p = this.position;
    const v = this.velocity;
    if (!this.rolling) v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);

    if (p.y <= BALL_RADIUS && v.y <= 0) {
      p.y = BALL_RADIUS;
      const impact = -v.y;
      if (this.rolling || impact < SETTLE_SPEED) {
        v.y = 0;
        this.rolling = true;
        this.roll(dt);
      } else {
        v.y = impact * BALL_RESTITUTION;
        this.frictionImpulse((1 + BALL_RESTITUTION) * BALL_MASS * impact);
        onBounce({ position: p.clone(), speed: impact });
      }
    }

    // Gym bounds: bounce off as if they were walls.
    const walls: [number, number, "x" | "z"][] = [
      [FLOOR_MIN_X, FLOOR_MAX_X, "x"],
      [FLOOR_MIN_Z, FLOOR_MAX_Z, "z"],
    ];
    for (const [min, max, axis] of walls) {
      if (p[axis] < min + BALL_RADIUS && v[axis] < 0) {
        p[axis] = min + BALL_RADIUS;
        v[axis] *= -BALL_WALL_RESTITUTION;
      } else if (p[axis] > max - BALL_RADIUS && v[axis] > 0) {
        p[axis] = max - BALL_RADIUS;
        v[axis] *= -BALL_WALL_RESTITUTION;
      }
    }
    for (const o of this.obstacles) o.collide(this, dt);
    this.integrateSpin(dt);
  }

  /** Puts the ball under a hand: it follows `target` and its velocity is the hand's. */
  carryTo(target: THREE.Vector3, dt: number) {
    this.kinematic = true;
    this.rolling = false;
    this.prev.copy(this.position);
    this.position.copy(target);
    if (dt > 0) this.velocity.subVectors(this.position, this.prev).divideScalar(dt);
  }

  /** Lets go: from here on the ball is free. Spin defaults to rolling-matched (no slip at the bounce). */
  release(velocity: THREE.Vector3, spin?: THREE.Vector3) {
    this.kinematic = false;
    this.rolling = false;
    this.velocity.copy(velocity);
    if (spin) this.spin.copy(spin);
    else rollingSpin(velocity, this.spin);
  }

  /**
   * Collision with a surface whose outward normal is `n` (unit, pointing at the
   * ball centre): restitution along the normal, Coulomb friction at the contact
   * point trading slide for spin. Returns the normal impact speed (0 if separating).
   */
  bounceOff(n: THREE.Vector3, restitution: number, friction: number): number {
    const v = this.velocity;
    const vn = v.dot(n);
    if (vn >= 0) return 0;
    const jn = -(1 + restitution) * vn * BALL_MASS;
    v.addScaledVector(n, jn / BALL_MASS);
    // Contact point velocity v + ω × r, with r = −R n from centre to contact.
    const r = this.tmp.copy(n).multiplyScalar(-BALL_RADIUS);
    const slip = new THREE.Vector3().crossVectors(this.spin, r).add(v);
    slip.addScaledVector(n, -slip.dot(n));
    const slipSpeed = slip.length();
    if (slipSpeed > 1e-5) {
      const stop = slipSpeed / (1 / BALL_MASS + (BALL_RADIUS * BALL_RADIUS) / INERTIA);
      const J = slip.multiplyScalar(-Math.min(stop, friction * jn) / slipSpeed);
      v.addScaledVector(J, 1 / BALL_MASS);
      this.spin.addScaledVector(r.cross(J), 1 / INERTIA);
    }
    return -vn;
  }

  /** Horizontal speed (m/s). */
  get groundSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  private integrateSpin(dt: number) {
    const w = this.spin.length();
    if (w < 1e-6) return;
    const q = new THREE.Quaternion().setFromAxisAngle(this.tmp.copy(this.spin).divideScalar(w), w * dt);
    this.orientation.premultiply(q).normalize();
  }

  /** Coulomb friction at the contact patch during a bounce: trades slide for spin. */
  private frictionImpulse(normalImpulse: number) {
    const slip = contactSlip(this.velocity, this.spin, this.tmp);
    const slipSpeed = slip.length();
    if (slipSpeed < 1e-5) return;
    // Impulse that would stop the slip entirely (linear + angular response).
    const stop = slipSpeed / (1 / BALL_MASS + (BALL_RADIUS * BALL_RADIUS) / INERTIA);
    const j = Math.min(stop, BALL_FLOOR_FRICTION * normalImpulse);
    this.applyContactImpulse(slip.normalize().multiplyScalar(-j));
  }

  private roll(dt: number) {
    const v = this.velocity;
    // Friction drives the ball to pure rolling, then rolling resistance slows it.
    const slip = contactSlip(v, this.spin, this.tmp);
    const slipSpeed = slip.length();
    if (slipSpeed > 1e-4) {
      const stop = slipSpeed / (1 / BALL_MASS + (BALL_RADIUS * BALL_RADIUS) / INERTIA);
      const j = Math.min(stop, BALL_FLOOR_FRICTION * BALL_MASS * GRAVITY * dt);
      this.applyContactImpulse(slip.normalize().multiplyScalar(-j));
    }
    const speed = this.groundSpeed;
    if (speed > 0) {
      const s = Math.max(0, speed - BALL_ROLLING_DECEL * dt) / speed;
      v.x *= s;
      v.z *= s;
      rollingSpin(v, this.spin);
    }
  }

  private applyContactImpulse(j: THREE.Vector3) {
    this.velocity.addScaledVector(j, 1 / BALL_MASS);
    // τ = r × J with r = (0, −R, 0) from centre to contact.
    this.spin.x += (-BALL_RADIUS * j.z) / INERTIA;
    this.spin.z += (BALL_RADIUS * j.x) / INERTIA;
  }
}

/** Velocity of the contact point (centre velocity + ω × r) on the floor plane. */
function contactSlip(v: THREE.Vector3, w: THREE.Vector3, out: THREE.Vector3) {
  return out.set(v.x + w.z * BALL_RADIUS, 0, v.z - w.x * BALL_RADIUS);
}

/** Spin for which the contact point does not slide at this velocity. */
export function rollingSpin(v: THREE.Vector3, out: THREE.Vector3) {
  return out.set(v.z / BALL_RADIUS, out.y, -v.x / BALL_RADIUS);
}

export interface DribblePlan {
  velocity: THREE.Vector3;
  /** Seconds from release to the floor. */
  tBounce: number;
  /** Seconds from release until the ball, rising, reaches the catch height. */
  tCatch: number;
}

/**
 * Ballistic push from `release` that bounces once and comes back up to
 * `catchPoint` (world, where the hand will be), peaking `apexMargin` above it so
 * the hand meets the ball just before the top. Pure physics: the planner only
 * picks the release velocity.
 */
export function planDribble(release: THREE.Vector3, catchPoint: THREE.Vector3, apexMargin: number): DribblePlan {
  const r = BALL_RADIUS;
  const g = GRAVITY;
  const e = BALL_RESTITUTION;
  const rise = Math.max(0.05, catchPoint.y - r);
  const vUp = Math.sqrt(2 * g * (rise + apexMargin));
  const vImpact = vUp / e;
  const drop = Math.max(0, release.y - r);
  const v0 = Math.sqrt(Math.max(0, vImpact * vImpact - 2 * g * drop)); // downward push speed
  const tBounce = (vImpact - v0) / g;
  const tUp = (vUp - Math.sqrt(Math.max(0, vUp * vUp - 2 * g * rise))) / g;
  const tCatch = tBounce + tUp;
  const velocity = new THREE.Vector3(
    (catchPoint.x - release.x) / tCatch,
    -v0,
    (catchPoint.z - release.z) / tCatch,
  );
  return { velocity, tBounce, tCatch };
}

/**
 * When a free ball moving with `velocity` from `position` next reaches height
 * `catchY` on its way up after one bounce — or its apex, if it never gets that
 * high. Used to time the catch window for imperfect pushes.
 */
export function predictCatch(position: THREE.Vector3, velocity: THREE.Vector3, catchY: number) {
  const r = BALL_RADIUS;
  const g = GRAVITY;
  const v0 = -velocity.y; // downward positive
  const drop = Math.max(0, position.y - r);
  const vImpact = Math.sqrt(v0 * v0 + 2 * g * drop);
  const tBounce = (vImpact - v0) / g;
  const vUp = vImpact * BALL_RESTITUTION;
  const rise = catchY - r;
  const disc = vUp * vUp - 2 * g * rise;
  const tUp = disc >= 0 ? (vUp - Math.sqrt(disc)) / g : vUp / g;
  const apexY = r + (vUp * vUp) / (2 * g);
  return { tCatch: tBounce + tUp, apexY };
}
