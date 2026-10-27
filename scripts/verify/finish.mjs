#!/usr/bin/env node
// (View C looks across the court from the sideline, so D runs at the +X hoop.)
// Drives the running finishes with real key presses: sprinting at the hoop and pressing Space
// within layup range is a layup, within dunk range a dunk; standing still it is still the
// pump fake (tap) / jumper (hold). Screenshots go to <out>/finish/.
//
//   node scripts/verify/finish.mjs [--url http://localhost:3000] [--out artifacts] [--tag name]
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
const tag = arg("tag", "");
const shots = path.join(out, "finish");
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
const raf = { polling: "raf", timeout: 15_000 };
const snap = () => game(() => ({ shot: window.__game.shot, combo: window.__game.combo, player: window.__game.player, ball: window.__game.ball }));
const shoot = async (name) => {
  const file = path.join(shots, `${tag}${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(file);
};
const freezeWhen = async (fn, arg, name) => {
  await game(() => window.__game.setTimeScale(0.2));
  await page.waitForFunction(fn, arg, raf);
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(150);
  await shoot(name);
  await game(() => window.__game.setTimeScale(0.3));
};
const settle = async () => {
  await game(() => window.__game.setTimeScale(1));
  await page.waitForFunction(() => window.__game.shot.phase === "none" && window.__game.dribble.state !== "shot", null, { timeout: 15_000 });
  await page.waitForTimeout(300);
};

/** Sprint at the hoop from `from` metres out and press Space at `at` metres. */
const run = async (from, at, name, apex) => {
  await game(([x]) => window.__game.placePlayer(x, 0.05), [await game(() => window.__game.world.hoopX).then((h) => h - from)]);
  await game(() => window.__game.setTimeScale(0.3));
  await page.keyboard.down("Shift");
  await page.keyboard.down("KeyD");
  await page.waitForFunction((d) => window.__game.shot.distance <= d, at, raf);
  const pre = await snap();
  await page.keyboard.down("Space");
  if (apex) {
    await page.waitForFunction(() => window.__game.shot.jumpHeight > 0.1, null, raf);
    await page.keyboard.up("KeyD");
    await page.keyboard.up("Shift");
    await freezeWhen((h) => window.__game.shot.jumpHeight > h, apex, `${name}-air`);
  } else {
    await page.keyboard.up("KeyD");
    await page.keyboard.up("Shift");
  }
  await page.keyboard.up("Space");
  await page.waitForFunction(() => window.__game.shot.lastResult !== null && window.__game.shot.phase !== "flight", null, raf).catch(() => {});
  await game(() => window.__game.setTimeScale(0.3));
  await page.waitForFunction((n) => window.__game.shot.attempts > n, pre.shot.attempts, raf);
  const post = await snap();
  await settle();
  return { pre, post };
};

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await game(() => window.__game.setView("C"));
  await page.waitForFunction(() => !window.__game.camera.gliding, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__game.dribble.state === "held", null, { timeout: 10_000 });

  // 1. Layup: sprint in from 6.5 m, Space at ~3 m.
  const layup = await run(6.5, 3, "1-layup", 0.62);
  const l = layup.post.shot;
  check("layup:kind", l.lastResult?.kind2 === undefined && l.lastRelease?.finish === "layup", { finish: l.lastRelease?.finish, pre: layup.pre.shot.distance, speed: layup.pre.player.speed });
  check("layup:resolved", l.attempts === layup.pre.shot.attempts + 1, { made: l.lastResult?.made, kind: l.lastResult?.kind, rim: l.lastResult?.rimHits, board: l.lastResult?.boardHits });
  check("layup:scored-in-combo", l.lastResult?.made ? layup.post.combo.lastShot?.points >= 200 : layup.post.combo.lastShot?.points === 0, { lastShot: layup.post.combo.lastShot });

  // 2. Dunk: sprint in from 5 m, Space at ~1.7 m.
  const dunk = await run(5, 1.7, "2-dunk", 0.9);
  const d = dunk.post.shot;
  check("dunk:kind", d.lastRelease?.finish === "dunk", { finish: d.lastRelease?.finish, pre: dunk.pre.shot.distance, speed: dunk.pre.player.speed });
  check("dunk:made", d.lastResult?.made === true, { made: d.lastResult?.made, kind: d.lastResult?.kind });
  check("dunk:scored-in-combo", dunk.post.combo.lastShot?.points >= 200, { lastShot: dunk.post.combo.lastShot });

  // 3. Standing: tap = pump fake, hold = jumper — same spots, no run-up.
  for (const at of [3, 1.7]) {
    await game(([x]) => window.__game.placePlayer(x, 0.05), [(await game(() => window.__game.world.hoopX)) - at]);
    await page.waitForTimeout(300);
    const before = await snap();
    await page.keyboard.down("Space");
    await page.waitForTimeout(60);
    await page.keyboard.up("Space");
    await page.waitForFunction(() => window.__game.shot.phase === "hold", null, raf);
    const hold = await snap();
    check(`standing-${at}:tap-is-pump`, hold.shot.attempts === before.shot.attempts && hold.shot.jumpHeight === 0, { phase: hold.shot.phase });
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.__game.shot.phase === "air", null, raf);
    await page.waitForTimeout(250);
    await page.keyboard.up("Space");
    await page.waitForFunction((n) => window.__game.shot.attempts > n, before.shot.attempts, raf);
    const jumper = await snap();
    check(`standing-${at}:hold-is-jumper`, !jumper.shot.lastRelease?.finish, { finish: jumper.shot.lastRelease?.finish });
    await settle();
  }

  report.ok = failures.length === 0 && consoleErrors.length === 0;
} catch (err) {
  report.error = String(err.stack ?? err).split("\n").slice(0, 4).join(" | ");
  await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
}

report.failures = failures;
await writeFile(path.join(shots, `${tag}report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
