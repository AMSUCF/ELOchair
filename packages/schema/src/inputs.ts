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

const CONTROL = /[\u0000-\u001f\u007f]/;

/** One line of text, trimmed, without control characters. */
export const OneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL.test(s), "one line of text, without control characters");

/** Free text up to `max` characters (newlines allowed). */
const Text = (max: number) => z.string().max(max);

export { LIMITS };

const Version = z.int().min(1);

const BoundedFieldValue = FieldValue.refine(
  (v) =>
    typeof v === "string"
      ? v.length <= LIMITS.fieldText
      : Array.isArray(v)
        ? v.length <= LIMITS.fieldItems && v.every((x) => x.length <= LIMITS.fieldText)
        : true,
  `field values are limited to ${LIMITS.fieldText} characters`,
);

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
  })
  .strict();

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
      .record(LanguageCode, z.string().max(LIMITS.bio))
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
