CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"chair_note" text DEFAULT '' NOT NULL,
	"recommendation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "reviews_submission_reviewer" UNIQUE("submission_id","reviewer_id"),
	CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" in ('draft','sent')),
	CONSTRAINT "reviews_recommendation_check" CHECK ("reviews"."recommendation" in ('accept','unsure','reject')),
	CONSTRAINT "reviews_sent_check" CHECK (("reviews"."status" = 'sent') = ("reviews"."sent_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "conferences" ADD COLUMN "review_began_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_people_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_conference_idx" ON "reviews" USING btree ("conference_id","status");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_idx" ON "reviews" USING btree ("reviewer_id");