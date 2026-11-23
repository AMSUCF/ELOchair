import type { ReviewPool } from "@elochair/schema";
import { fitReview, RECOMMENDATIONS, type ReviewContent } from "@elochair/schema/pure";
import type { UnsavedValues } from "./unsaved";

/*
 * A review's unsaved changes, as the browser keeps them (unsaved.ts): what the reviewer typed
 * or chose since the last save, by form path. "scores.<criterion>" holds a number, or null for
 * a score taken back; "comments" and "chairNote" hold text; "recommendation" holds one of the
 * three, or null.
 *
 * What comes back is checked against the form as it is now, as a proposal's unsaved text is
 * (unsavedProposal.ts): a score for a criterion that is gone or off its scale, a note or a
 * recommendation the form no longer has, and a value of the wrong kind are left out, so they
 * are neither shown nor sent.
 */

/** Where the browser keeps a review's unsaved changes: by the proposal, under the reviewer. */
export const reviewScope = (submissionId: string) => `review:${submissionId}`;

const scoreKeys = (a: ReviewContent, b: ReviewContent) => [
  ...new Set([...Object.keys(a.scores), ...Object.keys(b.scores)]),
];

/** The differences between the saved review and the form, by path. None: nothing is unsaved. */
export function unsavedOfReview(base: ReviewContent, form: ReviewContent): UnsavedValues {
  const out: UnsavedValues = {};
  for (const key of scoreKeys(base, form)) {
    if (base.scores[key] !== form.scores[key]) out[`scores.${key}`] = form.scores[key] ?? null;
  }
  if (base.comments !== form.comments) out.comments = form.comments;
  if (base.chairNote !== form.chairNote) out.chairNote = form.chairNote;
  if (base.recommendation !== form.recommendation) out.recommendation = form.recommendation;
  return out;
}

/**
 * `base` with unsaved values from the browser put back, as far as the pool's form still takes
 * them: a value the form has no place for now is left out, and the saved answer stays. The
 * saved review is fitted to the form too (fitReview): the page starts from what its reviewer
 * can see and change.
 */
export function withUnsavedReview(
  base: ReviewContent,
  values: UnsavedValues,
  pool: ReviewPool,
): ReviewContent {
  const out: ReviewContent = { ...base, scores: { ...base.scores } };
  for (const [path, v] of Object.entries(values)) {
    if (path === "comments") {
      if (typeof v === "string") out.comments = v;
    } else if (path === "chairNote") {
      if (typeof v === "string" && pool.form.chairNote.enabled) out.chairNote = v;
    } else if (path === "recommendation") {
      if (!pool.form.recommendation.enabled) continue;
      if (v === null) out.recommendation = null;
      else {
        const known = RECOMMENDATIONS.find((r) => r === v);
        if (known) out.recommendation = known;
      }
    } else if (path.startsWith("scores.")) {
      const key = path.slice("scores.".length);
      const criterion = pool.criteria.find((c) => c.key === key);
      if (!criterion) continue;
      if (v === null) delete out.scores[key];
      else if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        v >= criterion.min &&
        v <= criterion.max
      ) {
        out.scores[key] = v;
      }
    }
  }
  return fitReview(pool, out);
}
