import type { ConferenceConfig, LocalizedText } from "@elochair/schema";

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
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
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
  phase: string;
  year: number;
  title: LocalizedText;
  location: LocalizedText;
  modality: ConferenceConfig["modality"];
  dates: { start: string; end: string };
  placeholder: boolean;
};

export type ConferenceDetail = {
  slug: string;
  phase: string;
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

export type Role = "lead" | "presenter" | "coauthor" | "panelist" | "moderator";

export type Contributor = {
  personId: string;
  role: Role;
  position: number;
  status: "invited" | "confirmed" | "declined";
  isOwner: boolean;
  displayName: string | null;
  affiliation: string | null;
  email: string | null;
};

/** The submitter or invitee view of a submission (see packages/policy projections). */
export type MySubmission = {
  view: "submitter" | "invitee" | "chair";
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
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  contributors: Contributor[];
};

export type Check = {
  issues: Issue[];
  selfIdentification: { path: string; kind: string }[];
  presenterCap: { count: number; max: number } | null;
  missingBios: number[];
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
