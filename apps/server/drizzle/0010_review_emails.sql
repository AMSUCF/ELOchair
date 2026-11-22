CREATE TABLE "notification_choices" (
	"person_id" uuid NOT NULL,
	"conference_id" uuid NOT NULL,
	"assignments" text DEFAULT 'daily' NOT NULL,
	"reminder" boolean DEFAULT true NOT NULL,
	"chair_notices" text DEFAULT 'daily' NOT NULL,
	CONSTRAINT "notification_choices_person_id_conference_id_pk" PRIMARY KEY("person_id","conference_id"),
	CONSTRAINT "notification_choices_assignments_check" CHECK ("notification_choices"."assignments" in ('each','daily','none')),
	CONSTRAINT "notification_choices_chair_notices_check" CHECK ("notification_choices"."chair_notices" in ('each','daily','none'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('assigned','declined','reviews_complete')),
	CONSTRAINT "notifications_reason_check" CHECK ("notifications"."reason" in ('conflict','expertise','time')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('pending','sent','dropped')),
	CONSTRAINT "notifications_done_check" CHECK (("notifications"."status" = 'pending') = ("notifications"."done_at" is null))
);
--> statement-breakpoint
CREATE TABLE "review_reminders" (
	"conference_id" uuid NOT NULL,
	"reviews_due" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "review_reminders_conference_id_reviews_due_pk" PRIMARY KEY("conference_id","reviews_due")
);
--> statement-breakpoint
ALTER TABLE "notification_choices" ADD CONSTRAINT "notification_choices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_choices" ADD CONSTRAINT "notification_choices_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reminders" ADD CONSTRAINT "review_reminders_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","conference_id");