#!/usr/bin/env node
// Drives the fadeaway (Space + moving away from the hoop) with real key presses from mid-range: checks the
// lean, the drift away from the rim, the tighter window vs Space, a perfect
// make, a late miss and the score. Screenshots go to <out>/fadeaway/.
//
//   node scripts/verify/fadeaway.mjs [--url http://localhost:3000] [--out artifacts]
//
// Needs a dev server (window.__game is dev-only) and Chromium.

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
const shots = path.join(out, "fadeaway");
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && !m.text().includes("503") && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const report = { url, ok: false, checks: {}, shots: [], consoleErrors };
const failures = [];
const check = (name, pass, detail) => {
  report.checks[name] = { pass, ...detail };
  if (!pass) failures.push(name);
};
const game = (fn, a) => page.evaluate(fn, a);
const SLOW = 0.25;
const LEAD = 0.03 * SLOW;
const raf = { polling: "raf", timeout: 10_000 };

/** Hold `key`, snapshot mid-rise, release `offset` s from the apex (− early, + late), settle. */
async function jump(label, fade, offset, hoopX) {
  const key = "Space";
  await page.waitForFunction(() => window.__game.dribble.state === "held", null, { timeout: 10_000 });
  await game(([x, z]) => window.__game.placePlayer(x, z), [hoopX - 4.5, 0.6]);
  await page.waitForTimeout(400);
  const start = await game(() => ({ dist: window.__game.shot.distance, score: window.__game.combo.score, attempts: window.__game.shot.attempts }));
  // Fadeaway = Space while the WASD input points away from the hoop (camera-relative).
  const awayKeys = fade ? await game(() => {
    const g = window.__game;
    let fx = g.camera.target[0] - g.camera.position[0];
    let fz = g.camera.target[2] - g.camera.position[2];
    const l = Math.hypot(fx, fz);
    fx /= l;
    fz /= l;
    const ax = g.player.position[0] - g.world.hoopX; // away from the hoop (hoop is on z = 0)
    const az = g.player.position[2];
    const m = Math.hypot(ax, az);
    const f = (ax * fx + az * fz) / m;
    const r = (-ax * fz + az * fx) / m;
    return [f > 0.38 && "KeyW", f < -0.38 && "KeyS", r > 0.38 && "KeyD", r < -0.38 && "KeyA"].filter(Boolean);
  }) : [];
  for (const k of awayKeys) await page.keyboard.down(k);
  await page.keyboard.down(key);
  await page.waitForFunction(() => window.__game.shot.phase === "air", null, raf);
  await game((s) => window.__game.setTimeScale(s), SLOW);
  // Just before the apex: the lean pose.
  await page.waitForFunction((t) => {
    const a = window.__game.shot.apexIn;
    return a !== null && a <= t;
  }, offset < 0 ? -offset + LEAD + 0.02 : 0.05, raf);
  const mid = await game(() => ({ ...window.__game.shot }));
  await game(() => window.__game.setTimeScale(0));
  const leanFile = path.join(shots, `${label}-lean.png`);
  await page.screenshot({ path: leanFile });
  await game((s) => window.__game.setTimeScale(s), SLOW);
  await page.waitForFunction((t) => {
    const a = window.__game.shot.apexIn;
    return a !== null && a <= t;
  }, -offset + LEAD, raf);
  await page.keyboard.up(key);
  for (const k of awayKeys) await page.keyboard.up(k);
  await page.waitForFunction(() => window.__game.shot.phase === "flight", null, raf);
  const release = await game(() => window.__game.shot.lastRelease);
  await page.waitForFunction((n) => window.__game.shot.attempts > n, start.attempts, raf);
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(120);
  const resultFile = path.join(shots, `${label}-result.png`);
  await page.screenshot({ path: resultFile });
  const after = await game(() => ({ result: window.__game.shot.lastResult, score: window.__game.combo.score }));
  await game(() => window.__game.setTimeScale(1));
  const entry = { label, key, offset, start, mid, release, result: after.result, scoreDelta: after.score - start.score, files: [leanFile, resultFile] };
  report.shots.push(entry);
  return entry;
}

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const { hoopX } = await game(() => window.__game.world);
  await game(() => window.__game.setView("C")); // side-on: the lean reads best here

  const space = await jump("space", false, 0, hoopX);
  check("space:not-fade", space.release.fade === false && space.mid.fade === false && space.mid.lean === 0, { mid: space.mid.lean });
  check("space:no-drift", Math.abs(space.mid.distance - space.start.dist) < 0.05, { start: space.start.dist, mid: space.mid.distance });

  const fade = await jump("fade-perfect", true, 0, hoopX);
  check("fade:flag", fade.release.fade === true && fade.mid.fade === true, {});
  check("fade:leans", fade.mid.lean > 0.5, { lean: fade.mid.lean });
  check("fade:drifts-away", fade.mid.distance - fade.start.dist > 0.2, { start: fade.start.dist, mid: fade.mid.distance });
  check("fade:tighter-window", fade.release.tolerance < space.release.tolerance, { fade: fade.release.tolerance, space: space.release.tolerance });
  check("fade:perfect-made", fade.release.grade === "perfect" && fade.result.made === true, { grade: fade.release.grade, kind: fade.result.kind });
  check("fade:scored", fade.scoreDelta > 0, { delta: fade.scoreDelta });

  const late = await jump("fade-late", true, 0.2, hoopX);
  // Real physics: a bad release usually bricks but can still bank in, so the check is "not clean".
  check("fade:late-not-clean", late.release.grade === "late" && late.result.kind !== "swish", { grade: late.release.grade, made: late.result.made, kind: late.result.kind, rimHits: late.result.rimHits });
  const early = await jump("fade-early", true, -0.2, hoopX);
  check("fade:early-graded", early.release.grade === "early", { grade: early.release.grade, made: early.result.made, kind: early.result.kind });

  report.ok = failures.length === 0 && consoleErrors.length === 0;
} catch (err) {
  report.error = String(err);
  await page.screenshot({ path: path.join(out, "fadeaway-failure.png") }).catch(() => {});
} finally {
  await writeFile(path.join(out, "fadeaway-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ ok: report.ok, failures, error: report.error, consoleErrors }, null, 2));
process.exit(report.ok ? 0 : 1);
