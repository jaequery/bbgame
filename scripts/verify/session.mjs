#!/usr/bin/env node
// Drives Sessions + the leaderboard end to end: Free Practice (must never POST),
// a full 60-second Session played to the buzzer, initials entry, submit, and the
// run on the leaderboard after a page reload. Prints a JSON report.
//
//   node scripts/verify/session.mjs [--url http://localhost:3000] [--out artifacts] [--initials KZE] [--fast]
//
// --fast jumps the clock to 3 s left after a few moves instead of playing all 60 s.
// Needs a dev server (window.__game is dev-only) with a reachable database.

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
const initials = arg("initials", "KZE");
const fast = args.includes("--fast");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const posts = [];
page.on("request", (r) => {
  if (r.method() === "POST" && new URL(r.url()).pathname === "/api/runs") posts.push({ at: Date.now(), body: r.postData() });
});

const report = { url, ok: false, checks: [], shots: [], consoleErrors };
const failures = [];
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) failures.push(name);
};
const game = (fn, a) => page.evaluate(fn, a);
const shot = async (name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(file);
};
const board = () => game(() => fetch("/api/runs", { cache: "no-store" }).then((r) => r.json()));
const screen = () => game(() => window.__game.session.screen);

async function ready() {
  await page.waitForFunction(() => (window.__game?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/** Walks (camera-relative WASD) toward the loose ball for a moment. */
async function recover() {
  const s = await game(() => ({ ball: window.__game.ball.position, player: window.__game.player.position, cam: window.__game.camera }));
  const dx = s.ball[0] - s.player[0];
  const dz = s.ball[2] - s.player[2];
  let fx = s.cam.target[0] - s.cam.position[0];
  let fz = s.cam.target[2] - s.cam.position[2];
  const fl = Math.hypot(fx, fz);
  fx /= fl;
  fz /= fl;
  const f = dx * fx + dz * fz;
  const r = -dx * fz + dz * fx;
  const m = Math.hypot(f, r) || 1;
  const keys = [f / m > 0.38 && "w", f / m < -0.38 && "s", r / m > 0.38 && "d", r / m < -0.38 && "a"].filter(Boolean);
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(80);
  for (const k of keys) await page.keyboard.up(k);
}

/** Dribbles crossovers / between-legs / behind-the-backs on the catch until `until()` is true. */
async function play(until) {
  const handKey = (h) => (h === "R" ? "l" : "j");
  const other = (h) => (h === "R" ? "j" : "l");
  const paths = ["i", "k", ","];
  let n = 0;
  while (!(await until())) {
    const d = await game(() => window.__game.dribble);
    if (d.state === "loose") {
      await recover();
      continue;
    }
    if (d.state === "held") {
      await page.keyboard.press(handKey(d.hand));
      await page.waitForTimeout(120);
      continue;
    }
    try {
      await page.waitForFunction(
        () => {
          const c = window.__game.dribble.catchIn;
          return window.__game.session.screen !== "play" || (c !== null && c <= 0.03);
        },
        null,
        { polling: "raf", timeout: 3_000 },
      );
    } catch {
      continue;
    }
    if ((await screen()) !== "play") break;
    const keys = [handKey(d.hand), paths[n++ % paths.length], other(d.hand)];
    for (let i = 0; i < keys.length; i++) {
      if (i) await page.waitForTimeout(25);
      await page.keyboard.press(keys[i]);
    }
    await page.waitForTimeout(150);
  }
}

try {
  await page.goto(url, { waitUntil: "load" });
  await ready();
  check("title screen on load", (await screen()) === "title");
  await shot("session-1-title");
  const before = await board();
  check("GET /api/runs ok", before.ok === true, before);
  const bestText = await page.textContent("[data-testid=hud-best]");
  const top = before.runs?.[0]?.score ?? 0;
  check("HUD BEST shows the top score", bestText?.replace(/\D/g, "") === String(top), { bestText, top });

  // Free Practice: no clock, no results, nothing saved.
  await page.click("[data-testid=start-practice]");
  await page.waitForFunction(() => window.__game.session.screen === "play");
  const practice = await game(() => window.__game.session);
  check("practice has no clock", practice.mode === "practice" && practice.timeLeft === null, practice);
  await play(async () => (await game(() => window.__game.session.moves)) >= 3);
  await shot("session-2-practice");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__game.session.screen === "title");
  const afterPractice = await board();
  check("practice never POSTs", posts.length === 0, [...posts]);
  check("practice leaves the board unchanged", JSON.stringify(afterPractice.runs) === JSON.stringify(before.runs));

  // Session to the buzzer.
  const t0 = Date.now();
  await page.click("[data-testid=start-session]");
  await page.waitForFunction(() => window.__game.session.screen === "play");
  const s0 = await game(() => window.__game.session);
  check("session starts at 60 s, score 0", s0.mode === "session" && s0.timeLeft > 59 && (await game(() => window.__game.combo.score)) === 0, s0);
  let midShot = false;
  await play(async () => {
    const s = await game(() => window.__game.session);
    if (!midShot && s.timeLeft !== null && s.timeLeft < 45 && s.moves > 2) {
      midShot = true;
      await shot("session-3-clock");
    }
    if (fast && s.moves >= 6 && s.timeLeft > 3) await game(() => window.__game.setClock(3));
    return s.screen !== "play";
  });
  await page.waitForFunction(() => window.__game.session.screen === "results", null, { timeout: 75_000 });
  const elapsed = (Date.now() - t0) / 1000;
  const result = await game(() => window.__game.session.result);
  const shownScore = Number((await page.textContent("[data-testid=result-score]"))?.replace(/\D/g, ""));
  check("buzzer ends the session at 0", (await game(() => window.__game.hud.timeLeft)) === 0, { elapsed });
  if (!fast) check("session lasted ~60 s", elapsed >= 59 && elapsed < 75, { elapsed });
  check("results show the final score", result && shownScore === result.score && result.score > 0, { result, shownScore });
  check("results show best combo + moves", result.bestCombo >= 1 && result.moves >= 1, result);

  // Initials: type the first letter, spin the second with arrows, type the third.
  await page.keyboard.press(initials[0]);
  const spins = (initials.charCodeAt(1) - 65 + 26) % 26;
  for (let i = 0; i < spins; i++) await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(initials[2]);
  const typed = (await page.textContent("[data-testid=initials]"))?.replace(/[▲▼\s]/g, "");
  check("initials entry", typed === initials, { typed });
  await shot("session-4-results");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__game.session.screen === "leaderboard", null, { timeout: 10_000 });
  check("exactly one POST for the session", posts.length === 1, [...posts]);
  await page.waitForTimeout(400);
  await shot("session-5-leaderboard");

  // Reload: the run is on the server, not just in memory.
  await page.reload({ waitUntil: "load" });
  await ready();
  const afterReload = await board();
  const mine = afterReload.runs.find((r) => r.initials === initials && r.score === result.score);
  report.run = mine ?? null;
  await page.click("[data-testid=open-leaderboard]");
  await page.waitForSelector("[data-testid=leaderboard]");
  const rowText = mine ? await page.textContent(`[data-run-id="${mine.id}"]`) : null;
  check("run on the leaderboard after reload", !!mine && !!rowText?.includes(initials), { mine, rowText });
  await page.waitForTimeout(300);
  await shot("session-6-leaderboard-reload");
  const best = await page.textContent("[data-testid=hud-best]");
  check("HUD BEST = top score after reload", best?.replace(/\D/g, "") === String(afterReload.runs[0].score), { best });

  report.ok = failures.length === 0 && consoleErrors.length === 0;
} catch (err) {
  report.error = String(err?.stack ?? err);
  await page.screenshot({ path: path.join(out, "session-failure.png") }).catch(() => {});
} finally {
  report.failures = failures;
  await writeFile(path.join(out, "session-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
}
