#!/usr/bin/env node
// Drives dribbling + combo scoring with real key presses, timed off the ball:
// in each camera view (B, A, C) it performs every move — crossover, between the
// legs and behind the back in both directions, the high dribble and the basic
// switch — and checks the move, callout and score. Then it walks while
// dribbling, loses the ball the only way left (sprinting while spamming sloppy
// hand switches) and walks it down, and pushes the player into the floor bounds. Screenshot sequences of each move go to <out>/moves/.
//
//   node scripts/verify/dribble.mjs [--url http://localhost:3000] [--out artifacts] [--frames all|B]
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
const frameViews = arg("frames", "B"); // which views get full per-move screenshot sequences
await mkdir(path.join(out, "moves"), { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const report = { url, ok: false, checks: {}, views: {}, consoleErrors };
const failures = [];
const check = (name, pass, detail) => {
  report.checks[name] = { pass, ...detail };
  if (!pass) failures.push(name);
};

const game = (fn, a) => page.evaluate(fn, a);
const dribbleState = () => game(() => window.__game.dribble);
const comboState = () => game(() => window.__game.combo);
const handKey = (hand) => (hand === "R" ? "l" : "j");
const otherHand = (hand) => (hand === "R" ? "L" : "R");

/** Covers the Playwright → page key latency so the press lands on the catch. */
const LEAD = 0.03;

async function waitCatch() {
  await page.waitForFunction(
    (lead) => {
      const c = window.__game.dribble.catchIn;
      return c !== null && c <= lead;
    },
    LEAD,
    { polling: 5, timeout: 5_000 }, // between frames: a caught ball leaves flight on the next frame
  );
}

async function roll(keys) {
  for (let i = 0; i < keys.length; i++) {
    if (i) await page.waitForTimeout(25);
    await page.keyboard.press(keys[i]);
  }
}

/** Freezes the game clock for a screenshot so captures don't break the rhythm. */
async function frozenShot(file) {
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(60);
  await page.screenshot({ path: file });
  await game(() => window.__game.setTimeScale(1));
}

async function shootAt(simTarget, file) {
  await page.waitForFunction((t) => window.__game.simTime >= t, simTarget, { polling: "raf", timeout: 5_000 });
  await frozenShot(file);
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
      // Camera right = forward × up.
      const rx = -fz;
      const rz = fx;
      const f = dx * fx + dz * fz;
      const r = dx * rx + dz * rz;
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

/** Gets the ball into a dribble: recover it if loose, then let the auto-dribble push it. */
async function ensureDribbling() {
  const d = await dribbleState();
  if (d.state === "loose" && !(await recover())) throw new Error("could not recover the loose ball");
  await page.waitForFunction(() => window.__game.dribble.state === "flight", null, { timeout: 2_000 });
}

const MOVE_PLAN = ["crossover", "crossover", "between", "between", "behind", "behind", "high", "switch"];
const CALLOUT = {
  crossover: "CROSSOVER!!",
  between: "BETWEEN THE LEGS!!",
  behind: "BEHIND THE BACK!!",
  high: "HIGH DRIBBLE!",
  switch: "SWITCH!",
};
const PATH = { crossover: "i", between: "k", behind: "," };

function keysFor(kind, from) {
  const h = handKey(from);
  const o = handKey(otherHand(from));
  if (kind === "high") return { keys: [h, "i"], to: from };
  if (kind === "switch") return { keys: [h, o], to: otherHand(from) };
  return { keys: [h, PATH[kind], o], to: otherHand(from) };
}

async function doMove(view, index, kind, frames) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ensureDribbling();
    const before = await game(() => ({ d: window.__game.dribble, c: window.__game.combo }));
    const from = before.d.hand;
    const { keys, to } = keysFor(kind, from);
    await waitCatch();
    await roll(keys);
    try {
      await page.waitForFunction(
        (n) => window.__game.dribble.moves > n || window.__game.dribble.state === "loose",
        before.d.moves,
        { polling: "raf", timeout: 2_000 },
      );
    } catch {
      continue;
    }
    const files = [];
    const base = path.join(out, "moves", `${view}-${String(index).padStart(2, "0")}-${kind}-${from}to${to}`);
    const t0 = await game(() => window.__game.simTime);
    const after = await game(() => ({
      d: window.__game.dribble,
      c: window.__game.combo,
      callout: document.querySelector("[data-testid=hud-callout]")?.textContent ?? null,
    }));
    if (after.d.state === "loose" || after.d.moves === before.d.moves) continue;
    // Keys split across two contacts (a slow frame) read as another move, or the press missed
    // the clean window: it used to cost the ball, now it only scores less — retry either way.
    if (attempt < 3 && (after.d.lastMove?.kind !== kind || after.d.lastMove?.timing !== "clean")) {
      await page.waitForTimeout(4_500); // combo cools off so the retry scores like a first try
      continue;
    }
    if (frames) {
      // Release, mid-flight (around the bounce), and the catch.
      await frozenShot(`${base}-1.png`);
      files.push(`${base}-1.png`);
      const catchIn = (await dribbleState()).catchIn ?? 0.3;
      await shootAt(t0 + catchIn * 0.45, `${base}-2.png`);
      files.push(`${base}-2.png`);
      await shootAt(t0 + catchIn * 0.9, `${base}-3.png`);
      files.push(`${base}-3.png`);
    } else {
      await frozenShot(`${base}.png`);
      files.push(`${base}.png`);
    }
    const m = after.d.lastMove;
    return {
      kind,
      keys: keys.join(" "),
      attempt,
      move: m && { kind: m.kind, from: m.from, to: m.to, timing: m.timing },
      timing: after.d.lastTiming,
      points: after.c.lastMove?.points ?? 0,
      scoreBefore: before.c.score,
      scoreAfter: after.c.score,
      combo: after.c.combo,
      callout: after.callout,
      files,
      pass:
        m?.kind === kind &&
        m.from === from &&
        m.to === to &&
        after.c.score > before.c.score &&
        (after.callout ?? "").startsWith(CALLOUT[kind]),
    };
  }
  return { kind, pass: false, error: "lost the ball on every attempt" };
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

async function walkWhileDribbling(seconds) {
  await ensureDribbling();
  const start = await game(() => window.__game.player.position);
  const key = await keyTowardCentre();
  await page.keyboard.down(key);
  const until = Date.now() + seconds * 1000;
  let lost = false;
  try {
    while (Date.now() < until) {
      const d = await dribbleState();
      if (d.state === "loose") {
        lost = true;
        break;
      }
      if (d.state === "flight") {
        await waitCatch();
        await page.keyboard.press(handKey(d.hand));
        await page.waitForTimeout(150);
      } else await page.waitForTimeout(20);
    }
  } finally {
    await page.keyboard.up(key);
  }
  const end = await game(() => window.__game.player.position);
  return { key, distance: +Math.hypot(end[0] - start[0], end[2] - start[2]).toFixed(2), lost };
}

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await frozenShot(path.join(out, "dribble-start.png"));

  const pts = await game(() => window.__game.config.points);
  report.points = pts;
  check("points-order", pts.switch < pts.crossover && pts.crossover < pts.between && pts.between < pts.behind, { pts });

  for (const view of ["B", "A", "C"]) {
    await game((v) => window.__game.setView(v), view);
    await page.waitForFunction(() => !window.__game.camera.gliding, null, { timeout: 5_000 });
    const moves = [];
    for (let i = 0; i < MOVE_PLAN.length; i++) {
      moves.push(await doMove(view, i + 1, MOVE_PLAN[i], frameViews === "all" || frameViews.includes(view)));
    }
    const walk = await walkWhileDribbling(1.0);
    report.views[view] = { moves, walk };
    check(`moves-${view}`, moves.every((m) => m.pass), {
      failed: moves.filter((m) => !m.pass).map((m) => m.kind),
    });
    check(`walk-${view}`, walk.distance > 1.5 && !walk.lost, walk);
    const xs = moves.filter((m) => m.kind === "crossover");
    if (view === "B") check("repeat-scores-less", xs.length === 2 && xs[1].points < xs[0].points, { points: xs.map((m) => m.points) });
  }

  // Loose ball: sprint while spamming hand switches, the combo resets, the ball rolls away, walk onto it.
  await game(() => window.__game.setView("B"));
  await page.waitForFunction(() => !window.__game.camera.gliding, null, { timeout: 5_000 });
  await doMove("B", 90, "crossover", false);
  const comboBefore = (await comboState()).combo;
  await page.keyboard.down("Shift");
  await page.keyboard.down(await keyTowardCentre());
  for (let i = 0; i < 80 && (await dribbleState()).state !== "loose"; i++) {
    await page.keyboard.press(i % 2 ? "l" : "j");
    await page.waitForTimeout(45);
  }
  for (const k of ["w", "a", "s", "d", "Shift"]) await page.keyboard.up(k);
  await page.waitForFunction(() => window.__game.dribble.state === "loose", null, { timeout: 3_000 });
  await page.waitForTimeout(150);
  const loose = await game(() => ({
    combo: window.__game.combo.combo,
    chain: window.__game.combo.chain,
    ballVelocity: window.__game.ball.velocity,
    callout: document.querySelector("[data-testid=hud-callout]")?.textContent ?? null,
  }));
  await frozenShot(path.join(out, "loose-ball.png"));
  const groundSpeed = Math.hypot(loose.ballVelocity[0], loose.ballVelocity[2]);
  const recovered = await recover();
  const afterRecover = await dribbleState();
  check("loose-ball", comboBefore > 0 && loose.combo === 0 && loose.chain.length === 0 && groundSpeed > 0.2 && recovered && afterRecover.state !== "loose", {
    comboBefore,
    comboAfter: loose.combo,
    callout: loose.callout,
    groundSpeed: +groundSpeed.toFixed(2),
    recovered,
    stateAfter: afterRecover.state,
  });

  // Floor bounds: sprint straight ahead (view B) for 8 s — far enough to hit an edge from anywhere.
  await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.waitForTimeout(8_000);
  const bounds = await game(() => ({ p: window.__game.player.position, floor: window.__game.world.floor }));
  await frozenShot(path.join(out, "bounds.png"));
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  const [x, , z] = bounds.p;
  const f = bounds.floor;
  const edge = Math.min(x - f.minX, f.maxX - x, z - f.minZ, f.maxZ - z);
  check("bounds", x <= f.maxX && x >= f.minX && z <= f.maxZ && z >= f.minZ && edge < 0.6, {
    position: bounds.p,
    floor: f,
    distanceToEdge: +edge.toFixed(2),
  });

  report.ok = failures.length === 0;
} catch (err) {
  report.error = String(err);
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
}

report.failures = failures;
await writeFile(path.join(out, "dribble-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, failures, error: report.error, checks: report.checks }, null, 2));
process.exit(report.ok ? 0 : 1);
