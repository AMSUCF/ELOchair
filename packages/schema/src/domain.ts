import { z } from "zod";
import { ContributionRole, Key } from "./config";
import { LanguageCode } from "./i18n";
import { MAIL_LANGUAGES } from "./messages";

export const Id = z.uuid();

export const Person = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string().min(1).nullable(),
  orcid: z
    .string()
    .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, "expected an ORCID iD like 0000-0002-1825-0097")
    .nullable(),
  affiliation: z.string().nullable(),
  /** ISO 3166-1 alpha-2 */
  country: z.string().length(2).nullable(),
  languages: z.array(LanguageCode),
  /** Bios per language ({ en: "...", es: "..." }); kept on the person, never on submissions. */
  bios: z.record(LanguageCode, z.string()),
  pronouns: z.string().nullable(),
});
export type Person = z.infer<typeof Person>;

export const SubmissionStatus = z.enum([
  "draft",
  "submitted",
  "withdrawn",
  "accepted",
  "waitlisted",
  "rejected",
  "confirmed",
  "published",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

export const FieldValue = z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]);
export type FieldValue = z.infer<typeof FieldValue>;

/** How a contributor intends to take part; required when the conference is hybrid. */
export const ParticipationMode = z.enum(["in_person", "online", "undecided"]);
export type ParticipationMode = z.infer<typeof ParticipationMode>;

export const Submission = z.object({
  id: Id,
  conferenceId: Id,
  /** The person who created it: the only one who may change it. Never changes in this phase. */
  ownerPersonId: Id,
  /** Increases on every change; writes must send the version they edited. */
  version: z.int().min(1),
  typeKey: Key,
  trackKey: Key.nullable(),
  topicKeys: z.array(Key),
  language: LanguageCode,
  title: z.string(),
  abstract: z.string(),
  fields: z.record(Key, FieldValue),
  participationMode: ParticipationMode.nullable(),
  status: SubmissionStatus,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Submission = z.infer<typeof Submission>;

/**
 * The owner is confirmed on creation. Co-authors are invited until they confirm. Declining (or
 * leaving) keeps the row as "declined": it is evidence, and the invitation conflict stays.
 */
export const ContributionStatus = z.enum(["invited", "confirmed", "declined"]);
export type ContributionStatus = z.infer<typeof ContributionStatus>;

export const Contribution = z.object({
  submissionId: Id,
  personId: Id,
  role: ContributionRole,
  /** Order in the author list, starting at 0. */
  position: z.int().min(0),
  status: ContributionStatus,
  /**
   * What the owner typed when inviting. Until the person confirms, every view shows these and
   * never their profile, so an invitation reveals nothing about existing accounts.
   */
  invitedEmail: z.string().nullable(),
  invitedName: z.string().nullable(),
  invitedAffiliation: z.string().nullable(),
});
export type Contribution = z.infer<typeof Contribution>;

export const ReviewerProfile = z.object({
  conferenceId: Id,
  personId: Id,
  pools: z.array(Key).min(1),
  expertise: z.array(z.string()),
  languages: z.array(LanguageCode).min(1),
  maxLoad: z.int().min(0),
});
export type ReviewerProfile = z.infer<typeof ReviewerProfile>;

export const ConflictKind = z.enum(["self", "coauthor", "institution", "declared", "other"]);

/** A reviewer (or chair) may not judge a submission, or anything by a given person. */
export const Conflict = z
  .object({
    id: Id,
    conferenceId: Id,
    personId: Id,
    submissionId: Id.nullable(),
    otherPersonId: Id.nullable(),
    kind: ConflictKind,
    declaredBy: z.enum(["reviewer", "chair", "system"]),
  })
  .refine((c) => c.submissionId !== null || c.otherPersonId !== null, {
    message: "a conflict names a submission or a person",
  });
export type Conflict = z.infer<typeof Conflict>;

export const Assignment = z.object({
  id: Id,
  conferenceId: Id,
  reviewerId: Id,
  submissionId: Id,
  createdAt: z.iso.datetime({ offset: true }),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Assignment = z.infer<typeof Assignment>;

/** Per-conference role grants. Scope narrows track chairs to tracks and reviewers to pools. */
export const ConferenceRole = z.enum(["admin", "chair", "track_chair", "reviewer"]);
export type ConferenceRole = z.infer<typeof ConferenceRole>;

export const RoleGrant = z.object({
  conferenceId: Id,
  role: ConferenceRole,
  /** Track keys for track_chair, pool keys for reviewer; empty means unscoped. */
  scope: z.array(Key),
});
export type RoleGrant = z.infer<typeof RoleGrant>;

/**
 * The roles a chair can invite someone to (spec 03, §1.2). Track chairs are not part of this
 * version, and `admin` means nothing more than `chair`: neither is ever offered.
 */
export const InvitableRole = z.enum(["reviewer", "chair"]);
export type InvitableRole = z.infer<typeof InvitableRole>;

/**
 * The roles a chair can take away on the People page, as that page shows them: a chair is
 * anyone with the `chair` or the `admin` role, and removing one removes both.
 */
export const RemovableRole = z.enum(["chair", "reviewer", "track_chair"]);
export type RemovableRole = z.infer<typeof RemovableRole>;

/**
 * An invitation to a role at a conference, sent to an address by a chair. It holds what the
 * chair typed and nothing from anyone's profile: until it is accepted, every view shows it from
 * these fields only, so that it reads the same whether or not the address has an account.
 * `personId` is the one person row of that address, which is who the role goes to on acceptance,
 * whoever opens the link. The link's token is not part of this record: the server keeps its hash.
 */
export const RoleInvitation = z.object({
  id: Id,
  conferenceId: Id,
  personId: Id,
  role: InvitableRole,
  /** Review pool keys for a reviewer; empty for a chair. */
  pools: z.array(Key),
  /** The address as the chair typed it, lowercased. */
  invitedEmail: z.string(),
  /** A name the chair typed, for the chairs' own list. Never mailed, never put in a profile. */
  invitedName: z.string().nullable(),
  /** The language of the email. */
  lang: z.enum(MAIL_LANGUAGES),
  /** When the invitation was last sent, and until when its link works. */
  sentAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  answer: z.enum(["accepted", "declined"]).nullable(),
  answeredAt: z.iso.datetime({ offset: true }).nullable(),
  cancelledAt: z.iso.datetime({ offset: true }).nullable(),
});
export type RoleInvitation = z.infer<typeof RoleInvitation>;

/** Where an invitation stands. "expired" is a waiting one whose link no longer works. */
export type RoleInvitationState = "waiting" | "expired" | "accepted" | "declined" | "cancelled";

/**
 * An accepted invitation stays accepted: the role it gave is removed, not the invitation. Any
 * other one that a chair cancelled is cancelled, a declined one included (cancelling is how a
 * chair takes it off the list). What is left is declined, or waiting until it expires.
 */
export function roleInvitationState(
  inv: Pick<RoleInvitation, "answer" | "cancelledAt" | "expiresAt">,
  now: Date,
): RoleInvitationState {
  if (inv.answer === "accepted") return "accepted";
  if (inv.cancelledAt) return "cancelled";
  if (inv.answer === "declined") return "declined";
  return new Date(inv.expiresAt).getTime() > now.getTime() ? "waiting" : "expired";
}
