---
name: verify-app
description: Launch, health-check, drive and screenshot Dribble Dojo (Next.js + three.js game with Postgres). Use to prove a change works in the running game — camera views, HUD, dribbling, jumper, scoring, leaderboard — and to collect screenshot evidence for a PR.
---

# verify-app — Dribble Dojo

Everything here runs from the repo root. Ports: app **3000**, Postgres **5433** (host).
Evidence goes to `artifacts/` (git-ignored).

## Launch

From an empty data dir (fresh database) to a game that has rendered a frame:

```bash
# 1. Database. `down -v` deletes ONLY this project's volume (dribble-dojo_dojo-pg) —
#    skip it if you want to keep existing local data.
docker compose down -v
docker compose up -d --wait

# 2. App deps + env + schema
npm install
[ -f .env ] || cp .env.example .env
npm run db:migrate

# 3. Dev server in the background; remember its PID so Cleanup kills only it
mkdir -p artifacts
nohup npm run dev > artifacts/dev.log 2>&1 &
echo $! > artifacts/dev.pid

# 4. Ready = health ok AND the canvas has rendered a frame
for i in $(seq 1 60); do curl -sf localhost:3000/api/health && break; sleep 1; done
node scripts/verify/drive.mjs --out artifacts   # waits for window.__game.frames > 5
```

Ready means both: `curl -s localhost:3000/api/health` → `{"ok":true,"db":"ok"}` and the drive
script got past its first-frame wait (it fails with `failure.png` otherwise).

No Docker? The game still renders — only `/api/health` reports `db:"down"` (503). The ticket
stack allows a SQLite fallback if Docker is ever unavailable; it is not wired yet.

If `docker compose up` fails with "all predefined address pools have been fully subnetted",
the compose file already uses `network_mode: bridge` to avoid creating a network; make sure
you are on a current checkout.

## Doctor

Read-only; changes nothing:

```bash
bash scripts/verify/doctor.sh            # node, deps, .env, docker, compose state,
                                         # migrations count, /api/health, GET /
```

## Drive

- **Routes:** `/` (game; opens on the title screen), `/api/health` (DB check, 200 or 503),
  `/api/runs` (leaderboard GET top 10 / POST a run).
- **Keys:** the game listens on `window` keydown, by `event.code`. Playwright:
  `await page.keyboard.press("v")`. Ignore auto-repeat — the game does.
- **Game state:** dev builds expose `window.__game` (see `src/game/createGame.ts`):
  ```js
  window.__game.frames                    // frames rendered (>0 = canvas live)
  window.__game.world                     // courtLength 28.65, courtWidth 15.24, rimHeight 3.048,
                                          // ballRadius, ballCircumference 0.749 (metres)
  window.__game.player                    // { position, facing, velocity, speed, sprinting }
  window.__game.ball                      // { position, velocity, spin, radius, held, state }
  window.__game.dribble / combo / hands   // see features/dribbling.md, combo-scoring.md
  window.__game.shot / placePlayer(x, z)  // see features/jumper.md
  window.__game.camera                    // { view:"A"|"B"|"C", gliding, position, target, fov }
  window.__game.cycleView() / setView("A")
  ```
  It does not exist in `next build && next start` — drive a dev server.
- **Canvas screenshots:** the WebGL canvas is `[data-testid=game-canvas]` inside
  `[data-testid=game-stage]`; the HUD is DOM on top (`[data-testid=hud]`, `hud-view`,
  `hud-score`, `hud-combo`). `page.screenshot()` captures both. Headless Chromium needs
  `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL (the driver passes them).
  Wait for `document.fonts.ready` before shooting so canvas text is in the right face.
- **Ready-made driver:** `node scripts/verify/drive.mjs [--url …] [--out artifacts]` — screenshots
  each view (`view-B.png`, `view-A.png`, `view-C.png`), presses V three times sampling the camera
  mid-glide, writes `drive-report.json`, exits 0 only if the view order is B → A → C → B with
  intermediate (non-cut) frames. Copy its pattern for new features.
- **Title screen first:** the page opens on the title overlay and game keys (WASD, J/L/I/K/,
  Space, V) are ignored until a run starts. Click `[data-testid=start-practice]` or call
  `window.__game.startRun("practice")` right after the first-frame wait (the drivers do).
- **Dribbling driver:** `node scripts/verify/dribble.mjs [--url …] [--out artifacts] [--frames all]` —
  every move in B/A/C, walk, loose ball, floor bounds; writes `dribble-report.json` + `moves/`.
- **Auto-dribble driver:** `node scripts/verify/autodribble.mjs [--url …] [--out artifacts] [--seconds 30]` —
  30 s idle (stand + walk) and 30 s mashing never loose, rhythm, clean moves, sprint-spam loss;
  writes `autodribble-report.json` + `autodribble/`.
- **Jumper driver:** `node scripts/verify/jumper.mjs [--url …] [--out artifacts]` — combo → perfect
  jumper, early and late bricks, from mid-range and beyond the arc; writes `jumper-report.json` + `jumper/`.

- **Fadeaway driver:** `node scripts/verify/fadeaway.mjs [--url …] [--out artifacts]` — Space vs **F**
  from mid-range: lean, drift away from the rim, tighter window, perfect make, late/early grades;
  writes `fadeaway-report.json` + `fadeaway/` (view C screenshots of the lean).

## Evidence

- Screenshots and `drive-report.json` from `artifacts/`.
- `curl -s localhost:3000/api/health` output (and the 503 body with the DB stopped, if relevant).
- `npm run build` exit code.
- Attach screenshots to the ticket: `./.fredrin/fredrin ticket upload artifacts/view-B.png --label "Camera B"`.

## Cleanup

Kill only what Launch started:

```bash
# npm → sh → next dev → workers: kill the whole tree under the PID we recorded
kill_tree() { for c in $(pgrep -P "$1"); do kill_tree "$c"; done; kill "$1" 2>/dev/null; }
[ -f artifacts/dev.pid ] && kill_tree "$(cat artifacts/dev.pid)"; rm -f artifacts/dev.pid
docker compose stop db      # keeps data; `docker compose down -v` to wipe it
```

Never kill other containers or other projects' dev servers.

## Feature map

One file per top feature — how to drive it and what "working" looks like:

| Feature | File | Status |
|---|---|---|
| Camera views (B/A/C + glide) | [features/camera-views.md](features/camera-views.md) | built |
| Dribbling (J/L/I/K/, moves) | [features/dribbling.md](features/dribbling.md) | built |
| Combo scoring | [features/combo-scoring.md](features/combo-scoring.md) | built |
| Jumper (Space) | [features/jumper.md](features/jumper.md) | built |
| Sessions + leaderboard | [features/leaderboard.md](features/leaderboard.md) | built |

When you build one of the stubs, replace its file with real drive steps and extend
`window.__game` with the state it needs.
