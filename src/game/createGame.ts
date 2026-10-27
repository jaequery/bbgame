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
  THREE_POINT_RADIUS,
} from "./dimensions";
import { DRIBBLE, DribbleController, toWorld, type DribbleKey, type DribbleState, type Hand } from "./dribble";
import { createGym } from "./gym";
import { createHoop } from "./hoop";
import { HoopCollider } from "./hoopPhysics";
import { hudStore, type Callout, type HudState, type ViewId } from "./hudStore";
import { Locomotion, MOVE } from "./locomotion";
import { BotGuard, BotOffense, BotSpacer, BOT_HOOP, Defender, DUEL, PLAYER_HOOP, separate, TWOS, type OffenseEvents } from "./duel";
import { runControl, SessionClock, type PlayMode, type SessionResult } from "./session";
import { createPlayer, HERO_LOOK, WRIST_ABOVE_BALL, type Look, type Side } from "./player";
import { AIR_TIME, SHOT, ShotController, type FinishKind, type ShotPhase, type ShotRelease, type ShotResult } from "./shot";
import { clearDrawnTextures, redrawWhenFontsLoad, type GameFonts } from "./textures";
import { setOutlineResolution } from "./toon";

/** Where the player starts: near half, just beyond the arc, facing the +X hoop. */
export const PLAYER_START = new THREE.Vector3(4.2, 0, 0.6);

export interface Game {
  dispose(): void;
}

type TwosSpots = [[number, number, number], [number, number, number]];

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
    /** Steps taken since the last dribble ended; a third is blocked until a new dribble starts. */
    steps: number;
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
    /** The triple-threat hold (pump fake, hold, jab, reach), and how far the jab has stepped out (0…1). */
    inHold: boolean;
    jab: number;
    /** 0…1 how far the head-down hunch over the ball (I in the hold) has come down. */
    protect: number;
    /** Seconds to the jump's apex while rising with the ball (null otherwise). */
    apexIn: number | null;
    jumpHeight: number;
    /** The jump is a fadeaway (Space while moving away), and how far it has leaned back (0…1). */
    fade: boolean;
    /** The running finish in progress: "layup" or "dunk" (null otherwise). */
    finish: FinishKind | null;
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
  /** 1v1 / defense drill: the scoreboard, whose ball it is and where the bot is. */
  duel: {
    active: boolean;
    phase: "offense" | "defense";
    you: number;
    bot: number;
    stops: number;
    /** The possession is changing hands (a basket, stop or steal just happened). */
    switching: boolean;
    botPosition: [number, number, number];
    botJump: number;
    botBall: [number, number, number];
    /** The bot's shot while it has the ball: dribble, windup, flight, drop, stolen, done. */
    botPhase: string;
    /** Your block jump height (m) and raised hand (0…1). */
    jumpY: number;
    raise: number;
  };
  /** 2v2: team scores, target, and where the four players are. */
  twos: {
    active: boolean;
    phase: "offense" | "defense";
    us: number;
    them: number;
    target: number;
    mate: [number, number, number];
    opponents: TwosSpots;
  };
  /** Automation: set the 2v2 team scores (e.g. 10 to be one basket from the win). */
  setTwosScore(us: number, them: number): void;
  /** Automation: the bot goes up for its shot now (defense). */
  botShoot(): void;
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

/** The bot's kit: blue, so it reads apart from the red player. */
const BOT_LOOK: Look = { jersey: 0x2a5fd0, trim: 0xfaf4e6, hair: 0x1a1410, shoe: 0x1f3f9a, number: "7" };
const BOT2_LOOK: Look = { ...BOT_LOOK, hair: 0x7a4a1e, number: "11" };
/** Your 2v2 teammate wears your kit. */
const MATE_LOOK: Look = { ...HERO_LOOK, hair: 0x6b3a1a, number: "5" };

/** A bot's model with its shadow and hand targets. */
interface Figure {
  model: ReturnType<typeof createPlayer>;
  shadow: THREE.Mesh;
  hands: Record<Side, THREE.Vector3 | null>;
  targets: Record<Side, THREE.Vector3>;
  base: THREE.Vector3;
  yaw: number;
}

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
  let rimShakeAt = -Infinity;

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

  // The bots (1v1, the defense drill and 2v2): own models, ball and shadows, hidden outside those modes.
  const makeFigure = (look: Look): Figure => {
    const model = createPlayer(fonts, look);
    model.root.visible = false;
    scene.add(model.root);
    const shadow = blobShadow(0.55, new THREE.Vector3());
    shadow.visible = false;
    scene.add(shadow);
    return {
      model,
      shadow,
      hands: { L: null, R: null },
      targets: { L: new THREE.Vector3(), R: new THREE.Vector3() },
      base: new THREE.Vector3(),
      yaw: 0,
    };
  };
  /** In 2v2: opp1 is the first opponent (also the 1v1 bot), opp2 the second, mate your teammate. */
  const botFig = makeFigure(BOT_LOOK);
  const opp2Fig = makeFigure(BOT2_LOOK);
  const mateFig = makeFigure(MATE_LOOK);
  const botBall = createBall();
  botBall.visible = false;
  scene.add(botBall);
  const botBallShadow = blobShadow(BALL_RADIUS * 1.3, new THREE.Vector3());
  botBallShadow.visible = false;
  scene.add(botBallShadow);

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
  /** Instant feedback: the key lights up, the ball pops and the camera kicks on the press itself. */
  const pressFeedback = (key: DribbleKey) => {
    combo.onPress(key);
    // Every dribble key press squares the player up to the basket and holds it for a couple of seconds.
    body.faceHoop(MOVE.pressFaceHoopTime);
    playPress(key);
    rig.kick(key === "J" || key === "L" ? 0.5 : 1);
  };
  const dribble = new DribbleController(new BallBody(), bodyView, {
    move: (m) => {
      combo.onMove(m, simTime);
      session.onMove(m);
      // Crossovers, between the legs and behind the back are played facing the basket.
      if (m.kind === "crossover") {
        // Fake toward the hand the ball leaves, then lunge the other way (the receiving hand's side).
        const x = m.from === "L" ? 1 : -1;
        const yaw = body.aimYaw;
        body.fakeAndLunge(slideDir.set(Math.cos(yaw) * x, 0, -Math.sin(yaw) * x));
      }
      if (m.kind === "crossover" || m.kind === "between" || m.kind === "behind") body.faceHoop();
    },
    press: (key) => pressFeedback(key),
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
    },
  });
  const shot = new ShotController(dribble, bodyView, {
    gather: () => {
      combo.onShotStart();
      // The bot goes up at your shot if it is on you.
      if (match.active && match.phase === "offense" && distanceToBot() < DUEL.bot.block.contestRange) nearestGuard().contest(simTime);
    },
    abort: () => combo.onShotAbort(simTime),
    hold: (m) => {
      combo.onMove(m, simTime);
      if (m.kind === "pump") {
        playPress("I");
      }
    },
    release: (r) => {
      // The bot's jump can swat a jumper (not a dunk, which goes over it).
      if (match.active && match.phase === "offense" && r.finish !== "dunk" && nearestGuard().blocks(distanceToBot())) {
        const v = dribble.ball.velocity;
        v.set(-v.x * 0.25 + (Math.random() - 0.5), 2.4, (Math.random() - 0.5) * 3);
        pop("バシッ", dribble.ball.position, 1);
        playRim(6);
        note("BLOCKED!", "miss");
      }
      // A dunk shakes the rim as the ball goes down through it.
      if (r.finish === "dunk") {
        rimShakeAt = elapsed;
        playRim(4);
      }
    },
    result: (r) => {
      combo.onShot(r, simTime);
      if (!match.active || match.phase !== "offense" || match.switchAt !== null) return;
      if (r.made) {
        match.you += twos() ? (r.three ? 2 : 1) : DUEL.basket;
        note(twos() && r.three ? "THREE!" : "BUCKET!", "shot", scoreLine());
      } else {
        note("NO GOOD", "miss", scoreLine());
      }
      // The bot takes it the other way (in the drill, you stay on defense).
      scheduleSwitch(DUEL.switchDelay, "defense");
    },
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
    for (const key of ["J", "L", "I", "K"] as const) queue.push({ key, t: simAt(performance.now() / 1000), up: true });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  hudStore.set({ view: rig.view });

  // 1v1 and the defense drill: the ball changes hands after every basket, miss, stop and steal.
  const match = {
    active: false,
    mode: "duel" as "duel" | "defense" | "twos",
    phase: "offense" as "offense" | "defense",
    you: 0,
    bot: 0,
    stops: 0,
    /** Sim time the ball changes hands; null while a possession is live. */
    switchAt: null as number | null,
    next: "offense" as "offense" | "defense",
    /** A steal has ended the possession: your keys do nothing until the switch. */
    locked: false,
  };
  const botGuard = new BotGuard();
  const botOff = new BotOffense();
  const defender = new Defender();
  // 2v2 extras: the second opponent guards your teammate (or spaces the floor), your teammate spaces (or guards him).
  const oppGuard2 = new BotGuard();
  const oppSpacer = new BotSpacer(BOT_HOOP);
  const mateSpacer = new BotSpacer(PLAYER_HOOP);
  const mateGuard = new BotGuard(Math.random, BOT_HOOP);
  const twos = () => match.mode === "twos";
  const oppGuards = () => [botGuard, oppGuard2];
  let noteId = 1_000_000;
  const note = (text: string, tone: Callout["tone"], detail?: string) =>
    hudStore.set({ callout: { id: ++noteId, text, points: 0, tone, detail } });
  const scoreLine = () => (twos() ? `US ${match.you} – ${match.bot} THEM` : `YOU ${match.you} – ${match.bot} BOT`);
  /** The opponent closest to you on offense (the one on you, or whoever helps). */
  const nearestGuard = () => {
    if (!twos()) return botGuard;
    const d = (g: BotGuard) => Math.hypot(body.position.x - g.position.x, body.position.z - g.position.z);
    return d(oppGuard2) < d(botGuard) ? oppGuard2 : botGuard;
  };
  const distanceToBot = () => {
    const at = match.phase === "offense" ? nearestGuard().position : botOff.position;
    return Math.hypot(body.position.x - at.x, body.position.z - at.z);
  };
  const publishDuel = () =>
    hudStore.set({
      duel: match.active
        ? {
            you: match.you,
            bot: match.bot,
            stops: match.stops,
            phase: match.phase,
            mode: match.mode,
            target: twos() ? TWOS.target : null,
          }
        : null,
    });
  /** After `delay` seconds the ball goes to `next` (the drill never leaves defense). */
  const scheduleSwitch = (delay: number, next: "offense" | "defense", locked = false) => {
    match.switchAt = simTime + delay;
    match.next = match.mode === "defense" ? "defense" : next;
    match.locked = locked;
    publishDuel();
  };
  const botSpot = new THREE.Vector3();
  const enterPhase = (phase: "offense" | "defense") => {
    match.phase = phase;
    match.switchAt = null;
    match.locked = false;
    held.clear();
    queue.length = 0;
    commaSince = null;
    defender.reset();
    if (phase === "offense") {
      body.faceTarget = null;
      body.placeAt(PLAYER_START);
      camFacing.copy(body.facing);
      botGuard.start(botSpot.set(PLAYER_START.x + 1.6, 0, PLAYER_START.z), PLAYER_START, simTime);
      if (twos()) {
        // Check-up: your teammate on the wing, his man a step toward the hoop.
        mateSpacer.start(botSpot.set(4.4, 0, -4.6), PLAYER_START, simTime);
        oppGuard2.start(botSpot.set(5.8, 0, -4.6), mateSpacer.position, simTime);
      }
    } else {
      // The bot starts near the middle with the ball; you are between it and its hoop.
      botOff.shootRange = twos() ? TWOS.shootRange[0] + Math.random() * (TWOS.shootRange[1] - TWOS.shootRange[0]) : DUEL.bot.shootRange;
      botOff.start(botSpot.set(2.5, 0, 0.8), simTime);
      body.placeAt(botSpot.set(0.4, 0, 0.8));
      body.yaw = Math.atan2(botOff.position.x - body.position.x, botOff.position.z - body.position.z);
      body.facing.set(Math.sin(body.yaw), 0, Math.cos(body.yaw));
      body.faceTarget = botOff.position;
      camFacing.copy(body.facing);
      if (twos()) {
        oppSpacer.start(botSpot.set(-3.2, 0, -4.4), botOff.position, simTime);
        mateGuard.start(botSpot.set(-1.8, 0, -4.4), oppSpacer.position, simTime);
      }
    }
    // Rebuild the player's ball after moving the body.
    dribble.restart();
    shot.restart();
    ball.visible = phase === "offense";
    publishDuel();
  };
  const stopMatch = () => {
    match.active = false;
    match.switchAt = null;
    match.locked = false;
    body.faceTarget = null;
    ball.visible = true;
    for (const f of [botFig, opp2Fig, mateFig]) {
      f.model.root.visible = false;
      f.shadow.visible = false;
    }
    botBall.visible = false;
    botBallShadow.visible = false;
    defender.reset();
  };
  const offenseEvents: OffenseEvents = {
    release: () => {
      const dx = body.position.x - botOff.position.x;
      const dz = body.position.z - botOff.position.z;
      const dist = Math.hypot(dx, dz);
      // In front of the shooter = on the hoop's side of it.
      const inFront = dx * (-HOOP_X - botOff.position.x) + dz * (0 - botOff.position.z) > 0;
      let verdict = defender.judge(dist, inFront);
      if (twos() && verdict !== "blocked") {
        // Your teammate helps: his jump can swat it, or a hand up in its face contests it.
        const mx = mateGuard.position.x - botOff.position.x;
        const mz = mateGuard.position.z - botOff.position.z;
        const mateIn = mx * (BOT_HOOP.x - botOff.position.x) + mz * (0 - botOff.position.z) > 0;
        const md = Math.hypot(mx, mz);
        if (mateIn && mateGuard.blocks(md)) verdict = "blocked";
        else if (verdict === "open" && mateIn && md < TWOS.contestReach && Math.random() < 0.5) verdict = "contested";
      }
      if (verdict === "contested") note("CONTESTED", "shot");
      return verdict;
    },
    result: (made, blocked) => {
      if (match.switchAt !== null) return;
      if (blocked) {
        match.stops++;
        note("BLOCKED!!", "shot", scoreLine());
        pop("バシッ", botOff.ball, 1);
        playRim(6);
      } else if (made) {
        const three = twos() && botOff.hoopDistance > THREE_POINT_RADIUS;
        match.bot += twos() ? (three ? 2 : 1) : DUEL.basket;
        note(twos() ? (three ? "THEY HIT A THREE" : "THEY SCORE") : "BOT SCORES", "miss", scoreLine());
        playSwish();
        netKick[1] = elapsed;
        pop("シュパッ", nets[1].getWorldPosition(new THREE.Vector3()), 0.8);
      } else {
        match.stops++;
        note("STOPPED!", "shot", scoreLine());
        playRim(3);
        pop("ガンッ", botOff.ball, 0.6);
      }
      scheduleSwitch(DUEL.switchDelay, "offense");
    },
    cross: () => {
      playSqueak(3);
    },
  };
  const separateAll = (spots: THREE.Vector3[]) => {
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) separate(spots[i], spots[j]);
  };
  /** First to the target wins: the win/lose screen. */
  const endTwos = () => {
    const result = { mode: "twos" as const, you: match.you, bot: match.bot, stops: match.stops, won: match.you > match.bot };
    held.clear();
    playBuzzer();
    stopMatch();
    session.finish(combo.score);
    hudStore.set({ screen: "match", match: result, duel: null });
  };
  /** Per-frame bot and possession logic. */
  const tickMatch = (dt: number) => {
    if (match.switchAt !== null && simTime >= match.switchAt) {
      if (twos() && (match.you >= TWOS.target || match.bot >= TWOS.target)) return endTwos();
      enterPhase(match.next);
    }
    if (match.phase === "offense") {
      botGuard.update(simTime, dt, body.position);
      if (twos()) {
        mateSpacer.update(simTime, dt, body.position);
        oppGuard2.update(simTime, dt, mateSpacer.position);
        separateAll([body.position, botGuard.position, oppGuard2.position, mateSpacer.position]);
      } else separate(body.position, botGuard.position);
      const live = dribble.state !== "loose" && dribble.state !== "shot" && shot.phase === "none";
      if (live && match.switchAt === null && oppGuards().slice(0, twos() ? 2 : 1).some((g) => g.tryStrip(simTime, dt, body.position))) {
        note("STRIPPED!", "lost", scoreLine());
        pop("バシッ", dribble.ball.position, 1);
        playSqueak(4);
        ball.visible = false;
        scheduleSwitch(DUEL.stealDelay, "defense", true);
      }
      return;
    }
    defender.update(simTime, dt, held.has("KeyI"));
    if (twos()) {
      // The ball handler works around whichever of you two is nearer.
      const near = (a: THREE.Vector3) => Math.hypot(a.x - botOff.position.x, a.z - botOff.position.z);
      botOff.update(simTime, dt, near(mateGuard.position) < near(body.position) ? mateGuard.position : body.position, offenseEvents);
      oppSpacer.update(simTime, dt, botOff.position);
      mateGuard.update(simTime, dt, oppSpacer.position);
      if (botOff.phase === "windup" && near(mateGuard.position) < DUEL.bot.block.contestRange) mateGuard.contest(simTime);
      separateAll([body.position, botOff.position, oppSpacer.position, mateGuard.position]);
    } else {
      botOff.update(simTime, dt, body.position, offenseEvents);
      separate(body.position, botOff.position);
    }
    if (match.switchAt === null && botOff.exposed && defender.strips(simTime, body.position, body.yaw, botOff.ball)) {
      match.stops++;
      botOff.strip();
      note("STRIPPED!!", "shot", scoreLine());
      pop("バシッ", botOff.ball, 1);
      playSwish();
      scheduleSwitch(DUEL.stealDelay, "offense");
    }
  };

  // Runs: the title screen starts one; the buzzer (or Esc) ends it.
  const startRun = (mode: PlayMode) => {
    held.clear();
    queue.length = 0;
    body.placeAt(PLAYER_START);
    camFacing.copy(body.facing);
    dribble.restart();
    shot.restart();
    combo.resetRun();
    stopMatch();
    const versus = mode === "duel" || mode === "defense" || mode === "twos";
    session.start(mode, simTime, versus ? DUEL.matchSeconds : undefined);
    if (versus) {
      Object.assign(match, { active: true, mode, you: 0, bot: 0, stops: 0 });
      enterPhase(mode === "defense" ? "defense" : "offense");
    }
    hudStore.set({ screen: "play", mode, timeLeft: session.timeLeft(simTime), result: null, match: null, duel: null });
    publishDuel();
  };
  const quitRun = () => {
    held.clear();
    stopMatch();
    session.finish(combo.score);
    hudStore.set({ screen: "title", mode: null, timeLeft: null, duel: null });
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
    if (match.active) {
      const result = { mode: match.mode, you: match.you, bot: match.bot, stops: match.stops };
      stopMatch();
      session.finish(combo.score);
      hudStore.set({ screen: "match", timeLeft: 0, match: result, duel: null });
      return;
    }
    hudStore.set({ screen: "results", timeLeft: 0, result: session.finish(combo.score) });
  };
  void redrawWhenFontsLoad(fonts);

  /** In the triple-threat hold I / J / K / L are moves out of it; the other dribble keys leave it and dribble. */
  const pressKey = (key: DribbleKey) => {
    if (shot.inHold) {
      const result = shot.holdKey(key, simTime);
      if (result === "move") return pressFeedback(key);
    }
    const live = dribble.state !== "loose" && dribble.state !== "shot";
    dribble.press(key, simTime);
    // I is the power dribble: a dash toward where WASD points, else straight at the hoop.
    if (key === "I" && live) {
      if (input.lengthSq() > 1e-4) dashDir.copy(input).normalize();
      else dashDir.set(Math.sin(body.hoopYaw), 0, Math.cos(body.hoopYaw));
      body.dash(dashDir);
    }
  };
  const dashDir = new THREE.Vector3();
  let commaSince: number | null = null;

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
  const upHand = new THREE.Vector3();
  /** On defense: arms out wide, up for a block or a raised hand, and one hand sweeping across on a swipe. */
  const aimDefense = (now: number) => {
    const base = feet.set(body.position.x, defender.jumpY, body.position.z);
    const up = Math.max(defender.raise, defender.airborne ? 1 : 0);
    for (const side of ["L", "R"] as const) {
      const x = side === "L" ? 1 : -1;
      offsetFrom(base, x * 0.7, 1.15, 0.45, handTargets[side]);
      handTargets[side].lerp(offsetFrom(base, x * 0.22, 2.3, 0.25, upHand), up);
      hands[side] = handTargets[side];
    }
    const hand = defender.swipeHand(now);
    if (hand) offsetFrom(base, defender.sweep(now)!, 1.0, 0.85, handTargets[hand]);
  };
  const aimHands = (now: number) => {
    hands.L = hands.R = null;
    if (match.active && match.phase === "defense") return aimDefense(now);
    const b = dribble.ball;
    if (shot.phase === "ext") {
      // The reaching hand carries the ball out; the other one guards.
      hands[shot.extSide] = onBall(shot.extSide);
      return;
    }
    if (shot.phase === "rise") {
      // Running finish: one hand takes the ball up, the other swings up for balance.
      const floor = feet.set(body.position.x, shot.jumpY, body.position.z);
      hands.R = onBall("R");
      hands.L = offsetFrom(floor, 0.3, 1.9, 0.25, handTargets.L);
      return;
    }
    if (shot.holding || shot.inHold) {
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

  /** Hand target at a body-relative offset (x: + left) from the figure's feet. */
  const figAt = (f: Figure, x: number, y: number, z: number, side: Side) =>
    toWorld([x * (side === "L" ? 1 : -1), 0, z], f.base, f.yaw, f.targets[side]).setY(f.base.y + y);
  interface Source {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    yaw: number;
    jumpY: number;
  }
  /** Poses one bot: dribbling with the ball, guarding with arms wide, or just spacing the floor. */
  const poseFigure = (f: Figure, dt: number, src: Source, role: "offense" | "guard" | "spacer") => {
    f.yaw = src.yaw;
    f.base.set(src.position.x, src.jumpY, src.position.z);
    f.model.root.position.copy(f.base);
    f.model.root.rotation.y = f.yaw;
    f.shadow.position.set(src.position.x, 0.003, src.position.z);
    f.hands.L = f.hands.R = null;
    let shoot: { dip: number; air: number } | undefined;
    if (role === "offense" && botOff.phase === "dribble") {
      const side: Side = botOff.ballSide > 0 ? "L" : "R";
      f.hands[side] = f.targets[side].copy(botOff.ball).setY(botOff.ball.y + WRIST_ABOVE_BALL);
    } else if (role === "offense" && (botOff.phase === "windup" || botOff.phase === "flight")) {
      // Both hands under the ball, then up in the follow-through.
      for (const side of ["L", "R"] as const) {
        f.hands[side] = figAt(f, 0.12, botOff.phase === "windup" ? botOff.ball.y - f.base.y - 0.03 : 2.2, 0.3, side);
      }
      shoot = { dip: botOff.phase === "windup" && botOff.jumpY < 0.05 ? 1 : 0, air: THREE.MathUtils.clamp(botOff.jumpY / 0.15, 0, 1) };
    } else if (role === "guard") {
      // Guarding: arms wide, up when it jumps at your shot.
      const guard = src as BotGuard;
      for (const side of ["L", "R"] as const) {
        const a = guard.armsUp;
        const x = 0.7 + (0.22 - 0.7) * a;
        f.hands[side] = figAt(f, x, 1.15 + (2.3 - 1.15) * a, 0.45 + (0.25 - 0.45) * a, side);
      }
      if (guard.jumpY > 0) shoot = { dip: 0, air: THREE.MathUtils.clamp(guard.jumpY / 0.15, 0, 1) };
    }
    f.model.animate({
      dt,
      elapsed,
      speed: Math.hypot(src.velocity.x, src.velocity.z),
      dribbling: true,
      split: 0,
      hands: f.hands,
      shoot,
    });
  };
  /** Poses the bots, their ball and shadows for the current possession. */
  const poseBot = (dt: number) => {
    const on = match.active;
    const offense = on && match.phase === "defense";
    for (const f of [botFig, opp2Fig, mateFig]) {
      f.model.root.visible = on && (f === botFig || twos());
      f.shadow.visible = f.model.root.visible;
    }
    botBall.visible = offense && botOff.phase !== "stolen";
    botBallShadow.visible = botBall.visible;
    if (!on) return;
    if (offense) poseFigure(botFig, dt, botOff, "offense");
    else poseFigure(botFig, dt, botGuard, "guard");
    if (twos()) {
      if (offense) {
        poseFigure(opp2Fig, dt, oppSpacer, "spacer");
        poseFigure(mateFig, dt, mateGuard, "guard");
      } else {
        poseFigure(opp2Fig, dt, oppGuard2, "guard");
        poseFigure(mateFig, dt, mateSpacer, "spacer");
      }
    }
    if (offense) {
      botBall.position.copy(botOff.ball);
      botBall.rotation.x += dt * 6;
      botBallShadow.position.set(botOff.ball.x, 0.004, botOff.ball.z);
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
    // The +X rim rocks on its mount after a dunk.
    const shake = elapsed - rimShakeAt;
    hoops[0].rotation.z = shake >= 0 && shake < 1 ? 0.012 * Math.exp(-5 * shake) * Math.sin(34 * shake) : 0;
    nets.forEach((net, i) => {
      const t = elapsed - netKick[i];
      const s = t >= 0 && t < 1.5 ? 0.32 * Math.exp(-4.5 * t) * Math.cos(16 * t) : 0;
      net.scale.set(1 - 0.35 * s, 1 + s, 1 - 0.35 * s);
    });
  };

  /** The shot meter rides beside the player's head while a jumper is up, then shows the grade. */
  const meterAt = new THREE.Vector3();
  const updateMeter = () => {
    // The timing meter is for the jumper; a running finish has no release to time.
    const show = !shot.finish && (shot.holding || simTime - shot.releasedAt < 0.9);
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
        if (match.active && match.phase === "defense") {
          // On defense Space jumps to block, J / L swipe, I raises the hand (read from the held keys).
          if (up || match.locked) continue;
          if (key === "ShootDown") defender.jump(simTime);
          else if (key === "J") defender.swipe(1, simTime);
          else if (key === "L") defender.swipe(-1, simTime);
          if (key === "ShootDown" || key === "J" || key === "L") {
            playPress(key === "ShootDown" ? "I" : key);
          }
          continue;
        }
        if (match.locked) continue;
        if (key === "ShootDown") shot.press(simTime, move);
        else if (key === "ShootUp") shot.lift(simTime);
        else if (up) {
          shot.holdKeyUp(key);
          dribble.keyUp(key, simTime);
        }
        else pressKey(key);
      }
      const defending = match.active && match.phase === "defense";
      const dribbling = !defending && dribble.state !== "loose" && dribble.state !== "shot";
      // Holding comma backs down: the back to the hoop, as in the post.
      if (held.has("Comma") && !shot.feetLocked && dribbling) commaSince ??= simTime;
      else commaSince = null;
      body.backingDown = commaSince !== null && simTime - commaSince >= MOVE.backDownDelay;
      // In the triple-threat hold the feet stay planted but the body turns toward the way WASD points.
      body.holdingBall = !defending && dribble.state === "held";
      body.step(STEP, shot.feetLocked ? still : move, sprint, dribbling, squeak, shot.inHold ? move : undefined);
      dribble.update(simTime, STEP);
      shot.update(simTime);
      combo.update(simTime);
    }
    tickSession();
    if (match.active) tickMatch(dt);
    const defending = match.active && match.phase === "defense";

    player.root.position.y = defending ? defender.jumpY : shot.jumpY;
    player.root.rotation.y = body.renderYaw;
    subject.position.set(body.position.x, 0, body.position.z);
    // View B's heading follows the player only when idle or heading away from the
    // camera; strafing and backpedalling keep it steady so WASD paths stay straight.
    if (move.lengthSq() < 1e-4 || move.dot(camFacing) > 0.3) {
      camFacing.lerp(body.facing, 1 - Math.exp(-dt * 2.5)).normalize();
    }
    playerShadow.position.set(body.position.x, 0.003, body.position.z);
    aimHands(simTime);
    const shooting = !defending && (shot.holding || shot.inHold || shot.jumpY > 0 || simTime - shot.releasedAt < 0.45);
    player.animate({
      dt,
      elapsed,
      speed: body.speed,
      dribbling: !defending && dribble.state !== "loose" && dribble.state !== "shot",
      split: dribble.split,
      palm: dribble.palmEase,
      lunge: body.lunge,
      hands,
      shoot: shooting
        ? {
            dip: shot.phase === "gather" ? 1 : shot.inHold ? 0.6 : 0,
            air: THREE.MathUtils.clamp(shot.jumpY / 0.15, 0, 1),
            lean: shot.lean * SHOT.fade.lean,
            jab: shot.jabAmount,
            hunch: shot.protectAmount,
          }
        : defending && defender.airborne
          ? { dip: 0, air: THREE.MathUtils.clamp(defender.jumpY / 0.15, 0, 1) }
          : undefined,
    });
    poseBot(dt);
    animateNets();
    updateMeter();

    ball.position.copy(dribble.ball.position);
    ball.quaternion.copy(dribble.ball.orientation);
    ballShadow.visible = ball.visible;
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
          steps: body.steps,
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
          inHold: shot.inHold,
          jab: +shot.jabAmount.toFixed(3),
          protect: +shot.protectAmount.toFixed(3),
          apexIn: apexIn === null ? null : +apexIn.toFixed(4),
          jumpHeight: +shot.jumpY.toFixed(3),
          fade: shot.fade,
          finish: shot.finish,
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
      get duel() {
        return {
          active: match.active,
          phase: match.phase,
          you: match.you,
          bot: match.bot,
          stops: match.stops,
          switching: match.switchAt !== null,
          botPosition: tuple((match.phase === "defense" ? botOff : botGuard).position),
          botJump: +(match.phase === "defense" ? botOff : botGuard).jumpY.toFixed(3),
          botBall: tuple(botOff.ball),
          botPhase: match.phase === "defense" ? botOff.phase : "guard",
          jumpY: +defender.jumpY.toFixed(3),
          raise: +defender.raise.toFixed(3),
        };
      },
      get twos() {
        const defense = match.phase === "defense";
        return {
          active: match.active && twos(),
          phase: match.phase,
          us: match.you,
          them: match.bot,
          target: TWOS.target,
          mate: tuple((defense ? mateGuard : mateSpacer).position),
          opponents: [tuple((defense ? botOff : botGuard).position), tuple((defense ? oppSpacer : oppGuard2).position)] as TwosSpots,
        };
      },
      setTwosScore: (us: number, them: number) => {
        match.you = us;
        match.bot = them;
        publishDuel();
      },
      botShoot: () => botOff.shootNow(simTime),
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
