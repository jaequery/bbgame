import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Trivial first table: proves migrations run.
export const appMeta = pgTable("app_meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One finished 60-second Session, as submitted from the results screen.
export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    initials: varchar("initials", { length: 3 }).notNull(),
    score: integer("score").notNull(),
    bestCombo: integer("best_combo").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("runs_score_idx").on(t.score.desc(), t.createdAt)],
);
