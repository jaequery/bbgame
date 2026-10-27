# Sessions + leaderboard

Title screen → **60s Session** (clock, buzzer, results, initials, saved run) or **Free Practice**
(no clock, never saved) → all-time top-10 leaderboard in Postgres. HUD BEST = the board's top score.

## Code

- `src/game/session.ts` — `SessionClock` (60 s on the game's sim clock, best combo, move tally)
  and `runControl` (screens → game loop).
- `src/game/createGame.ts` — `startRun` / `quitRun` / `tickSession`; input is ignored unless
  `hud.screen === "play"`; Esc quits a run; a run resets the player to `PLAYER_START` with the ball
  (`Locomotion.placeAt`, `DribbleController.restart`) and the score (`ComboScorer.reset`).
- `src/game/hudStore.ts` — `screen` (`title|play|results|leaderboard`), `mode`, `timeLeft`,
  `topScore`, `result`.
- `src/components/Screens.tsx` (+ `.module.css`) — title, results with NBA-Jam initials, leaderboard.
  `src/components/Hud.tsx` — TIME clock (Session only) and BEST.
- `src/lib/runs.ts` — shared limits + `parseRun()` validation. `src/app/api/runs/route.ts` — GET/POST.
- `src/db/schema.ts` `runs` table, migration `drizzle/0001_runs.sql`.

## Drive

```bash
node scripts/verify/session.mjs --url http://localhost:3000 --out artifacts           # full 60 s run
node scripts/verify/session.mjs --url http://localhost:3000 --out artifacts --fast    # clock jumped to 3 s
```

It: checks the title screen and HUD BEST; plays Free Practice, presses Esc, asserts **zero**
`POST /api/runs` and an unchanged board; starts a Session, dribbles until the buzzer, types
initials (`K`, `ArrowUp`×25 → `Z`, `ArrowRight`, `E`), presses Enter, reloads, opens the
leaderboard and finds the row. Writes `session-report.json` and `session-1…6-*.png`.

`window.__game` fields:

```js
window.__game.session      // { screen, mode: "session"|"practice"|null, timeLeft, bestCombo, moves, result }
window.__game.startRun("session" | "practice")   // same as the title buttons
window.__game.setClock(3)  // Session: 3 s left (reach the buzzer fast)
window.__game.hud.topScore // HUD BEST
```

API by hand:

```bash
curl -s localhost:3000/api/runs                                   # {"ok":true,"runs":[…]}
curl -s -XPOST localhost:3000/api/runs -H 'content-type: application/json' \
  -d '{"initials":"ABC","score":1200,"bestCombo":3}'              # 201 {"ok":true,"run":{…}}
# 400: initials not ^[A-Z]{3}$, score not an integer 0–2,000,000, bestCombo 0–1,000, non-JSON
# 429: 6th POST within 60 s from one IP (x-forwarded-for) · 503: DATABASE_URL unset / DB down
```

## Working looks like

- Load: title panel (ドリブル道場 / DRIBBLE DOJO, three buttons), `session.screen === "title"`;
  pressing J/L does nothing.
- Session: TIME panel top-right counts 60.0 → 0.0 (red under 10 s); at 0 a buzzer plays and the
  results panel shows TIME UP!!, final score (= `combo.score`), best combo, move count and the
  per-move chips, plus three letter slots.
- After Enter: leaderboard with the new row highlighted yellow; after a reload the row is still
  there and HUD BEST equals row #1's score.
- Practice: no TIME panel, `session.timeLeft === null`, no POST ever; Esc → title.
- DB down: `/` still renders the title; leaderboard says "LEADERBOARD OFFLINE"; submit shows
  "Couldn't save" and Skip still returns to the title.
