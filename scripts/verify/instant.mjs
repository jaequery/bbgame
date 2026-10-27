#!/usr/bin/env node
// Instant-feedback check: a dribble key pressed while the ball is in the air must
// change the controller (state / lastMove / move count), the HUD chain and the
// callout right away — no buffering, no decision waits. Screenshots go to <out>.
//
//   node scripts/verify/instant.mjs [--url http://localhost:3000] [--out artifacts] [--tag before|after]
//
// Needs a dev server (window.__game is dev-only) and Chromium.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = arg("url", "http://localhost:3000");
const out = arg("out", "artifacts");
const tag = arg("tag", "after");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const report = { tag, ok: false, presses: [], errors };
try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  const snap = () =>
    page.evaluate(() => {
      const d = window.__game.dribble;
      return { state: d.state, hand: d.hand, moves: d.moves, kind: d.lastMove?.kind ?? null, chain: window.__game.combo.chain.length };
    });

  // Slow the clock so a press lands mid-flight, then look at the very next frames.
  await page.evaluate(() => window.__game.setTimeScale(0.25));
  for (const [i, key] of ["i", "l", "j", "k", "l", ","].entries()) {
    await page.waitForFunction(() => window.__game.dribble.state === "flight", null, { polling: 5, timeout: 10_000 });
    await page.waitForTimeout(40);
    const before = await snap();
    const t0 = Date.now();
    await page.keyboard.press(key);
    // Poll once per frame until anything changes.
    let after = before;
    let frames = 0;
    for (; frames < 40; frames++) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      after = await snap();
      if (after.moves !== before.moves) break;
    }
    report.presses.push({ key, before, after, framesToReact: frames + 1, ms: Date.now() - t0 });
    if (i === 0) await page.screenshot({ path: path.join(out, `instant-${tag}.png`) });
    await page.waitForTimeout(150);
  }
  // Rapid alternating J/L at full speed: every press must register as a move.
  await page.evaluate(() => window.__game.setTimeScale(1));
  await page.waitForTimeout(300);
  const m0 = (await snap()).moves;
  const keys = ["j", "l", "j", "l", "j", "l"];
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(110);
  }
  const m1 = (await snap()).moves;
  report.rapid = { pressed: keys.length, movesAdded: m1 - m0 };
  report.ok = errors.length === 0;
} finally {
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
}
