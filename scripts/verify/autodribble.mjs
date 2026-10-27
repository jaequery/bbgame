#!/usr/bin/env node
// Drives the auto-dribble and the "almost impossible to lose" rule:
//   1. 30 s with no dribble input — 15 s standing, then 15 s walking WASD.
//   2. 30 s of random J / L / I / K / , mashing (no sprint).
//   3. Each transfer move in both directions + the high dribble, timed off the catch.
//   4. The one remaining loss: sprinting while spamming sloppy hand switches,
//      then walking onto the loose ball.
// An in-page sampler reads window.__game.dribble on every animation frame, so a
// loose ball between polls can't slip by. Writes <out>/autodribble-report.json
// and screenshots to <out>/autodribble/. Exit 0 = every check passed.
//
//   node scripts/verify/autodribble.mjs [--url http://localhost:3000] [--out artifacts] [--seconds 30]
//
// Needs a dev server (window.__game is dev-only) and Chromium:
//   npx playwright install chromium

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg("url", "http://localhost:3000");
const out = arg("out", "artifacts");
const seconds = Number(arg("seconds", "30"));
const shots = path.join(out, "autodribble");
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const report = { url, ok: false, checks: {}, consoleErrors };
const failures = [];
const check = (name, pass, detail) => {
  report.checks[name] = { pass, ...detail };
  if (!pass) failures.push(name);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
};

const game = (fn, a) => page.evaluate(fn, a);
const handKey = (hand) => (hand === "R" ? "l" : "j");
const otherHand = (hand) => (hand === "R" ? "L" : "R");
const LEAD = 0.03;

async function frozenShot(name) {
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(60);
  const file = path.join(shots, name);
  await page.screenshot({ path: file });
  await game(() => window.__game.setTimeScale(1));
  return file;
}

/** Starts a per-frame sampler of the dribble state in the page. */
const startSampler = () =>
  game(() => {
    const g = window.__game;
    const s = {
      frames: 0,
      looseFrames: 0,
      states: {},
      lostStart: g.dribble.lost,
      movesStart: g.dribble.moves,
      minY: Infinity,
      maxY: -Infinity,
      bounces: 0,
      lastVy: 0,
      run: true,
      log: [],
    };
    const tick = () => {
      if (!s.run) return;
      const d = g.dribble;
      const y = g.ball.position[1];
      const vy = g.ball.velocity[1];
      s.frames++;
      s.states[d.state] = (s.states[d.state] ?? 0) + 1;
      if (d.state === "loose") s.looseFrames++;
      s.minY = Math.min(s.minY, y);
      s.maxY = Math.max(s.maxY, y);
      if (s.lastVy < -0.5 && vy > 0.5) s.bounces++;
      s.lastVy = vy;
      if (s.frames % 15 === 0) s.log.push({ t: +g.simTime.toFixed(2), state: d.state, hand: d.hand, y: +y.toFixed(2), speed: +g.player.speed.toFixed(2) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__sampler = s;
  });

const stopSampler = () =>
  game(() => {
    const s = window.__sampler;
    s.run = false;
    const d = window.__game.dribble;
    return {
      frames: s.frames,
      looseFrames: s.looseFrames,
      states: s.states,
      lost: d.lost - s.lostStart,
      moves: d.moves - s.movesStart,
      bounces: s.bounces,
      ballY: [+s.minY.toFixed(2), +s.maxY.toFixed(2)],
      log: s.log,
    };
  });

/** Average seconds between pushes over a stretch (the dribble rhythm). */
async function rhythm(ms) {
  const a = await game(() => ({ m: window.__game.dribble.moves, t: window.__game.simTime }));
  await page.waitForTimeout(ms);
  const b = await game(() => ({ m: window.__game.dribble.moves, t: window.__game.simTime }));
  return +((b.t - a.t) / Math.max(1, b.m - a.m)).toFixed(3);
}

const CALLOUT = {
  crossover: "CROSSOVER!!",
  between: "BETWEEN THE LEGS!!",
  behind: "BEHIND THE BACK!!",
  high: "HIGH DRIBBLE!",
};
const PATH = { crossover: "i", between: "k", behind: "," };

async function doMove(kind, label) {
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.waitForFunction(() => window.__game.dribble.state === "flight", null, { timeout: 3_000 });
    const before = await game(() => ({ d: window.__game.dribble, c: window.__game.combo }));
    const from = before.d.hand;
    const keys = kind === "high" ? [handKey(from), "i"] : [handKey(from), PATH[kind], handKey(otherHand(from))];
    const to = kind === "high" ? from : otherHand(from);
    await page.waitForFunction((lead) => {
      const c = window.__game.dribble.catchIn;
      return c !== null && c <= lead;
    }, LEAD, { polling: 5, timeout: 3_000 }); // between frames: a caught ball leaves flight on the next frame
    for (let i = 0; i < keys.length; i++) {
      if (i) await page.waitForTimeout(25);
      await page.keyboard.press(keys[i]);
    }
    await page
      .waitForFunction((n) => window.__game.combo.moves > n, before.c.moves, { polling: "raf", timeout: 2_000 })
      .catch(() => {});
    await page.waitForTimeout(30);
    const after = await game(() => ({
      d: window.__game.dribble,
      c: window.__game.combo,
      callout: document.querySelector("[data-testid=hud-callout]")?.textContent ?? null,
    }));
    const m = after.d.lastMove;
    const file = await frozenShot(`move-${label}.png`);
    last = {
      kind,
      keys: keys.join(" "),
      attempt,
      move: m && { kind: m.kind, from: m.from, to: m.to, timing: m.timing },
      timing: after.d.lastTiming,
      points: after.c.lastMove?.points ?? 0,
      callout: after.callout,
      file,
      pass:
        m?.kind === kind &&
        m.from === from &&
        m.to === to &&
        m.timing === "clean" &&
        after.c.moves > before.c.moves &&
        (after.c.lastMove?.points ?? 0) > 0 &&
        (after.callout ?? "").startsWith(CALLOUT[kind]),
    };
    if (last.pass) return last;
    await page.waitForTimeout(600);
  }
  return last;
}

/** Walks (camera-relative WASD) onto the loose ball until it is picked up. */
async function recover(timeoutMs = 12_000) {
  const start = Date.now();
  const down = new Set();
  const set = async (key, on) => {
    if (on && !down.has(key)) {
      await page.keyboard.down(key);
      down.add(key);
    } else if (!on && down.has(key)) {
      await page.keyboard.up(key);
      down.delete(key);
    }
  };
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await game(() => ({
        state: window.__game.dribble.state,
        ball: window.__game.ball.position,
        player: window.__game.player.position,
        cam: window.__game.camera,
      }));
      if (s.state !== "loose") return true;
      const dx = s.ball[0] - s.player[0];
      const dz = s.ball[2] - s.player[2];
      let fx = s.cam.target[0] - s.cam.position[0];
      let fz = s.cam.target[2] - s.cam.position[2];
      const fl = Math.hypot(fx, fz);
      fx /= fl;
      fz /= fl;
      const f = dx * fx + dz * fz;
      const r = dx * -fz + dz * fx;
      const m = Math.hypot(f, r);
      await set("w", f / m > 0.38);
      await set("s", f / m < -0.38);
      await set("d", r / m > 0.38);
      await set("a", r / m < -0.38);
      await page.waitForTimeout(40);
    }
    return false;
  } finally {
    for (const k of [...down]) await page.keyboard.up(k);
  }
}

/** The WASD key whose camera-relative direction points most toward centre court. */
async function keyTowardCentre() {
  const s = await game(() => ({ p: window.__game.player.position, cam: window.__game.camera }));
  const fx0 = s.cam.target[0] - s.cam.position[0];
  const fz0 = s.cam.target[2] - s.cam.position[2];
  const fl = Math.hypot(fx0, fz0);
  const [fx, fz] = [fx0 / fl, fz0 / fl];
  const dirs = { w: [fx, fz], s: [-fx, -fz], d: [-fz, fx], a: [fz, -fx] };
  const [cx, cz] = [-s.p[0], -s.p[2]];
  return Object.entries(dirs).sort((a, b) => b[1][0] * cx + b[1][1] * cz - (a[1][0] * cx + a[1][1] * cz))[0][0];
}

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  // 1. No input: standing, then walking.
  const half = (seconds * 1000) / 2;
  await startSampler();
  report.rhythmStanding = await rhythm(3000);
  await page.waitForTimeout(Math.max(0, half - 3000 - 1500));
  await frozenShot("idle-standing.png");
  const walkKeys = ["w", "d", "s", "a"];
  const walkStart = Date.now();
  let walkRhythm = null;
  for (let i = 0; Date.now() - walkStart < half; i++) {
    const key = i === 0 ? await keyTowardCentre() : walkKeys[i % 4];
    await page.keyboard.down(key);
    if (i === 0) {
      await page.waitForTimeout(800); // up to speed first
      walkRhythm = await rhythm(2200);
    } else await page.waitForTimeout(3000);
    if (i === 1) await frozenShot("idle-walking.png");
    await page.keyboard.up(key);
  }
  report.rhythmWalking = walkRhythm;
  const idle = await stopSampler();
  report.idle = idle;
  check("no-input-never-loose", idle.looseFrames === 0 && idle.lost === 0 && idle.moves > 20 && idle.bounces > 20, {
    ...idle,
    log: undefined,
  });
  check("rhythm-follows-movement", report.rhythmWalking < report.rhythmStanding, {
    standing: report.rhythmStanding,
    walking: report.rhythmWalking,
  });

  // 2. Mash J / L / I / K / , at random for 30 s, no sprint.
  const keys = ["j", "l", "i", "k", ","];
  await startSampler();
  const comboBefore = await game(() => window.__game.combo);
  const mashStart = Date.now();
  let presses = 0;
  let shot = false;
  while (Date.now() - mashStart < seconds * 1000) {
    await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
    presses++;
    await page.waitForTimeout(25 + Math.random() * 110);
    if (!shot && Date.now() - mashStart > 10_000) {
      await frozenShot("mash.png");
      shot = true;
    }
  }
  const mash = await stopSampler();
  const comboAfter = await game(() => window.__game.combo);
  report.mash = mash;
  check("mash-never-loose", mash.looseFrames === 0 && mash.lost === 0, {
    ...mash,
    log: undefined,
    presses,
    scoredMoves: comboAfter.moves - comboBefore.moves,
  });

  // 3. Each transfer move both ways + the high dribble, performed cleanly.
  await page.waitForTimeout(4500); // let the combo cool off
  const plan = ["crossover", "crossover", "between", "between", "behind", "behind", "high"];
  report.moves = [];
  for (let i = 0; i < plan.length; i++) report.moves.push(await doMove(plan[i], `${i + 1}-${plan[i]}`));
  const pairs = ["crossover", "between", "behind"].map((k) => new Set(report.moves.filter((m) => m.pass && m.kind === k).map((m) => m.move.from)).size);
  check("moves-clean", report.moves.every((m) => m?.pass) && pairs.every((n) => n === 2), {
    moves: report.moves.map((m) => m && { kind: m.kind, from: m.move?.from, to: m.move?.to, timing: m.timing, points: m.points, callout: m.callout, attempt: m.attempt }),
  });

  // 4. The one way left to lose it: sprint + spam sloppy hand switches.
  await page.keyboard.down("Shift");
  await page.keyboard.down(await keyTowardCentre());
  let spamPresses = 0;
  for (; spamPresses < 120 && (await game(() => window.__game.dribble.state)) !== "loose"; spamPresses++) {
    await page.keyboard.press(spamPresses % 2 ? "l" : "j");
    await page.waitForTimeout(45);
  }
  for (const k of ["w", "a", "s", "d", "Shift"]) await page.keyboard.up(k);
  const lostState = await game(() => ({
    state: window.__game.dribble.state,
    callout: document.querySelector("[data-testid=hud-callout]")?.textContent ?? null,
  }));
  await frozenShot("sprint-spam-loose.png");
  const recovered = lostState.state === "loose" && (await recover());
  check("sprint-spam-loses-and-recovers", lostState.state === "loose" && recovered, { spamPresses, ...lostState, recovered });

  check("no-console-errors", consoleErrors.length === 0, { count: consoleErrors.length });
  report.ok = failures.length === 0;
} catch (err) {
  report.error = String(err?.stack ?? err);
  failures.push("exception");
  await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => {});
} finally {
  report.failures = failures;
  await writeFile(path.join(out, "autodribble-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(failures.length ? `FAILED: ${failures.join(", ")}` : "ALL PASS");
  process.exit(failures.length ? 1 : 0);
}
