CREATE TABLE "role_invitation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"conference_id" uuid,
	"invitation_id" uuid,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_invitation_sends_kind_check" CHECK ("role_invitation_sends"."kind" in ('invite','resend'))
);
--> statement-breakpoint
CREATE TABLE "role_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conference_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"pools" text[] DEFAULT '{}'::text[] NOT NULL,
	"invited_email" text NOT NULL,
	"invited_name" text,
	"lang" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"answer" text,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "role_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "role_invitations_role_check" CHECK ("role_invitations"."role" in ('reviewer','chair')),
	CONSTRAINT "role_invitations_lang_check" CHECK ("role_invitations"."lang" in ('en','es','pt')),
	CONSTRAINT "role_invitations_answer_check" CHECK ("role_invitations"."answer" in ('accepted','declined')),
	CONSTRAINT "role_invitations_answered_check" CHECK (("role_invitations"."answer" is null) = ("role_invitations"."answered_at" is null)),
	CONSTRAINT "role_invitations_pools_check" CHECK (("role_invitations"."role" = 'reviewer' and cardinality("role_invitations"."pools") >= 1) or ("role_invitations"."role" = 'chair' and cardinality("role_invitations"."pools") = 0))
);
--> statement-breakpoint
ALTER TABLE "role_invitation_sends" ADD CONSTRAINT "role_invitation_sends_inviter_person_id_people_id_fk" FOREIGN KEY ("inviter_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_invitation_sends" ADD CONSTRAINT "role_invitation_sends_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_invitations" ADD CONSTRAINT "role_invitations_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_invitations" ADD CONSTRAINT "role_invitations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_invitations" ADD CONSTRAINT "role_invitations_invited_by_person_id_people_id_fk" FOREIGN KEY ("invited_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_invitation_sends_inviter_idx" ON "role_invitation_sends" USING btree ("inviter_person_id","sent_at");--> statement-breakpoint
CREATE INDEX "role_invitation_sends_recipient_idx" ON "role_invitation_sends" USING btree ("recipient_person_id","sent_at");--> statement-breakpoint
CREATE INDEX "role_invitations_conference_idx" ON "role_invitations" USING btree ("conference_id","invited_email");--> statement-breakpoint
CREATE INDEX "role_invitations_person_idx" ON "role_invitations" USING btree ("person_id");