# Dribbling (J / L / I / K / ,)

**Built** — ticket BBGA-EQIU6D; auto-dribble + loss rule — ticket BBGA-EBI86H.

## Code

- `src/game/ballPhysics.ts` — `BallBody` rigid body (gravity, restitution 0.78, spin + Coulomb
  friction at the bounce, rolling resistance, gym bounds) and `planDribble` / `predictCatch`.
- `src/game/dribble.ts` — `DribbleController`: auto-catch + auto-dribble rhythm, input buffer,
  the hand → path → hand roll parser, move geometry (carry path, release, catch point), the
  sprint-spam loss + pickup. Tunables in `DRIBBLE` (windows in seconds, heights in metres,
  `rhythm`, `powerApexMargin`, `lateGrab`, `bufferSize`, `spamCount`, `spamWindow`).
- `src/game/locomotion.ts` — camera-relative WASD, Shift sprint, facing, floor bounds, squeaks.
- `src/game/player.ts` — `animate()`: gait, crouch, split stance, two-bone arm IK.
- `src/game/audio.ts` — generated thump / squeak (WebAudio; starts on the first key press).
- `src/game/createGame.ts` — fixed 1/240 s substeps; key presses are applied at their event time.

## Rules a driver needs

- **Auto-dribble (NBA-game style).** With no keys the player dribbles by themselves: the hand
  always meets the ball on its way up (`catchIn` reaching 0 → `held`) and pushes it again after
  a short hold, in whichever hand has it. These pushes are `lastMove: {kind: "pound", auto: true}`.
  Rhythm follows movement (`DRIBBLE.rhythm`): standing ≈ 0.5 s per bounce with a higher catch,
  walking ≈ 0.43 s, sprinting quicker and lower.
- **Keys force dribbles.** The ball hand's key (`dribble.hand`: `R` → `L` key, `L` → `J` key) is
  a power pound (`power: true`, harder and quicker); the other hand's key is a switch; rolls
  below are the moves. A press while the ball is away is **buffered** (`dribble.queued`, up to 3)
  and applied at the next contact; a press within `lateGrab` (0.09 s) of an auto push takes
  that contact.
- **Timing only scores.** `|press − ideal catch| ≤ cleanWindow` (0.075 s, ×0.8 for a switch,
  ×0.7 sprinting) = clean; anything else = sloppy (half points, combo doesn't grow, callout
  with a "SLOPPY" second line). The ball stays yours either way.
- **The one loss:** `spamCount` (4) sloppy hand changes within `spamWindow` (1.5 s) while
  sprinting → `state: "loose"`, `lost` +1. Walk onto it to pick it up. Nothing else loses it.
- A move is the roll pressed **at the catch**: second key within 0.13 s, all three within 0.35 s.

| Move | Keys (from right hand) | From left hand | `lastMove.kind` | Callout |
|---|---|---|---|---|
| Crossover | `L I J` | `J I L` | `crossover` | CROSSOVER!! |
| Between the legs | `L K J` | `J K L` | `between` | BETWEEN THE LEGS!! |
| Behind the back | `L , J` | `J , L` | `behind` | BEHIND THE BACK!! |
| High dribble | `L I` (no hand after) | `J I` | `high` | HIGH DRIBBLE! |
| Basic switch | `L J` | `J L` | `switch` | SWITCH! |
| Pound (plain) | `L` | `J` | `pound` | — |

## Drive

Ready-made: `node scripts/verify/dribble.mjs --url http://localhost:3000 --out artifacts`
(`--frames all` for 3-frame sequences in every view; default only view B). It performs every
move in views B, A and C, walks while dribbling, loses the ball by sprint-spamming switches and
walks onto it, sprints into the floor edge, and writes `artifacts/dribble-report.json` +
`artifacts/moves/*.png`. Exit 0 = every check passed.

Auto-dribble + loss rule: `node scripts/verify/autodribble.mjs --url http://localhost:3000 --out artifacts`
(`--seconds 30`). 30 s with no input (standing, then walking WASD) and 30 s of random
J/L/I/K/, mashing, sampling `dribble.state` every frame (never `loose`); the rhythm standing vs
walking; each transfer move both ways + the high dribble clean; the sprint-spam loss + pickup.
Writes `artifacts/autodribble-report.json` + `artifacts/autodribble/*.png`.

By hand (Playwright):

```js
// The ball auto-dribbles from the start. Wait for it to come back up — poll on a timer, not
// raf: the auto-catch takes it out of flight on the very next frame.
await page.waitForFunction(() => {
  const c = window.__game.dribble.catchIn; return c !== null && c <= 0.03;
}, null, { polling: 5 });
for (const k of ["l", "i", "j"]) { await page.keyboard.press(k); await page.waitForTimeout(25); }
await page.waitForFunction(() => window.__game.dribble.lastMove?.kind === "crossover");
```

Freeze the clock around screenshots so the rhythm survives them:
`window.__game.setTimeScale(0)` … screenshot … `setTimeScale(1)`.

## State (`window.__game`)

```js
__game.dribble   // { state: "held"|"carry"|"flight"|"loose", hand: "L"|"R", heightMode,
                 //   catchIn, lastTiming: {error, timing: "clean"|"sloppy"},
                 //   lastMove: {kind, from, to, keys, timing, auto?, power?},
                 //   moves, lost, split, queued: ["J", …] }
__game.ball      // { position, velocity, spin, radius, held, state }
__game.hands     // { L: [x,y,z], R: [x,y,z] } wrist positions
__game.player    // { position, facing, velocity, speed, sprinting }
__game.config    // { dribble, combo, move, points } — the tunables
__game.simTime / timeScale / setTimeScale(s)
```

## Working looks like

- Ball bounces between hand and floor; `ball.position[1]` swings ~0.12 ↔ ~0.68 m on a low dribble.
- Each move: `lastMove.kind/from/to` match the table, `[data-testid=hud-callout]` shows its
  callout, a ダムッ pop (`[data-testid=hud-sfx]`) appears at each bounce, the ball changes hands.
- Between the legs: `dribble.split` is ±1 while it happens (split stance).
- Stop pressing: the dribble keeps going forever (`moves` keeps rising, `lost` stays put).
- Mash keys: moves happen (some with a SLOPPY callout), the ball never gets loose.
- Sprint (Shift + WASD) while alternating `j`/`l` every ~45 ms: within ~2 s `state === "loose"`,
  "LOOSE BALL!!", the ball rolls away; walking onto it brings it back.
