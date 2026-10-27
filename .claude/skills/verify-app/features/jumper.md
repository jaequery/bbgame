# Jumper (Space)

**Built** — ticket BBGA-EY71E4.

## Code

- `src/game/shot.ts` — `ShotController` (gather → jump → release → flight → rebound → pass) and
  tunables `SHOT` (gather/jump, launch angle, timing tolerance near/far, miss growth, backspin).
  `isThree()`, `shotTolerance()`, `solveLaunch()`.
- `src/game/hoopPhysics.ts` — `HoopCollider`: rim torus (regulation 5/8 in tube), glass backboard
  box, net drag + funnel, and the make test (ball centre drops through the ring plane inside it).
- `src/game/ballPhysics.ts` — `BallBody.obstacles` + `bounceOff()` (restitution + spin-coupled
  Coulomb friction at any contact normal). Constants in `dimensions.ts` (`RIM_RESTITUTION`, …).
- `src/game/dribble.ts` — `shot` state, `surrender()` / `receive()`.
- `src/game/combo.ts` — `onShotStart()` (pauses the combo timeout), `onShot()` cash-in, `SHOT_CALLOUTS`.
- `src/components/Hud.tsx` — shot meter (`hud-meter`), callout detail line (`hud-callout-detail`).
- `src/game/audio.ts` — `playSwish`, `playRim`, `playBoard`.

## Rules

- **Hold Space**: the ball is gathered into both hands (held/carry: now; mid-dribble: on its way
  back up, at the catch), the knees dip for `gatherTime` 0.2 s, then the player leaves the floor
  (0.55 m leap, apex 0.335 s after take-off). **Release** = Space up; holding all the way down
  forces a late release at 0.12 m.
- Timing error `e = release − apex`. `|e| ≤ tolerance` = PERFECT (0.065 s at ≤ 3 m → 0.035 s at
  8.5 m). The aim point moves short (early) / long (late) of the rim centre — 5 cm per tolerance
  unit inside the window, 9 cm per unit beyond (late also drifts sideways), capped at 27 cm so a
  bad release still finds iron. Early = higher arc, late = flatter. Then it is pure physics.
- Points (`__game.config.combo.shot`): made 2 = 200, made 3 = 300 (feet beyond the arc / corner line
  at release). A make adds `comboPoints × 2` (× 3 for a 3) and ends the combo; a miss resets it.
- Callouts: SWISH!! (no touch), BANK!! (glass), IN!! (rim), RIM OUT…, OFF THE BOARD…, AIRBALL….
- The ball is passed back ~0.5–0.75 s after the result and lands in the right hand (`held`).

## Drive

```bash
node scripts/verify/jumper.mjs --url http://localhost:3000 --out artifacts
```

From mid-range (4.5 m) and beyond the arc (7.5 m): builds a two-move combo (L I J, J K L), holds
Space, releases at the apex (slow-mo `setTimeScale(0.25)` so the key lands on time), then releases
0.2 s early and 0.2 s late. Writes `jumper-report.json` and `jumper/<shot>-{release,flight,rim,result}.png`.

```js
__game.placePlayer(x, z)   // teleport, face the +X hoop, ball in the right hand (refused mid-shot)
__game.world.hoopX         // +X rim centre (12.7254)
__game.shot                // { phase, apexIn, jumpHeight, distance, lastRelease, lastResult, attempts, makes }
                           // lastRelease: { grade, error, tolerance, distance, three, angle, speed, forced }
                           // lastResult:  + { made, kind, rimHits, boardHits }
__game.combo               // + comboPoints, lastShot { made, kind, three, base, cashed, multiplier, points }
__game.config.shot         // SHOT + airTime
```

Manual: hold Space, watch the meter beside the player — let go as the red fill crosses the gold band.

## Working looks like

- Perfect release from either spot → made (usually SWISH!!), `three` true only from beyond the arc.
- After the combo: score rises by `base + comboPoints × 2|3`; callout reads e.g.
  `SWISH!! +1,500 · 3PT 300 + COMBO 400 ×3`; `×0` afterwards.
- ±0.2 s → miss with `rimHits + boardHits > 0` (RIM OUT…), combo ×0, score unchanged.
- `dribble.state` back to `held` within ~1.6 s of the result.

## Fadeaway (F)

Hold **F** instead of Space: same gather → jump → release flow and grading, but the player drifts
`SHOT.fade.drift` (0.7 m) away from the rim and leans back (`SHOT.fade.lean`), and the perfect window
is `SHOT.fade.toleranceScale` (0.6×) of the Space jumper's. `__game.shot.fade` / `.lean` and
`lastRelease.fade` expose it. Drive: `node scripts/verify/fadeaway.mjs`.
