import type {
  ConferenceConfig,
  ConferencePhase,
  ContributionRole,
  ContributionStatus,
  LocalizedText,
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
};

export type ConferenceDetail = {
  slug: string;
  phase: ConferencePhase;
  config: ConferenceConfig;
  /** Decided by the server clock. */
  callOpen: boolean;
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
