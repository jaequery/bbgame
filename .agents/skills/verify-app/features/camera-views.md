# Camera views

Code: `src/game/cameras.ts` (poses + glide), key handling in `src/game/createGame.ts`,
HUD label in `src/components/Hud.tsx`.

| View | Key order | Pose |
|---|---|---|
| **B** behind the shoulder (default) | 1st | low, behind and right of the player, hoop ahead, follows the player |
| **A** diagonal isometric | 2nd | high diagonal of the full court (fov 32), loosely follows (35% toward player) |
| **C** side broadcast | 3rd | near sideline (z ≈ 8.4 m), tracks the player's X |

V cycles B → A → C → B. Each switch is a 0.9 s eased glide (`camera.gliding === true`
during it); pressing V mid-glide retargets from the current pose.

## Drive

```js
await page.waitForFunction(() => window.__game?.frames > 5);
(await page.evaluate(() => window.__game.camera.view)) === "B";
await page.keyboard.press("v");
// sample a few times over ~600 ms: positions strictly between the two poses = glide, not cut
await page.waitForFunction(() => !window.__game.camera.gliding);
(await page.evaluate(() => window.__game.camera.view)) === "A";
```

`scripts/verify/drive.mjs` does all of this and screenshots each view.

## Working looks like

- B: player's back (#10 KAZE) large in frame, +X hoop and 全国制覇 banner ahead, ball visible.
- A: whole court diagonal, both hoops, far bleachers + banner; near walls cut away.
- C: side-on player, far bleachers/banner/windows behind, key paint at right.
- HUD bottom-left shows the view letter + name and updates on each V.
