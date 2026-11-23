import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConferenceConfig, type ConferenceConfigInput, type ReviewPool } from "./config";
import { Review } from "./domain";
import { DeclineReviewInput, ReviewInput, RoleRemovalInput } from "./inputs";
import {
  DECLINE_REASONS,
  EMPTY_REVIEW,
  fitReview,
  RECOMMENDATIONS,
  type ReviewContent,
  reviewContentIssues,
  reviewIssues,
  reviewPoolFor,
  SCALE_CHOICES_MAX,
  scaleChoices,
} from "./reviewForm";

/*
 * The review form (spec 03, §1.4 and §1.8): what keeps a review from being sent, what a draft
 * may hold, and what a form no longer has a place for. A made-up conference with two pools: one
 * whose form is as the app words it, and one whose chairs set everything.
 */

const input: ConferenceConfigInput = {
  slug: "review-form-test",
  year: 2031,
  title: { en: "Made-up meeting" },
  theme: { en: "Nothing in particular" },
  host: "Instituto Inventado",
  location: { en: "Nowhere" },
  modality: "online",
  timezone: "America/Bogota",
  defaultLanguage: "en",
  languages: ["en", "es"],
  contactEmail: "meeting@example.org",
  dates: { start: "2031-08-03", end: "2031-08-06" },
  deadlines: {
    submissionsOpen: "2031-01-11T00:00:00-05:00",
    submissionsClose: "2031-02-14T23:59:00-12:00",
    notification: "2031-04-30T23:59:00-05:00",
    finalMaterials: "2031-05-31T23:59:00-05:00",
  },
  rules: { presenterCap: null },
  reviewPools: [
    {
      key: "plain",
      name: { en: "Plain committee" },
      blindMode: "double",
      reviewsPerSubmission: 2,
      criteria: [
        { key: "fit", label: { en: "Fit" } },
        { key: "clarity", label: { en: "Clarity" } },
      ],
    },
    {
      key: "worded",
      name: { en: "Worded committee" },
      blindMode: "single",
      reviewsPerSubmission: 1,
      criteria: [{ key: "merit", label: { en: "Merit" }, min: 0, max: 10 }],
      form: {
        comments: { minWords: 5, maxWords: 8 },
        chairNote: { enabled: false },
        recommendation: { enabled: false },
      },
    },
  ],
  submissionTypes: [
    {
      key: "talk",
      name: { en: "Talk" },
      description: { en: "A talk." },
      reviewPool: "plain",
      abstract: { label: { en: "Abstract" }, maxWords: 300 },
      team: { min: 1, max: 3 },
    },
    {
      key: "work",
      name: { en: "Work" },
      description: { en: "A work." },
      reviewPool: "worded",
      abstract: { label: { en: "Statement" }, maxWords: 300 },
      team: { min: 1, max: 3 },
    },
  ],
};
const config = ConferenceConfig.parse(input);
const [plain, worded] = config.reviewPools as [ReviewPool, ReviewPool];

const full: ReviewContent = {
  scores: { fit: 4, clarity: 2 },
  comments: "A clear argument, well made.",
  chairNote: "",
  recommendation: "accept",
};
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("the form a format's reviewers fill in", () => {
  it("is its pool's: found by the format, and nothing for a format the conference lacks", () => {
    expect(reviewPoolFor(config, "talk")?.key).toBe("plain");
    expect(reviewPoolFor(config, "work")?.key).toBe("worded");
    expect(reviewPoolFor(config, "nope")).toBeUndefined();
  });

  it("lists a scale from its smallest score to its largest, where it fits one row of choices", () => {
    expect(scaleChoices({ min: 1, max: 5 })).toEqual([1, 2, 3, 4, 5]);
    expect(scaleChoices({ min: 0, max: 10 })).toHaveLength(SCALE_CHOICES_MAX);
    expect(scaleChoices({ min: -2, max: -1 })).toEqual([-2, -1]);
    expect(scaleChoices({ min: 3, max: 3 })).toEqual([3]);
  });

  it("lists nothing for a wider scale, however wide: its score is typed", () => {
    expect(scaleChoices({ min: 0, max: 11 })).toBeNull();
    expect(scaleChoices({ min: 1, max: 100 })).toBeNull();
    // The settings put no bound on a scale. Nothing here counts through one.
    const began = Date.now();
    expect(scaleChoices({ min: 0, max: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(scaleChoices({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(Date.now() - began).toBeLessThan(1000);
    // A scale written backwards is refused by the settings; it lists nothing here either.
    expect(scaleChoices({ min: 5, max: 1 })).toBeNull();
  });
});

describe("what keeps a review from being sent", () => {
  it("nothing, when every criterion is scored, the comments are written and a recommendation is given", () => {
    expect(reviewIssues(plain, full)).toEqual([]);
    // The note for the chairs is always optional.
    expect(reviewIssues(plain, { ...full, chairNote: "Between us." })).toEqual([]);
  });

  it("a criterion without a score, comments that are missing, and a missing recommendation", () => {
    expect(reviewIssues(plain, EMPTY_REVIEW)).toEqual([
      { path: "scores.fit", code: "required" },
      { path: "scores.clarity", code: "required" },
      { path: "comments", code: "required" },
      { path: "recommendation", code: "required" },
    ]);
    // Blank is not written.
    expect(reviewIssues(plain, { ...full, comments: "  \n " })).toEqual([
      { path: "comments", code: "required" },
    ]);
  });

  it("a score that is not on its criterion's scale, or not a whole number", () => {
    const scored = (fit: number) => reviewIssues(plain, { ...full, scores: { fit, clarity: 2 } });
    for (const ok of [1, 3, 5]) expect(scored(ok), `${ok}`).toEqual([]);
    for (const off of [0, 6, -1, 100]) {
      expect(scored(off), `${off}`).toEqual([
        { path: "scores.fit", code: "out_of_range", params: { min: 1, max: 5 } },
      ]);
    }
    expect(scored(2.5)).toEqual([{ path: "scores.fit", code: "not_integer" }]);
    // Each criterion on its own scale: 0 and 10 are scores where the chairs said so.
    const merit = (n: number) =>
      reviewIssues(worded, { ...EMPTY_REVIEW, scores: { merit: n }, comments: words(6) });
    expect(merit(0)).toEqual([]);
    expect(merit(10)).toEqual([]);
    expect(merit(11)).toEqual([
      { path: "scores.merit", code: "out_of_range", params: { min: 0, max: 10 } },
    ]);
  });

  it("comments outside the pool's word limits, with the count as the reviewer sees it", () => {
    const commented = (n: number) =>
      reviewIssues(worded, { ...EMPTY_REVIEW, scores: { merit: 5 }, comments: words(n) });
    expect(commented(4)).toEqual([
      { path: "comments", code: "too_few_words", params: { min: 5, count: 4 } },
    ]);
    expect(commented(5)).toEqual([]);
    expect(commented(8)).toEqual([]);
    expect(commented(9)).toEqual([
      { path: "comments", code: "too_many_words", params: { max: 8, count: 9 } },
    ]);
    // A pool that sets no limit takes any length.
    expect(reviewIssues(plain, { ...full, comments: words(5000) })).toEqual([]);
    expect(reviewIssues(plain, { ...full, comments: "One." })).toEqual([]);
  });

  it("asks for no recommendation where the form has none, and takes none", () => {
    const base = { ...EMPTY_REVIEW, scores: { merit: 5 }, comments: words(6) };
    expect(reviewIssues(worded, base)).toEqual([]);
    expect(reviewIssues(worded, { ...base, recommendation: "reject" })).toEqual([
      { path: "recommendation", code: "not_on_form" },
    ]);
    expect(reviewIssues(worded, { ...base, chairNote: "Between us." })).toEqual([
      { path: "chairNote", code: "not_on_form" },
    ]);
  });
});

describe("what a draft may hold", () => {
  it("as little as it likes: nothing at all is a draft", () => {
    expect(reviewContentIssues(plain, EMPTY_REVIEW)).toEqual([]);
    expect(reviewContentIssues(plain, { ...EMPTY_REVIEW, scores: { fit: 3 } })).toEqual([]);
    expect(reviewContentIssues(worded, { ...EMPTY_REVIEW, comments: "Too short." })).toEqual([]);
  });

  it("never an answer the form has no place for, or a score off its scale", () => {
    expect(
      reviewContentIssues(plain, { ...EMPTY_REVIEW, scores: { fit: 9, merit: 3, clarity: 1.5 } }),
    ).toEqual([
      { path: "scores.fit", code: "out_of_range", params: { min: 1, max: 5 } },
      { path: "scores.merit", code: "not_on_form" },
      { path: "scores.clarity", code: "not_integer" },
    ]);
    expect(
      reviewContentIssues(worded, {
        ...EMPTY_REVIEW,
        chairNote: "Between us.",
        recommendation: "unsure",
      }),
    ).toEqual([
      { path: "chairNote", code: "not_on_form" },
      { path: "recommendation", code: "not_on_form" },
    ]);
    // A note of spaces is no note.
    expect(reviewContentIssues(worded, { ...EMPTY_REVIEW, chairNote: "  " })).toEqual([]);
  });

  it("everything a draft may not hold keeps a review from being sent too", () => {
    const anyReview = fc.record({
      scores: fc.dictionary(
        fc.constantFrom("fit", "clarity", "merit", "other"),
        fc.oneof(fc.integer({ min: -3, max: 12 }), fc.constant(2.5)),
      ),
      comments: fc.constantFrom("", "  ", words(3), words(6), words(20)),
      chairNote: fc.constantFrom("", " ", "Between us."),
      recommendation: fc.constantFrom(null, ...RECOMMENDATIONS),
    });
    fc.assert(
      fc.property(anyReview, fc.constantFrom(plain, worded), (review, pool) => {
        const draft = reviewContentIssues(pool, review);
        const sent = reviewIssues(pool, review);
        for (const issue of draft) expect(sent).toContainEqual(issue);
        // And what the form can show of it holds nothing a draft may not hold.
        expect(reviewContentIssues(pool, fitReview(pool, review))).toEqual([]);
      }),
    );
  });
});

describe("a review as the form can show it now", () => {
  it("is itself while the form has a place for everything in it", () => {
    expect(fitReview(plain, full)).toEqual(full);
    expect(fitReview(plain, EMPTY_REVIEW)).toEqual(EMPTY_REVIEW);
  });

  it("leaves out a score for a criterion that is gone or off its scale, and what the form no longer has", () => {
    expect(
      fitReview(plain, { ...full, scores: { fit: 9, clarity: 2, merit: 3 }, chairNote: "Keep." }),
    ).toEqual({ ...full, scores: { clarity: 2 }, chairNote: "Keep." });
    expect(
      fitReview(worded, {
        scores: { merit: 10, fit: 4 },
        comments: "Stays as written.",
        chairNote: "Goes: this form has no note.",
        recommendation: "accept",
      }),
    ).toEqual({
      scores: { merit: 10 },
      comments: "Stays as written.",
      chairNote: "",
      recommendation: null,
    });
  });
});

describe("what a reviewer may send", () => {
  const input = { version: 0, send: false, ...EMPTY_REVIEW };
  const ok = (v: unknown) => ReviewInput.safeParse(v).success;

  it("a whole review every time, with the version it was made on", () => {
    expect(ok(input)).toBe(true);
    expect(ok({ ...input, version: 3, send: true, ...full })).toBe(true);
    for (const missing of [
      "version",
      "send",
      "scores",
      "comments",
      "chairNote",
      "recommendation",
    ]) {
      const { [missing as keyof typeof input]: _gone, ...rest } = input;
      expect(ok(rest), missing).toBe(false);
    }
  });

  it("never who reviews, which proposal, or whether it counts as sent already", () => {
    for (const more of [
      { reviewerId: "00000000-0000-4000-8000-000000000001" },
      { submissionId: "00000000-0000-4000-8000-000000000001" },
      { status: "sent" },
      { sentAt: "2031-03-01T00:00:00Z" },
      { conferenceId: "00000000-0000-4000-8000-000000000001" },
    ]) {
      expect(ok({ ...input, ...more }), JSON.stringify(more)).toBe(false);
    }
  });

  it("scores as whole numbers under machine keys, text within its limits, one of three recommendations", () => {
    for (const bad of [
      { scores: { fit: 2.5 } },
      { scores: { fit: "4" } },
      { scores: { "Not A Key": 4 } },
      { scores: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 1])) },
      { comments: "x".repeat(20_001) },
      { chairNote: "x".repeat(20_001) },
      { comments: "half a character \uD83D" },
      { comments: "a control \u0000 character" },
      { recommendation: "maybe" },
      { recommendation: "" },
      { version: -1 },
      { version: 1.5 },
      { send: "yes" },
    ]) {
      expect(ok({ ...input, ...bad }), JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    expect(ok({ ...input, comments: "Line one.\n\nLine two.\tTabbed." })).toBe(true);
    expect(ok({ ...input, comments: "x".repeat(20_000) })).toBe(true);
    // A score is any whole number: its scale is its criterion's, which the settings do not
    // bound, and is checked against the form, not here.
    for (const score of [0, -3, 5_000_000_000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(ok({ ...input, scores: { fit: score } }), String(score)).toBe(true);
    }
    for (const score of [2 ** 53, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(ok({ ...input, scores: { fit: score } }), String(score)).toBe(false);
    }
    // And the form takes it where the scale reaches that far.
    const wide = { ...plain, criteria: [{ ...plain.criteria[0], min: 0, max: 6_000_000_000 }] };
    expect(
      reviewContentIssues(wide as typeof plain, {
        ...full,
        scores: { [wide.criteria[0]?.key ?? ""]: 5_000_000_000 },
      }),
    ).toEqual([]);
  });

  it("that they cannot review a proposal: one of three reasons, and a short note if they like", () => {
    const declines = (v: unknown) => DeclineReviewInput.safeParse(v).success;
    for (const reason of DECLINE_REASONS) {
      expect(declines({ reason }), reason).toBe(true);
      expect(declines({ reason, note: "Away until April." }), reason).toBe(true);
    }
    for (const bad of [
      {},
      // The two reasons that are a chair's are not a reviewer's to give.
      { reason: "chair" },
      { reason: "role_removed" },
      { reason: "other" },
      { reason: "time", note: "x".repeat(2001) },
      { reason: "time", note: 5 },
      // Nothing in it can name a proposal or a person.
      { reason: "time", reviewerId: "00000000-0000-4000-8000-000000000001" },
      { reason: "time", submissionId: "00000000-0000-4000-8000-000000000001" },
    ]) {
      expect(declines(bad), JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });

  it("a reviewer's removal names two numbers: the proposals assigned, and the reviews sent", () => {
    expect(RoleRemovalInput.safeParse({ assignments: 3, reviews: 1 }).success).toBe(true);
    expect(RoleRemovalInput.safeParse({ assignments: 3 }).success).toBe(true);
    for (const bad of [{ reviews: -1 }, { reviews: 1.5 }, { reviews: "1" }, { sent: 1 }]) {
      expect(RoleRemovalInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("a review as a record", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const review = {
    id: id(1),
    conferenceId: id(2),
    submissionId: id(3),
    reviewerId: id(4),
    version: 1,
    status: "draft",
    scores: {},
    comments: "",
    chairNote: "",
    recommendation: null,
    createdAt: "2031-03-01T12:00:00Z",
    updatedAt: "2031-03-01T12:00:00Z",
    sentAt: null,
  };
  const ok = (v: unknown) => Review.safeParse(v).success;

  it("is a draft or sent, of one proposal by one reviewer", () => {
    expect(ok(review)).toBe(true);
    expect(
      ok({ ...review, status: "sent", sentAt: "2031-03-02T12:00:00Z", ...full, version: 2 }),
    ).toBe(true);
    for (const bad of [
      { status: "released" },
      { status: "withdrawn" },
      { reviewerId: null },
      { submissionId: null },
      { recommendation: "maybe" },
      { scores: { fit: 2.5 } },
      { version: 0 },
    ]) {
      expect(ok({ ...review, ...bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  it("holds nothing of an assignment: a review belongs to a proposal and a reviewer", () => {
    expect(Object.keys(Review.shape)).not.toContain("assignmentId");
    expect(Object.keys(Review.shape).sort()).toEqual(Object.keys(review).sort());
  });
});
