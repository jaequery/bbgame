#!/usr/bin/env node
// Drives the pump fake + triple-threat hold with real key presses: a Space tap pumps
// (feet stay down) into the hold; K jabs, J / L reach the ball out, I resumes dribbling,
// and a held Space still shoots the jumper (also from the hold). Screenshots go to
// <out>/pump/.
//
//   node scripts/verify/pump.mjs [--url http://localhost:3000] [--out artifacts]
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
const shots = path.join(out, "pump");
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
const raf = { polling: "raf", timeout: 10_000 };
const snap = () => game(() => ({ shot: window.__game.shot, score: window.__game.combo.score, lastMove: window.__game.combo.lastMove, dribble: window.__game.dribble.state }));
const phase = (p) => page.waitForFunction((x) => window.__game.shot.phase === x, p, raf);
const shoot = async (name) => {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(file);
};
/** Slow-mo so a pose can be caught, then freeze for the screenshot. */
const freezeWhen = async (fn, arg, name) => {
  await game(() => window.__game.setTimeScale(0.25));
  await page.waitForFunction(fn, arg, raf);
  await game(() => window.__game.setTimeScale(0));
  await page.waitForTimeout(150);
  await shoot(name);
  await game(() => window.__game.setTimeScale(1));
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

  // 1. Tap Space → pump fake → hold, feet on the floor.
  const start = await snap();
  await page.keyboard.down("Space");
  await page.waitForTimeout(50);
  await page.keyboard.up("Space");
  await freezeWhen(() => window.__game.shot.phase === "pump" && window.__game.ball.position[1] > 1.3, null, "1-pump-top");
  await phase("hold");
  let maxJump = 0;
  for (let i = 0; i < 5; i++) {
    maxJump = Math.max(maxJump, (await snap()).shot.jumpHeight);
    await page.waitForTimeout(60);
  }
  const hold = await snap();
  await shoot("2-hold");
  check("pump:tap-is-pump", hold.shot.phase === "hold" && hold.shot.inHold && hold.shot.attempts === 0, { phase: hold.shot.phase, attempts: hold.shot.attempts });
  check("pump:feet-on-floor", maxJump === 0 && hold.shot.jumpHeight === 0, { maxJump });
  check("pump:scored", hold.lastMove?.kind === "pump" && hold.score > start.score, { lastMove: hold.lastMove, delta: hold.score - start.score });
  check("pump:held-ball", hold.dribble === "shot", { dribble: hold.dribble });

  // 2. K: jab step toward the rim and back; the player stays put overall.
  const p0 = await game(() => window.__game.player.position);
  await page.keyboard.press("k");
  await freezeWhen(() => window.__game.shot.phase === "jab" && window.__game.shot.jab > 0.9, null, "3-jab");
  const jabMid = await game(() => window.__game.player.position);
  await phase("hold");
  const jabEnd = await snap();
  const p1 = await game(() => window.__game.player.position);
  check("jab:steps-toward-rim", jabMid[0] - p0[0] > 0.2, { from: p0[0], mid: jabMid[0] });
  check("jab:returns", Math.abs(p1[0] - p0[0]) < 0.02 && jabEnd.shot.phase === "hold" && jabEnd.dribble === "shot", { from: p0[0], to: p1[0] });
  check("jab:scored", jabEnd.lastMove?.kind === "jab", { lastMove: jabEnd.lastMove });

  // 3. J / L: the ball reaches out to that side and comes back (J = player's left, +local X).
  const side = async (key, kind, name, sign) => {
    await page.keyboard.press(key);
    await freezeWhen(() => window.__game.shot.phase === "ext" && window.__game.hands.L[1] > 0 && Math.abs(window.__game.ball.position[2] - window.__game.player.position[2]) > 0.55, null, name);
    const mid = await game(() => ({ ball: window.__game.ball.position, player: window.__game.player.position, yaw: window.__game.player.yaw }));
    await phase("hold");
    const s = await snap();
    // Local X of the ball relative to the player (+ = left).
    const dx = mid.ball[0] - mid.player[0];
    const dz = mid.ball[2] - mid.player[2];
    const local = dx * Math.cos(mid.yaw) - dz * Math.sin(mid.yaw);
    check(`ext${kind}:reaches-${kind === "L" ? "left" : "right"}`, local * sign > 0.5, { local });
    check(`ext${kind}:returns-and-scored`, s.shot.phase === "hold" && s.lastMove?.kind === `ext${kind}`, { phase: s.shot.phase, lastMove: s.lastMove });
  };
  // Behind the player both sides of the reach read.
  await game(() => window.__game.setView("B"));
  await page.waitForFunction(() => !window.__game.camera.gliding, null, { timeout: 10_000 });
  await side("j", "L", "4-reach-left", 1);
  await side("l", "R", "5-reach-right", -1);

  // 4. Holding Space from the hold is still the jumper.
  const before = (await snap()).shot.attempts;
  await game(() => window.__game.setTimeScale(0.25));
  await page.keyboard.down("Space");
  await phase("air");
  await page.waitForFunction(() => window.__game.shot.apexIn !== null && window.__game.shot.apexIn < 0.03, null, raf);
  await page.keyboard.up("Space");
  await phase("flight");
  await game(() => window.__game.setTimeScale(1));
  await page.waitForFunction((n) => window.__game.shot.attempts > n, before, raf);
  const afterShot = await snap();
  check("jumper:from-hold", afterShot.shot.attempts === before + 1 && afterShot.shot.lastRelease !== null, { attempts: afterShot.shot.attempts });

  // 5. A fresh pump, then I resumes dribbling.
  await page.waitForFunction(() => window.__game.dribble.state === "held", null, { timeout: 15_000 });
  await game(() => window.__game.placePlayer(4.2, 0.6));
  await page.waitForTimeout(300);
  await page.keyboard.down("Space");
  await page.waitForTimeout(50);
  await page.keyboard.up("Space");
  await phase("hold");
  await page.keyboard.press("i");
  await page.waitForTimeout(500);
  const exit = await snap();
  check("exit:dribbles", !exit.shot.inHold && exit.dribble !== "shot" && exit.dribble !== "loose", { phase: exit.shot.phase, dribble: exit.dribble });
  await shoot("7-after-exit");

  // 6. The plain jumper (hold Space) is not a pump.
  await page.waitForFunction(() => window.__game.dribble.state === "held" || window.__game.dribble.state === "flight", null, raf);
  const n = (await snap()).shot.attempts;
  await page.keyboard.down("Space");
  await phase("air");
  await page.waitForTimeout(200);
  await page.keyboard.up("Space");
  await page.waitForFunction((x) => window.__game.shot.attempts > x, n, raf);
  check("jumper:hold-is-shot", true, {});

  report.ok = failures.length === 0 && consoleErrors.length === 0;
} catch (err) {
  report.error = String(err.stack).split("\n").slice(0, 4).join(" | ");
  report.state = await snap().catch(() => null);
  await page.screenshot({ path: path.join(out, "pump-failure.png") }).catch(() => {});
} finally {
  await writeFile(path.join(out, "pump-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ ok: report.ok, failures, error: report.error, consoleErrors }, null, 2));
process.exit(report.ok ? 0 : 1);
