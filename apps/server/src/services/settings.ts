import { createHash } from "node:crypto";
import {
  type PersonViewer,
  reviewsKeptFrom,
  type SubmissionRecord,
  submissionAccess,
  submissionIssues,
} from "@elochair/policy";
import {
  ConferenceConfig,
  type ConfigChange,
  configChanges,
  countWords,
  effectiveBlindMode,
  findType,
  isCallOpen,
  keyedPath,
  type Review,
  type ReviewPool,
  reviewersCanRead,
  reviewPoolFor,
  type SubmissionIssue,
} from "@elochair/schema";
import type { ZodError } from "zod";
import type { ConferenceRow } from "../repo";
import { LIVE_STATUSES } from "./submissions";

/*
 * Changing a conference's configuration through the app (spec 02, §1.9): what a change would
 * do. Who may make one is the route's to say (any chair, in person: every chair may save any
 * valid configuration); it saves only what a review lets through. Three things a review does
 * not let through although the configuration is valid: showing the authors of an anonymized
 * review that has begun (namesRevealed), changing what an agreement says under the version
 * people have accepted (agreementsReworded), and leaving a review that was sent outside its
 * form (reviewsOutsideForm).
 *
 * Everything here answers in paths, codes, counts and opaque submission IDs: never a name, a
 * title, a score or a word of anyone's text. A problem with the wording of an email names the
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
 * what the schema refuses, what the conference's proposals do not allow (namesRevealed), what
 * the consent already recorded does not allow (agreementsReworded), and what the reviews
 * already sent do not allow (reviewsOutsideForm).
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

/** One way a change makes a pool's form narrower, and whether a review falls outside it. */
type Narrowing = {
  path: string;
  code: string;
  /** Whether what this review holds is outside the form as the change leaves it. */
  breaks: (review: Review, language: string) => boolean;
};

/**
 * How `now` narrows the form that `was` gave a pool's reviewers: a scale with an end moved in,
 * a criterion that is gone, a limit on the comments that is new or tighter, and a note or a
 * recommendation taken off the form. Relabelling, describing, widening and putting something on
 * the form narrow nothing.
 */
function narrowings(was: ReviewPool, now: ReviewPool): Narrowing[] {
  const at = `reviewPools.${now.key}`;
  const out: Narrowing[] = [];
  for (const before of was.criteria) {
    const after = now.criteria.find((c) => c.key === before.key);
    const score = (r: Review) => r.scores[before.key];
    if (!after) {
      out.push({
        path: `${at}.criteria`,
        code: "reviews_have_scores",
        breaks: (r) => score(r) !== undefined,
      });
      continue;
    }
    if (after.min > before.min) {
      out.push({
        path: `${at}.criteria.${before.key}.min`,
        code: "reviews_below_scale",
        breaks: (r) => (score(r) ?? after.min) < after.min,
      });
    }
    if (after.max < before.max) {
      out.push({
        path: `${at}.criteria.${before.key}.max`,
        code: "reviews_above_scale",
        breaks: (r) => (score(r) ?? after.max) > after.max,
      });
    }
  }
  const { minWords, maxWords } = now.form.comments;
  if (minWords !== undefined && minWords > (was.form.comments.minWords ?? 0)) {
    out.push({
      path: `${at}.form.comments.minWords`,
      code: "reviews_too_short",
      breaks: (r, language) => countWords(r.comments, language) < minWords,
    });
  }
  if (maxWords !== undefined && maxWords < (was.form.comments.maxWords ?? Infinity)) {
    out.push({
      path: `${at}.form.comments.maxWords`,
      code: "reviews_too_long",
      breaks: (r, language) => countWords(r.comments, language) > maxWords,
    });
  }
  if (was.form.chairNote.enabled && !now.form.chairNote.enabled) {
    out.push({
      path: `${at}.form.chairNote.enabled`,
      code: "reviews_have_note",
      breaks: (r) => r.chairNote.trim() !== "",
    });
  }
  if (was.form.recommendation.enabled && !now.form.recommendation.enabled) {
    out.push({
      path: `${at}.form.recommendation.enabled`,
      code: "reviews_have_recommendation",
      breaks: (r) => r.recommendation !== null,
    });
  }
  return out;
}

/**
 * Whether reviews of the conference's proposals can have been written: it has been in a phase
 * in which its reviewers can read. The mark on its row says so durably (repo.ts sets it,
 * wherever a conference gets a phase, and nothing clears it); the phase it is in now covers a
 * row the mark has not reached. A fact every chair of the conference knows.
 */
export const reviewHasBegun = (conference: Pick<ConferenceRow, "phase" | "reviewBeganAt">) =>
  conference.reviewBeganAt !== null || reviewersCanRead(conference.phase);

/**
 * Sent reviews stay valid, as submitted proposals do (spec 03, §1.8). A change that would leave
 * a review that was sent outside a scale, outside the comments' word limits, with a score for a
 * criterion that is gone, or with an answer to a note or a recommendation the form no longer
 * has, is refused at the value that would do it, with how many reviews it would do it to. So is
 * giving a format that has sent reviews to another pool: its reviews answered another form.
 * Drafts never block: they are their reviewers' own, and are not even read here (`reviews` are
 * the sent ones). Whatever became of a proposal since, a review of it that was sent counts.
 *
 * The reviews are weighed only for someone they are not kept from. A chair is never shown a
 * review of their own proposal, or of one they have a conflict with, nor that one was sent
 * (reviewsKeptFrom in packages/policy). If this refusal depended on such a review, it would say
 * so, and what the review holds: a chair could try one end of a scale after another and read
 * their own scores from what is refused. So the reviews of such a proposal are not read here at
 * all: not what they hold, and not whether there are any. What is decided for that chair
 * instead is decided without them, from two things only: the proposal was submitted at some
 * time, and the conference has been in review (reviewHasBegun: the mark on its row, which a
 * move back out of review does not clear). From then on, and for good, every narrowing of the
 * form of the pool that reviews it is refused to that chair (`reviews_hidden`, without a
 * number), whatever became of the proposal since and whichever phase the conference is in. A
 * chair from whom no review of that pool is kept can make the change. Until the conference has
 * been in review this refusal is made to nobody: no review can have been written.
 *
 * Every other sent review is weighed by what it holds, for any chair and in any phase: also the
 * review of a proposal that has gone back to a draft or was withdrawn since, which no chair is
 * shown now. It was sent, and it is counted, once for each value it would be outside of.
 *
 * What the refusal tells a chair, exactly (spec 02, §1.9 has it in full). That at least one
 * proposal kept from them was submitted at some time for a format the pool reviews, and, where
 * the change gives a format to another pool, that it was of that format: never how many, and
 * never which proposal. Of their own proposals they know that. Of the proposals they have a
 * conflict with they can already work out nearly all of it: the overview on "Manage
 * submissions" counts every proposal that is not a draft by format, kept ones included
 * (services/reports.ts), beside a list of the ones they are shown. What the refusal adds is
 * one case: that a proposal they have a conflict with which was submitted, and has since gone
 * back to a draft, exists for a format of this pool.
 */
function reviewsOutsideForm(
  viewer: PersonViewer,
  conference: Pick<ConferenceRow, "phase" | "reviewBeganAt">,
  before: ConferenceConfig,
  after: ConferenceConfig,
  records: SubmissionRecord[],
  reviews: readonly Review[],
): ConfigIssue[] {
  const bySubmission = new Map(records.map((r) => [r.submission.id, r]));
  /** The proposals whose reviews are kept from the person asking. */
  const kept = new Set(
    records.filter((r) => reviewsKeptFrom(viewer, r)).map((r) => r.submission.id),
  );
  // From here on, nothing of a review that is kept from them is looked at.
  const sent = reviews.filter((r) => r.status === "sent" && !kept.has(r.submissionId));
  const narrowed = new Map<string, Narrowing[]>();
  const found = new Map<string, { path: string; code: string; n: number; hidden: boolean }>();
  const count = (path: string, code: string, readable: boolean) => {
    const key = `${path}:${code}`;
    const hit = found.get(key) ?? { path, code, n: 0, hidden: false };
    if (readable) hit.n += 1;
    else hit.hidden = true;
    found.set(key, hit);
  };
  /** What the change does to the form a format's proposals are reviewed on. */
  const changeFor = (typeKey: string): { moved: string } | { narrowings: Narrowing[] } | null => {
    const was = reviewPoolFor(before, typeKey);
    if (!was) return null;
    const now = reviewPoolFor(after, typeKey);
    if (now?.key !== was.key) return { moved: `submissionTypes.${typeKey}.reviewPool` };
    const list = narrowed.get(was.key) ?? narrowings(was, now);
    narrowed.set(was.key, list);
    return { narrowings: list };
  };

  // The reviews that are not kept from the person asking: weighed, each against what it holds.
  for (const review of sent) {
    const record = bySubmission.get(review.submissionId);
    if (!record) continue;
    const change = changeFor(record.submission.typeKey);
    if (!change) continue;
    if ("moved" in change) count(change.moved, "reviews_sent", true);
    else {
      // One review is one review, however many criteria that it scores are removed at once.
      const outside = new Set<string>();
      for (const narrowing of change.narrowings) {
        const key = `${narrowing.path}:${narrowing.code}`;
        if (outside.has(key) || !narrowing.breaks(review, record.submission.language)) continue;
        outside.add(key);
        count(narrowing.path, narrowing.code, true);
      }
    }
  }

  // The proposals whose reviews are kept from them (their own, and those they have a conflict
  // with): decided without their reviews. It was submitted, and the conference has been in
  // review, whichever phase it is in now.
  for (const record of reviewHasBegun(conference) ? records : []) {
    if (!kept.has(record.submission.id) || record.submission.submittedAt === null) continue;
    const change = changeFor(record.submission.typeKey);
    if (!change) continue;
    if ("moved" in change) count(change.moved, "reviews_sent", false);
    else for (const narrowing of change.narrowings) count(narrowing.path, narrowing.code, false);
  }

  return [...found.values()].flatMap((hit) => [
    ...(hit.n > 0
      ? [
          {
            path: hit.path,
            code: hit.code,
            params: { n: hit.n },
            message: "reviews that were sent would be outside the review form",
          },
        ]
      : []),
    ...(hit.hidden
      ? [
          {
            path: hit.path,
            code: "reviews_hidden",
            message:
              "the pool reviews a proposal whose reviews are kept from the person asking: another chair makes this change",
          },
        ]
      : []),
  ]);
}

/**
 * What saving `input` over the stored configuration would do. Nothing is written. `records` are
 * the conference's submissions as they are now, and `everAssigned` the ids of those that have,
 * or have had, a reviewer (everAssigned in services/assignments.ts); `sentReviews` are the
 * conference's reviews that were sent (loadSentReviews); `base` is the token of the
 * configuration the person started from, when they said so. `viewer` decides two things only:
 * which of the proposals that block the save are named to them (those they may manage as a
 * chair), and which sent reviews are weighed for them, the others never being read at all
 * (reviewsOutsideForm).
 */
export function reviewConfig(args: {
  viewer: PersonViewer;
  conference: ConferenceRow;
  records: SubmissionRecord[];
  everAssigned: ReadonlySet<string>;
  sentReviews: readonly Review[];
  input: unknown;
  base: string | null;
  now: Date;
}): { review: ConfigReview; next: ConferenceConfig | null } {
  const { viewer, conference, records, everAssigned, sentReviews, input, base, now } = args;
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
    ...reviewsOutsideForm(viewer, conference, before, next, records, sentReviews),
  ];

  const byCode: Record<string, number> = {};
  const submissionIds: string[] = [];
  let blockedCount = 0;
  for (const record of records) {
    const status = record.submission.status;
    // Work that was sent in and not withdrawn or turned down must stay valid.
    if (status !== "draft" && !LIVE_STATUSES.includes(status)) continue;
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
  ).filter((key) => {
    const at = next.deadlines[key];
    return at !== undefined && at !== before.deadlines[key] && Date.parse(at) < now.getTime();
  });

  review.canSave =
    !review.stale &&
    review.issues.length === 0 &&
    review.blocked === null &&
    review.changes.length > 0;
  return { review, next };
}
