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
  /** Bios per language: { "en": "...", "es": "..." }. */
  bios: jsonb("bios").notNull().default({}),
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
    /**
     * When the conference was first found in a phase in which its reviewers can read
     * (`reviewing` or a later one). Set once, by whatever gives a conference its phase
     * (repo.ts), and never cleared: a conference that is moved back out of review has still been
     * in review, and reviews of its proposals may have been sent. It says nothing that the
     * chairs do not know. Null for a conference that has never been in such a phase.
     */
    reviewBeganAt: ts("review_began_at"),
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
    /** The creator: the only person who may change the submission. */
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => people.id),
    /** Optimistic concurrency: increases on every change. */
    version: integer("version").notNull().default(1),
    typeKey: text("type_key").notNull(),
    trackKey: text("track_key"),
    topicKeys: text("topic_keys").array().notNull().default(sql`'{}'::text[]`),
    language: text("language").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    fields: jsonb("fields").notNull().default({}),
    participationMode: text("participation_mode"),
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
    /** invited → confirmed, or → declined (kept as evidence). The owner starts confirmed. */
    status: text("status").notNull().default("confirmed"),
    /** What the owner typed when inviting; shown instead of the profile until confirmed. */
    invitedEmail: text("invited_email"),
    invitedName: text("invited_name"),
    invitedAffiliation: text("invited_affiliation"),
    invitedAt: ts("invited_at"),
    /** Last time an invitation email went out (for the once-an-hour resend limit). */
    lastSentAt: ts("last_sent_at"),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.personId] }),
    check("contributions_status_check", sql`${t.status} in ('invited','confirmed','declined')`),
    index("contributions_invited_email_idx").on(t.invitedEmail, t.invitedAt),
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

/**
 * One reviewer on one proposal (spec 03, §1.3): at most one row for the two. The table holds
 * the assignments that stand, and nothing else, as it always has: whatever reads it reads the
 * ones that count, in this version of the app and in every earlier one. Taking a reviewer off a
 * proposal deletes the row and writes the record of it to `assignment_releases`, in the same
 * transaction.
 */
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
    /** The chair who made it. Null on rows from before this column, and on seeded ones. */
    assignedByPersonId: uuid("assigned_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (t) => [unique("assignments_reviewer_submission").on(t.reviewerId, t.submissionId)],
);

/**
 * The record of every assignment that was released (spec 03, §1.3): what the assignment was,
 * and when, why and by whom it ended. A row here gives nobody anything. It is read for three
 * things only, all in services/assignments.ts: that a proposal has had a reviewer (the guard on
 * anonymity, and the rule that such a proposal keeps its format), and who left a proposal
 * because of a conflict (never offered for it again).
 *
 * What survives what:
 * - The record of who reviewed a proposal goes with the proposal, as its assignments do
 *   (`submission_id`, cascade): an owner deleting a draft never fails on it, and nothing is left
 *   of a proposal that is gone.
 * - A person's deletion does not fail on it either, and does not take the record away: their
 *   id becomes null (`reviewer_id`, `assigned_by_person_id`, `released_by_person_id`), and the
 *   proposal keeps the fact that it has had a reviewer.
 * - `assignment_id` is the id the row in `assignments` had. That row is gone, so it is no
 *   foreign key.
 */
export const assignmentReleases = pgTable(
  "assignment_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => people.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").notNull(),
    assignedByPersonId: uuid("assigned_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    assignedAt: ts("assigned_at").notNull(),
    releasedByPersonId: uuid("released_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    releasedAt: ts("released_at").notNull(),
    reason: text("reason").notNull(),
    /**
     * What the reviewer wrote for the chairs when they said they could not review the proposal
     * (spec 03, §1.3). Null where they wrote nothing, and on every release that was not theirs.
     * It is a person's text: shown only to a chair who manages the proposal, never audited.
     */
    note: text("note"),
  },
  (t) => [
    check(
      "assignment_releases_reason_check",
      sql`${t.reason} in ('chair','conflict','expertise','time','role_removed')`,
    ),
    index("assignment_releases_submission_idx").on(t.submissionId),
    index("assignment_releases_conference_idx").on(t.conferenceId),
  ],
);

/**
 * One reviewer's review of one proposal (spec 03, §1.4): at most one row for the two. A draft
 * is its reviewer's own, and nothing a chair reads says that one exists; a sent review is read
 * by the chairs who manage the proposal.
 *
 * A review belongs to a proposal and a reviewer, not to a row of `assignments`: that row is
 * deleted when the assignment is released, which is what lets every version of the app read
 * `assignments` as the assignments that stand. What keeps the two in step is the code that
 * releases (services/assignments.ts): a release takes the reviewer's draft with it, and an
 * assignment whose review was sent is not released.
 *
 * What survives what:
 * - A review goes with its proposal and with its conference, as the proposal's assignments and
 *   their record do (`submission_id`, `conference_id`, cascade): an owner deleting a draft
 *   never fails on it, and nothing is left of a proposal that is gone.
 * - It does not go with its reviewer, and it does not lose them (`reviewer_id`, no action, as
 *   on `assignments`): a review is one person's judgement, in their words, and it neither
 *   vanishes nor becomes nobody's because a row of `people` was deleted. Whoever deletes a
 *   person decides first what becomes of their reviews.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => people.id),
    /** Optimistic concurrency, as for a proposal: increases on every save. */
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    /** A whole number for each criterion answered: { "<criterion key>": 4 }. */
    scores: jsonb("scores").notNull().default({}),
    /** For the authors. */
    comments: text("comments").notNull().default(""),
    /** For the chairs only. */
    chairNote: text("chair_note").notNull().default(""),
    recommendation: text("recommendation"),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    /** When it was first sent; null while it is a draft. */
    sentAt: ts("sent_at"),
  },
  (t) => [
    unique("reviews_submission_reviewer").on(t.submissionId, t.reviewerId),
    check("reviews_status_check", sql`${t.status} in ('draft','sent')`),
    check("reviews_recommendation_check", sql`${t.recommendation} in ('accept','unsure','reject')`),
    // Sent is said once: a sent review has the time it was sent, and a draft has none.
    check("reviews_sent_check", sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
    index("reviews_conference_idx").on(t.conferenceId, t.status),
    index("reviews_reviewer_idx").on(t.reviewerId),
  ],
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

/** Who acknowledged which version of a conference agreement, and when (consent records). */
export const agreementAcks = pgTable(
  "agreement_acks",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    version: text("version").notNull(),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.conferenceId, t.key, t.version] })],
);

/**
 * Every invitation email sent (first invitations and resends), for the daily abuse limits.
 * Server-internal and never projected. It holds IDs only, and nothing deletes from it:
 * removing an invitee or deleting a draft must not hand back the sender's or the recipient's
 * budget, so `submission_id` deliberately has no foreign key.
 */
export const invitationSends = pgTable(
  "invitation_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** One person row per normalized address, so this is the recipient address too. */
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id"),
    kind: text("kind").notNull(),
    sentAt: ts("sent_at").notNull(),
  },
  (t) => [
    check("invitation_sends_kind_check", sql`${t.kind} in ('invite','resend')`),
    index("invitation_sends_owner_idx").on(t.ownerPersonId, t.sentAt),
    index("invitation_sends_recipient_idx").on(t.recipientPersonId, t.sentAt),
  ],
);

/** Single-use links in invitation emails (stored as hashes, like sign-in tokens). */
export const invitationTokens = pgTable(
  "invitation_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    lang: text("lang").notNull().default("en"),
    createdAt: created(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [index("invitation_tokens_target_idx").on(t.submissionId, t.personId)],
);

/**
 * Invitations to a role at a conference (reviewer or chair), sent by a chair to an address
 * (spec 03, §1.2). A row holds what the chair typed, and nothing from anyone's profile.
 * - `person_id` is the one person row of the invited address: the role goes to that person when
 *   the invitation is accepted, whoever opens the link.
 * - The link's token is stored only as a hash. It works while the row is not answered, not
 *   cancelled and not expired; sending the invitation again puts a new hash in its place.
 * - Rows are kept: an answer or a cancellation is recorded on the row, never by deleting it.
 */
export const roleInvitations = pgTable(
  "role_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** Review pool keys for a reviewer; empty for a chair. */
    pools: text("pools").array().notNull().default(sql`'{}'::text[]`),
    /** What the chair typed: shown instead of the profile until the invitation is accepted. */
    invitedEmail: text("invited_email").notNull(),
    invitedName: text("invited_name"),
    /** The language of the email, chosen by the chair. */
    lang: text("lang").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** The chair who invited. Kept as null if that person's record is ever deleted. */
    invitedByPersonId: uuid("invited_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: created(),
    /** Last time the email went out (for the once-an-hour resend limit, and shown to chairs). */
    lastSentAt: ts("last_sent_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    answeredAt: ts("answered_at"),
    answer: text("answer"),
    cancelledAt: ts("cancelled_at"),
  },
  (t) => [
    check("role_invitations_role_check", sql`${t.role} in ('reviewer','chair')`),
    check("role_invitations_lang_check", sql`${t.lang} in ('en','es','pt')`),
    check("role_invitations_answer_check", sql`${t.answer} in ('accepted','declined')`),
    check(
      "role_invitations_answered_check",
      sql`(${t.answer} is null) = (${t.answeredAt} is null)`,
    ),
    // A reviewer is invited to at least one pool, a chair to none: an empty scope on a
    // reviewer's role would mean every pool.
    check(
      "role_invitations_pools_check",
      sql`(${t.role} = 'reviewer' and cardinality(${t.pools}) >= 1) or (${t.role} = 'chair' and cardinality(${t.pools}) = 0)`,
    ),
    index("role_invitations_conference_idx").on(t.conferenceId, t.invitedEmail),
    index("role_invitations_person_idx").on(t.personId),
  ],
);

/**
 * Every role invitation email sent (first invitations and resends), for the daily limits.
 * Server-internal and never projected. It holds IDs only, and nothing deletes from it:
 * cancelling an invitation must not hand back the inviting chair's or the recipient's budget,
 * so `conference_id` and `invitation_id` deliberately have no foreign key.
 */
export const roleInvitationSends = pgTable(
  "role_invitation_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterPersonId: uuid("inviter_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** One person row per normalized address, so this is the recipient address too. */
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    conferenceId: uuid("conference_id"),
    invitationId: uuid("invitation_id"),
    kind: text("kind").notNull(),
    sentAt: ts("sent_at").notNull(),
  },
  (t) => [
    check("role_invitation_sends_kind_check", sql`${t.kind} in ('invite','resend')`),
    index("role_invitation_sends_inviter_idx").on(t.inviterPersonId, t.sentAt),
    index("role_invitation_sends_recipient_idx").on(t.recipientPersonId, t.sentAt),
  ],
);

/**
 * A person's choices about the emails of the review phase at one conference (spec 03, §1.7):
 * at most one row for the two. No row means the defaults (DEFAULT_NOTIFICATION_CHOICES): one
 * summary a day, and the reminder. The first two choices are read while the person reviews
 * there, the third while they chair it; the row stays when a role goes, and means nothing then.
 */
export const notificationChoices = pgTable(
  "notification_choices",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    /** When proposals are assigned to them: each one, one summary a day, or none. */
    assignments: text("assignments").notNull().default("daily"),
    /** The one reminder before reviews are due. */
    reminder: boolean("reminder").notNull().default(true),
    /** For a chair, notices about reviewing: each one, one summary a day, or none. */
    chairNotices: text("chair_notices").notNull().default("daily"),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.conferenceId] }),
    check(
      "notification_choices_assignments_check",
      sql`${t.assignments} in ('each','daily','none')`,
    ),
    check(
      "notification_choices_chair_notices_check",
      sql`${t.chairNotices} in ('each','daily','none')`,
    ),
  ],
);

/**
 * Something a person is to be told about by email (spec 03, §1.7): written when it happens, in
 * the transaction of what caused it, and looked at afterwards by one job (services/
 * notifications.ts), which makes an email of it, or of several, as that person chose, or none.
 * IDs, a kind, a reason out of three and times: nothing a person typed.
 * - `assigned`: to a reviewer, a proposal was assigned to them;
 * - `declined`: to a chair, a reviewer gave a proposal back (`reason` says why);
 * - `reviews_complete`: to a chair, a proposal has all the reviews its committee asks for.
 * A row is `pending` until the job has decided: `sent` once an email that counts it is in the
 * outbox, `dropped` when none will be (the person chose no email, or it is no longer true). The
 * mark and the outbox row are written in one transaction, so a second run finds nothing to do.
 *
 * It goes with its conference, its proposal and its person (cascade): nothing is left to send
 * about what is gone, and deleting any of them never fails on it.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    /** Who is to be told. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The proposal it is about. Never named in an email: it is how the job checks it again. */
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** For `declined`: why the reviewer said they cannot review it. Null for the other kinds. */
    reason: text("reason"),
    createdAt: created(),
    status: text("status").notNull().default("pending"),
    /** When the job decided; null while the row is pending. */
    doneAt: ts("done_at"),
  },
  (t) => [
    check("notifications_kind_check", sql`${t.kind} in ('assigned','declined','reviews_complete')`),
    check("notifications_reason_check", sql`${t.reason} in ('conflict','expertise','time')`),
    check("notifications_status_check", sql`${t.status} in ('pending','sent','dropped')`),
    // Decided is said once: a row that is not pending has the time it was decided.
    check("notifications_done_check", sql`(${t.status} = 'pending') = (${t.doneAt} is null)`),
    index("notifications_pending_idx").on(t.status, t.conferenceId),
  ],
);

/**
 * Every reminder before reviews are due that has gone out: one row for a conference and the
 * day it was for (spec 03, §1.7), written in the transaction that puts the reminders in the
 * outbox. The reminder is decided once for all of a conference's reviewers together, so this is
 * all that has to be remembered. Rows are kept: a day that was reminded once is never reminded
 * again, also when the chairs move the day away and back. A day they have not had before is
 * another day.
 */
export const reviewReminders = pgTable(
  "review_reminders",
  {
    conferenceId: uuid("conference_id")
      .notNull()
      .references(() => conferences.id, { onDelete: "cascade" }),
    /** The day reviews were due when it went out. */
    reviewsDue: ts("reviews_due").notNull(),
    sentAt: ts("sent_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.conferenceId, t.reviewsDue] })],
);
