import { z } from "zod";
import { ContributionRole, Key } from "./config";
import { FieldValue, Id, InvitableRole, ParticipationMode, SubmissionStatus } from "./domain";
import { LanguageCode } from "./i18n";
import { hasStrayInvisible } from "./invisible";
import { LIMITS, ROLE_INVITATIONS } from "./limits";
import { MAIL_LANGUAGES } from "./messages";
import { DECLINE_REASONS, RECOMMENDATIONS } from "./reviewForm";

/*
 * What clients may send. Every write input is .strict(): unknown keys (such as "email" on a
 * profile, or "ownerPersonId" on a submission) are refused, never silently dropped.
 * Character caps bound storage even for drafts, which skip word-limit validation.
 */

/**
 * Characters a one-line name must not contain: control characters (newlines, tabs, NUL...) and
 * the Unicode line and paragraph separators. Invisible format characters (bidi overrides,
 * zero-width spaces, byte-order marks, soft hyphens) are refused by hasStrayInvisible().
 */
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/** A letter or digit that shows on screen (Hangul fillers are letters, but invisible). */
const VISIBLE_LETTER = /(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{N}]/u;

/**
 * Unpaired UTF-16 surrogates: half a character, which is no text at all. Postgres refuses them
 * inside JSON (a 500 instead of a 400) and turns them into U+FFFD in text columns.
 */
const isWellFormed = (s: string) => !/\p{Cs}/u.test(s);
const WELL_FORMED = "text without broken characters (unpaired UTF-16 surrogates)";

/** One line of text, trimmed, with at least one visible letter or digit and nothing invisible. */
export const OneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isWellFormed, WELL_FORMED)
    .refine(
      // Format characters are refused except joiners inside words and emoji and the three
      // standard subdivision flags (see invisible.ts).
      (s) => !NOT_ONE_LINE.test(s) && !hasStrayInvisible(s),
      "one line of text, without control or invisible formatting characters",
    )
    .refine((s) => VISIBLE_LETTER.test(s), "at least one letter or digit");

/** Control characters other than tab, line feed and carriage return (NUL, escape, ...). */
const hasStrayControl = (s: string) => /\p{Cc}/u.test(s.replace(/[\t\n\r]/g, ""));
const NO_CONTROL = "text without control characters (other than tabs and line breaks)";

/** Free text up to `max` characters (newlines and tabs allowed; other control characters not). */
const Text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !hasStrayControl(s), NO_CONTROL)
    .refine(isWellFormed, WELL_FORMED);

export { LIMITS, ROLE_INVITATIONS };

const Version = z.int().min(1);

/** Whether every string in a field value (the value itself, or each item of a list) passes. */
const everyString = (v: FieldValue, ok: (s: string) => boolean) =>
  typeof v === "string" ? ok(v) : Array.isArray(v) ? v.every(ok) : true;

const BoundedFieldValue = FieldValue.refine(
  (v) =>
    (!Array.isArray(v) || v.length <= LIMITS.fieldItems) &&
    everyString(v, (s) => s.length <= LIMITS.fieldText),
  `field values are limited to ${LIMITS.fieldText} characters`,
)
  .refine((v) => everyString(v, (s) => !hasStrayControl(s)), NO_CONTROL)
  .refine((v) => everyString(v, isWellFormed), WELL_FORMED);

export const CreateSubmissionInput = z
  .object({
    typeKey: Key,
    /** Language of the abstract: one of the conference's languages. */
    language: LanguageCode,
    /** The owner's own program role; the owner need not be the lead. */
    ownRole: ContributionRole.default("lead"),
    participationMode: ParticipationMode.optional(),
  })
  .strict();
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionInput>;

export const UpdateSubmissionInput = z
  .object({
    version: Version,
    typeKey: Key.optional(),
    title: Text(LIMITS.title).optional(),
    abstract: Text(LIMITS.abstractCeiling).optional(),
    trackKey: Key.nullable().optional(),
    topicKeys: z.array(Key).max(30).optional(),
    language: LanguageCode.optional(),
    fields: z.record(Key, BoundedFieldValue).optional(),
    participationMode: ParticipationMode.nullable().optional(),
  })
  .strict();
export type UpdateSubmissionInput = z.infer<typeof UpdateSubmissionInput>;

export const AcceptedAgreements = z
  .array(z.object({ key: Key, version: z.string().min(1).max(40) }).strict())
  .max(20);

export const SubmitInput = z
  .object({ version: Version, acceptedAgreements: AcceptedAgreements.default([]) })
  .strict();

export const VersionInput = z.object({ version: Version }).strict();

/** Invite a co-author. "lead" is not offered: the lead is chosen among confirmed people. */
export const InviteInput = z
  .object({
    version: Version,
    email: z.email().max(254),
    role: ContributionRole.exclude(["lead"]),
    name: OneLine(LIMITS.name).optional(),
    affiliation: OneLine(LIMITS.affiliation).optional(),
    /** Language for the invitation email. */
    lang: z.enum(["en", "es", "pt"]),
  })
  .strict();
export type InviteInput = z.infer<typeof InviteInput>;

export const ContributorChangeInput = z
  .object({
    version: Version,
    role: ContributionRole.optional(),
    position: z.int().min(0).max(50).optional(),
  })
  .strict();

export const AnswerInvitationInput = z
  .object({
    answer: z.enum(["confirm", "decline"]),
    acceptedAgreements: AcceptedAgreements.default([]),
    /** The invitee's own name for their profile, if they have none yet (their own words). */
    displayName: OneLine(LIMITS.name).optional(),
  })
  .strict();

export const AnswerByTokenInput = AnswerInvitationInput.extend({
  token: z.string().min(20).max(200),
}).strict();

export const InvitationTokenInput = z.object({ token: z.string().min(20).max(200) }).strict();

const distinct = (list: readonly string[]) => new Set(list).size === list.length;

/**
 * A chair invites one address to a role (spec 03, §1.2). A reviewer is invited to one or more of
 * the conference's review pools; a chair to none. `name` is for the chairs' own list: it is
 * never mailed and never written to anyone's profile.
 */
export const RoleInvitationInput = z
  .object({
    email: z.email().max(254),
    name: OneLine(LIMITS.name).optional(),
    role: InvitableRole,
    pools: z.array(Key).max(50).refine(distinct, "each pool once").default([]),
    /** Language of the invitation email. */
    lang: z.enum(MAIL_LANGUAGES),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === "reviewer" && v.pools.length === 0) {
      ctx.addIssue({ code: "custom", path: ["pools"], message: "a reviewer needs a review pool" });
    }
    if (v.role === "chair" && v.pools.length > 0) {
      ctx.addIssue({ code: "custom", path: ["pools"], message: "a chair has no review pools" });
    }
  });
export type RoleInvitationInput = z.infer<typeof RoleInvitationInput>;

/**
 * An answer to a role invitation, by its link. Nothing here says who answers or what role is
 * given: the invitation the token belongs to decides both, and unknown keys are refused.
 * - `displayName`: the invitee's own name, needed to accept while their profile has none.
 * - `languages` and `maxLoad`: what a reviewer says on accepting (the languages they can review
 *   in, and the most proposals they will take). A chair's answer does not use them.
 */
export const RoleInvitationAnswerInput = z
  .object({
    token: z.string().min(20).max(200),
    answer: z.enum(["accept", "decline"]),
    displayName: OneLine(LIMITS.name).optional(),
    languages: z
      .array(z.enum(MAIL_LANGUAGES))
      .min(1)
      .max(MAIL_LANGUAGES.length)
      .refine(distinct, "each language once")
      .optional(),
    maxLoad: z.int().min(ROLE_INVITATIONS.minLoad).max(ROLE_INVITATIONS.maxLoad).optional(),
  })
  .strict();
export type RoleInvitationAnswerInput = z.infer<typeof RoleInvitationAnswerInput>;

/**
 * Removing a reviewer's role names the number of assigned proposals the confirmation showed:
 * the removal is refused (409 `stale`) if that is no longer the number, so that what is confirmed
 * is what the question said. Removing a chair or a track chair sends nothing.
 */
export const RoleRemovalInput = z
  .object({
    assignments: z.int().min(0).optional(),
    /**
     * How many of those proposals the confirmation said have a review of theirs that was sent:
     * those reviews and their assignments stay (spec 03, §1.2). Left out, it is none. Refused
     * the same way (409 `stale`) if it is no longer the number.
     */
    reviews: z.int().min(0).optional(),
  })
  .strict();

/**
 * A reviewer saves their review of a proposal (spec 03, §1.4). The proposal is named by the
 * address, and the reviewer is whoever is signed in: nothing here can name another.
 * - `version` is the version of the review the form was loaded with, 0 while there is none
 *   yet. A save on an older version is refused (409 `stale`), as for a proposal.
 * - `send` false keeps a draft, however incomplete; true sends the review to the chairs, which
 *   needs everything the form requires. A review that was sent can only be sent again.
 * - The whole content is sent every time: an answer left out is an answer taken back.
 * Character caps bound storage; the limits in words are the review form's, and the server's.
 */
export const ReviewInput = z
  .object({
    version: z.int().min(0),
    send: z.boolean(),
    // Any whole number: the scale it must be on is its criterion's, which the settings do not
    // bound, and is checked against the form (reviewContentIssues).
    scores: z
      .record(Key, z.int())
      .refine((v) => Object.keys(v).length <= 100, "at most 100 scores"),
    comments: Text(LIMITS.reviewText),
    chairNote: Text(LIMITS.reviewText),
    recommendation: z.enum(RECOMMENDATIONS).nullable(),
  })
  .strict();
export type ReviewInput = z.infer<typeof ReviewInput>;

/**
 * A reviewer says they cannot review a proposal (spec 03, §1.3): why, and a note for the chairs
 * if they want to add one.
 */
export const DeclineReviewInput = z
  .object({
    reason: z.enum(DECLINE_REASONS),
    note: Text(LIMITS.declineNote).optional(),
  })
  .strict();
export type DeclineReviewInput = z.infer<typeof DeclineReviewInput>;

/**
 * A chair assigns one reviewer to one proposal (spec 03, §1.3). The proposal is named by the
 * address. `confirmedFull` says the chair was shown that the reviewer has reached the number of
 * proposals they said they would take, and assigned them all the same: without it such a
 * reviewer is not assigned (409 `reviewer_full`), so that nobody goes over their number unasked.
 */
export const AssignReviewerInput = z
  .object({ reviewerId: Id, confirmedFull: z.boolean().optional() })
  .strict();
export type AssignReviewerInput = z.infer<typeof AssignReviewerInput>;

/** Your own profile. Email and id are not editable here; sending them is an error. */
export const ProfileInput = z
  .object({
    displayName: OneLine(LIMITS.name),
    affiliation: OneLine(LIMITS.affiliation).nullable(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, "a two-letter country code such as CO")
      .nullable(),
    languages: z.array(LanguageCode).max(10),
    pronouns: OneLine(LIMITS.pronouns).nullable(),
    orcid: z
      .string()
      .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, "an ORCID iD like 0000-0002-1825-0097")
      .nullable(),
    bios: z
      .record(LanguageCode, Text(LIMITS.bio))
      .refine((b) => Object.keys(b).length <= 5, "at most five languages"),
  })
  .strict();
export type ProfileInput = z.infer<typeof ProfileInput>;

const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item));
const flag = z.preprocess(
  (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : v),
  z.boolean(),
);

/**
 * A paging cursor: nextCursor from a previous page, opaque to clients. The server seals a
 * position in the conference's order into it, and refuses cursors it did not seal.
 */
export const PageCursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]{40,200}$/, "nextCursor from a previous page");

const assignmentsPageSize = z.coerce.number().int().min(1).max(200).default(50);

/**
 * The chairs' Assignments page (spec 03, §1.3): every pool, with the first `limit` of its
 * proposals.
 */
export const AssignmentsQuery = z.object({ limit: assignmentsPageSize }).strict();
export type AssignmentsQuery = z.infer<typeof AssignmentsQuery>;

/** A further page of one pool's proposals on that page. */
export const AssignmentsPoolQuery = z
  .object({
    /** nextCursor from the previous page of the same pool; empty means the first page. */
    cursor: z.union([z.literal(""), PageCursor]).optional(),
    limit: assignmentsPageSize,
  })
  .strict();
export type AssignmentsPoolQuery = z.infer<typeof AssignmentsPoolQuery>;

/** One query shape for the REST list, the CSV exports and the MCP tools. */
export const SubmissionQuery = z
  .object({
    status: list(SubmissionStatus.exclude(["draft"])).optional(),
    type: Key.optional(),
    track: Key.optional(),
    language: LanguageCode.optional(),
    participationMode: ParticipationMode.optional(),
    hasSelfIdWarnings: flag.optional(),
    hasPendingInvitations: flag.optional(),
    incomplete: flag.optional(),
    /** Title search; refused for viewers who cannot see titles. */
    q: z.string().trim().min(1).max(LIMITS.query).optional(),
    /** nextCursor from the previous page; empty means the first page. */
    cursor: z.union([z.literal(""), PageCursor]).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type SubmissionQuery = z.infer<typeof SubmissionQuery>;
