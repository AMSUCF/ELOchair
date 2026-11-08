import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Database tables. Shapes mirror packages/schema; change the Zod schema first, then this file,
 * then run `npm run db:generate -w @elochair/server` to write a migration.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Always stored lowercased. */
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  orcid: text("orcid"),
  affiliation: text("affiliation"),
  country: text("country"),
  languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
  bio: text("bio"),
  pronouns: text("pronouns"),
  siteAdmin: boolean("site_admin").notNull().default(false),
  createdAt: created(),
});

export const conferences = pgTable(
  "conferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    phase: text("phase").notNull().default("draft"),
    /** A validated ConferenceConfig. */
    config: jsonb("config").notNull(),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "conferences_phase_check",
      sql`${t.phase} in ('draft','cfp_open','reviewing','deciding','confirming','scheduling','published','archived')`,
    ),
  ],
);

export const conferenceRoles = pgTable(
  "conference_roles",
  {
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    scope: text("scope").array().notNull().default(sql`'{}'::text[]`),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.conferenceId, t.personId, t.role] }),
    check(
      "conference_roles_role_check",
      sql`${t.role} in ('admin','chair','track_chair','reviewer')`,
    ),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    typeKey: text("type_key").notNull(),
    trackKey: text("track_key"),
    topicKeys: text("topic_keys").array().notNull().default(sql`'{}'::text[]`),
    language: text("language").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    fields: jsonb("fields").notNull().default({}),
    status: text("status").notNull().default("draft"),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    submittedAt: ts("submitted_at"),
  },
  (t) => [index("submissions_conference_idx").on(t.conferenceId, t.status)],
);

export const contributions = pgTable(
  "contributions",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    role: text("role").notNull(),
    position: integer("position").notNull(),
    /** "invited" until the co-author confirms; the lead is "confirmed" from the start. */
    status: text("status").notNull().default("confirmed"),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.personId] }),
    check("contributions_status_check", sql`${t.status} in ('invited','confirmed')`),
    index("contributions_person_idx").on(t.personId),
  ],
);

export const reviewerProfiles = pgTable(
  "reviewer_profiles",
  {
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    pools: text("pools").array().notNull(),
    expertise: text("expertise").array().notNull().default(sql`'{}'::text[]`),
    languages: text("languages").array().notNull(),
    maxLoad: integer("max_load").notNull().default(8),
  },
  (t) => [primaryKey({ columns: [t.conferenceId, t.personId] })],
);

export const conflicts = pgTable(
  "conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
    otherPersonId: uuid("other_person_id").references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    declaredBy: text("declared_by").notNull(),
    createdAt: created(),
  },
  (t) => [
    check(
      "conflicts_target_check",
      sql`${t.submissionId} is not null or ${t.otherPersonId} is not null`,
    ),
    index("conflicts_person_idx").on(t.conferenceId, t.personId),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => people.id),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    createdAt: created(),
    dueAt: ts("due_at"),
  },
  (t) => [unique("assignments_reviewer_submission").on(t.reviewerId, t.submissionId)],
);

export const loginTokens = pgTable("login_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  /** SHA-256 of the token; the token itself is only ever in the email. */
  tokenHash: text("token_hash").notNull().unique(),
  lang: text("lang").notNull().default("en"),
  /** SHA-256 of email + the 8-digit code from the same email (for typing into an installed app). */
  codeHash: text("code_hash"),
  /** Wrong codes tried against this token; it stops accepting codes at the limit. */
  codeAttempts: integer("code_attempts").notNull().default(0),
  createdAt: created(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  createdAt: created(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
});

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: created(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [check("api_tokens_tier_check", sql`${t.tier} in ('M','C')`)],
);

/** Append-only: a trigger (see the custom migration) rejects UPDATE, DELETE and TRUNCATE. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorKind: text("actor_kind").notNull(),
    actorPersonId: uuid("actor_person_id"),
    tokenId: uuid("token_id"),
    conferenceId: uuid("conference_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [
    check("audit_actor_kind_check", sql`${t.actorKind} in ('human','agent_m','agent_c','system')`),
    index("audit_conference_idx").on(t.conferenceId, t.at),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    kind: text("kind").notNull(),
    createdAt: created(),
    sentAt: ts("sent_at"),
    attempts: integer("attempts").notNull().default(0),
    /** Set while a delivery pass owns the row, so overlapping passes never send twice. */
    claimedAt: ts("claimed_at"),
    /** Earliest time of the next attempt (exponential backoff after failures). */
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending_idx").on(t.sentAt, t.nextAttemptAt)],
);
