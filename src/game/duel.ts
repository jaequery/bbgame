// The bot for 1v1 and the defense drill, plus the player's defensive moves.
// Offense: the bot dribbles at the -X hoop on a kinematic ball and shoots.
// Defense (the bot guarding you): it shadows you between you and the +X hoop,
// reaches for the ball and jumps at your jumper. No rendering here; `createGame`
// poses the bot's model from these numbers.

import * as THREE from "three";
import { BALL_RADIUS, FLOOR_MAX_X, FLOOR_MAX_Z, FLOOR_MIN_X, FLOOR_MIN_Z, GRAVITY, HOOP_X, RIM_HEIGHT } from "./dimensions";

export const DUEL = {
  /** Length of a 1v1 match or defense drill (s). */
  matchSeconds: 90,
  /** Points for a basket. */
  basket: 2,
  /** Pause (s) after a basket, stop or miss before the ball changes hands. */
  switchDelay: 1.7,
  /** Pause (s) after a steal. */
  stealDelay: 0.9,
  /** Bodies closer than this (m) push each other apart. */
  bodyRadius: 0.75,
  bot: {
    /** Dribbling to the hoop (m/s). */
    speed: 2.7,
    /** Shadowing the player on defense (m/s). */
    guardSpeed: 3.2,
    /** The bot shoots from inside this distance (m). */
    shootRange: 6.2,
    /** Seconds from the start of the gather to the release; the player must be airborne by then to block. */
    windup: 0.45,
    /** A crossover every so often (s). */
    crossEvery: 1.05,
    /** Bounces per second. */
    bounceRate: 2.2,
    /** Shot hit chance: close in, minus per metre beyond 2 m (clamped). */
    hit: { close: 0.78, perMetre: 0.075, min: 0.22, max: 0.8, contested: 0.4 },
    /** On defense: how close (m) it stays in front of the player. */
    gap: 1.15,
    /** Chance per second to strip a dribbling player within `stripRange` (m). */
    strip: { range: 0.95, perSecond: 0.55, grace: 1.5 },
    /** Chance its jump swats a jumper released within `blockRange` (m). */
    block: { range: 1.7, chance: 0.6, contestRange: 2.6, jumpTime: 0.6, jumpHeight: 0.7 },
  },
  defender: {
    /** Space: jump to block. */
    jumpTime: 0.62,
    jumpHeight: 0.7,
    /** J / L: the hand sweeps across the front. */
    swipeTime: 0.28,
    swipeCooldown: 0.4,
    /** The sweep covers ±this (m) either side of the body. */
    swipeSpan: 0.9,
    /** The ball is stripped within this window (m) of the hand, this far ahead of the body. */
    swipeHalfWidth: 0.4,
    swipeReach: [0.15, 1.5] as [number, number],
    /** Ball height (m) above which a swipe goes under it. */
    swipeBallMax: 0.9,
    /** Within this distance (m) of the shooter, a jump at the release blocks it. */
    blockReach: 1.5,
    /** Within this, a raised hand or a jump contests it. */
    contestReach: 2.2,
    /** A block needs at least this much height (m). */
    blockHeight: 0.3,
  },
};

const BOT_HOOP = new THREE.Vector3(-HOOP_X, RIM_HEIGHT, 0);
const PLAYER_HOOP = new THREE.Vector3(HOOP_X, RIM_HEIGHT, 0);

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Pushes two floor bodies apart if they overlap; each moves half. */
export function separate(a: THREE.Vector3, b: THREE.Vector3, min = DUEL.bodyRadius) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= min) return;
  const nx = d > 1e-4 ? dx / d : 1;
  const nz = d > 1e-4 ? dz / d : 0;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
}

function keepOnFloor(p: THREE.Vector3) {
  p.x = THREE.MathUtils.clamp(p.x, FLOOR_MIN_X + 0.35, FLOOR_MAX_X - 0.35);
  p.z = THREE.MathUtils.clamp(p.z, FLOOR_MIN_Z + 0.35, FLOOR_MAX_Z - 0.35);
}

/** How a defender affected a shot at its release. */
export type Judgement = "blocked" | "contested" | "open";

export type BotShotPhase = "dribble" | "windup" | "flight" | "drop" | "stolen" | "done";

export interface OffenseEvents {
  /** The bot lets go of its shot; says how the player's defense affected it. */
  release(): Judgement;
  /** The shot is decided. */
  result(made: boolean, blocked: boolean): void;
  /** The bot crossed over. */
  cross(): void;
}

/** The bot with the ball, attacking the -X hoop. */
export class BotOffense {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = -Math.PI / 2;
  jumpY = 0;
  phase: BotShotPhase = "dribble";
  /** +1: the ball is on the bot's left. Eases with `sideEase`. */
  ballSide = 1;
  sideEase = 1;
  readonly ball = new THREE.Vector3();
  private readonly ballVel = new THREE.Vector3();
  private phaseAt = 0;
  private crossAt = 0;
  private shootAt = 0;
  private made = false;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private arc = 1;
  private flight = 0.9;
  private readonly dir = new THREE.Vector3();
  private readonly perp = new THREE.Vector3();
  private readonly rel = new THREE.Vector3();

  constructor(private readonly random: () => number = Math.random) {}

  start(at: THREE.Vector3, now: number) {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.atan2(BOT_HOOP.x - at.x, BOT_HOOP.z - at.z);
    this.jumpY = 0;
    this.phase = "dribble";
    this.phaseAt = now;
    this.crossAt = now + DUEL.bot.crossEvery;
    this.shootAt = 0;
    this.ballSide = this.random() < 0.5 ? 1 : -1;
    this.sideEase = this.ballSide;
    this.placeBall(now);
  }

  /** Automation: go up for the shot now. */
  shootNow(now: number) {
    if (this.phase !== "dribble") return;
    this.phase = "windup";
    this.phaseAt = now;
  }

  /** The ball is out of the bot's hands (stripped). */
  strip() {
    this.phase = "stolen";
  }

  /** Where the bot's hand-and-ball is while dribbling. */
  private placeBall(now: number) {
    const left = this.perp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const u = (now * DUEL.bot.bounceRate) % 1;
    this.ball
      .copy(this.position)
      .addScaledVector(left, 0.42 * this.sideEase)
      .addScaledVector(fwd, 0.35);
    this.ball.y = BALL_RADIUS + 0.95 * 4 * u * (1 - u);
  }

  /** Ball is low enough to be swiped. */
  get exposed() {
    return this.phase === "dribble" && this.ball.y < DUEL.defender.swipeBallMax;
  }

  get shooting() {
    return this.phase === "windup" || this.phase === "flight";
  }

  /** Distance to the hoop the bot attacks (m). */
  get hoopDistance() {
    return Math.hypot(BOT_HOOP.x - this.position.x, BOT_HOOP.z - this.position.z);
  }

  update(now: number, dt: number, defender: THREE.Vector3, events: OffenseEvents) {
    const k = 1 - Math.exp(-dt * 8);
    switch (this.phase) {
      case "dribble": {
        const toHoop = this.dir.set(BOT_HOOP.x - this.position.x, 0, BOT_HOOP.z - this.position.z);
        const dist = toHoop.length();
        toHoop.normalize();
        const perp = this.perp.set(toHoop.z, 0, -toHoop.x);
        // Go around the defender: step to the side they are not on, more the closer they are.
        const rel = this.rel.set(defender.x - this.position.x, 0, defender.z - this.position.z);
        const ahead = rel.dot(toHoop);
        const lateral = rel.dot(perp);
        if (ahead > -0.3 && ahead < 2.4) {
          toHoop.addScaledVector(perp, (lateral >= 0 ? -1 : 1) * 1.1 * (1 - Math.max(0, ahead) / 2.4));
        }
        toHoop.addScaledVector(perp, this.ballSide * 0.2).normalize();
        const inRange = dist <= DUEL.bot.shootRange;
        const speed = inRange ? 0.8 : DUEL.bot.speed;
        this.velocity.x += (toHoop.x * speed - this.velocity.x) * k;
        this.velocity.z += (toHoop.z * speed - this.velocity.z) * k;
        this.position.addScaledVector(this.velocity, dt);
        const want = Math.atan2(BOT_HOOP.x - this.position.x, BOT_HOOP.z - this.position.z);
        this.turnTo(want, dt);
        if (now >= this.crossAt) {
          this.ballSide = -this.ballSide;
          this.crossAt = now + DUEL.bot.crossEvery * (0.8 + this.random() * 0.5);
          events.cross();
        }
        this.sideEase += (this.ballSide - this.sideEase) * (1 - Math.exp(-dt * 14));
        if (inRange) {
          this.shootAt ||= now + 0.35 + this.random() * 0.7;
          if (now >= this.shootAt) {
            this.phase = "windup";
            this.phaseAt = now;
          }
        }
        this.placeBall(now);
        break;
      }
      case "windup": {
        this.velocity.multiplyScalar(Math.exp(-dt * 10));
        this.position.addScaledVector(this.velocity, dt);
        const u = clamp01((now - this.phaseAt) / DUEL.bot.windup);
        this.jumpY = 0.42 * smooth(clamp01((u - 0.3) / 0.7));
        this.turnTo(Math.atan2(BOT_HOOP.x - this.position.x, BOT_HOOP.z - this.position.z), dt);
        // The ball rides up from the chest to the forehead.
        this.ball.set(this.position.x, 1.1 + 1.2 * smooth(u) + this.jumpY, this.position.z);
        this.ball.addScaledVector(this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.25);
        if (u >= 1) this.release(now, events);
        break;
      }
      case "flight": {
        const u = clamp01((now - this.phaseAt) / this.flight);
        this.ball.lerpVectors(this.from, this.to, u);
        this.ball.y += this.arc * 4 * u * (1 - u);
        this.jumpY = Math.max(0, this.jumpY - dt * 1.6);
        if (u >= 1) {
          events.result(this.made, false);
          this.phase = "drop";
          this.phaseAt = now;
          if (this.made) this.ballVel.set(0, -1.5, 0);
          else this.ballVel.set(1 + this.random() * 1.2, 1.6, (this.random() - 0.5) * 2.4);
        }
        break;
      }
      case "drop": {
        this.fall(dt);
        this.jumpY = Math.max(0, this.jumpY - dt * 1.6);
        if (now - this.phaseAt > 0.9) this.phase = "done";
        break;
      }
      default:
        this.jumpY = Math.max(0, this.jumpY - dt * 1.6);
        break;
    }
    keepOnFloor(this.position);
  }

  private turnTo(want: number, dt: number) {
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += THREE.MathUtils.clamp(d, -9 * dt, 9 * dt);
  }

  private release(now: number, events: OffenseEvents) {
    const verdict = events.release();
    const dist = this.hoopDistance;
    const h = DUEL.bot.hit;
    const base = THREE.MathUtils.clamp(h.close - h.perMetre * Math.max(0, dist - 2), h.min, h.max);
    this.from.copy(this.ball);
    this.phaseAt = now;
    if (verdict === "blocked") {
      // Swatted back toward the shooter's own court.
      this.phase = "drop";
      this.ballVel.set(1.8 + this.random(), 2.4, (this.random() - 0.5) * 3);
      this.made = false;
      events.result(false, true);
      return;
    }
    this.made = this.random() < (verdict === "contested" ? base * h.contested : base);
    this.to.copy(BOT_HOOP);
    if (!this.made) {
      // Off the front or back of the rim.
      const off = (this.random() < 0.5 ? -1 : 1) * (0.28 + this.random() * 0.12);
      this.to.x += (this.random() < 0.5 ? 1 : -1) * 0.3;
      this.to.z += off;
    }
    this.flight = 0.7 + 0.04 * dist;
    this.arc = 1 + 0.1 * dist;
    this.phase = "flight";
  }

  /** Free fall with floor bounces, from the ball's velocity. */
  private fall(dt: number) {
    this.ballVel.y -= GRAVITY * dt;
    this.ball.addScaledVector(this.ballVel, dt);
    if (this.ball.y < BALL_RADIUS) {
      this.ball.y = BALL_RADIUS;
      this.ballVel.y = Math.abs(this.ballVel.y) * 0.55;
      this.ballVel.x *= 0.7;
      this.ballVel.z *= 0.7;
    }
  }
}

/** The bot guarding the player, who attacks the +X hoop. */
export class BotGuard {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = Math.PI / 2;
  jumpY = 0;
  /** 0…1 arms up. */
  armsUp = 0;
  private jumpAt = -Infinity;
  private startedAt = 0;
  private readonly want = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  /** Smoothed read of where the player is: the bot reacts late. */
  private readonly read = new THREE.Vector3();

  constructor(private readonly random: () => number = Math.random) {}

  start(at: THREE.Vector3, player: THREE.Vector3, now: number) {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.read.copy(player);
    this.jumpY = 0;
    this.armsUp = 0;
    this.jumpAt = -Infinity;
    this.startedAt = now;
    this.yaw = Math.atan2(player.x - at.x, player.z - at.z);
  }

  /** Jump at the player's shot. */
  contest(now: number) {
    if (now - this.jumpAt > DUEL.bot.block.jumpTime + 0.2) this.jumpAt = now;
  }

  update(now: number, dt: number, player: THREE.Vector3) {
    this.read.lerp(player, 1 - Math.exp(-dt * 5));
    // Stay between the player and the hoop, a gap in front.
    const toHoop = this.dir.set(PLAYER_HOOP.x - this.read.x, 0, PLAYER_HOOP.z - this.read.z).normalize();
    this.want.copy(this.read).addScaledVector(toHoop, DUEL.bot.gap);
    const dx = this.want.x - this.position.x;
    const dz = this.want.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const speed = Math.min(DUEL.bot.guardSpeed, d * 5);
    const k = 1 - Math.exp(-dt * 8);
    this.velocity.x += ((d > 1e-3 ? dx / d : 0) * speed - this.velocity.x) * k;
    this.velocity.z += ((d > 1e-3 ? dz / d : 0) * speed - this.velocity.z) * k;
    this.position.addScaledVector(this.velocity, dt);
    keepOnFloor(this.position);
    const want = Math.atan2(player.x - this.position.x, player.z - this.position.z);
    let turn = want - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.yaw += THREE.MathUtils.clamp(turn, -9 * dt, 9 * dt);

    const u = (now - this.jumpAt) / DUEL.bot.block.jumpTime;
    this.jumpY = u >= 0 && u <= 1 ? DUEL.bot.block.jumpHeight * 4 * u * (1 - u) : 0;
    const up = this.jumpY > 0 ? 1 : 0;
    this.armsUp += (up - this.armsUp) * (1 - Math.exp(-dt * 14));
  }

  /** Per-frame strip attempt on a dribbler; true when the bot gets the ball. */
  tryStrip(now: number, dt: number, player: THREE.Vector3) {
    const s = DUEL.bot.strip;
    if (now - this.startedAt < s.grace) return false;
    if (Math.hypot(player.x - this.position.x, player.z - this.position.z) > s.range) return false;
    return this.random() < s.perSecond * dt;
  }

  /** Does the bot's jump swat a jumper released at `distance`? */
  blocks(distance: number) {
    const b = DUEL.bot.block;
    return this.jumpY > 0.2 && distance < b.range && this.random() < b.chance;
  }
}

/** The player's defensive moves: Space jump, J / L swipes, I hand up. */
export class Defender {
  jumpY = 0;
  /** 0…1 hand raised (I held). */
  raise = 0;
  raised = false;
  private jumpAt = -Infinity;
  private swipeDir: 1 | -1 = 1;
  private swipeAt = -Infinity;
  private swipeSpent = false;
  private lastSwipe = -Infinity;

  reset() {
    this.jumpY = 0;
    this.raise = 0;
    this.raised = false;
    this.jumpAt = -Infinity;
    this.swipeAt = -Infinity;
    this.lastSwipe = -Infinity;
  }

  get airborne() {
    return this.jumpY > 0;
  }

  jump(now: number) {
    if (now - this.jumpAt > DUEL.defender.jumpTime + 0.15) this.jumpAt = now;
  }

  /** `dir` +1: J, left hand across to the right. −1: L, right hand across to the left. */
  swipe(dir: 1 | -1, now: number) {
    if (now - this.lastSwipe < DUEL.defender.swipeCooldown) return;
    this.lastSwipe = now;
    this.swipeAt = now;
    this.swipeDir = dir;
    this.swipeSpent = false;
  }

  /** Which hand is swiping, or null. */
  swipeHand(now: number): "L" | "R" | null {
    return this.sweep(now) === null ? null : this.swipeDir > 0 ? "L" : "R";
  }

  /** Lateral position (m, + = the player's left) of the sweeping hand; null when not swiping. */
  sweep(now: number): number | null {
    const u = (now - this.swipeAt) / DUEL.defender.swipeTime;
    if (u < 0 || u > 1) return null;
    return this.swipeDir * DUEL.defender.swipeSpan * (1 - 2 * smooth(u));
  }

  update(now: number, dt: number, raiseHeld: boolean) {
    const u = (now - this.jumpAt) / DUEL.defender.jumpTime;
    this.jumpY = u >= 0 && u <= 1 ? DUEL.defender.jumpHeight * 4 * u * (1 - u) : 0;
    this.raised = raiseHeld;
    this.raise += ((raiseHeld ? 1 : 0) - this.raise) * (1 - Math.exp(-dt * 16));
  }

  /** Does the sweeping hand catch the ball (world `ball`) in front of a body at `pos` facing `yaw`? One strip per swipe. */
  strips(now: number, pos: THREE.Vector3, yaw: number, ball: THREE.Vector3) {
    const sweep = this.sweep(now);
    if (sweep === null || this.swipeSpent) return false;
    const rx = ball.x - pos.x;
    const rz = ball.z - pos.z;
    const fwd = rx * Math.sin(yaw) + rz * Math.cos(yaw);
    const lat = rx * Math.cos(yaw) - rz * Math.sin(yaw);
    const d = DUEL.defender;
    if (fwd < d.swipeReach[0] || fwd > d.swipeReach[1] || ball.y > d.swipeBallMax) return false;
    if (Math.abs(lat - sweep) > d.swipeHalfWidth) return false;
    this.swipeSpent = true;
    return true;
  }

  /** What the player's jump and raised hand do to a shot released `distance` metres away. */
  judge(distance: number, inFront: boolean): Judgement {
    const d = DUEL.defender;
    if (!inFront) return "open";
    if (distance <= d.blockReach && this.jumpY >= d.blockHeight) return "blocked";
    if (distance <= d.contestReach && (this.raised || this.airborne)) return "contested";
    return "open";
  }
}
