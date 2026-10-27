#!/usr/bin/env node
// Drives the jumper with real key presses: from mid-range (~4.5 m) and from
// beyond the arc (~7.6 m) it builds a two-move combo, holds Space and lets go
// right at the apex (perfect), then shoots badly timed releases (0.2 s early
// and late). Checks make/miss, 2 vs 3, the combo cash-in on score + HUD and
// the rebound pass back into the hand. Screenshots go to <out>/jumper/.
//
//   node scripts/verify/jumper.mjs [--url http://localhost:3000] [--out artifacts]
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
const shots = path.join(out, "jumper");
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const report = { url, ok: false, checks: {}, shots: [], consoleErrors };
const hoop = { x: 0, rimHeight: 0 };
const failures = [];
const check = (name, pass, detail) => {
  report.checks[name] = { pass, ...detail };
  if (!pass) failures.push(name);
};

const game = (fn, a) => page.evaluate(fn, a);
/**
 * Moves and releases run in slow-mo so key presses land on the intended sim time
 * even when headless WebGL renders at a few frames per second (raf polling).
 */
const SLOW = 0.25;
const LEAD = 0.03 * SLOW;

async function waitCatch() {
  await page.waitForFunction(
    (lead) => {
      const c = window.__game.dribble.catchIn;
      return c !== null && c <= lead;
    },
    LEAD,
    { polling: "raf", timeout: 5_000 },
  );
}

async function roll(keys) {
  for (let i = 0; i < keys.length; i++) {
    if (i) await page.waitForTimeout(25);
    await page.keyboard.press(keys[i]);
  }
}

/** Crossover then between the legs, both clean: combo ×2. Leaves the ball in the air. */
async function buildCombo() {
  await game((s) => window.__game.setTimeScale(s), SLOW);
  await roll(["l", "i", "j"]);
  await waitCatch();
  await roll(["j", "k", "l"]);
  await page.waitForFunction(() => window.__game.dribble.state === "flight", null, { timeout: 2_000 });
}

async function place(x, z) {
  await page.waitForFunction(() => window.__game.dribble.state === "held", null, { timeout: 8_000 });
  const ok = await game(([px, pz]) => window.__game.placePlayer(px, pz), [x, z]);
  if (!ok) throw new Error("placePlayer refused");
  await page.waitForTimeout(400);
  await game((s) => window.__game.setTimeScale(s), SLOW);
}

/**
 * Holds Space, releases `offset` seconds from the apex (− early, + late),
 * freezes on the result for a screenshot and waits for the rebound pass.
 */
async function jumper(label, offset) {
  const before = await game(() => ({ combo: window.__game.combo, attempts: window.__game.shot.attempts }));
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__game.shot.phase === "air", null, { polling: "raf", timeout: 5_000 });
  await game((s) => window.__game.setTimeScale(s), SLOW);
  await page.waitForFunction(
    (t) => {
      const a = window.__game.shot.apexIn;
      return a !== null && a <= t;
    },
    -offset + LEAD,
    { polling: "raf", timeout: 10_000 },
  );
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.__game.shot.phase === "flight", null, { polling: "raf", timeout: 5_000 });
  const release = await game(() => window.__game.shot.lastRelease);
  // Release frame: in the air, ball off the fingertips, meter grading the timing.
  await game(() => window.__game.setTimeScale(0));
  const releaseFile = path.join(shots, `${label}-release.png`);
  await page.screenshot({ path: releaseFile });
  await game((s) => window.__game.setTimeScale(s), SLOW);
  // Mid-flight frame: the arc and the meter's grade.
  const released = await game(() => window.__game.simTime);
  await page.waitForFunction((t) => window.__game.simTime >= t, released + 0.4, { polling: "raf", timeout: 10_000 });
  await game(() => window.__game.setTimeScale(0));
  const flightFile = path.join(shots, `${label}-flight.png`);
  await page.screenshot({ path: flightFile });
  await game((s) => window.__game.setTimeScale(s), SLOW);

  // At the rim: the frame where the ball meets the iron / drops through the net.
  await page.waitForFunction(
    ([n, hoopX, rimY]) => {
      const g = window.__game;
      const [x, y, z] = g.ball.position;
      return g.shot.attempts > n || (Math.hypot(x - hoopX, z) < 0.45 && y < rimY + 0.2);
    },
    [before.attempts, hoop.x, hoop.rimHeight],
    { polling: "raf", timeout: 10_000 },
  );
  await game(() => window.__game.setTimeScale(0));
  const rimFile = path.join(shots, `${label}-rim.png`);
  await page.screenshot({ path: rimFile });
  await game((s) => window.__game.setTimeScale(s), SLOW);

  await page.waitForFunction((n) => window.__game.shot.attempts > n, before.attempts, { polling: "raf", timeout: 10_000 });
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(120); // callout burst fully in
  const resultFile = path.join(shots, `${label}-result.png`);
  await page.screenshot({ path: resultFile });
  const after = await game(() => ({
    result: window.__game.shot.lastResult,
    combo: window.__game.combo,
    hud: window.__game.hud,
    detail: document.querySelector("[data-testid=hud-callout-detail]")?.textContent ?? null,
    hudScore: document.querySelector("[data-testid=hud-score]")?.textContent ?? null,
    t: window.__game.simTime,
  }));
  await game(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.dribble.state === "held", null, { polling: "raf", timeout: 8_000 });
  const back = await game(() => window.__game.simTime);
  const entry = {
    label,
    offset,
    release,
    result: after.result,
    comboBefore: { combo: before.combo.combo, comboPoints: before.combo.comboPoints, score: before.combo.score },
    comboAfter: { combo: after.combo.combo, score: after.combo.score, lastShot: after.combo.lastShot },
    callout: after.hud.callout,
    hudScore: after.hudScore,
    reboundSeconds: +(back - after.t).toFixed(2),
    files: [releaseFile, flightFile, rimFile, resultFile],
  };
  report.shots.push(entry);
  return entry;
}

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  // Leave the title screen: game keys only work during a run.
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const { hoopX, rimHeight } = await game(() => window.__game.world);
  Object.assign(hoop, { x: hoopX, rimHeight });
  const points = await game(() => window.__game.config.combo.shot);
  const MID = [hoopX - 4.5, 0.6];
  const DEEP = [hoopX - 7.5, 1.0];

  const verifyMake = (e, three) => {
    const cp = e.comboBefore.comboPoints;
    const expected = (three ? points.three : points.two) + cp * (three ? points.cashThree : points.cashTwo);
    check(`${e.label}:made`, e.result.made === true, { kind: e.result.kind, grade: e.release.grade, error: e.release.error });
    check(`${e.label}:three-flag`, e.release.three === three, { three: e.release.three, distance: e.release.distance });
    check(`${e.label}:cash-in`, e.comboAfter.score - e.comboBefore.score === expected && cp > 0, {
      comboPoints: cp,
      delta: e.comboAfter.score - e.comboBefore.score,
      expected,
    });
    check(`${e.label}:hud-cash-in`, !!e.callout?.detail?.includes(`×${three ? points.cashThree : points.cashTwo}`), {
      callout: e.callout,
    });
    check(`${e.label}:hud-score`, e.hudScore === e.comboAfter.score.toLocaleString("en-US"), { hudScore: e.hudScore });
    check(`${e.label}:combo-reset`, e.comboAfter.combo === 0, { combo: e.comboAfter.combo });
    check(`${e.label}:rebound`, e.reboundSeconds <= 4, { reboundSeconds: e.reboundSeconds });
  };
  const verifyMiss = (e) => {
    check(`${e.label}:missed`, e.result.made === false, { kind: e.result.kind, grade: e.release.grade, error: e.release.error });
    check(`${e.label}:off-iron`, e.result.rimHits + e.result.boardHits > 0, {
      rimHits: e.result.rimHits,
      boardHits: e.result.boardHits,
    });
    check(`${e.label}:combo-reset`, e.comboAfter.combo === 0 && e.comboAfter.score === e.comboBefore.score, {
      combo: e.comboAfter.combo,
    });
    check(`${e.label}:rebound`, e.reboundSeconds <= 4, { reboundSeconds: e.reboundSeconds });
  };

  // Mid-range: combo → perfect jumper; then early and late bricks.
  await place(...MID);
  await buildCombo();
  verifyMake(await jumper("mid-make", 0), false);
  await place(...MID);
  await roll(["l", "i", "j"]); // one move, so the miss has a combo to lose
  await page.waitForFunction(() => window.__game.dribble.state === "flight", null, { timeout: 4_000 });
  verifyMiss(await jumper("mid-early", -0.2));
  await place(...MID);
  verifyMiss(await jumper("mid-late", 0.2));

  // Beyond the arc.
  await place(...DEEP);
  await buildCombo();
  verifyMake(await jumper("three-make", 0), true);
  await place(...DEEP);
  verifyMiss(await jumper("three-early", -0.2));
  await place(...DEEP);
  verifyMiss(await jumper("three-late", 0.2));

  check("no-console-errors", consoleErrors.length === 0, { count: consoleErrors.length });
  report.ok = failures.length === 0;
} catch (err) {
  report.error = String(err?.stack ?? err);
  await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => {});
} finally {
  report.failures = failures;
  await writeFile(path.join(out, "jumper-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, failures, error: report.error }, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
}
