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
  ["SHIFT", "Sprint"],
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

      {hud.callout && (
        <div
          key={`callout-${hud.callout.id}`}
          className={`${styles.callout} ${styles[hud.callout.tone] ?? ""}`}
          data-testid="hud-callout"
          aria-live="polite"
        >
          <span className={styles.calloutText}>{hud.callout.text}</span>
          {hud.callout.points > 0 && <span className={styles.calloutPoints}>+{fmt.format(hud.callout.points)}</span>}
        </div>
      )}

      {hud.sfx && (
        <span
          key={`sfx-${hud.sfx.id}`}
          className={styles.sfx}
          data-testid="hud-sfx"
          aria-hidden
          style={{
            left: `${hud.sfx.x * 100}%`,
            top: `${hud.sfx.y * 100}%`,
            fontSize: `${22 + 22 * hud.sfx.strength}px`,
          }}
        >
          {hud.sfx.text}
        </span>
      )}

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
