import * as THREE from "three";
import { disposeAudio, playBounce, playSqueak, unlockAudio } from "./audio";
import { createBall } from "./ball";
import { BallBody } from "./ballPhysics";
import { CameraRig, type Subject } from "./cameras";
import { COMBO, ComboScorer, type ComboSnapshot } from "./combo";
import { createFloor } from "./court";
import {
  BALL_CIRCUMFERENCE,
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  FLOOR_MAX_X,
  FLOOR_MAX_Z,
  FLOOR_MIN_X,
  FLOOR_MIN_Z,
  RIM_HEIGHT,
} from "./dimensions";
import { DRIBBLE, DribbleController, type DribbleKey, type DribbleState, type Hand } from "./dribble";
import { createGym } from "./gym";
import { createHoop } from "./hoop";
import { hudStore, type HudState, type ViewId } from "./hudStore";
import { Locomotion, MOVE } from "./locomotion";
import { createPlayer, WRIST_ABOVE_BALL, type Side } from "./player";
import { clearDrawnTextures, redrawWhenFontsLoad, type GameFonts } from "./textures";
import { setOutlineResolution } from "./toon";

/** Where the player starts: near half, just beyond the arc, facing the +X hoop. */
export const PLAYER_START = new THREE.Vector3(4.2, 0, 0.6);

export interface Game {
  dispose(): void;
}

/** Dev-only debug handle exposed as `window.__game` for automation. */
export interface GameDebugHandle {
  frames: number;
  world: {
    courtLength: number;
    courtWidth: number;
    rimHeight: number;
    ballRadius: number;
    ballCircumference: number;
    /** Walkable floor (player and loose ball stay inside). */
    floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  };
  player: {
    position: [number, number, number];
    facing: [number, number, number];
    velocity: [number, number, number];
    speed: number;
    sprinting: boolean;
  };
  ball: {
    position: [number, number, number];
    velocity: [number, number, number];
    spin: [number, number, number];
    radius: number;
    /** A hand is on the ball (holding or carrying it into a move). */
    held: boolean;
    state: DribbleState;
  };
  /** Wrist positions (world). */
  hands: Record<Side, [number, number, number]>;
  dribble: {
    state: DribbleState;
    /** Hand holding the ball, or the one it's flying to. */
    hand: Hand;
    heightMode: "low" | "high";
    /** Seconds until the ideal catch (null unless the ball is in the air). */
    catchIn: number | null;
    lastTiming: DribbleController["lastTiming"];
    lastMove: DribbleController["lastMove"];
    moves: number;
    lost: number;
    split: number;
  };
  combo: ComboSnapshot;
  hud: HudState;
  config: { dribble: typeof DRIBBLE; combo: typeof COMBO; move: typeof MOVE; points: typeof COMBO.points };
  camera: {
    view: ViewId;
    gliding: boolean;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  cycleView(): void;
  setView(view: ViewId): void;
  /** Game clock (seconds) that physics, timing windows and `catchIn` run on. */
  readonly simTime: number;
  readonly timeScale: number;
  /** Slow-mo / freeze for automation: 0 pauses, 1 is real time. Input still lands at the right sim time. */
  setTimeScale(scale: number): void;
}

declare global {
  interface Window {
    __game?: GameDebugHandle;
  }
}

const KEY_CODES: Record<string, DribbleKey> = {
  KeyJ: "J",
  KeyL: "L",
  KeyI: "I",
  KeyK: "K",
  Comma: ",",
};

/** Physics and input run in fixed substeps so timing doesn't depend on frame rate. */
const STEP = 1 / 240;

const tuple = (v: THREE.Vector3): [number, number, number] => [
  +v.x.toFixed(4),
  +v.y.toFixed(4),
  +v.z.toFixed(4),
];

export function createGame(container: HTMLElement, fonts: GameFonts): Game {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x2a1b10);
  renderer.domElement.dataset.testid = "game-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1b10, 70, 140);

  // Warm key light from the far-wall windows + a soft fill.
  scene.add(new THREE.HemisphereLight(0xfff3dc, 0x8a5a33, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
  sun.position.set(-6, 14, -10);
  scene.add(sun);

  scene.add(createFloor(renderer.capabilities.getMaxAnisotropy()));
  scene.add(createGym(fonts));
  scene.add(createHoop(1));
  scene.add(createHoop(-1));

  const player = createPlayer(fonts);
  player.root.position.copy(PLAYER_START);
  const body = new Locomotion(player.root.position);
  player.root.rotation.y = body.yaw;
  scene.add(player.root);
  const playerShadow = blobShadow(0.55, player.root.position);
  scene.add(playerShadow);

  const ball = createBall();
  scene.add(ball);
  const ballShadow = blobShadow(BALL_RADIUS * 1.3, new THREE.Vector3());
  scene.add(ballShadow);

  // The camera heading trails the player's facing, so view B swings round
  // smoothly instead of snapping with every turn.
  const camFacing = body.facing.clone();
  const subject: Subject = { position: player.root.position, facing: camFacing };
  const rig = new CameraRig(1, subject);

  const combo = new ComboScorer();
  let sfxId = 0;
  const projected = new THREE.Vector3();
  const dribble = new DribbleController(
    new BallBody(),
    { position: body.position, velocity: body.velocity, get yaw() { return body.yaw; }, get sprinting() { return body.sprinting; } },
    {
      move: (m) => combo.onMove(m, simTime),
      lost: () => combo.onLost(),
      pickup: () => {},
      bounce: (e) => {
        playBounce(e.speed);
        if (e.speed < 1) return;
        projected.copy(e.position).project(rig.camera);
        if (projected.z > 1) return;
        hudStore.set({
          sfx: {
            id: ++sfxId,
            text: "ダムッ",
            x: (projected.x + 1) / 2,
            y: (1 - projected.y) / 2,
            strength: Math.min(1, e.speed / 6),
          },
        });
      },
    },
  );

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    rig.camera.aspect = w / h;
    rig.camera.updateProjectionMatrix();
    setOutlineResolution(w, h);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // Input: dribble keys are queued with their timestamps and applied in the
  // substep they happened in; WASD/Shift are held state.
  const queue: { key: DribbleKey; t: number }[] = [];
  const held = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    held.add(e.code);
    if (e.repeat) return;
    unlockAudio();
    if (e.code === "KeyV") rig.cycle();
    const key = KEY_CODES[e.code];
    if (key) queue.push({ key, t: simAt(e.timeStamp / 1000) });
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
  const onBlur = () => held.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  hudStore.set({ view: rig.view });
  void redrawWhenFontsLoad(fonts);

  const camForward = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const input = new THREE.Vector3();
  const readInput = () => {
    // WASD relative to where the camera looks, flattened onto the floor.
    rig.camera.getWorldDirection(camForward).setY(0).normalize();
    camRight.crossVectors(camForward, THREE.Object3D.DEFAULT_UP);
    const f = (held.has("KeyW") ? 1 : 0) - (held.has("KeyS") ? 1 : 0);
    const r = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
    input.set(0, 0, 0).addScaledVector(camForward, f).addScaledVector(camRight, r);
    if (input.lengthSq() > 1) input.normalize();
    return input;
  };

  const hands: Record<Side, THREE.Vector3 | null> = { L: null, R: null };
  const handTargets: Record<Side, THREE.Vector3> = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  const catchPoint = new THREE.Vector3();
  const onBall = (side: Side) => handTargets[side].copy(dribble.ball.position).setY(dribble.ball.position.y + WRIST_ABOVE_BALL);
  const aimHands = (now: number) => {
    hands.L = hands.R = null;
    const b = dribble.ball;
    const contact = dribble.contactHand;
    if (contact) {
      hands[contact] = onBall(contact);
      return;
    }
    if (dribble.state !== "flight") return;
    const catcher = dribble.hand;
    const sinceRelease = now - dribble.releasedAt;
    const pusher = dribble.lastMove?.from ?? catcher;
    // Follow through on the push, then get the catching hand under the ball's path.
    if (sinceRelease < 0.08) hands[pusher] = onBall(pusher);
    if (pusher !== catcher || sinceRelease >= 0.08) {
      dribble.catchPoint(catchPoint);
      const near = b.velocity.y > 0 && b.position.distanceTo(catchPoint) < 0.45;
      hands[catcher] = near
        ? onBall(catcher)
        : handTargets[catcher].copy(catchPoint).setY(catchPoint.y + WRIST_ABOVE_BALL + 0.06);
    }
  };

  // Game clock: real time × timeScale, rebased whenever the scale changes.
  let frames = 0;
  let last = performance.now() / 1000;
  let realBase = last;
  let simBase = last;
  let timeScale = 1;
  let simTime = last;
  function simAt(real: number) {
    return simBase + (real - realBase) * timeScale;
  }
  const setTimeScale = (scale: number) => {
    const now = performance.now() / 1000;
    simBase = simAt(now);
    realBase = now;
    timeScale = Math.max(0, scale);
  };
  let elapsed = 0;
  const squeak = (speed: number) => playSqueak(speed);
  renderer.setAnimationLoop(() => {
    const real = performance.now() / 1000;
    const dt = Math.min(real - last, 0.1) * timeScale;
    last = real;
    elapsed += dt;
    const now = simAt(real);
    if (now - simTime > 0.1) simTime = now - 0.1; // too far behind: drop time rather than spiral

    const move = readInput();
    const sprint = held.has("ShiftLeft") || held.has("ShiftRight");
    while (simTime + STEP <= now) {
      simTime += STEP;
      while (queue.length && queue[0].t <= simTime) dribble.press(queue.shift()!.key, simTime);
      body.step(STEP, move, sprint, dribble.state !== "loose", squeak);
      dribble.update(simTime, STEP);
      combo.update(simTime);
    }

    player.root.rotation.y = body.yaw;
    // View B's heading follows the player only when idle or heading away from the
    // camera; strafing and backpedalling keep it steady so WASD paths stay straight.
    if (move.lengthSq() < 1e-4 || move.dot(camFacing) > 0.3) {
      camFacing.lerp(body.facing, 1 - Math.exp(-dt * 2.5)).normalize();
    }
    playerShadow.position.set(body.position.x, 0.003, body.position.z);
    aimHands(simTime);
    player.animate({
      dt,
      elapsed,
      speed: body.speed,
      dribbling: dribble.state !== "loose",
      split: dribble.split,
      hands,
    });

    ball.position.copy(dribble.ball.position);
    ball.quaternion.copy(dribble.ball.orientation);
    ballShadow.position.set(ball.position.x, 0.004, ball.position.z);
    rig.update(dt, subject);
    renderer.render(scene, rig.camera);
    frames++;
    if (frames === 1) container.dataset.rendered = "true";
  });

  if (process.env.NODE_ENV !== "production") {
    window.__game = {
      get frames() {
        return frames;
      },
      world: {
        courtLength: +COURT_LENGTH.toFixed(4),
        courtWidth: +COURT_WIDTH.toFixed(4),
        rimHeight: +RIM_HEIGHT.toFixed(4),
        ballRadius: +BALL_RADIUS.toFixed(4),
        ballCircumference: +BALL_CIRCUMFERENCE.toFixed(4),
        floor: { minX: FLOOR_MIN_X, maxX: FLOOR_MAX_X, minZ: FLOOR_MIN_Z, maxZ: FLOOR_MAX_Z },
      },
      get player() {
        return {
          position: tuple(player.root.position),
          facing: tuple(body.facing),
          velocity: tuple(body.velocity),
          speed: +body.speed.toFixed(3),
          sprinting: body.sprinting,
        };
      },
      get ball() {
        const b = dribble.ball;
        return {
          position: tuple(b.position),
          velocity: tuple(b.velocity),
          spin: tuple(b.spin),
          radius: BALL_RADIUS,
          held: dribble.contactHand !== null,
          state: dribble.state,
        };
      },
      get hands() {
        const w = new THREE.Vector3();
        return { L: tuple(player.wrist("L", w)), R: tuple(player.wrist("R", w)) };
      },
      get dribble() {
        const catchIn = dribble.catchIn(simAt(performance.now() / 1000));
        return {
          state: dribble.state,
          hand: dribble.hand,
          heightMode: dribble.heightMode,
          catchIn: catchIn === null ? null : +catchIn.toFixed(4),
          lastTiming: dribble.lastTiming,
          lastMove: dribble.lastMove,
          moves: dribble.moves,
          lost: dribble.lost,
          split: dribble.split,
        };
      },
      get combo() {
        return combo.snapshot();
      },
      get hud() {
        return hudStore.getSnapshot();
      },
      config: { dribble: DRIBBLE, combo: COMBO, move: MOVE, points: COMBO.points },
      get simTime() {
        return simAt(performance.now() / 1000);
      },
      get timeScale() {
        return timeScale;
      },
      setTimeScale,
      get camera() {
        return {
          view: rig.view,
          gliding: rig.gliding,
          position: tuple(rig.camera.position),
          target: tuple(rig.pose.target),
          fov: +rig.camera.fov.toFixed(2),
        };
      },
      cycleView: () => rig.cycle(),
      setView: (view: ViewId) => rig.setView(view),
    } as GameDebugHandle;
  }

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      disposeAudio();
      observer.disconnect();
      clearDrawnTextures();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m: THREE.Material) => {
            for (const value of Object.values(m)) {
              if (value instanceof THREE.Texture) value.dispose();
            }
            m.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      delete container.dataset.rendered;
      if (window.__game) delete window.__game;
    },
  };
}

/** Soft ink-brown ellipse on the floor (anime-style contact shadow). */
function blobShadow(radius: number, follow: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 32);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x4a2a14,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),
  );
  mesh.position.set(follow.x, 0.003, follow.z);
  mesh.renderOrder = 1;
  return mesh;
}
