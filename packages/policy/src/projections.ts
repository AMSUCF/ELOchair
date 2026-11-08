import {
  type Assignment,
  type BlindMode,
  type Contribution,
  type ContributionRole,
  countWords,
  type FieldValue,
  findType,
  type Person,
  type Submission,
} from "@elochair/schema";
import { type Access, type SubmissionContext, submissionAccess } from "./access";
import type { Viewer } from "./viewer";

/*
 * Projections: the only code that turns records into what a viewer may see.
 * Each output type is an explicit allow-list, so a new database column cannot leak by default.
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
  status: Submission["status"];
  abstractWords: number;
  filledFieldKeys: string[];
  contributors: { personId: string; role: ContributionRole; position: number }[];
  assignedReviewerIds: string[];
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
  /** Absent in double-blind review. Never includes email. */
  contributors?: {
    displayName: string;
    affiliation: string | null;
    role: ContributionRole;
    bio?: string | null;
  }[];
};

export type FullContributor = {
  personId: string;
  role: ContributionRole;
  position: number;
  displayName: string | null;
  email: string;
  affiliation: string | null;
};

export type SubmitterSubmission = Omit<Submission, never> & {
  view: "submitter";
  contributors: FullContributor[];
};

export type ChairSubmission = Omit<Submission, never> & {
  view: "chair";
  contributors: (FullContributor & {
    bio: string | null;
    country: string | null;
    orcid: string | null;
  })[];
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

const sortedContributions = (cs: Contribution[]) => [...cs].sort((a, b) => a.position - b.position);

function personOf(rec: SubmissionRecord, id: string): Person {
  const p = rec.people.get(id);
  if (!p) throw new Error(`missing person ${id} for submission ${rec.submission.id}`);
  return p;
}

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

function baseCopy(s: Submission): Submission {
  return {
    id: s.id,
    conferenceId: s.conferenceId,
    typeKey: s.typeKey,
    trackKey: s.trackKey,
    topicKeys: [...s.topicKeys],
    language: s.language,
    title: s.title,
    abstract: s.abstract,
    fields: { ...s.fields },
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    submittedAt: s.submittedAt,
  };
}

function fullContributors(rec: SubmissionRecord): FullContributor[] {
  return sortedContributions(rec.contributions).map((c) => {
    const p = personOf(rec, c.personId);
    return {
      personId: c.personId,
      role: c.role,
      position: c.position,
      displayName: p.displayName,
      email: p.email,
      affiliation: p.affiliation,
    };
  });
}

const reviewerIds = (assignments: Assignment[]) => assignments.map((a) => a.reviewerId).sort();

export function renderSubmission(
  access: Access,
  rec: SubmissionRecord,
): ProjectedSubmission | null {
  const s = rec.submission;
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
        contributors: sortedContributions(rec.contributions).map((c) => {
          const p = personOf(rec, c.personId);
          return { displayName: p.displayName ?? "", affiliation: p.affiliation, role: c.role };
        }),
      };
    case "metadata":
      return {
        view: "metadata",
        id: s.id,
        conferenceId: s.conferenceId,
        typeKey: s.typeKey,
        trackKey: s.trackKey,
        topicKeys: [...s.topicKeys],
        language: s.language,
        status: s.status,
        abstractWords: countWords(s.abstract, s.language),
        filledFieldKeys: Object.keys(s.fields).sort(),
        contributors: sortedContributions(rec.contributions).map((c) => ({
          personId: c.personId,
          role: c.role,
          position: c.position,
        })),
        assignedReviewerIds: reviewerIds(rec.assignments),
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
        out.contributors = sortedContributions(rec.contributions).map((c) => {
          const p = personOf(rec, c.personId);
          const shown = {
            displayName: p.displayName ?? "",
            affiliation: p.affiliation,
            role: c.role,
          };
          return blindMode === "open" ? { ...shown, bio: p.bio } : shown;
        });
      }
      return out;
    }
    case "submitter":
      return { ...baseCopy(s), view: "submitter", contributors: fullContributors(rec) };
    case "chair":
      return {
        ...baseCopy(s),
        view: "chair",
        contributors: fullContributors(rec).map((c) => {
          const p = personOf(rec, c.personId);
          return { ...c, bio: p.bio, country: p.country, orcid: p.orcid };
        }),
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

/** What someone may see of a person record outside any submission (e.g. a profile page). */
export type SelfPerson = Person & { view: "self" };

export function projectSelf(viewer: Viewer, person: Person): SelfPerson | null {
  if (viewer.kind !== "person" || viewer.personId !== person.id) return null;
  return { ...person, languages: [...person.languages], view: "self" };
}
