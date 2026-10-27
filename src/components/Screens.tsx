"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { unlockAudio } from "@/game/audio";
import type { MoveKind } from "@/game/dribble";
import { hudStore } from "@/game/hudStore";
import { runControl, type PlayMode, type SessionResult } from "@/game/session";
import { RUNS, type RunRow } from "@/lib/runs";
import styles from "./Screens.module.css";

const fmt = new Intl.NumberFormat("en-US");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const MOVE_LABELS: [MoveKind, string][] = [
  ["crossover", "Crossover"],
  ["between", "Between legs"],
  ["behind", "Behind back"],
  ["switch", "Switch"],
  ["high", "High dribble"],
];

type Board = { status: "loading" } | { status: "ok"; runs: RunRow[] } | { status: "offline" };

/** Title, results (initials) and leaderboard overlays on top of the game. */
export default function Screens() {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, hudStore.getSnapshot);
  const [board, setBoard] = useState<Board>({ status: "loading" });
  const [highlight, setHighlight] = useState<number | null>(null);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; runs?: RunRow[] };
      if (!res.ok || !data.runs) throw new Error("offline");
      setBoard({ status: "ok", runs: data.runs });
      hudStore.set({ topScore: data.runs[0]?.score ?? 0 });
    } catch {
      setBoard({ status: "offline" });
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: the board feeds HUD BEST as soon as the page loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBoard();
  }, [loadBoard]);

  const start = (mode: PlayMode) => {
    unlockAudio();
    runControl.start(mode);
  };
  const show = (screen: "title" | "leaderboard") => {
    if (screen === "leaderboard") void loadBoard();
    hudStore.set({ screen });
  };

  if (hud.screen === "play") return null;

  return (
    <div className={styles.overlay} data-testid={`screen-${hud.screen}`}>
      <div className={styles.halftone} aria-hidden />
      {hud.screen === "title" && <Title board={board} onStart={start} onBoard={() => show("leaderboard")} />}
      {hud.screen === "results" && hud.result && (
        <Results
          result={hud.result}
          onSaved={async (row) => {
            setHighlight(row.id);
            await loadBoard();
            hudStore.set({ screen: "leaderboard" });
          }}
          onSkip={() => show("title")}
        />
      )}
      {hud.screen === "leaderboard" && (
        <Leaderboard
          board={board}
          highlight={highlight}
          onPlay={() => start("session")}
          onBack={() => show("title")}
        />
      )}
    </div>
  );
}

function Title({
  board,
  onStart,
  onBoard,
}: {
  board: Board;
  onStart: (mode: PlayMode) => void;
  onBoard: () => void;
}) {
  const top = board.status === "ok" ? board.runs[0] : undefined;
  return (
    <section className={`${styles.panel} ${styles.titlePanel}`} aria-label="Title">
      <span className={styles.kicker}>体育館 · 放課後練習</span>
      <h1 className={styles.logoJp}>ドリブル道場</h1>
      <span className={styles.logoEn}>DRIBBLE DOJO</span>
      <div className={styles.menu}>
        <button className={styles.primary} onClick={() => onStart("session")} autoFocus data-testid="start-session">
          <span className={styles.btnMain}>60s SESSION</span>
          <span className={styles.btnSub}>Score at the buzzer goes on the board</span>
        </button>
        <button className={styles.button} onClick={() => onStart("practice")} data-testid="start-practice">
          <span className={styles.btnMain}>FREE PRACTICE</span>
          <span className={styles.btnSub}>No clock · nothing saved · Esc to leave</span>
        </button>
        <button className={styles.button} onClick={onBoard} data-testid="open-leaderboard">
          <span className={styles.btnMain}>LEADERBOARD</span>
          <span className={styles.btnSub}>
            {top ? `Top: ${top.initials} · ${fmt.format(top.score)}` : board.status === "offline" ? "Offline" : "Top 10, all-time"}
          </span>
        </button>
      </div>
    </section>
  );
}

function Results({
  result,
  onSaved,
  onSkip,
}: {
  result: SessionResult;
  onSaved: (row: RunRow) => Promise<void>;
  onSkip: () => void;
}) {
  const [letters, setLetters] = useState(["A", "A", "A"]);
  const [slot, setSlot] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const submit = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initials: letters.join(""), score: result.score, bestCombo: result.bestCombo }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: RunRow; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error ?? `HTTP ${res.status}`);
      await onSaved(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      sendingRef.current = false;
      setSending(false);
    }
  }, [letters, result, onSaved]);

  // NBA Jam entry: ↑/↓ spin the letter, ←/→ pick the slot, or just type.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const spin = (by: number) =>
        setLetters((l) => l.map((c, i) => (i === slot ? LETTERS[(LETTERS.indexOf(c) + by + 26) % 26] : c)));
      if (/^Key[A-Z]$/.test(e.code)) {
        const c = e.code.slice(3);
        setLetters((l) => l.map((x, i) => (i === slot ? c : x)));
        setSlot((s) => Math.min(2, s + 1));
      } else if (e.code === "ArrowUp") spin(1);
      else if (e.code === "ArrowDown") spin(-1);
      else if (e.code === "ArrowLeft" || e.code === "Backspace") setSlot((s) => Math.max(0, s - 1));
      else if (e.code === "ArrowRight") setSlot((s) => Math.min(2, s + 1));
      else if (e.code === "Enter") void submit();
      else if (e.code === "Escape") onSkip();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slot, submit, onSkip]);

  const used = MOVE_LABELS.filter(([k]) => result.moveCounts[k]);

  return (
    <section className={`${styles.panel} ${styles.resultsPanel}`} aria-label="Results">
      <span className={styles.burst}>タイムアップ!! TIME UP!!</span>
      <div className={styles.final}>
        <span className={styles.statLabel}>FINAL SCORE</span>
        <span className={styles.finalScore} data-testid="result-score">
          {fmt.format(result.score)}
        </span>
      </div>
      <div className={styles.stats}>
        <div>
          <span className={styles.statLabel}>BEST COMBO</span>
          <span className={styles.statValue} data-testid="result-combo">
            ×{result.bestCombo}
          </span>
        </div>
        <div>
          <span className={styles.statLabel}>MOVES</span>
          <span className={styles.statValue} data-testid="result-moves">
            {result.moves}
          </span>
        </div>
      </div>
      <ul className={styles.moveList}>
        {used.length === 0 && <li>No moves — try J, I, L!</li>}
        {used.map(([k, label]) => (
          <li key={k}>
            {label} <b>×{result.moveCounts[k]}</b>
          </li>
        ))}
      </ul>

      <span className={styles.statLabel}>ENTER YOUR INITIALS</span>
      <div className={styles.initials} data-testid="initials">
        {letters.map((c, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className={i === slot ? styles.letterActive : styles.letter}
            onClick={() => setSlot(i)}
          >
            <span aria-hidden>▲</span>
            {c}
            <span aria-hidden>▼</span>
          </button>
        ))}
      </div>
      <span className={styles.hint}>Type A–Z or ↑↓ ←→ · Enter to submit · Esc to skip</span>
      {error && (
        <span className={styles.error} role="alert">
          Couldn&apos;t save: {error}
        </span>
      )}
      <div className={styles.row}>
        <button
          type="button"
          tabIndex={-1}
          className={styles.primary}
          disabled={sending}
          onClick={() => void submit()}
          data-testid="submit-run"
        >
          <span className={styles.btnMain}>{sending ? "SAVING…" : "SUBMIT"}</span>
        </button>
        <button type="button" tabIndex={-1} className={styles.button} onClick={onSkip}>
          <span className={styles.btnMain}>SKIP</span>
        </button>
      </div>
    </section>
  );
}

function Leaderboard({
  board,
  highlight,
  onPlay,
  onBack,
}: {
  board: Board;
  highlight: number | null;
  onPlay: () => void;
  onBack: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.code === "Escape" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <section className={`${styles.panel} ${styles.boardPanel}`} aria-label="Leaderboard">
      <span className={styles.kicker}>全国ランキング</span>
      <h2 className={styles.boardTitle}>TOP {RUNS.top}</h2>
      {board.status === "loading" && <p className={styles.empty}>Loading…</p>}
      {board.status === "offline" && <p className={styles.empty}>LEADERBOARD OFFLINE — the database is unreachable.</p>}
      {board.status === "ok" && board.runs.length === 0 && <p className={styles.empty}>No runs yet. Be the first!</p>}
      {board.status === "ok" && board.runs.length > 0 && (
        <table className={styles.table} data-testid="leaderboard">
          <thead>
            <tr>
              <th>#</th>
              <th>NAME</th>
              <th>SCORE</th>
              <th>COMBO</th>
            </tr>
          </thead>
          <tbody>
            {board.runs.map((r, i) => (
              <tr key={r.id} className={r.id === highlight ? styles.mine : undefined} data-run-id={r.id}>
                <td>{i + 1}</td>
                <td className={styles.name}>{r.initials}</td>
                <td>{fmt.format(r.score)}</td>
                <td>×{r.bestCombo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.primary} onClick={onPlay} autoFocus>
          <span className={styles.btnMain}>PLAY SESSION</span>
        </button>
        <button type="button" className={styles.button} onClick={onBack} data-testid="board-back">
          <span className={styles.btnMain}>TITLE</span>
        </button>
      </div>
    </section>
  );
}
