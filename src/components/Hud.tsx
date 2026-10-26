"use client";

import { useSyncExternalStore } from "react";
import { hudStore, VIEW_LABELS } from "@/game/hudStore";
import styles from "./Hud.module.css";

const CONTROLS: [string, string][] = [
  ["J", "Left"],
  ["K", "Legs"],
  ["L", "Right"],
  ["I", "High"],
  [",", "Behind back"],
  ["SPACE", "Shoot"],
  ["WASD", "Move"],
  ["V", "View"],
];

const CHAIN_SLOTS = 4;
const fmt = new Intl.NumberFormat("en-US");

export default function Hud() {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, hudStore.getSnapshot);
  const chain = hud.chain.slice(-CHAIN_SLOTS);

  return (
    <div className={styles.hud} data-testid="hud">
      <div className={styles.halftone} aria-hidden />

      <section className={styles.scoreCard} aria-label="Score">
        <span className={styles.scoreLabel}>SCORE</span>
        <span className={styles.scoreValue} data-testid="hud-score">
          {fmt.format(hud.score)}
        </span>
        <span className={styles.best}>BEST {fmt.format(hud.best)}</span>
      </section>

      <section className={styles.combo} aria-label="Combo">
        <span className={styles.comboValue} data-testid="hud-combo">
          ×{hud.combo}
        </span>
        <span className={styles.comboLabel}>COMBO</span>
        <ol className={styles.chain} aria-label="Key chain">
          {Array.from({ length: CHAIN_SLOTS }, (_, i) => (
            <li key={i} className={chain[i] ? styles.chainKey : styles.chainEmpty}>
              {chain[i] ?? ""}
            </li>
          ))}
        </ol>
      </section>

      <header className={styles.title}>
        <span className={styles.titleJp}>ドリブル道場</span>
        <span className={styles.titleEn}>DRIBBLE DOJO · PRACTICE GYM</span>
      </header>

      <section className={styles.view} aria-label="Camera view">
        <span className={styles.viewKey}>{hud.view}</span>
        <span className={styles.viewName} data-testid="hud-view">
          {VIEW_LABELS[hud.view]}
        </span>
        <span className={styles.viewHint}>
          <kbd>V</kbd> switch
        </span>
      </section>

      <section className={styles.controls} aria-label="Controls">
        {CONTROLS.map(([key, label]) => (
          <div key={key} className={styles.control}>
            <kbd className={key.length > 1 ? styles.keyWide : styles.key}>{key}</kbd>
            <span>{label}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
