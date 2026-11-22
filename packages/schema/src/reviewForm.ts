import type { ConferenceConfig, ReviewPool } from "./config";
import { findType } from "./lookup";
import { countWords } from "./words";

/*
 * The review form (spec 03, §1.4 and §1.8): what a pool's reviewers are asked, what a review
 * holds, and what keeps one from being sent. Zod-free, so that the reviewer's page, the server
 * and the guard on the settings share this one definition.
 *
 * The form is the chairs' to word: the criteria with their scales and descriptions, the limits
 * and the description of the comments, and whether there is a note for the chairs and a
 * recommendation, are all read from the configuration. The names of the three fixed fields and
 * of the three recommendations are the app's own.
 */

/** The overall recommendation a reviewer gives, where the form has one. */
export const RECOMMENDATIONS = ["accept", "unsure", "reject"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/**
 * Why a reviewer says they cannot review a proposal: the three reasons of a release that a
 * reviewer gives themself (AssignmentReleaseReason has two more, which are a chair's).
 */
export const DECLINE_REASONS = ["conflict", "expertise", "time"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * The most values a scale may have and still be shown as one row of choices. A wider scale
 * (which the settings allow: they put no bound on one) is answered by typing the number.
 */
export const SCALE_CHOICES_MAX = 11;

/** What a review holds: the reviewer's answers, whatever state the review is in. */
export type ReviewContent = {
  /** A whole number for each criterion answered so far, by the criterion's key. */
  scores: Record<string, number>;
  /** For the authors. Empty while nothing is written. */
  comments: string;
  /** For the chairs only. Empty when there is none. */
  chairNote: string;
  recommendation: Recommendation | null;
};

export const EMPTY_REVIEW: ReviewContent = {
  scores: {},
  comments: "",
  chairNote: "",
  recommendation: null,
};

/** The form of the pool that reviews a format; undefined when the conference has neither. */
export function reviewPoolFor(config: ConferenceConfig, typeKey: string): ReviewPool | undefined {
  const key = findType(config, typeKey)?.reviewPool;
  return config.reviewPools.find((p) => p.key === key);
}

/**
 * The scores of a scale as one row of choices, smallest first; null for a scale too wide for
 * that (more than SCALE_CHOICES_MAX values), which is answered by typing the number. How wide
 * it is is worked out and never counted through: a scale may run to any whole number.
 */
export function scaleChoices(criterion: { min: number; max: number }): number[] | null {
  const width = criterion.max - criterion.min + 1;
  if (!(width >= 1 && width <= SCALE_CHOICES_MAX)) return null;
  return Array.from({ length: width }, (_, i) => criterion.min + i);
}

export type ReviewIssue = {
  /** "scores.<criterion>", "comments", "chairNote" or "recommendation". */
  path: string;
  code:
    | "required"
    | "not_integer"
    /** A score outside its criterion's scale (params: min, max). */
    | "out_of_range"
    | "too_few_words"
    | "too_many_words"
    /** An answer to something the form does not have: a criterion, the note, the recommendation. */
    | "not_on_form";
  params?: Record<string, string | number>;
};

/**
 * What is wrong with what a review holds, whatever state it is in: an answer that the form has
 * no place for, or a score that is not on its criterion's scale. A draft may be incomplete; it
 * may not hold these.
 */
export function reviewContentIssues(pool: ReviewPool, review: ReviewContent): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const criteria = new Map(pool.criteria.map((c) => [c.key, c]));
  for (const [key, score] of Object.entries(review.scores)) {
    const criterion = criteria.get(key);
    const path = `scores.${key}`;
    if (!criterion) issues.push({ path, code: "not_on_form" });
    else if (!Number.isInteger(score)) issues.push({ path, code: "not_integer" });
    else if (score < criterion.min || score > criterion.max) {
      issues.push({
        path,
        code: "out_of_range",
        params: { min: criterion.min, max: criterion.max },
      });
    }
  }
  if (!pool.form.chairNote.enabled && review.chairNote.trim() !== "") {
    issues.push({ path: "chairNote", code: "not_on_form" });
  }
  if (!pool.form.recommendation.enabled && review.recommendation !== null) {
    issues.push({ path: "recommendation", code: "not_on_form" });
  }
  return issues;
}

/**
 * What keeps a review from being sent: everything a draft may not hold (reviewContentIssues),
 * a criterion without a score, comments that are missing or outside the pool's word limits,
 * and a recommendation that is missing where the form has one. The note for the chairs is
 * always optional. Words are counted as a proposal's are (countWords), in `language`.
 */
export function reviewIssues(
  pool: ReviewPool,
  review: ReviewContent,
  language = "en",
): ReviewIssue[] {
  const issues = reviewContentIssues(pool, review);
  for (const criterion of pool.criteria) {
    if (review.scores[criterion.key] === undefined) {
      issues.push({ path: `scores.${criterion.key}`, code: "required" });
    }
  }
  const { minWords, maxWords } = pool.form.comments;
  if (review.comments.trim() === "") issues.push({ path: "comments", code: "required" });
  else {
    const count = countWords(review.comments, language);
    if (minWords !== undefined && count < minWords) {
      issues.push({ path: "comments", code: "too_few_words", params: { min: minWords, count } });
    }
    if (maxWords !== undefined && count > maxWords) {
      issues.push({ path: "comments", code: "too_many_words", params: { max: maxWords, count } });
    }
  }
  if (pool.form.recommendation.enabled && review.recommendation === null) {
    issues.push({ path: "recommendation", code: "required" });
  }
  return issues;
}

/**
 * A review as the form can show it now: what no longer has a place on the form is left out (a
 * score for a criterion that is gone or off its scale, a note or a recommendation the form no
 * longer has). The reviewer's page starts from this, for a stored draft and for unsaved text
 * alike, so that nothing is sent that its writer cannot see.
 */
export function fitReview(pool: ReviewPool, review: ReviewContent): ReviewContent {
  const scores: Record<string, number> = {};
  for (const criterion of pool.criteria) {
    const score = review.scores[criterion.key];
    if (
      typeof score === "number" &&
      Number.isInteger(score) &&
      score >= criterion.min &&
      score <= criterion.max
    ) {
      scores[criterion.key] = score;
    }
  }
  return {
    scores,
    comments: review.comments,
    chairNote: pool.form.chairNote.enabled ? review.chairNote : "",
    recommendation: pool.form.recommendation.enabled ? review.recommendation : null,
  };
}
