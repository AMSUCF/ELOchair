CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by_person_id" uuid,
	"comments" jsonb,
	CONSTRAINT "decisions_outcome_check" CHECK ("decisions"."outcome" in ('accepted','waitlisted','rejected')),
	CONSTRAINT "decisions_sent_check" CHECK (("decisions"."sent_at" is null) = ("decisions"."comments" is null))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_person_id_people_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_sent_by_person_id_people_id_fk" FOREIGN KEY ("sent_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_one_waiting" ON "decisions" USING btree ("submission_id") WHERE "decisions"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "decisions_conference_idx" ON "decisions" USING btree ("conference_id","sent_at");--> statement-breakpoint
CREATE INDEX "decisions_submission_idx" ON "decisions" USING btree ("submission_id");