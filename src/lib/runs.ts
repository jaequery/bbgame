// Shared by the /api/runs route and the client screens — no server imports here.

/** A leaderboard row as the API returns it. */
export interface RunRow {
  id: number;
  initials: string;
  score: number;
  bestCombo: number;
  createdAt: string;
}

export const RUNS = {
  /** Session length (seconds). */
  sessionSeconds: 60,
  /** Rows on the board. */
  top: 10,
  initials: /^[A-Z]{3}$/,
  /** Sanity bounds, far above anything a 60 s run can reach. */
  maxScore: 2_000_000,
  maxCombo: 1_000,
  /** Per-IP submissions allowed per window. */
  rateLimit: { max: 5, windowMs: 60_000 },
};

export type RunInput = Pick<RunRow, "initials" | "score" | "bestCombo">;

/** Returns the cleaned run, or an error message for a 400. */
export function parseRun(body: unknown): RunInput | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { initials, score, bestCombo } = body as Record<string, unknown>;
  if (typeof initials !== "string" || !RUNS.initials.test(initials)) return "initials must be 3 letters A-Z";
  if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > RUNS.maxScore) {
    return `score must be an integer 0-${RUNS.maxScore}`;
  }
  if (!Number.isInteger(bestCombo) || (bestCombo as number) < 0 || (bestCombo as number) > RUNS.maxCombo) {
    return `bestCombo must be an integer 0-${RUNS.maxCombo}`;
  }
  return { initials, score: score as number, bestCombo: bestCombo as number };
}
