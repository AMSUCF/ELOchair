import { z } from "zod";
import { ContributionRole, Key } from "./config";
import { FieldValue, ParticipationMode, SubmissionStatus } from "./domain";
import { LanguageCode } from "./i18n";
import { LIMITS } from "./limits";

/*
 * What clients may send. Every write input is .strict(): unknown keys (such as "email" on a
 * profile, or "ownerPersonId" on a submission) are refused, never silently dropped.
 * Character caps bound storage even for drafts, which skip word-limit validation.
 */

/**
 * Characters a one-line name must not contain: control characters (newlines, tabs, NUL...),
 * format characters (bidi overrides, zero-width spaces, byte-order marks, soft hyphens) and the
 * Unicode line and paragraph separators.
 */
const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/**
 * Zero-width (non-)joiners are how some scripts are spelled (Persian compound surnames, Indic
 * scripts) and how emoji sequences are built, so they are allowed between letters or
 * pictographs, and nowhere else. A skin tone counts as part of the pictograph before it: the
 * woman artist with a medium skin tone is U+1F469 U+1F3FD U+200D U+1F3A8.
 */
const JOINER_IN_WORD =
  /(?<=[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}])[\u200C\u200D](?=[\p{L}\p{M}\p{Extended_Pictographic}])/gu;
/**
 * The invisible tags of a subdivision flag (Scotland is the black flag U+1F3F4, then the tags
 * g b s c t and a cancel tag): a region's two letters, one to four letters or digits, and the
 * cancel tag, right after the black flag. Tags are otherwise refused, because they can spell
 * out hidden text.
 */
const SUBDIVISION_TAGS =
  /(?<=\u{1F3F4})[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,4}\u{E007F}/gu;
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
      (s) => !NOT_ONE_LINE.test(s.replace(SUBDIVISION_TAGS, "").replace(JOINER_IN_WORD, "")),
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

export { LIMITS };

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
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type SubmissionQuery = z.infer<typeof SubmissionQuery>;
