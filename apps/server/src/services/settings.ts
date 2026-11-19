import { createHash } from "node:crypto";
import {
  type PersonViewer,
  type SubmissionRecord,
  submissionAccess,
  submissionIssues,
} from "@elochair/policy";
import {
  ConferenceConfig,
  type ConfigChange,
  configChanges,
  isCallOpen,
  keyedPath,
  type SubmissionIssue,
  type SubmissionStatus,
} from "@elochair/schema";
import type { ZodError } from "zod";
import type { ConferenceRow } from "../repo";

/*
 * Changing a conference's configuration through the app (spec 02, §1.9): what a change would
 * do. Who may make one is the route's to say (any chair, in person: every chair may save any
 * valid configuration); it saves only what a review lets through.
 *
 * Everything here answers in paths, codes, counts and opaque submission IDs: never a name, a
 * title or a word of anyone's text.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : isObject(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, canonical(v[key])]),
        )
      : v;

/**
 * Names one exact configuration. A save says which configuration it was based on by this token,
 * and is refused when that is no longer the stored one. Keys are sorted first: the database
 * does not keep their order.
 */
export const configToken = (config: ConferenceConfig): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(config)))
    .digest("hex")
    .slice(0, 32);

/** A problem with a submitted configuration, by keyed path, with a code a screen can explain. */
export type ConfigIssue = {
  path: string;
  code: string;
  params?: Record<string, number>;
  message: string;
};

/** The schema's findings as the settings screen shows them: beside a value, in any language. */
export function configIssues(error: ZodError, input: unknown): ConfigIssue[] {
  const defaultLanguage =
    isObject(input) && typeof input.defaultLanguage === "string" ? input.defaultLanguage : "en";
  return error.issues.map((issue) => {
    let code = "invalid";
    let leaf: string | undefined;
    let params: Record<string, number> | undefined;
    if (issue.code === "custom") {
      const named = issue.params as { code?: string; leaf?: string } | undefined;
      if (named?.code) {
        code = named.code;
        leaf = named.leaf;
      }
    } else if (issue.code === "invalid_type") {
      // A text that is missing altogether is missing in the default language.
      if (issue.expected === "record") {
        code = "default_language_required";
        leaf = defaultLanguage;
      } else if (issue.expected === "int") code = "whole_number";
      else if (issue.expected === "number") code = "number_required";
      else code = "required";
    } else if (issue.code === "too_small") {
      if (issue.origin === "string") code = "required";
      else {
        code = "too_small";
        // "More than" bounds in the schema are all on whole numbers: say the smallest allowed.
        params = { min: Number(issue.minimum) + (issue.inclusive === false ? 1 : 0) };
      }
    } else if (issue.code === "too_big") {
      code = "too_big";
      params = { max: Number(issue.maximum) - (issue.inclusive === false ? 1 : 0) };
    } else if (issue.code === "invalid_format") {
      if (["email", "url", "date", "datetime"].includes(issue.format)) code = issue.format;
    }
    const path = keyedPath(input, issue.path as (string | number)[]);
    return {
      path: leaf ? `${path}.${leaf}` : path,
      code,
      ...(params ? { params } : {}),
      message: issue.message,
    };
  });
}

/** Work that has been sent in and not withdrawn or turned down: it must stay valid. */
const LIVE: readonly SubmissionStatus[] = [
  "submitted",
  "accepted",
  "waitlisted",
  "confirmed",
  "published",
];

export type Blocked = {
  /** Submitted proposals that would have a problem they do not have now. */
  count: number;
  /** How many of them would gain each problem (a proposal with two counts under both). */
  byCode: Record<string, number>;
  /** Those the person may manage as a chair; their own and conflicted work is only counted. */
  submissionIds: string[];
};

export type ConfigReview = {
  /** Names the stored configuration this review compared with. */
  token: string;
  /** The configuration the caller started from is no longer the stored one. */
  stale: boolean;
  issues: ConfigIssue[];
  changes: ConfigChange[];
  blocked: Blocked | null;
  warnings: {
    /** Drafts that would have a problem they do not have now. Drafts never block. */
    drafts: number;
    /** The change opens, or closes, the call at this very moment. */
    callOpens: boolean;
    callCloses: boolean;
    /** Deadlines this change moves into the past. */
    pastDeadlines: string[];
  };
  canSave: boolean;
};

const issueKey = (i: SubmissionIssue) => `${i.path}:${i.code}`;

/** The problems a proposal would have under `after` that it does not have now. */
function gained(record: SubmissionRecord, after: ConferenceConfig): SubmissionIssue[] {
  const { submission, contributions, people } = record;
  const had = new Set(
    submissionIssues(record.config, submission, contributions, people).map(issueKey),
  );
  return submissionIssues(after, submission, contributions, people).filter(
    (i) => !had.has(issueKey(i)),
  );
}

/**
 * What saving `input` over the stored configuration would do. Nothing is written. `records` are
 * the conference's submissions as they are now; `base` is the token of the configuration the
 * person started from, when they said so. `viewer` decides one thing only: which of the
 * proposals that block the save are named to them (those they may manage as a chair).
 */
export function reviewConfig(args: {
  viewer: PersonViewer;
  conference: ConferenceRow;
  records: SubmissionRecord[];
  input: unknown;
  base: string | null;
  now: Date;
}): { review: ConfigReview; next: ConferenceConfig | null } {
  const { viewer, conference, records, input, base, now } = args;
  const token = configToken(conference.config);
  const review: ConfigReview = {
    token,
    stale: base !== null && base !== token,
    issues: [],
    changes: [],
    blocked: null,
    warnings: { drafts: 0, callOpens: false, callCloses: false, pastDeadlines: [] },
    canSave: false,
  };
  const parsed = ConferenceConfig.safeParse(input);
  if (!parsed.success) {
    review.issues = configIssues(parsed.error, input);
    return { review, next: null };
  }
  const next = parsed.data;
  const before = conference.config;
  review.changes = configChanges(before, next);

  const byCode: Record<string, number> = {};
  const submissionIds: string[] = [];
  let blockedCount = 0;
  for (const record of records) {
    const status = record.submission.status;
    if (status !== "draft" && !LIVE.includes(status)) continue;
    const codes = new Set(gained(record, next).map((i) => i.code));
    if (codes.size === 0) continue;
    if (status === "draft") {
      review.warnings.drafts += 1;
      continue;
    }
    blockedCount += 1;
    for (const code of codes) byCode[code] = (byCode[code] ?? 0) + 1;
    if (submissionAccess(viewer, record) === "chair") submissionIds.push(record.submission.id);
  }
  if (blockedCount > 0) review.blocked = { count: blockedCount, byCode, submissionIds };

  const wasOpen = isCallOpen(before, conference.phase, now);
  const willBeOpen = isCallOpen(next, conference.phase, now);
  review.warnings.callOpens = !wasOpen && willBeOpen;
  review.warnings.callCloses = wasOpen && !willBeOpen;
  review.warnings.pastDeadlines = (
    Object.keys(next.deadlines) as (keyof ConferenceConfig["deadlines"])[]
  ).filter(
    (key) =>
      next.deadlines[key] !== before.deadlines[key] &&
      Date.parse(next.deadlines[key]) < now.getTime(),
  );

  review.canSave = !review.stale && review.blocked === null && review.changes.length > 0;
  return { review, next };
}
