import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | null = null;
let db: Db | null = null;

/**
 * Lazily connects on first use so `next build` and the game page never need a
 * database. Returns null when DATABASE_URL is not configured.
 */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!db) {
    client = postgres(url, { max: 5, connect_timeout: 3, idle_timeout: 20 });
    db = drizzle(client, { schema });
  }
  return db;
}
