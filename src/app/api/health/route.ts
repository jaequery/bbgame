import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";

export async function GET() {
  await connection();
  const db = getDb();
  if (!db) {
    return Response.json({ ok: false, db: "unconfigured" }, { status: 503 });
  }
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "ok" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, db: "down", error: message }, { status: 503 });
  }
}
