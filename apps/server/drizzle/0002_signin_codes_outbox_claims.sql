DROP INDEX "outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "login_tokens" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("sent_at","next_attempt_at");