"use client";

import { useEffect, useRef, useState } from "react";
import type { GameFonts } from "@/game/textures";
import styles from "./Game.module.css";

export default function Game({ fonts }: { fonts: GameFonts }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let disposed = false;
    let game: { dispose(): void } | null = null;
    // three.js is loaded on the client only, after hydration.
    import("@/game/createGame")
      .then(({ createGame }) => {
        if (disposed) return;
        game = createGame(container, fonts);
      })
      .catch((err: unknown) => {
        console.error(err);
        setError("WebGL is not available in this browser.");
      });
    return () => {
      disposed = true;
      game?.dispose();
    };
  }, [fonts]);

  return (
    <div ref={ref} className={styles.stage} data-testid="game-stage">
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
