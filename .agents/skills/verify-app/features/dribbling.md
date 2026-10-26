# Dribbling (J / L / I / K / ,)

**Built** — ticket BBGA-EQIU6D.

## Code

- `src/game/ballPhysics.ts` — `BallBody` rigid body (gravity, restitution 0.78, spin + Coulomb
  friction at the bounce, rolling resistance, gym bounds) and `planDribble` / `predictCatch`.
- `src/game/dribble.ts` — `DribbleController`: catch windows, the hand → path → hand roll
  parser, move geometry (carry path, release, catch point), loose ball + pickup. Tunables in
  `DRIBBLE` (windows in seconds, heights in metres).
- `src/game/locomotion.ts` — camera-relative WASD, Shift sprint, facing, floor bounds, squeaks.
- `src/game/player.ts` — `animate()`: gait, crouch, split stance, two-bone arm IK.
- `src/game/audio.ts` — generated thump / squeak (WebAudio; starts on the first key press).
- `src/game/createGame.ts` — fixed 1/240 s substeps; key presses are applied at their event time.

## Rules a driver needs

- The ball starts **held** in the right hand (`L` key). Press `L` to start dribbling.
- In the air, the next press must land within `config.dribble.okWindow` (0.15 s) of the ideal
  catch — `dribble.catchIn` counts down to it; within `cleanWindow` (0.075 s) is clean. The
  key must be the hand the ball is going to (`dribble.hand`: `R` → `L` key, `L` → `J` key).
  No press, a wrong hand or a badly early press → `state: "loose"`.
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
move in views B, A and C, walks while dribbling, loses the ball and walks onto it, sprints into
the floor edge, and writes `artifacts/dribble-report.json` + `artifacts/moves/*.png`. Exit 0 =
every check passed.

By hand (Playwright):

```js
await page.keyboard.press("l");                       // start dribbling (ball in right hand)
await page.waitForFunction(() => {                    // wait for the ball to come back up
  const c = window.__game.dribble.catchIn; return c !== null && c <= 0.03;
}, null, { polling: "raf" });
for (const k of ["l", "i", "j"]) { await page.keyboard.press(k); await page.waitForTimeout(25); }
await page.waitForFunction(() => window.__game.dribble.lastMove?.kind === "crossover");
```

Freeze the clock around screenshots so the rhythm survives them:
`window.__game.setTimeScale(0)` … screenshot … `setTimeScale(1)`.

## State (`window.__game`)

```js
__game.dribble   // { state: "held"|"carry"|"flight"|"loose", hand: "L"|"R", heightMode,
                 //   catchIn, lastTiming: {error, timing}, lastMove: {kind, from, to, keys, timing},
                 //   moves, lost, split }
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
- Stop pressing: within ~0.2 s `dribble.state === "loose"`, ball rolls away
  (horizontal speed > 0), walking onto it returns `state: "held"`.
