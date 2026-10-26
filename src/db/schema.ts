import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Trivial first table: proves migrations run. Later tickets add game tables
// (sessions, leaderboard) next to it.
export const appMeta = pgTable("app_meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
