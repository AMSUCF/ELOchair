CREATE TABLE "assignment_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"assignment_id" uuid NOT NULL,
	"assigned_by_person_id" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"released_by_person_id" uuid,
	"released_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "assignment_releases_reason_check" CHECK ("assignment_releases"."reason" in ('chair','conflict','expertise','time','role_removed'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "assigned_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD CONSTRAINT "assignment_releases_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD CONSTRAINT "assignment_releases_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD CONSTRAINT "assignment_releases_reviewer_id_people_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD CONSTRAINT "assignment_releases_assigned_by_person_id_people_id_fk" FOREIGN KEY ("assigned_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_releases" ADD CONSTRAINT "assignment_releases_released_by_person_id_people_id_fk" FOREIGN KEY ("released_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_releases_submission_idx" ON "assignment_releases" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "assignment_releases_conference_idx" ON "assignment_releases" USING btree ("conference_id");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_person_id_people_id_fk" FOREIGN KEY ("assigned_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;