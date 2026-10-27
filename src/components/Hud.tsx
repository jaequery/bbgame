"use client";

import { useSyncExternalStore } from "react";
import { hudStore, VIEW_LABELS } from "@/game/hudStore";
import styles from "./Hud.module.css";

const CONTROLS: [string, string][] = [
  ["J", "Left"],
  ["K", "Legs"],
  ["L", "Right"],
  ["I", "Crossover"],
  [",", "Behind back"],
  ["U", "Spin L"],
  ["O", "Spin R"],
  ["HOLD J/L", "Palm"],
  ["SPACE", "Shoot"],
  ["WASD", "Move"],
  ["SHIFT", "Sprint"],
  ["V", "View"],
  ["ESC", "Menu"],
];

const CHAIN_SLOTS = 4;
const GRADE_TEXT = { perfect: "PERFECT!!", early: "EARLY", late: "LATE" } as const;
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
        <span className={styles.best} data-testid="hud-best">
          BEST {fmt.format(hud.topScore)}
        </span>
      </section>

      {hud.screen === "play" && hud.timeLeft !== null && (
        <section
          className={`${styles.clock} ${hud.timeLeft <= 10 ? styles.clockLow : ""}`}
          aria-label="Session clock"
        >
          <span className={styles.clockLabel}>TIME</span>
          <span className={styles.clockValue} data-testid="hud-clock">
            {hud.timeLeft.toFixed(1)}
          </span>
        </section>
      )}

      <section className={styles.combo} aria-label="Combo">
        <span className={styles.comboValue} data-testid="hud-combo">
          ×{hud.combo}
        </span>
        <span className={styles.comboLabel}>COMBO</span>
        <ol className={styles.chain} aria-label="Key chain">
          {Array.from({ length: CHAIN_SLOTS }, (_, i) => (
            <li
              key={`${i}:${hud.chain.length}`}
              className={chain[i] ? `${styles.chainKey} ${i === chain.length - 1 ? styles.chainHit : ""}` : styles.chainEmpty}
            >
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
          {hud.callout.detail && (
            <span className={styles.calloutDetail} data-testid="hud-callout-detail">
              {hud.callout.detail}
            </span>
          )}
        </div>
      )}

      {hud.meter && (
        <div
          className={styles.meter}
          data-testid="hud-meter"
          data-grade={hud.meter.grade ?? ""}
          style={{ left: `${hud.meter.x * 100}%`, top: `${hud.meter.y * 100}%` }}
          aria-hidden
        >
          <div className={styles.meterTrack}>
            <div
              className={styles.meterZone}
              style={{ bottom: `${hud.meter.zone[0] * 100}%`, height: `${(hud.meter.zone[1] - hud.meter.zone[0]) * 100}%` }}
            />
            <div className={styles.meterFill} style={{ height: `${hud.meter.fill * 100}%` }} />
          </div>
          {hud.meter.grade && (
            <span key={hud.meter.grade} className={`${styles.meterGrade} ${styles[hud.meter.grade] ?? ""}`}>
              {GRADE_TEXT[hud.meter.grade]}
            </span>
          )}
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
