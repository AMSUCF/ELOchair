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
  effectiveBlindMode,
  findType,
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
 * valid configuration); it saves only what a review lets through. Two things a review does not
 * let through although the configuration is valid: showing the authors of an anonymized review
 * that has begun (namesRevealed), and changing what an agreement says under the version people
 * have accepted (agreementsReworded).
 *
 * Everything here answers in paths, codes, counts and opaque submission IDs: never a name, a
 * title or a word of anyone's text. A problem with the wording of an email names the
 * placeholders it is about ("{link}"): they come from the configuration that was sent in.
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

/**
 * A problem with a submitted configuration, by keyed path, with a code a screen can explain:
 * what the schema refuses, what the conference's proposals do not allow (namesRevealed), and
 * what the consent already recorded does not allow (agreementsReworded).
 */
export type ConfigIssue = {
  path: string;
  code: string;
  /** What the explanation names: a bound, or the placeholders of an email's text. */
  params?: Record<string, string | number>;
  message: string;
};

/** The schema's findings as the settings screen shows them: beside a value, in any language. */
export function configIssues(error: ZodError, input: unknown): ConfigIssue[] {
  const defaultLanguage =
    isObject(input) && typeof input.defaultLanguage === "string" ? input.defaultLanguage : "en";
  return error.issues.map((issue) => {
    let code = "invalid";
    let leaf: string | undefined;
    let params: Record<string, string | number> | undefined;
    if (issue.code === "custom") {
      const named = issue.params as
        | { code?: string; leaf?: string; values?: Record<string, string | number> }
        | undefined;
      if (named?.code) {
        code = named.code;
        leaf = named.leaf;
        params = named.values;
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
      // A text that is too long is not a number that is too large.
      code = issue.origin === "string" ? "too_long" : "too_big";
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
  /** Values that cannot be saved as they are. Any of them, and nothing is saved. */
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
 * An anonymized review that has begun stays anonymized. Reviewers were promised, and authors
 * were told, that the authors are not shown: once a proposal has been given a reviewer, a
 * change that would show a reviewer of it who wrote it is refused, at the value that would do
 * it. On the settings screen that is the pool's mode. Through the API it may also be a format's
 * own mode, or the pool a format is reviewed by. Hiding names that were shown is always
 * allowed, and so is every change while no proposal has had a reviewer.
 *
 * Any assignment counts, whatever became of the proposal since, and whatever became of the
 * assignment: `everAssigned` holds the submissions that have, or have had, a reviewer. A
 * released assignment counts for nothing anywhere else (spec 03, §1.3), and still counts here:
 * the reviewer may have read the proposal anonymized while it was theirs, and can be assigned
 * to it again. If releasing took the proposal out of this guard, a chair could release its
 * reviewers, show names, and assign the same people again, who would then be shown the authors
 * of what they were given as anonymized. The mode is the one in force for the format
 * (effectiveBlindMode), so a format with a mode of its own is not touched by its pool's.
 */
function namesRevealed(
  before: ConferenceConfig,
  after: ConferenceConfig,
  records: SubmissionRecord[],
  everAssigned: ReadonlySet<string>,
): ConfigIssue[] {
  const assigned = new Set(
    records.filter((r) => everAssigned.has(r.submission.id)).map((r) => r.submission.typeKey),
  );
  const paths = new Set<string>();
  for (const type of after.submissionTypes) {
    if (!assigned.has(type.key)) continue;
    if (effectiveBlindMode(before, type.key) !== "double") continue;
    if (effectiveBlindMode(after, type.key) === "double") continue;
    // The value that differs: the format's own mode, else its pool, else that pool's mode.
    const was = findType(before, type.key);
    paths.add(
      was?.blindMode !== type.blindMode
        ? `submissionTypes.${type.key}.blindMode`
        : was?.reviewPool !== type.reviewPool
          ? `submissionTypes.${type.key}.reviewPool`
          : `reviewPools.${type.reviewPool}.blindMode`,
    );
  }
  return [...paths].map((path) => ({
    path,
    code: "reviewers_assigned",
    message: "reviewers have been assigned to proposals that are reviewed anonymized",
  }));
}

/**
 * Consent is recorded against an agreement's version (`agreement_acks`: person, conference,
 * key, version). A person who accepted "privacy" at version 1 accepted the words it had then.
 * So what an agreement says, its title, its text or its link in any language, is changed only
 * together with its version: a save that changes one of them and keeps the stored version is
 * refused, at the version, which is the value to change. The new version only has to differ
 * from the stored one. Changing the version alone is always allowed.
 *
 * Agreements are matched by key. One that is new has no stored version to keep, and one that is
 * removed says nothing any more; neither is this rule's concern (and neither has a screen).
 */
function agreementsReworded(before: ConferenceConfig, after: ConferenceConfig): ConfigIssue[] {
  const said = (a: ConferenceConfig["agreements"][number]) =>
    JSON.stringify(canonical({ title: a.title, text: a.text ?? null, url: a.url ?? null }));
  return after.agreements.flatMap((agreement) => {
    const stored = before.agreements.find((a) => a.key === agreement.key);
    if (!stored || stored.version !== agreement.version || said(stored) === said(agreement)) {
      return [];
    }
    return [
      {
        path: `agreements.${agreement.key}.version`,
        code: "agreement_version_required",
        message: "what an agreement says can only change together with its version",
      },
    ];
  });
}

/**
 * What saving `input` over the stored configuration would do. Nothing is written. `records` are
 * the conference's submissions as they are now, and `everAssigned` the ids of those that have,
 * or have had, a reviewer (everAssigned in services/assignments.ts); `base` is the token of the
 * configuration the person started from, when they said so. `viewer` decides one thing only:
 * which of the proposals that block the save are named to them (those they may manage as a
 * chair).
 */
export function reviewConfig(args: {
  viewer: PersonViewer;
  conference: ConferenceRow;
  records: SubmissionRecord[];
  everAssigned: ReadonlySet<string>;
  input: unknown;
  base: string | null;
  now: Date;
}): { review: ConfigReview; next: ConferenceConfig | null } {
  const { viewer, conference, records, everAssigned, input, base, now } = args;
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
  review.issues = [
    ...namesRevealed(before, next, records, everAssigned),
    ...agreementsReworded(before, next),
  ];

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

  review.canSave =
    !review.stale &&
    review.issues.length === 0 &&
    review.blocked === null &&
    review.changes.length > 0;
  return { review, next };
}
