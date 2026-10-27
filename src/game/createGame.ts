import * as THREE from "three";
import { disposeAudio, playBoard, playBounce, playBuzzer, playPress, playRim, playSqueak, playSwish, unlockAudio } from "./audio";
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
  HOOP_X,
  RIM_HEIGHT,
} from "./dimensions";
import { DRIBBLE, DribbleController, toWorld, type DribbleKey, type DribbleState, type Hand } from "./dribble";
import { createGym } from "./gym";
import { createHoop } from "./hoop";
import { HoopCollider } from "./hoopPhysics";
import { hudStore, type HudState, type ViewId } from "./hudStore";
import { Locomotion, MOVE } from "./locomotion";
import { runControl, SessionClock, type PlayMode, type SessionResult } from "./session";
import { createPlayer, WRIST_ABOVE_BALL, type Side } from "./player";
import { AIR_TIME, SHOT, ShotController, type ShotPhase, type ShotRelease, type ShotResult } from "./shot";
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
    /** Centre of the +X rim on the floor plane (x; z = 0). */
    hoopX: number;
  };
  player: {
    position: [number, number, number];
    facing: [number, number, number];
    /** Heading (rad), and the heading drawn including a spin move in progress. */
    yaw: number;
    renderYaw: number;
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
    /** A hand key is held down on the ball. */
    palm: boolean;
    /** Seconds until the ideal catch (null unless the ball is in the air). */
    catchIn: number | null;
    lastTiming: DribbleController["lastTiming"];
    lastMove: DribbleController["lastMove"];
    moves: number;
    lost: number;
    split: number;
    /** Keys pressed while the ball was away, waiting for the next contact. */
    queued: DribbleKey[];
  };
  combo: ComboSnapshot;
  hud: HudState;
  shot: {
    phase: ShotPhase;
    /** Seconds to the jump's apex while rising with the ball (null otherwise). */
    apexIn: number | null;
    jumpHeight: number;
    /** The jump is a fadeaway (Space while moving away), and how far it has leaned back (0…1). */
    fade: boolean;
    lean: number;
    /** Horizontal distance from the player to the +X rim (m). */
    distance: number;
    lastRelease: ShotRelease | null;
    lastResult: ShotResult | null;
    attempts: number;
    makes: number;
  };
  config: {
    dribble: typeof DRIBBLE;
    combo: typeof COMBO;
    move: typeof MOVE;
    points: typeof COMBO.points;
    shot: typeof SHOT;
  };
  camera: {
    view: ViewId;
    gliding: boolean;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  session: {
    screen: HudState["screen"];
    mode: PlayMode | null;
    timeLeft: number | null;
    bestCombo: number;
    moves: number;
    result: SessionResult | null;
  };
  /** Same as the title-screen buttons. */
  startRun(mode: PlayMode): void;
  /** Automation: set the Session clock to `seconds` left (e.g. 2 to reach the buzzer fast). */
  setClock(seconds: number): void;
  cycleView(): void;
  setView(view: ViewId): void;
  /** Teleports the player to (x, z) facing the +X hoop with the ball in the right hand (not mid-shot). */
  placePlayer(x: number, z: number): boolean;
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

/** Katakana pop at the ball for each dribble key, the moment it is pressed. */
const PRESS_POPS: Record<DribbleKey, string> = { J: "パシッ", L: "パシッ", I: "シャッ", K: "ズバッ", ",": "ヒュッ", U: "クルッ", O: "クルッ" };

const KEY_CODES: Record<string, DribbleKey> = {
  KeyJ: "J",
  KeyL: "L",
  KeyI: "I",
  KeyK: "K",
  Comma: ",",
  KeyU: "U",
  KeyO: "O",
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
  const hoops = [createHoop(1), createHoop(-1)];
  hoops.forEach((h) => scene.add(h));
  const nets = hoops.map((h) => h.getObjectByName("net")!);
  const netKick = [-Infinity, -Infinity];

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
  // The cameras follow the player's spot on the floor, not the jump.
  const subject: Subject = { position: player.root.position.clone(), facing: camFacing };
  const rig = new CameraRig(1, subject);

  const combo = new ComboScorer();
  const session = new SessionClock();
  let sfxId = 0;
  const projected = new THREE.Vector3();
  /** Katakana SFX pop at a world position. */
  const pop = (text: string, at: THREE.Vector3, strength: number) => {
    projected.copy(at).project(rig.camera);
    if (projected.z > 1) return;
    hudStore.set({
      sfx: { id: ++sfxId, text, x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, strength: Math.min(1, strength) },
    });
  };
  const bodyVelocity = new THREE.Vector3();
  const bodyView = {
    position: body.position,
    // Counts a hold-cross slide that is still running, so the catch is aimed where the hand will be.
    get velocity() {
      return body.expectedVelocity(0.4, bodyVelocity);
    },
    get yaw() {
      return body.renderYaw;
    },
    get aimYaw() {
      return body.aimYaw;
    },
    get sprinting() {
      return body.sprinting;
    },
  };
  const slideDir = new THREE.Vector3();
  const dribble = new DribbleController(new BallBody(), bodyView, {
    move: (m) => {
      combo.onMove(m, simTime);
      session.onMove(m);
      // Crossovers (and hold-crosses), between the legs and behind the back are played facing the basket.
      if (m.kind === "crossover" || m.kind === "between" || m.kind === "behind") body.faceHoop();
    },
    press: (key) => {
      // Instant feedback: the key lights up, the ball pops and the camera kicks on the press itself.
      combo.onPress(key);
      // Every dribble key press squares the player up to the basket and holds it for a couple of seconds.
      body.faceHoop(MOVE.pressFaceHoopTime);
      playPress(key);
      pop(PRESS_POPS[key], dribble.ball.position, 1);
      rig.kick(key === "J" || key === "L" ? 0.5 : 1);
    },
    lost: () => combo.onLost(),
    pickup: () => {},
    slide: (side) => {
      // The receiving hand's side is the player's local ±X.
      const x = side === "L" ? 1 : -1;
      const yaw = body.aimYaw;
      body.slide(slideDir.set(Math.cos(yaw) * x, 0, -Math.sin(yaw) * x), DRIBBLE.slideDistance);
    },
    spin: (side, time) => body.spin(side === "L" ? 1 : -1, time),
    bounce: (e) => {
      playBounce(e.speed);
      if (e.speed >= 1) pop("ダムッ", e.position, e.speed / 6);
    },
  });
  const shot = new ShotController(dribble, bodyView, {
    gather: () => combo.onShotStart(),
    release: () => {},
    result: (r) => combo.onShot(r, simTime),
  });
  dribble.ball.obstacles = hoops.map(
    (_, i) =>
      new HoopCollider(i === 0 ? 1 : -1, {
        hit: (e) => {
          shot.onHoopHit(e);
          if (e.part === "rim") {
            playRim(e.speed);
            netKick[i] = Math.max(netKick[i], elapsed - 0.25);
            if (e.speed > 1.2) pop("ガンッ", e.position, e.speed / 6);
          } else {
            playBoard(e.speed);
            if (e.speed > 1.2) pop("バンッ", e.position, e.speed / 6);
          }
        },
        score: () => {
          shot.onScore();
          playSwish();
          netKick[i] = elapsed;
          pop("シュパッ", nets[i].getWorldPosition(new THREE.Vector3()), 0.8);
        },
      }),
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
  const queue: { key: DribbleKey | "ShootDown" | "ShootUp"; t: number; up?: boolean }[] = [];
  const held = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Menus own the keyboard (initials entry types letters).
    if (hudStore.getSnapshot().screen !== "play") return;
    if (e.code === "Escape") return quitRun();
    if (e.code === "Space") e.preventDefault(); // no page scroll
    held.add(e.code);
    if (e.repeat) return;
    unlockAudio();
    if (e.code === "KeyV") rig.cycle();
    if (e.code === "Space") queue.push({ key: "ShootDown", t: simAt(e.timeStamp / 1000) });
    const key = KEY_CODES[e.code];
    if (key) queue.push({ key, t: simAt(e.timeStamp / 1000) });
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
    if (e.code === "Space") queue.push({ key: "ShootUp", t: simAt(e.timeStamp / 1000) });
    const key = KEY_CODES[e.code];
    if (key) queue.push({ key, t: simAt(e.timeStamp / 1000), up: true });
  };
  const onBlur = () => {
    held.clear();
    // A palmed ball can't stay palmed by a key nobody can release any more.
    for (const key of ["J", "L"] as const) queue.push({ key, t: simAt(performance.now() / 1000), up: true });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  hudStore.set({ view: rig.view });

  // Runs: the title screen starts one; the buzzer (or Esc) ends it.
  const startRun = (mode: PlayMode) => {
    held.clear();
    queue.length = 0;
    body.placeAt(PLAYER_START);
    camFacing.copy(body.facing);
    dribble.restart();
    shot.restart();
    combo.resetRun();
    session.start(mode, simTime);
    hudStore.set({ screen: "play", mode, timeLeft: session.timeLeft(simTime), result: null });
  };
  const quitRun = () => {
    held.clear();
    session.finish(combo.score);
    hudStore.set({ screen: "title", mode: null, timeLeft: null });
  };
  const unbindRuns = runControl.bind({ start: startRun, quit: quitRun });
  const tickSession = () => {
    session.onCombo(combo.combo);
    const left = session.timeLeft(simTime);
    if (left === null) return;
    if (left > 0) {
      const shown = Math.ceil(left * 10) / 10;
      if (shown !== hudStore.getSnapshot().timeLeft) hudStore.set({ timeLeft: shown });
      return;
    }
    held.clear();
    playBuzzer();
    hudStore.set({ screen: "results", timeLeft: 0, result: session.finish(combo.score) });
  };
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
  /** World point at a body-relative offset (x: + left) from `base`. */
  const offsetFrom = (base: THREE.Vector3, x: number, y: number, z: number, out: THREE.Vector3) =>
    toWorld([x, 0, z], base, body.yaw, out).setY(base.y + y);
  const feet = new THREE.Vector3();
  const aimHands = (now: number) => {
    hands.L = hands.R = null;
    const b = dribble.ball;
    if (shot.holding) {
      // Guide hand on the side of the ball, shooting hand under and behind it.
      hands.L = offsetFrom(b.position, 0.15, -0.02, -0.03, handTargets.L);
      hands.R = offsetFrom(b.position, -0.03, -0.1, -0.11, handTargets.R);
      return;
    }
    if (now - shot.releasedAt < 0.5) {
      // Follow-through: shooting arm up, wrist snapped over; guide hand stays up.
      const floor = feet.set(body.position.x, shot.jumpY, body.position.z);
      offsetFrom(floor, 0.22, 2.0, 0.24, handTargets.L);
      offsetFrom(floor, -0.1, 2.26, 0.36, handTargets.R);
      hands.L = handTargets.L;
      hands.R = handTargets.R;
      return;
    }
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
  const still = new THREE.Vector3();

  /** A basket stretches the net down and lets it spring back; a rim hit gives it a smaller shake. */
  const animateNets = () => {
    nets.forEach((net, i) => {
      const t = elapsed - netKick[i];
      const s = t >= 0 && t < 1.5 ? 0.32 * Math.exp(-4.5 * t) * Math.cos(16 * t) : 0;
      net.scale.set(1 - 0.35 * s, 1 + s, 1 - 0.35 * s);
    });
  };

  /** The shot meter rides beside the player's head while a jumper is up, then shows the grade. */
  const meterAt = new THREE.Vector3();
  const updateMeter = () => {
    const show = shot.holding || simTime - shot.releasedAt < 0.9;
    if (!show) {
      if (hudStore.getSnapshot().meter) hudStore.set({ meter: null });
      return;
    }
    offsetFrom(feet.set(body.position.x, shot.jumpY, body.position.z), -0.55, 1.75, 0, meterAt).project(rig.camera);
    const m = shot.meter();
    hudStore.set({
      meter: {
        fill: +m.fill.toFixed(3),
        zone: m.zone,
        grade: m.grade,
        x: THREE.MathUtils.clamp((meterAt.x + 1) / 2, 0.04, 0.96),
        y: THREE.MathUtils.clamp((1 - meterAt.y) / 2, 0.08, 0.9),
      },
    });
  };
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
      while (queue.length && queue[0].t <= simTime) {
        const { key, up } = queue.shift()!;
        if (key === "ShootDown") shot.press(simTime, move);
        else if (key === "ShootUp") shot.lift();
        else if (up) dribble.keyUp(key, simTime);
        else dribble.press(key, simTime);
      }
      const dribbling = dribble.state !== "loose" && dribble.state !== "shot";
      body.step(STEP, shot.feetLocked ? still : move, sprint, dribbling, squeak);
      dribble.update(simTime, STEP);
      shot.update(simTime);
      combo.update(simTime);
    }
    tickSession();

    player.root.position.y = shot.jumpY;
    player.root.rotation.y = body.renderYaw;
    subject.position.set(body.position.x, 0, body.position.z);
    // View B's heading follows the player only when idle or heading away from the
    // camera; strafing and backpedalling keep it steady so WASD paths stay straight.
    if (move.lengthSq() < 1e-4 || move.dot(camFacing) > 0.3) {
      camFacing.lerp(body.facing, 1 - Math.exp(-dt * 2.5)).normalize();
    }
    playerShadow.position.set(body.position.x, 0.003, body.position.z);
    aimHands(simTime);
    const shooting = shot.holding || shot.jumpY > 0 || simTime - shot.releasedAt < 0.45;
    player.animate({
      dt,
      elapsed,
      speed: body.speed,
      dribbling: dribble.state !== "loose" && dribble.state !== "shot",
      split: dribble.split,
      hands,
      shoot: shooting
        ? { dip: shot.phase === "gather" ? 1 : 0, air: THREE.MathUtils.clamp(shot.jumpY / 0.15, 0, 1), lean: shot.lean * SHOT.fade.lean }
        : undefined,
    });
    animateNets();
    updateMeter();

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
        hoopX: +HOOP_X.toFixed(4),
      },
      get player() {
        return {
          position: tuple(player.root.position),
          facing: tuple(body.facing),
          yaw: +body.yaw.toFixed(4),
          renderYaw: +body.renderYaw.toFixed(4),
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
          palm: dribble.palming,
          catchIn: catchIn === null ? null : +catchIn.toFixed(4),
          lastTiming: dribble.lastTiming,
          lastMove: dribble.lastMove,
          moves: dribble.moves,
          lost: dribble.lost,
          split: dribble.split,
          queued: dribble.queued,
        };
      },
      get combo() {
        return combo.snapshot();
      },
      get hud() {
        return hudStore.getSnapshot();
      },
      get shot() {
        const apexIn = shot.apexIn(simAt(performance.now() / 1000));
        return {
          phase: shot.phase,
          apexIn: apexIn === null ? null : +apexIn.toFixed(4),
          jumpHeight: +shot.jumpY.toFixed(3),
          fade: shot.fade,
          lean: +shot.lean.toFixed(3),
          distance: +shot.distanceToRim().toFixed(3),
          lastRelease: shot.lastRelease,
          lastResult: shot.lastResult,
          attempts: shot.attempts,
          makes: shot.makes,
        };
      },
      config: { dribble: DRIBBLE, combo: COMBO, move: MOVE, points: COMBO.points, shot: { ...SHOT, airTime: AIR_TIME } },
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
      get session() {
        const hud = hudStore.getSnapshot();
        return {
          screen: hud.screen,
          mode: session.mode,
          timeLeft: session.timeLeft(simTime),
          bestCombo: session.bestCombo,
          moves: session.moves,
          result: hud.result,
        };
      },
      startRun,
      setClock: (seconds: number) => {
        session.endsAt = simTime + seconds;
      },
      cycleView: () => rig.cycle(),
      setView: (view: ViewId) => rig.setView(view),
      placePlayer: (x: number, z: number) => {
        if (shot.phase !== "none" || shot.jumpY > 0) return false;
        body.position.set(x, 0, z);
        body.velocity.set(0, 0, 0);
        body.yaw = Math.atan2(HOOP_X - x, -z);
        camFacing.set(Math.sin(body.yaw), 0, Math.cos(body.yaw));
        dribble.receive("R");
        dribble.ball.position.copy(toWorld([-0.36, DRIBBLE.lowHeight + 0.06, 0.27], body.position, body.yaw, new THREE.Vector3()));
        dribble.ball.velocity.set(0, 0, 0);
        return true;
      },
    } as GameDebugHandle;
  }

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      unbindRuns();
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
