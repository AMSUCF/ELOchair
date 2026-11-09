import {
  type Assignment,
  type BlindMode,
  type Contribution,
  type ContributionRole,
  type ContributionStatus,
  countWords,
  type FieldValue,
  findType,
  isFilledValue,
  type Person,
  type Submission,
  type SubmissionIssue,
} from "@elochair/schema";
import { type Access, type SubmissionContext, submissionAccess } from "./access";
import { selfIdFindings, shownIdentity, submissionIssues } from "./derived";
import type { Viewer } from "./viewer";

/*
 * Projections: the only code that turns records into what a viewer may see.
 * Each output type is an explicit allow-list, so a new database column cannot leak by default.
 * Invitees appear as the owner typed them until they confirm, in every view, the chair's too.
 * Declined people appear only to chairs, and only as typed.
 */

export type PublicContributor = {
  displayName: string;
  affiliation: string | null;
  role: ContributionRole;
};

export type PublicSubmission = {
  view: "public";
  id: string;
  conferenceId: string;
  typeKey: string;
  trackKey: string | null;
  topicKeys: string[];
  language: string;
  title: string;
  abstract: string;
  fields: Record<string, FieldValue>;
  contributors: PublicContributor[];
};

/** Tier M: opaque IDs, enumerations, counts and dates. No free text, no names. */
export type MetadataSubmission = {
  view: "metadata";
  id: string;
  conferenceId: string;
  typeKey: string;
  trackKey: string | null;
  topicKeys: string[];
  language: string;
  participationMode: Submission["participationMode"];
  status: Submission["status"];
  abstractWords: number;
  filledFieldKeys: string[];
  contributors: {
    personId: string;
    role: ContributionRole;
    position: number;
    status: ContributionStatus;
  }[];
  /** Rule violations (codes only); non-empty on submitted work means "incomplete". */
  issueCodes: SubmissionIssue["code"][];
  selfIdWarningCount: number;
  /** Absent when the agent's owner is a contributor (they must not learn who reviews it). */
  assignedReviewerIds?: string[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
};

export type ReviewerSubmission = {
  view: "reviewer";
  blindMode: BlindMode;
  id: string;
  conferenceId: string;
  typeKey: string;
  trackKey: string | null;
  topicKeys: string[];
  language: string;
  title: string;
  abstract: string;
  fields: Record<string, FieldValue>;
  /** Confirmed contributors only; absent in double-blind review. Never includes email. */
  contributors?: {
    displayName: string;
    affiliation: string | null;
    role: ContributionRole;
    bios?: Record<string, string>;
  }[];
};

export type SubmitterContributor = {
  personId: string;
  role: ContributionRole;
  position: number;
  status: ContributionStatus;
  isOwner: boolean;
  displayName: string | null;
  affiliation: string | null;
  /** Hidden from invitees until they confirm. */
  email: string | null;
};

type SubmissionCore = Pick<
  Submission,
  | "id"
  | "conferenceId"
  | "ownerPersonId"
  | "version"
  | "typeKey"
  | "trackKey"
  | "topicKeys"
  | "language"
  | "title"
  | "abstract"
  | "fields"
  | "participationMode"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "submittedAt"
>;

export type SubmitterSubmission = SubmissionCore & {
  view: "submitter" | "invitee";
  contributors: SubmitterContributor[];
};

export type ChairContributor = {
  personId: string;
  role: ContributionRole;
  position: number;
  status: ContributionStatus;
  isOwner: boolean;
  /**
   * Confirmed people: from their profile (the name may be empty for people who never set one).
   * Invited and declined people: what the owner typed, and no profile details at all (null
   * country, pronouns and ORCID, no bios), so an invitation reveals nothing about an account.
   */
  displayName: string | null;
  email: string;
  affiliation: string | null;
  country: string | null;
  pronouns: string | null;
  /** Self-declared until ORCID sign-in exists. */
  orcid: string | null;
  bios: Record<string, string>;
  /** What the owner typed when inviting (null for the owner). */
  invitedEmail: string | null;
  invitedName: string | null;
  invitedAffiliation: string | null;
};

export type ChairSubmission = SubmissionCore & {
  view: "chair";
  contributors: ChairContributor[];
  issueCodes: SubmissionIssue["code"][];
  selfIdWarningCount: number;
  assignedReviewerIds: string[];
  conflictCount: number;
};

export type ProjectedSubmission =
  | PublicSubmission
  | MetadataSubmission
  | ReviewerSubmission
  | SubmitterSubmission
  | ChairSubmission;

export type SubmissionRecord = SubmissionContext & {
  /** Person records for the contributors. */
  people: Map<string, Person>;
};

const ordered = (cs: Contribution[]) => [...cs].sort((a, b) => a.position - b.position);
const confirmed = (cs: Contribution[]) => ordered(cs).filter((c) => c.status === "confirmed");
const live = (cs: Contribution[]) => ordered(cs).filter((c) => c.status !== "declined");

function fieldsWhere(
  rec: SubmissionRecord,
  keep: (f: { identifying: boolean; public: boolean }) => boolean,
): Record<string, FieldValue> {
  const type = findType(rec.config, rec.submission.typeKey);
  const out: Record<string, FieldValue> = {};
  for (const f of type?.fields ?? []) {
    const v = rec.submission.fields[f.key];
    if (v !== undefined && keep(f)) out[f.key] = v;
  }
  return out;
}

function core(s: Submission): SubmissionCore {
  return {
    id: s.id,
    conferenceId: s.conferenceId,
    ownerPersonId: s.ownerPersonId,
    version: s.version,
    typeKey: s.typeKey,
    trackKey: s.trackKey,
    topicKeys: [...s.topicKeys],
    language: s.language,
    title: s.title,
    abstract: s.abstract,
    fields: { ...s.fields },
    participationMode: s.participationMode,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    submittedAt: s.submittedAt,
  };
}

const reviewerIds = (assignments: Assignment[]) => assignments.map((a) => a.reviewerId).sort();
const issueCodes = (rec: SubmissionRecord) =>
  [
    ...new Set(
      submissionIssues(rec.config, rec.submission, rec.contributions, rec.people).map(
        (i) => i.code,
      ),
    ),
  ].sort();
const selfIdCount = (rec: SubmissionRecord) =>
  selfIdFindings(rec.config, rec.submission, rec.contributions, rec.people).length;

export function renderSubmission(
  access: Access,
  rec: SubmissionRecord,
): ProjectedSubmission | null {
  const s = rec.submission;
  const person = (id: string) => rec.people.get(id);
  switch (access) {
    case "none":
      return null;
    case "public":
      return {
        view: "public",
        id: s.id,
        conferenceId: s.conferenceId,
        typeKey: s.typeKey,
        trackKey: s.trackKey,
        topicKeys: [...s.topicKeys],
        language: s.language,
        title: s.title,
        abstract: s.abstract,
        fields: fieldsWhere(rec, (f) => f.public),
        contributors: confirmed(rec.contributions).map((c) => ({
          displayName: person(c.personId)?.displayName ?? "",
          affiliation: person(c.personId)?.affiliation ?? null,
          role: c.role,
        })),
      };
    case "metadata":
    case "metadata_own":
      return {
        view: "metadata",
        id: s.id,
        conferenceId: s.conferenceId,
        typeKey: s.typeKey,
        trackKey: s.trackKey,
        topicKeys: [...s.topicKeys],
        language: s.language,
        participationMode: s.participationMode,
        status: s.status,
        abstractWords: countWords(s.abstract, s.language),
        // Keys from the configuration only: a key the type does not define is owner-written text.
        filledFieldKeys: (findType(rec.config, s.typeKey)?.fields ?? [])
          .filter((f) => isFilledValue(s.fields[f.key]))
          .map((f) => f.key)
          .sort(),
        // The chair's own work: the contributor's view, so declined people are gone (as there).
        contributors: (access === "metadata_own"
          ? live(rec.contributions)
          : ordered(rec.contributions)
        ).map((c) => ({
          personId: c.personId,
          role: c.role,
          position: c.position,
          status: c.status,
        })),
        issueCodes: issueCodes(rec),
        selfIdWarningCount: selfIdCount(rec),
        ...(access === "metadata" ? { assignedReviewerIds: reviewerIds(rec.assignments) } : {}),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        submittedAt: s.submittedAt,
      };
    case "reviewer_double":
    case "reviewer_single":
    case "reviewer_open": {
      const blindMode = access.slice("reviewer_".length) as BlindMode;
      const out: ReviewerSubmission = {
        view: "reviewer",
        blindMode,
        id: s.id,
        conferenceId: s.conferenceId,
        typeKey: s.typeKey,
        trackKey: s.trackKey,
        topicKeys: [...s.topicKeys],
        language: s.language,
        title: s.title,
        abstract: s.abstract,
        fields: fieldsWhere(rec, (f) => blindMode !== "double" || !f.identifying),
      };
      if (blindMode !== "double") {
        out.contributors = confirmed(rec.contributions).map((c) => {
          const p = person(c.personId);
          const shown = {
            displayName: p?.displayName ?? "",
            affiliation: p?.affiliation ?? null,
            role: c.role,
          };
          return blindMode === "open" ? { ...shown, bios: { ...(p?.bios ?? {}) } } : shown;
        });
      }
      return out;
    }
    case "submitter":
    case "invitee":
      return {
        ...core(s),
        view: access,
        contributors: live(rec.contributions).map((c) => {
          const shown = shownIdentity(c, person(c.personId));
          return {
            personId: c.personId,
            role: c.role,
            position: c.position,
            status: c.status,
            isOwner: c.personId === s.ownerPersonId,
            displayName: shown.displayName,
            affiliation: shown.affiliation,
            email: access === "submitter" ? shown.email : null,
          };
        }),
      };
    case "chair":
      return {
        ...core(s),
        view: "chair",
        contributors: ordered(rec.contributions).map((c) => {
          // Chairs too see a profile only once its owner confirms: until then (and after
          // declining) the person is what the owner typed, and nothing else.
          const p = c.status === "confirmed" ? person(c.personId) : undefined;
          const shown = shownIdentity(c, p);
          return {
            personId: c.personId,
            role: c.role,
            position: c.position,
            status: c.status,
            isOwner: c.personId === s.ownerPersonId,
            displayName: shown.displayName,
            email: shown.email ?? c.invitedEmail ?? "",
            affiliation: shown.affiliation,
            country: p?.country ?? null,
            pronouns: p?.pronouns ?? null,
            orcid: p?.orcid ?? null,
            bios: { ...(p?.bios ?? {}) },
            invitedEmail: c.invitedEmail,
            invitedName: c.invitedName,
            invitedAffiliation: c.invitedAffiliation,
          };
        }),
        issueCodes: issueCodes(rec),
        selfIdWarningCount: selfIdCount(rec),
        assignedReviewerIds: reviewerIds(rec.assignments),
        conflictCount: rec.conflicts.length,
      };
  }
}

/** Decide and render in one step. Returns null when the viewer may not see the submission. */
export function projectSubmission(
  viewer: Viewer,
  rec: SubmissionRecord,
): ProjectedSubmission | null {
  return renderSubmission(submissionAccess(viewer, rec), rec);
}

/** What someone may see of their own person record (e.g. the account page). */
export type SelfPerson = Person & { view: "self" };

export function projectSelf(viewer: Viewer, person: Person): SelfPerson | null {
  if (viewer.kind !== "person" || viewer.personId !== person.id) return null;
  return {
    ...person,
    languages: [...person.languages],
    bios: { ...person.bios },
    view: "self",
  };
}

/**
 * The submission check for its contributors and chairs (human sessions only): blocking issues,
 * where self-identifying details appear (path and kind, never the detail itself), and the
 * viewer's own presenter-cap count. Nothing about other people's other submissions.
 */
export type SubmissionCheck = {
  issues: SubmissionIssue[];
  selfIdentification: { path: string; kind: string }[];
  /** The viewer's own count across submitted work (null for chairs or when there is no cap). */
  presenterCap: { count: number; max: number } | null;
  /** Positions of confirmed contributors without a bio, when the conference asks for bios. */
  missingBios: number[];
  /**
   * Positions of confirmed contributors with a bio (in any language) longer than the
   * conference's rules.bio.maxWords. Empty when the conference sets no bio rules.
   */
  longBios: number[];
};

export function projectCheck(
  viewer: Viewer,
  rec: SubmissionRecord,
  ownCapCount: number | null,
): SubmissionCheck | null {
  if (viewer.kind !== "person") return null;
  const access = submissionAccess(viewer, rec);
  if (access !== "submitter" && access !== "invitee" && access !== "chair") return null;
  const { config, submission, contributions, people } = rec;
  const cap = config.rules.presenterCap;
  const maxBioWords = config.rules.bio?.maxWords;
  return {
    issues: submissionIssues(config, submission, contributions, people),
    selfIdentification: selfIdFindings(config, submission, contributions, people).map((w) => ({
      path: w.path,
      kind: w.kind,
    })),
    presenterCap:
      access !== "chair" && cap && ownCapCount !== null
        ? { count: ownCapCount, max: cap.max }
        : null,
    missingBios: config.rules.bio?.requested
      ? confirmed(contributions)
          .filter((c) => Object.values(people.get(c.personId)?.bios ?? {}).every((b) => !b.trim()))
          .map((c) => c.position)
      : [],
    longBios: maxBioWords
      ? confirmed(contributions)
          .filter((c) =>
            Object.entries(people.get(c.personId)?.bios ?? {}).some(
              ([lang, bio]) => countWords(bio, lang) > maxBioWords,
            ),
          )
          .map((c) => c.position)
      : [],
  };
}
