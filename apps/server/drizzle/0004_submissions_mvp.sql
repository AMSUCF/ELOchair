CREATE TABLE "agreement_acks" (
	"person_id" uuid NOT NULL,
	"conference_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_acks_person_id_conference_id_key_version_pk" PRIMARY KEY("person_id","conference_id","key","version")
);
--> statement-breakpoint
CREATE TABLE "invitation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "invitation_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_status_check";--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "invited_email" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "invited_name" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "invited_affiliation" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "bios" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Keep existing single-language bios (assumed English).
UPDATE "people" SET "bios" = jsonb_build_object('en', "bio") WHERE "bio" IS NOT NULL AND "bio" <> '';--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "owner_person_id" uuid;--> statement-breakpoint
-- Existing submissions belong to their first contributor.
UPDATE "submissions" s SET "owner_person_id" = (
  SELECT c."person_id" FROM "contributions" c WHERE c."submission_id" = s."id" ORDER BY c."position" LIMIT 1
);--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "owner_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "participation_mode" text;--> statement-breakpoint
ALTER TABLE "agreement_acks" ADD CONSTRAINT "agreement_acks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acks" ADD CONSTRAINT "agreement_acks_conference_id_conferences_id_fk" FOREIGN KEY ("conference_id") REFERENCES "public"."conferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_tokens_target_idx" ON "invitation_tokens" USING btree ("submission_id","person_id");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_invited_email_idx" ON "contributions" USING btree ("invited_email","invited_at");--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_status_check" CHECK ("contributions"."status" in ('invited','confirmed','declined'));