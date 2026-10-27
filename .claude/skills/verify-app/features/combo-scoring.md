# Combo scoring

**Built** — ticket BBGA-EQIU6D.

## Code

- `src/game/combo.ts` — `ComboScorer` + tunables `COMBO` (points, repeat/sloppy factors, timeout).
- `src/game/hudStore.ts` — `score`, `best`, `combo`, `chain`, `callout`, `sfx`.
- `src/components/Hud.tsx` / `Hud.module.css` — score card, ×N, key-chain row, callout burst, ダムッ pop.

## Rules

- Base points (`__game.config.points`): pound 0 · high 20 · switch 40 · crossover 100 ·
  between 150 · behind 200.
- A **clean** move different from the previous one raises the multiplier by 1 and scores
  `base × combo`. Repeating the same move keeps the multiplier and scores
  `base × combo × 0.5^repeats`. A **sloppy** move (pressed early/late, outside `cleanWindow`)
  scores half, doesn't raise it, and its callout says "SLOPPY" (`callout.detail`). The ball is
  never lost for timing.
- Losing the ball (only by sprint-spamming sloppy switches — see [dribbling.md](dribbling.md)),
  or 4 s without a move, resets combo to 0 and clears the chain.
- A made jumper cashes the combo in: `comboPoints × 2` (× 3 for a 3) on top of the shot's
  base; any shot ends the combo, and the timeout is paused while the shot is up. See
  [jumper.md](jumper.md).

## Drive

Covered by `node scripts/verify/dribble.mjs` (see [dribbling.md](dribbling.md)): checks
`points-order`, `repeat-scores-less` and `loose-ball` (combo → 0, "LOOSE BALL!!" callout, via the sprint-spam loss).

```js
__game.combo     // { score, best, combo, chain: ["L","I","J",…], lastMove: {kind, points, timing}, moves }
__game.hud       // the HUD store snapshot, incl. callout { text, points, tone }
```

## Working looks like

- After `L I J` then `J K L` (both clean): combo ×1 → ×2, score 100 → 400, chain row shows the keys.
- `[data-testid=hud-score]` and `[data-testid=hud-combo]` match `__game.combo`.
- Ball goes loose → ×0, empty chain, ink "LOOSE BALL!!" burst.
