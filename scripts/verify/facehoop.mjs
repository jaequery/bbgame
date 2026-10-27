#!/usr/bin/env node
// Moves in each WASD direction, then plays a crossover (I), between the legs (K), behind the back (,),
// a plain J pound and a U spin, and reports whether the player ends up facing the +X hoop.
//
//   node scripts/verify/facehoop.mjs [--url http://localhost:3000] [--out artifacts] [--prefix after]

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
const prefix = arg("prefix", "facehoop");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const state = () =>
  page.evaluate(() => {
    const g = window.__game;
    const [x, , z] = g.player.position;
    return { yaw: g.player.yaw, hoopYaw: Math.atan2(g.world.hoopX - x, -z), pos: g.player.position, hand: g.dribble.hand, move: g.dribble.lastMove?.kind ?? null };
  });

const report = { cases: [], errors };
try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.startRun("practice"));
  await page.waitForTimeout(500);
  for (const key of ["i", "k", ",", "j", "u"]) {
    for (const dir of ["w", "a", "s", "d"]) {
      await page.evaluate(() => window.__game.placePlayer(0, 0));
      await page.waitForTimeout(250);
      await page.keyboard.down(dir);
      await page.waitForTimeout(700); // get up to speed, heading along the movement direction
      const before = await state();
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      const during = await state();
      await page.keyboard.up(dir);
      const err = Math.abs(wrap(during.yaw - during.hoopYaw));
      report.cases.push({
        key, dir, yawBefore: +before.yaw.toFixed(2), yawDuring: +during.yaw.toFixed(2), hoopYaw: +during.hoopYaw.toFixed(2),
        errFromHoop: +err.toFixed(2), move: during.move, facingHoop: err < 0.1,
      });
      if (key === "i" && dir === "w") await page.screenshot({ path: path.join(out, `${prefix}-crossover-moving.png`) });
      await page.waitForTimeout(1200);
    }
  }
} catch (e) {
  report.error = String(e);
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}
await browser.close();
await writeFile(path.join(out, `${prefix}.json`), JSON.stringify(report, null, 1));
for (const c of report.cases) console.log(c.key.padEnd(2), c.dir, c.move?.padEnd(9), "yaw", c.yawDuring, "hoop", c.hoopYaw, c.facingHoop ? "FACING" : "-");
console.log(report.error ?? "", errors);
