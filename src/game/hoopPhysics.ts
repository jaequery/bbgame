import * as THREE from "three";
import type { BallBody, BallObstacle } from "./ballPhysics";
import {
  BACKBOARD_BOTTOM,
  BACKBOARD_FROM_BASELINE,
  BACKBOARD_HEIGHT,
  BACKBOARD_WIDTH,
  BALL_RADIUS,
  BOARD_FRICTION,
  BOARD_RESTITUTION,
  BOARD_THICKNESS,
  COURT_HALF_LENGTH,
  HOOP_X,
  NET_BOTTOM_RADIUS,
  NET_LENGTH,
  RIM_FRICTION,
  RIM_HEIGHT,
  RIM_RADIUS,
  RIM_RESTITUTION,
  RIM_TUBE,
} from "./dimensions";

/** Radius of the rim tube's centre line (inner diameter 18 in). */
const RIM_CENTRE_RADIUS = RIM_RADIUS + RIM_TUBE;
/** How hard the net mesh grabs a ball going through it (1/s). */
const NET_DRAG_H = 9;
const NET_DRAG_V = 2.2;

export interface HoopHit {
  part: "rim" | "board";
  /** Normal impact speed (m/s). */
  speed: number;
  position: THREE.Vector3;
}

export interface HoopEvents {
  hit(e: HoopHit): void;
  /** The ball's centre dropped through the rim plane inside the ring: a basket. */
  score(): void;
}

/**
 * One basket as the ball sees it: the rim as a torus of regulation tube
 * radius, the backboard as a glass box and the net as a soft funnel that grabs
 * a ball falling through. `side` = +1 for the hoop at +X.
 */
export class HoopCollider implements BallObstacle {
  readonly rim: THREE.Vector3;
  private readonly boardMin: THREE.Vector3;
  private readonly boardMax: THREE.Vector3;
  /** Set while a ball that came down through the ring is in the net. */
  private inNet = false;
  private readonly q = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(
    readonly side: 1 | -1,
    private readonly events: HoopEvents,
  ) {
    this.rim = new THREE.Vector3(side * HOOP_X, RIM_HEIGHT, 0);
    const face = side * (COURT_HALF_LENGTH - BACKBOARD_FROM_BASELINE);
    const back = face + side * BOARD_THICKNESS;
    this.boardMin = new THREE.Vector3(Math.min(face, back), BACKBOARD_BOTTOM, -BACKBOARD_WIDTH / 2);
    this.boardMax = new THREE.Vector3(Math.max(face, back), BACKBOARD_BOTTOM + BACKBOARD_HEIGHT, BACKBOARD_WIDTH / 2);
  }

  collide(ball: BallBody, dt: number) {
    const p = ball.position;
    const c = this.rim;
    if (!this.inNet && (p.y < RIM_HEIGHT - 1 || Math.abs(p.x - c.x) > 2.5 || Math.abs(p.z) > 2)) return;
    const prevY = p.y - ball.velocity.y * dt;

    this.collideRim(ball);
    this.collideBoard(ball);

    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const h = Math.hypot(dx, dz);
    if (prevY >= RIM_HEIGHT && p.y < RIM_HEIGHT && h < RIM_RADIUS) {
      this.inNet = true;
      this.events.score();
    }
    if (this.inNet) this.net(ball, dt, dx, dz, h);
  }

  private collideRim(ball: BallBody) {
    const p = ball.position;
    const c = this.rim;
    // Closest point on the tube's centre circle, then a sphere-vs-tube test.
    let hx = p.x - c.x;
    let hz = p.z - c.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 1e-6) {
      hx = 1;
      hz = 0;
    } else {
      hx /= hl;
      hz /= hl;
    }
    const q = this.q.set(c.x + hx * RIM_CENTRE_RADIUS, c.y, c.z + hz * RIM_CENTRE_RADIUS);
    const n = this.n.subVectors(p, q);
    const dist = n.length();
    const reach = BALL_RADIUS + RIM_TUBE;
    if (dist >= reach || dist < 1e-6) return;
    n.divideScalar(dist);
    p.copy(q).addScaledVector(n, reach);
    const speed = ball.bounceOff(n, RIM_RESTITUTION, RIM_FRICTION);
    if (speed > 0.25) this.events.hit({ part: "rim", speed, position: q.clone() });
  }

  private collideBoard(ball: BallBody) {
    const p = ball.position;
    const q = this.q.copy(p).clamp(this.boardMin, this.boardMax);
    const n = this.n.subVectors(p, q);
    const dist = n.length();
    if (dist >= BALL_RADIUS) return;
    if (dist < 1e-6) n.set(-this.side, 0, 0);
    else n.divideScalar(dist);
    p.copy(q).addScaledVector(n, BALL_RADIUS);
    const speed = ball.bounceOff(n, BOARD_RESTITUTION, BOARD_FRICTION);
    if (speed > 0.25) this.events.hit({ part: "board", speed, position: q.clone() });
  }

  /** Mesh drag plus a funnel narrowing to the net's bottom opening. */
  private net(ball: BallBody, dt: number, dx: number, dz: number, h: number) {
    const p = ball.position;
    const v = ball.velocity;
    const depth = RIM_HEIGHT - p.y;
    if (depth > NET_LENGTH + BALL_RADIUS || depth < -BALL_RADIUS) {
      this.inNet = false;
      return;
    }
    const kh = Math.exp(-NET_DRAG_H * dt);
    v.x *= kh;
    v.z *= kh;
    if (v.y < 0) v.y *= Math.exp(-NET_DRAG_V * dt);
    // The cords give, so the ball squeezes a little past the mesh radius.
    const t = THREE.MathUtils.clamp(depth / NET_LENGTH, 0, 1);
    const limit = Math.max(0, THREE.MathUtils.lerp(RIM_RADIUS, NET_BOTTOM_RADIUS, t) - BALL_RADIUS * 0.8);
    if (h > limit && h > 1e-6) {
      const s = limit / h;
      p.x = this.rim.x + dx * s;
      p.z = this.rim.z + dz * s;
      const radial = (v.x * dx + v.z * dz) / h;
      if (radial > 0) {
        v.x -= (radial * dx) / h;
        v.z -= (radial * dz) / h;
      }
    }
  }
}
