CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"initials" varchar(3) NOT NULL,
	"score" integer NOT NULL,
	"best_combo" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runs_score_idx" ON "runs" USING btree ("score" DESC NULLS LAST,"created_at");