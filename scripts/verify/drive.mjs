#!/usr/bin/env node
// Drives the running game with Playwright: waits for the first rendered frame,
// screenshots each camera view and checks the V glide. Prints a JSON report.
//
//   node scripts/verify/drive.mjs [--url http://localhost:3000] [--out artifacts]
//
// Requires a dev server (window.__game is dev-only) and Chromium:
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
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  // SwiftShader keeps WebGL working on headless machines without a GPU.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const report = { url, ok: false, views: [], glide: [], consoleErrors };
try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  report.world = await page.evaluate(() => window.__game.world);

  const state = () => page.evaluate(() => window.__game.camera);
  const shoot = async (view) => {
    const file = path.join(out, `view-${view}.png`);
    await page.screenshot({ path: file });
    report.views.push({ view, file, camera: await state() });
  };

  const initial = await state();
  report.initialView = initial.view;
  await shoot(initial.view);

  for (let i = 0; i < 3; i++) {
    const before = await state();
    await page.keyboard.press("v");
    // Sample the glide: positions between the two poses prove it is not a cut.
    const samples = [];
    for (let s = 0; s < 6; s++) {
      await page.waitForTimeout(110);
      samples.push(await state());
    }
    await page.waitForFunction(() => !window.__game.camera.gliding, null, { timeout: 5_000 });
    await page.waitForTimeout(400);
    const after = await state();
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const total = dist(before.position, after.position);
    const intermediate = samples.filter(
      (s) => s.gliding && dist(s.position, before.position) > 0.05 && dist(s.position, after.position) > 0.05,
    ).length;
    report.glide.push({ from: before.view, to: after.view, distance: +total.toFixed(2), intermediateFrames: intermediate });
    if (i < 2) await shoot(after.view);
  }

  const order = report.glide.map((g) => g.to).join("");
  report.ok =
    report.initialView === "B" && order === "ACB" && report.glide.every((g) => g.intermediateFrames >= 2);
} catch (err) {
  report.error = String(err);
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
}

await writeFile(path.join(out, "drive-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
