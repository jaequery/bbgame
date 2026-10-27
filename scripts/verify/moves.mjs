#!/usr/bin/env node
// Drives the dribble controls with real key presses and reports the game state:
// no auto-dribble, palm + 1.5 s release, hold-cross slide, U/O spins.
//
//   node scripts/verify/moves.mjs [--url http://localhost:3000] [--out artifacts] [--prefix after]

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
const prefix = arg("prefix", "moves");
await mkdir(out, { recursive: true });

// Software WebGL is slow: run the logic checks in a small viewport (the sim keeps real time), screenshot big.
const SMALL = { width: 400, height: 225 };
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: SMALL });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const snap = () =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      t: +g.simTime.toFixed(2),
      ball: { state: g.ball.state, y: g.ball.position[1], pos: g.ball.position },
      dribble: { state: g.dribble.state, hand: g.dribble.hand, palm: g.dribble.palm, lastMove: g.dribble.lastMove?.kind ?? null, moves: g.dribble.moves },
      player: g.player.position,
      yaw: g.player.yaw,
      renderYaw: g.player.renderYaw,
      hud: { chain: g.hud.chain, callout: g.hud.callout?.text ?? null, score: g.hud.score },
    };
  });
const shot = async (name) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${prefix}-${name}.png`) });
  await page.setViewportSize(SMALL);
};
const report = { steps: {}, errors };

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  // 1. Hands off the keys: does the ball bounce by itself?
  const idle = [];
  for (let i = 0; i < 10; i++) {
    idle.push(await snap());
    await page.waitForTimeout(250);
  }
  const ys = idle.map((s) => s.ball.y);
  report.steps.idle = {
    ballYRange: [Math.min(...ys), Math.max(...ys)],
    movesDuring: idle[idle.length - 1].dribble.moves - idle[0].dribble.moves,
    states: [...new Set(idle.map((s) => s.dribble.state))],
  };
  await shot("idle");

  // 2. Hold L (right hand): palm, then the ball is let go at 1.5 s and bounces back.
  await page.keyboard.down("l");
  const palm = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2400) {
    const s = await snap();
    palm.push({ at: +((Date.now() - t0) / 1000).toFixed(2), ball: s.dribble.state, y: s.ball.y, palm: s.dribble.palm, lastMove: s.dribble.lastMove });
    await page.waitForTimeout(100);
  }
  await page.keyboard.up("l");
  const left = palm.find((p) => p.ball !== "held");
  report.steps.palm = {
    heldAtHalfSecond: palm.filter((p) => p.at < 1.3).every((p) => p.ball === "held" && p.palm),
    ballLeftHandAt: left?.at ?? null,
    samples: palm,
  };
  await page.waitForTimeout(1200);
  report.steps.afterDrop = await snap();
  await page.keyboard.down("l");
  await page.waitForTimeout(600);
  await shot("palm");
  await page.keyboard.up("l");
  await page.waitForTimeout(1200);

  // 3. Hold L then tap J early release resumes a dribble.
  await page.keyboard.down("l");
  await page.waitForTimeout(300);
  await page.keyboard.up("l");
  await page.waitForTimeout(60);
  report.steps.earlyRelease = await snap();
  await page.waitForTimeout(1200);

  // 4. Hold-cross: palm with L, then press J.
  await page.keyboard.down("l");
  await page.waitForTimeout(400);
  const before = await snap();
  await page.keyboard.down("j");
  const crossSamples = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(80);
    crossSamples.push(await snap());
  }
  await shot("holdcross");
  await page.keyboard.up("j");
  await page.keyboard.up("l");
  await page.waitForTimeout(800);
  const after = await snap();
  report.steps.holdCross = {
    before,
    move: crossSamples.map((s) => s.dribble.lastMove),
    slideMetres: +Math.hypot(after.player[0] - before.player[0], after.player[2] - before.player[2]).toFixed(3),
    after,
  };
  await page.waitForTimeout(800);

  // 5. Spins.
  for (const [key, name] of [["u", "spinL"], ["o", "spinR"]]) {
    await page.keyboard.press(key);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(90);
      samples.push(await snap());
      if (i === 3) await shot(name);
    }
    report.steps[name] = {
      moves: samples.map((s) => s.dribble.lastMove),
      renderYaw: samples.map((s) => s.renderYaw),
      callout: samples.at(-1).hud.callout,
      last: samples.at(-1),
    };
    await page.waitForTimeout(900);
  }
  report.ok = true;
} catch (err) {
  report.error = String(err);
  await page.screenshot({ path: path.join(out, `${prefix}-failure.png`) }).catch(() => {});
} finally {
  await browser.close();
}
await writeFile(path.join(out, `${prefix}-report.json`), JSON.stringify(report, null, 2));
const S = report.steps;
console.log(JSON.stringify({ idle: S.idle, palm: S.palm && { ...S.palm, samples: undefined }, earlyRelease: S.earlyRelease?.dribble, holdCross: S.holdCross && { moves: S.holdCross.move, slideMetres: S.holdCross.slideMetres }, spinL: S.spinL && { renderYaw: S.spinL.renderYaw, callout: S.spinL.callout }, spinR: S.spinR && { renderYaw: S.spinR.renderYaw, callout: S.spinR.callout }, error: report.error }, null, 1));
if (!report.ok) process.exit(1);
