import type {
  CallState,
  ConferenceConfig,
  ConferencePhase,
  ContributionRole,
  ContributionStatus,
  LocalizedText,
  NoticeFrequency,
  Recommendation,
  SelfIdKind,
  SubmissionIssue,
  SubmissionStatus,
} from "@elochair/schema";

export type Issue = { path: string; code: string; params?: Record<string, string | number> };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      issues: Issue[];
      body: Record<string, unknown> | null;
    };

/** JSON over fetch, same-origin cookies. Never throws for HTTP errors; check `ok`. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    const body = (data as Record<string, unknown> | null) ?? null;
    return {
      ok: false,
      status: res.status,
      error: (body?.error as string | undefined) ?? "error",
      issues: Array.isArray(body?.issues) ? (body.issues as Issue[]) : [],
      body,
    };
  } catch {
    return { ok: false, status: 0, error: "network", issues: [], body: null };
  }
}

export type ConferenceSummary = {
  slug: string;
  phase: ConferencePhase;
  year: number;
  title: LocalizedText;
  theme: LocalizedText;
  location: LocalizedText;
  modality: ConferenceConfig["modality"];
  dates: { start: string; end: string };
  placeholder: boolean;
  /** Decided by the server clock. */
  callOpen: boolean;
  /** Where the call stands: open, yet to open, or closed. Decided by the server clock too. */
  callState: CallState;
};

export type ConferenceDetail = {
  slug: string;
  phase: ConferencePhase;
  config: ConferenceConfig;
  /** Decided by the server clock. */
  callOpen: boolean;
  /** Where the call stands: open, yet to open, or closed. Decided by the server clock too. */
  callState: CallState;
};

export type Me =
  | {
      kind: "person";
      person: Profile | null;
      siteAdmin: boolean;
      roles: {
        conference: string | null;
        role: "admin" | "chair" | "track_chair" | "reviewer";
        scope: string[];
      }[];
    }
  | { kind: "agent"; tier: "M" | "C"; conference: string | null };

/**
 * A person's own choices about the emails of the review phase at one conference (spec 03,
 * §1.7): each part is there only for the role it belongs to.
 */
export type EmailChoices = {
  view: "email_choices";
  conference: { slug: string; title: LocalizedText; defaultLanguage: string };
  reviewer: { assignments: NoticeFrequency; reminder: boolean; reminderDays: number } | null;
  chair: { notices: NoticeFrequency } | null;
};

export type Role = ContributionRole;

export type Contributor = {
  personId: string;
  role: Role;
  position: number;
  status: ContributionStatus;
  isOwner: boolean;
  displayName: string | null;
  affiliation: string | null;
  email: string | null;
};

/** The submitter or invitee view of a submission (see packages/policy projections). */
export type MySubmission = {
  view: "submitter" | "invitee";
  id: string;
  conferenceId: string;
  ownerPersonId: string;
  version: number;
  typeKey: string;
  trackKey: string | null;
  topicKeys: string[];
  language: string;
  title: string;
  abstract: string;
  fields: Record<string, string | string[] | boolean | number>;
  participationMode: "in_person" | "online" | "undecided" | null;
  status: SubmissionStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  contributors: Contributor[];
};

/**
 * The chair view of a submission (the chair projection in packages/policy): what the owner
 * sees, with each person's contact details and the problems the list flags.
 */
export type ChairSubmission = Omit<MySubmission, "view" | "contributors"> & {
  view: "chair";
  contributors: (Contributor & {
    country: string | null;
    /** What the owner typed for someone who has not confirmed. */
    invitedEmail: string | null;
    invitedName: string | null;
  })[];
  issueCodes: SubmissionIssue["code"][];
  selfIdWarningCount: number;
};

/**
 * What a reviewer is given of a proposal assigned to them (the reviewer projection in
 * packages/policy): no status, no owner, no person IDs and never an email.
 */
export type ReviewerSubmission = {
  view: "reviewer";
  blindMode: "double" | "single" | "open";
  id: string;
  conferenceId: string;
  typeKey: string;
  trackKey: string | null;
  topicKeys: string[];
  language: string;
  title: string;
  abstract: string;
  /** Without the answers marked as identifying, in anonymized (double-blind) review. */
  fields: Record<string, string | string[] | boolean | number>;
  /** Confirmed contributors; absent in anonymized review. */
  contributors?: {
    displayName: string;
    affiliation: string | null;
    role: Role;
    bios?: Record<string, string>;
  }[];
};

export type Check = {
  issues: Issue[];
  selfIdentification: { path: string; kind: SelfIdKind }[];
  presenterCap: { count: number; max: number } | null;
  missingBios: number[];
  /** Confirmed contributors whose bio (in any language) is over the conference's word limit. */
  longBios?: number[];
};

/** Your own profile (the "self" projection). */
export type Profile = {
  id: string;
  email: string;
  displayName: string | null;
  affiliation: string | null;
  country: string | null;
  languages: string[];
  pronouns: string | null;
  orcid: string | null;
  bios: Record<string, string>;
};

/** The roles a chair can invite someone to, and those the People page can take away. */
export type InvitableRole = "reviewer" | "chair";
export type RemovableRole = "chair" | "reviewer" | "track_chair";

/** Someone who holds a role, by their profile (the People projection in packages/policy). */
export type RoleHolder = { personId: string; displayName: string | null; email: string };

/** An invitation nobody accepted, as the chair typed it: nothing in it is from a profile. */
export type PeopleInvitation = {
  id: string;
  role: InvitableRole;
  pools: string[];
  email: string;
  name: string | null;
  lang: "en" | "es" | "pt";
  state: "waiting" | "expired" | "declined";
  sentAt: string;
  expiresAt: string;
  answeredAt: string | null;
};

/** Who holds a role at a conference and who has been invited, for its chairs. */
export type People = {
  view: "people";
  chairs: (RoleHolder & { you: boolean })[];
  reviewers: (RoleHolder & {
    pools: string[];
    /** Among the proposals the chair looking manages: their own and conflicted ones left out. */
    assigned: number;
    /** How many of those have a review of theirs that was sent. */
    sent: number;
    maxLoad: number | null;
    languages: string[];
  })[];
  trackChairs: (RoleHolder & { tracks: string[] })[];
  invitations: PeopleInvitation[];
};

/** What the page of an invitation to a role shows whoever holds its link. */
export type RoleInvitation = {
  view: "role_invitation";
  conference: { slug: string; title: LocalizedText };
  role: InvitableRole;
  pools: { key: string; name: LocalizedText }[];
  /** The address the invitation was sent to: the role goes to it, whoever opens the link. */
  email: string;
  lang: "en" | "es" | "pt";
  expiresAt: string;
  nameNeeded: boolean;
};

/**
 * A reviewer who can be assigned to a proposal, as a chair who manages it is shown them (the
 * Reviewers projection in packages/policy). `assigned` counts the proposals that chair manages.
 */
export type ReviewerCandidate = RoleHolder & {
  languages: string[];
  assigned: number;
  maxLoad: number | null;
  /** They have as many proposals as they said they would take: offered all the same, last. */
  full: boolean;
};

/** A review that was sent, as a chair who manages its proposal reads it (packages/policy). */
export type ChairReview = {
  scores: Record<string, number>;
  comments: string;
  chairNote: string;
  recommendation: Recommendation | null;
  sentAt: string;
  /** When it was last changed, if that was after it was first sent. */
  changedAt: string | null;
};

/** Who reviews a proposal and who could, for a chair who manages it. */
export type ProposalReviewers = {
  view: "proposal_reviewers";
  submissionId: string;
  /** The review pool of the proposal's format: a "committee" wherever a person reads it. */
  pool: string | null;
  needed: number;
  /**
   * Everyone assigned to it. `blocked`: they can no longer review it, and are not counted.
   * `review`: their review once it is sent; until then nothing says whether they began one.
   */
  assigned: (RoleHolder & {
    assignedAt: string;
    blocked: boolean;
    review: ChairReview | null;
  })[];
  /** Sent reviews by people who are no longer assigned to it. */
  otherReviews: (RoleHolder & { review: ChairReview })[];
  /** Who said they could not review it, with their reason and their note for the chairs. */
  declined: (RoleHolder & {
    reason: "conflict" | "expertise" | "time";
    note: string | null;
    at: string;
  })[];
  takes: "yes" | "call_not_closed" | "not_under_consideration";
  candidates: ReviewerCandidate[];
};

/** One proposal on the chairs' Assignments page. */
export type AssignmentsProposal = {
  id: string;
  title: string;
  typeKey: string;
  reviewers: RoleHolder[];
  short: boolean;
  /** How many reviews of it were sent. */
  sent: number;
};

/** One review pool on that page: its totals, and one page of its proposals. */
export type AssignmentsPool = {
  key: string;
  needed: number;
  proposals: number;
  short: number;
  /** How many have their reviewers and fewer sent reviews than the committee asks for. */
  waiting: number;
  items: AssignmentsProposal[];
  nextCursor: string | null;
};

/** Where a reviewer's own review of a proposal stands. */
export type OwnReviewStatus = "not_started" | "draft" | "sent";

/** A reviewer's own review of a proposal (the own-review projection in packages/policy). */
export type OwnReview = {
  view: "own_review";
  submissionId: string;
  status: OwnReviewStatus;
  /** The version a save names; 0 while nothing has been saved. */
  version: number;
  scores: Record<string, number>;
  comments: string;
  chairNote: string;
  recommendation: Recommendation | null;
  sentAt: string | null;
  updatedAt: string | null;
  /** The conference is in review: the review can be saved, sent and changed. */
  open: boolean;
  /** "I cannot review this proposal" is offered. */
  canDecline: boolean;
};

/** A reviewer's own list for one conference ("My reviews"). */
export type MyReviews = {
  view: "my_reviews";
  conference: { slug: string; title: LocalizedText; timezone: string; defaultLanguage: string };
  open: boolean;
  reviewsDue: string | null;
  counts: { sent: number; draft: number; notStarted: number };
  committees: { key: string; name: LocalizedText; guidelines: LocalizedText | null }[];
  formats: Record<string, LocalizedText>;
  proposals: {
    submissionId: string;
    title: string;
    typeKey: string;
    language: string;
    status: OwnReviewStatus;
  }[];
};

export type Assignments = {
  view: "assignments";
  callClosed: boolean;
  /** Proposals not listed: the chair's own, and those they have a conflict with. */
  excluded: number;
  pools: AssignmentsPool[];
};
