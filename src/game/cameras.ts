import * as THREE from "three";
import { HOOP_X } from "./dimensions";
import { hudStore, VIEW_ORDER, type ViewId } from "./hudStore";

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const GLIDE_SECONDS = 0.9;

/** What a camera view needs to know about the player each frame. */
export interface Subject {
  position: THREE.Vector3;
  /** Unit vector the player faces on the floor plane. */
  facing: THREE.Vector3;
}

const COURT_CENTER = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** The ideal pose of each view for the subject's current position. */
export function poseFor(view: ViewId, s: Subject, out: CameraPose): CameraPose {
  const side = new THREE.Vector3().crossVectors(s.facing, UP).normalize(); // player's right
  switch (view) {
    case "B": {
      // Low, behind and slightly right of the player; hoop ahead, ball at the feet.
      out.position
        .copy(s.position)
        .addScaledVector(s.facing, -3.1)
        .addScaledVector(side, 0.95)
        .setY(2.05);
      out.target.copy(s.position).addScaledVector(s.facing, 5).setY(1.05);
      out.fov = 55;
      break;
    }
    case "A": {
      // High diagonal (NBA Jam): whole court in frame, loosely follows the player.
      const focus = COURT_CENTER.clone().lerp(s.position, 0.35);
      out.position.copy(focus).add(new THREE.Vector3(17, 26, 30));
      out.target.copy(focus);
      out.fov = 32;
      break;
    }
    case "C": {
      // Sideline broadcast: tracks the player horizontally, looks across the court.
      const x = THREE.MathUtils.clamp(s.position.x, -HOOP_X, HOOP_X);
      out.position.set(x, 2.9, 8.4);
      out.target.set(x + 0.9, 1.2, s.position.z - 2);
      out.fov = 42;
      break;
    }
  }
  return out;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Owns the perspective camera and glides between views. During a glide the
 * pose blends from where the camera was to the *live* pose of the new view,
 * so it stays smooth even while the player moves. V retargets mid-glide.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  view: ViewId = "B";
  private from: CameraPose = blankPose();
  private ideal: CameraPose = blankPose();
  private current: CameraPose = blankPose();
  private glideT = 1;

  constructor(aspect: number, subject: Subject) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.05, 200);
    poseFor(this.view, subject, this.current);
    this.apply();
  }

  get gliding() {
    return this.glideT < 1;
  }

  get pose(): Readonly<CameraPose> {
    return this.current;
  }

  setView(view: ViewId) {
    if (view === this.view) return;
    copyPose(this.current, this.from);
    this.view = view;
    this.glideT = 0;
    hudStore.set({ view });
  }

  cycle() {
    const next = VIEW_ORDER[(VIEW_ORDER.indexOf(this.view) + 1) % VIEW_ORDER.length];
    this.setView(next);
  }

  update(dt: number, subject: Subject) {
    poseFor(this.view, subject, this.ideal);
    if (this.glideT < 1) {
      this.glideT = Math.min(1, this.glideT + dt / GLIDE_SECONDS);
      const e = easeInOutCubic(this.glideT);
      this.current.position.lerpVectors(this.from.position, this.ideal.position, e);
      // Lift the path a little so glides arc over the player instead of through.
      this.current.position.y += Math.sin(Math.PI * e) * 1.2;
      this.current.target.lerpVectors(this.from.target, this.ideal.target, e);
      this.current.fov = THREE.MathUtils.lerp(this.from.fov, this.ideal.fov, e);
    } else {
      // Settled: follow with light damping.
      const k = 1 - Math.exp(-dt * 6);
      this.current.position.lerp(this.ideal.position, k);
      this.current.target.lerp(this.ideal.target, k);
      this.current.fov = THREE.MathUtils.lerp(this.current.fov, this.ideal.fov, k);
    }
    this.apply();
  }

  private apply() {
    this.camera.position.copy(this.current.position);
    this.camera.lookAt(this.current.target);
    if (this.camera.fov !== this.current.fov) {
      this.camera.fov = this.current.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function blankPose(): CameraPose {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 };
}

function copyPose(src: CameraPose, dst: CameraPose) {
  dst.position.copy(src.position);
  dst.target.copy(src.target);
  dst.fov = src.fov;
}
