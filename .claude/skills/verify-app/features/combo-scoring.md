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
  `base × combo × 0.5^repeats`. A **sloppy** catch (early/late, outside `cleanWindow`) scores
  half and doesn't raise it.
- Losing the ball, or 4 s without a move, resets combo to 0 and clears the chain.

## Drive

Covered by `node scripts/verify/dribble.mjs` (see [dribbling.md](dribbling.md)): checks
`points-order`, `repeat-scores-less` and `loose-ball` (combo → 0, "LOOSE BALL!!" callout).

```js
__game.combo     // { score, best, combo, chain: ["L","I","J",…], lastMove: {kind, points, timing}, moves }
__game.hud       // the HUD store snapshot, incl. callout { text, points, tone }
```

## Working looks like

- After `L I J` then `J K L` (both clean): combo ×1 → ×2, score 100 → 400, chain row shows the keys.
- `[data-testid=hud-score]` and `[data-testid=hud-combo]` match `__game.combo`.
- Ball goes loose → ×0, empty chain, ink "LOOSE BALL!!" burst.
