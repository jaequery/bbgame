import { asc, desc } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { runs } from "@/db/schema";
import { parseRun, RUNS, type RunRow } from "@/lib/runs";

// Simple per-IP limiter. In-memory, so on Vercel each function instance keeps its
// own window — enough to stop a stuck key or a naive script, not a determined one.
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const { max, windowMs } = RUNS.rateLimit;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  const limited = recent.length >= max;
  if (!limited) recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return limited;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

const toRow = (r: typeof runs.$inferSelect): RunRow => ({
  id: r.id,
  initials: r.initials,
  score: r.score,
  bestCombo: r.bestCombo,
  createdAt: r.createdAt.toISOString(),
});

const dbError = (err: unknown) => {
  console.error("[api/runs]", err);
  return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
};

/** Top 10, all-time: highest score first, the earlier run wins a tie. */
export async function GET() {
  await connection();
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "database unconfigured" }, { status: 503 });
  try {
    const rows = await db.select().from(runs).orderBy(desc(runs.score), asc(runs.createdAt)).limit(RUNS.top);
    return Response.json({ ok: true, runs: rows.map(toRow) });
  } catch (err) {
    return dbError(err);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const run = parseRun(body);
  if (typeof run === "string") return Response.json({ ok: false, error: run }, { status: 400 });

  if (rateLimited(clientIp(req), Date.now())) {
    return Response.json({ ok: false, error: "too many runs — wait a minute" }, { status: 429 });
  }

  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "database unconfigured" }, { status: 503 });
  try {
    const [row] = await db.insert(runs).values(run).returning();
    return Response.json({ ok: true, run: toRow(row) }, { status: 201 });
  } catch (err) {
    return dbError(err);
  }
}
