import * as THREE from "three";
import { FLOOR_MAX_X, FLOOR_MAX_Z, FLOOR_MIN_X, FLOOR_MIN_Z, HOOP_X } from "./dimensions";

/** Movement tuning (m/s, m/s², rad/s). */
export const MOVE = {
  walk: 3.4,
  sprint: 5.6,
  /** Speed multiplier while dribbling. */
  dribbling: 0.86,
  accel: 16,
  /** Decay rate (1/s) of a hold-cross slide. */
  slideRate: 7,
  turnRate: 9,
  /** A cut sharper than this (rad) at speed squeaks the sneakers. */
  squeakAngle: 1.7,
  squeakMinSpeed: 2.2,
};

/** Keeps the body inside the gym floor; the ball's bounds match. */
const BODY_MARGIN = 0.35;

/**
 * Player body on the floor: accelerates toward the camera-relative WASD
 * direction, faces where it is going (the +X hoop when idle) and squeaks on
 * hard cuts and stops.
 */
export class Locomotion {
  readonly velocity = new THREE.Vector3();
  readonly facing = new THREE.Vector3(1, 0, 0);
  yaw = Math.atan2(1, 0);
  sprinting = false;
  private squeakCooldown = 0;
  /** Sideways slide (hold-cross): a velocity that dies away, covering `distance` in total. */
  private readonly slideVel = new THREE.Vector3();
  /** Spin move: a full turn about Y that comes back to the facing it started from. */
  private spinDir = 0;
  private spinLeft = 0;
  private spinTime = 0;
  /** Extra yaw (rad) the spin adds on top of `yaw`. */
  spinAngle = 0;
  private readonly want = new THREE.Vector3();

  constructor(readonly position: THREE.Vector3) {}

  /**
   * @param input world-space move direction on the floor (length ≤ 1)
   * @param sprint Shift held
   */
  step(dt: number, input: THREE.Vector3, sprint: boolean, dribbling: boolean, onSqueak: (speed: number) => void) {
    const moving = input.lengthSq() > 1e-4;
    this.sprinting = sprint && moving;
    const top = (this.sprinting ? MOVE.sprint : MOVE.walk) * (dribbling ? MOVE.dribbling : 1);
    this.want.copy(input).multiplyScalar(top);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.squeakCooldown -= dt;
    if (speed > MOVE.squeakMinSpeed && this.squeakCooldown <= 0) {
      const cut = moving ? this.velocity.angleTo(this.want) : Math.PI;
      if (cut > MOVE.squeakAngle) {
        onSqueak(speed);
        this.squeakCooldown = 0.35;
      }
    }

    // Accelerate toward the wanted velocity (feet can only push so hard).
    const dv = this.want.sub(this.velocity);
    const max = MOVE.accel * dt;
    if (dv.length() > max) dv.setLength(max);
    this.velocity.add(dv);
    this.position.addScaledVector(this.velocity, dt);
    this.position.addScaledVector(this.slideVel, dt);
    this.slideVel.multiplyScalar(Math.exp(-MOVE.slideRate * dt));
    if (this.spinLeft > 0) {
      this.spinLeft = Math.max(0, this.spinLeft - dt);
      const u = 1 - this.spinLeft / this.spinTime;
      this.spinAngle = this.spinLeft > 0 ? this.spinDir * Math.PI * 2 * u * u * (3 - 2 * u) : 0;
    }

    const p = this.position;
    const clampAxis = (axis: "x" | "z", min: number, max: number) => {
      if (p[axis] < min || p[axis] > max) {
        p[axis] = THREE.MathUtils.clamp(p[axis], min, max);
        this.velocity[axis] = 0;
      }
    };
    clampAxis("x", FLOOR_MIN_X + BODY_MARGIN, FLOOR_MAX_X - BODY_MARGIN);
    clampAxis("z", FLOOR_MIN_Z + BODY_MARGIN, FLOOR_MAX_Z - BODY_MARGIN);

    // Face the way we're going; square up to the hoop when standing.
    const target = moving ? Math.atan2(input.x, input.z) : Math.atan2(HOOP_X - p.x, -p.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += THREE.MathUtils.clamp(d, -MOVE.turnRate * dt, MOVE.turnRate * dt);
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Slides sideways: `dir` is a unit floor vector, `distance` metres in total. */
  slide(dir: THREE.Vector3, distance: number) {
    this.slideVel.copy(dir).multiplyScalar(distance * MOVE.slideRate);
  }

  /** Turns a full circle (+1 = to the player's left) over `time` seconds. */
  spin(dir: 1 | -1, time: number) {
    this.spinDir = dir;
    this.spinTime = time;
    this.spinLeft = time;
  }

  /** Where the body is drawn facing: the heading plus any spin in progress. */
  get renderYaw() {
    return this.yaw + this.spinAngle;
  }

  /** Average ground velocity over the next `horizon` seconds, counting a slide that is still running. */
  expectedVelocity(horizon: number, out: THREE.Vector3) {
    const k = MOVE.slideRate;
    const avg = horizon > 1e-3 ? (1 - Math.exp(-k * horizon)) / (k * horizon) : 1;
    return out.copy(this.velocity).addScaledVector(this.slideVel, avg);
  }

  /** Stand still at `at`, squared up to the +X hoop. */
  placeAt(at: THREE.Vector3) {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.slideVel.set(0, 0, 0);
    this.spinLeft = 0;
    this.spinAngle = 0;
    this.yaw = Math.atan2(HOOP_X - at.x, -at.z);
    this.facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
