# AGENTS.md

Conventions for AI coding agents working in **bbgame**. This file is the
canonical entry point under the [AGENTS.md](https://agents.md) standard, and it
is the first thing a Fredrin Worker reads.

## Project

**Dribble Dojo (ドリブル道場)** — a realistic basketball *dribbling* simulator in a
hand-drawn 90s anime (Slam Dunk) look: a solo practice gym, combo scoring, jump
shots and a leaderboard. Next.js (App Router, TypeScript) + three.js, Postgres via
Drizzle. Deployed on Vercel (preview per branch, production on merge).

## Commands

| What | Command |
|---|---|
| Install | `npm install` |
| Database (local) | `docker compose up -d --wait` (Postgres 16 on host port **5433**) |
| Env | `cp .env.example .env` (`DATABASE_URL`) |
| Migrate | `npm run db:migrate` · new migration after a schema edit: `npm run db:generate` |
| Dev server | `npm run dev` → http://localhost:3000 (game at `/`, health at `/api/health`) |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` (must pass — Vercel runs it) |
| Drive the game (screenshots + camera checks) | `node scripts/verify/drive.mjs --out artifacts` (needs `npx playwright install chromium` once) |

Full launch/verify procedure: `.claude/skills/verify-app/SKILL.md` (mirrored in `.agents/skills/verify-app/`).

## Layout

- `src/app/` — routes. `page.tsx` mounts `<Game>` + `<Hud>`; `api/health/route.ts` checks the DB.
- `src/components/` — client components: `Game.tsx` (mounts three.js), `Hud.tsx` (manga HUD).
- `src/game/` — all three.js code, client-only:
  - `dimensions.ts` — every real-world measurement (metres). Use these, never magic numbers.
  - `court.ts` (floor + painted lines), `hoop.ts`, `gym.ts`, `player.ts`, `ball.ts` — scene parts.
  - `ballPhysics.ts`, `hoopPhysics.ts` — the ball as a rigid body; rim/backboard/net colliders.
  - `dribble.ts`, `shot.ts`, `combo.ts` — dribble moves, the Space jumper, scoring + cash-in.
  - `toon.ts` — cel-shaded materials (`toon()`) and ink outlines (`outline()` / `inked()`).
  - `cameras.ts` — the three views and the glide between them.
  - `hudStore.ts` — tiny store the game loop writes and the HUD reads (score, combo, key chain, view).
  - `createGame.ts` — renderer, loop, input, and the dev-only `window.__game` debug handle.
- `src/db/` — Drizzle schema + lazy client. `drizzle/` — generated SQL migrations (commit them).
- `scripts/verify/` — Playwright driver used by the verify-app skill.

## Conventions

- **World space is metres, Y up.** Court long axis is X (baselines at ±14.33 m), width is Z;
  the player attacks the **+X** hoop. Ball and court are regulation size; only the player is
  drawn ~8% large (`PLAYER_SCALE`).
- **Server code stays out of the game.** Anything under `src/game/` and `src/components/` is
  client-only (`"use client"`); never import `src/db` from them. The page must render with the
  DB down — only API routes touch Postgres, and `getDb()` connects lazily at request time so
  `next build` needs no database.
- **Art direction:** toon materials from `toon()` (3 flat bands) + `inked()` outlines on solid
  objects. Don't outline flat planes (the hull shows from behind) — paint borders into textures.
  Text on canvas textures goes through `drawnTexture()` so it redraws once web fonts load.
- **Walls are single-sided, facing inward**, so the high isometric camera sees through the near
  walls. Keep new wall-mounted props single-sided too.
- **Debug handle:** `window.__game` (dev only) exposes `frames`, `world`, `player`, `ball`,
  `camera`, `cycleView()`, `setView()`, `shot`, `placePlayer()`, `setTimeScale()`. Extend it when you add game state that automation needs.
- **Controls** (canonical): WASD move · J left hand · L right hand (tap = dribble, hold = palm the
  ball, dropped after 3 s; opposite hand key while palming = hold-cross with a slide) ·
  I crossover · K between legs · `,` behind back · U right spin · O left spin · Space jumper (hold WASD pointing away from the hoop and it becomes a fadeaway: leans back, tighter timing window) ·
  V cycle camera (B → A → C). A ball left untouched in the hand dribbles once after 3 s; otherwise it only moves on a key press.
- Never commit `.env`; document new env vars in `.env.example`.
- Next.js here is v16 with Cache Components on — read `node_modules/next/dist/docs/` before
  using an API you haven't checked. A route handler that must run per request calls
  `await connection()` first.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
