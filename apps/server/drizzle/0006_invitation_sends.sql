CREATE TABLE "invitation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"submission_id" uuid,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invitation_sends_kind_check" CHECK ("invitation_sends"."kind" in ('invite','resend'))
);
--> statement-breakpoint
ALTER TABLE "invitation_sends" ADD CONSTRAINT "invitation_sends_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_sends" ADD CONSTRAINT "invitation_sends_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_sends_owner_idx" ON "invitation_sends" USING btree ("owner_person_id","sent_at");--> statement-breakpoint
CREATE INDEX "invitation_sends_recipient_idx" ON "invitation_sends" USING btree ("recipient_person_id","sent_at");