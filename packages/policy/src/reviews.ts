import {
  type ConferenceConfig,
  type DeclineReason,
  findType,
  type LocalizedText,
  type Recommendation,
  type Review,
  type ReviewPool,
  reviewersCanRead,
} from "@elochair/schema";
import {
  isAssignedReviewer,
  isConflicted,
  type SubmissionContext,
  submissionAccess,
} from "./access";
import { reviewerPools } from "./people";
import { renderSubmission, type SubmissionRecord } from "./projections";
import { hasRole, type PersonViewer, type Viewer } from "./viewer";

/*
 * Reviews (spec 03, §1.4 and §1.5): who may write one, and what anyone is shown of one.
 *
 * Four rules decide everything here:
 * - A review is written by the person the policy gives a reviewer's view of the proposal
 *   (submissionAccess: the role, the committee, an assignment that stands, no conflict, a
 *   proposal reviewers still read), in person, and only while the conference is in `reviewing`.
 *   Never an agent, whatever its tier. A chair who also reviews, and is assigned, is given the
 *   proposal as a chair, which shows more than a reviewer's view: they are its reviewer all the
 *   same (isReviewerOf).
 * - A reviewer is shown their own review and nothing of anyone else's: not who else reviews
 *   the proposal, not what they wrote, not what was decided.
 * - A draft is its reviewer's own. Nothing here hands a chair a draft, or a sign that one
 *   exists: the chairs' views take sent reviews only.
 * - A chair is shown a sent review, and who wrote it, only for a proposal they manage as a
 *   chair (canManageReviewers in assignments.ts): never their own, never one they have a
 *   conflict with.
 *
 * Authors are shown nothing of reviews in this step, and neither is any agent: every
 * projection here answers null for an agent of either tier. Tier M is for cloud agents and
 * never gets review text or who reviews; tier C has no view of reviews yet either.
 */

/** The phase in which reviews are written, sent and changed. In any later one they are read. */
export const reviewsOpen = (phase: string): boolean => phase === "reviewing";

/**
 * A person who reviews the proposal, as things stand: someone the policy gives a reviewer's
 * view of it, or a chair who is given it as a chair and is also assigned to it as a reviewer of
 * its committee (a chair may review like anyone, never their own proposal or one they have a
 * conflict with: those are not given to them as a chair). Never an agent.
 */
export function isReviewerOf(viewer: Viewer, ctx: SubmissionContext): viewer is PersonViewer {
  if (viewer.kind !== "person") return false;
  const access = submissionAccess(viewer, ctx);
  return access.startsWith("reviewer_") || (access === "chair" && isAssignedReviewer(viewer, ctx));
}

/**
 * Whether the viewer may write, send or change a review of the proposal now, and may say that
 * they cannot review it: its reviewer, in person, while the conference is in `reviewing`.
 */
export function canWriteReview(viewer: Viewer, ctx: SubmissionContext): viewer is PersonViewer {
  return isReviewerOf(viewer, ctx) && reviewsOpen(ctx.phase);
}

/**
 * Whether a proposal's reviews are kept from a person whatever role they hold: they are one of
 * its people (invited or confirmed), or have a conflict with it. Such a person is never shown a
 * review of it, nor that one exists. Whatever is worked out for a chair from the conference's
 * reviews (the guard on the review form's settings) leaves the reviews of these proposals
 * unread, and may depend on them in no way.
 */
export function reviewsKeptFrom(viewer: PersonViewer, ctx: SubmissionContext): boolean {
  const own = ctx.contributions.find((c) => c.personId === viewer.personId);
  return (own !== undefined && own.status !== "declined") || isConflicted(viewer.personId, ctx);
}

/** Where a reviewer's own review of a proposal stands. */
export type OwnReviewStatus = "not_started" | "draft" | "sent";

/** A reviewer's own review of a proposal assigned to them, as they are shown it. */
export type OwnReview = {
  view: "own_review";
  submissionId: string;
  status: OwnReviewStatus;
  /** The version a save must name; 0 while nothing has been saved. */
  version: number;
  scores: Record<string, number>;
  comments: string;
  chairNote: string;
  recommendation: Recommendation | null;
  /** When it was first sent, and when it was last saved; null where it was not. */
  sentAt: string | null;
  updatedAt: string | null;
  /** The conference is in review: the review can be saved, sent and changed. */
  open: boolean;
  /** "I cannot review this" is offered: the conference is in review, and nothing was sent. */
  canDecline: boolean;
};

const mine = (viewer: PersonViewer, ctx: SubmissionContext, review: Review | null | undefined) =>
  review && review.reviewerId === viewer.personId && review.submissionId === ctx.submission.id
    ? review
    : null;

/** The pool that reviews a proposal's format, if the conference still has both. */
const poolOf = (ctx: Pick<SubmissionContext, "config" | "submission">): ReviewPool | undefined => {
  const key = findType(ctx.config, ctx.submission.typeKey)?.reviewPool;
  return ctx.config.reviewPools.find((p) => p.key === key);
};

/** Scores for the pool's own criteria, and nothing under any other key. */
const scoresOf = (pool: ReviewPool | undefined, review: Review): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const criterion of pool?.criteria ?? []) {
    const score = review.scores[criterion.key];
    if (typeof score === "number") out[criterion.key] = score;
  }
  return out;
};

/**
 * A reviewer's own review of a proposal; null for anyone who is not given the proposal as its
 * reviewer (a stranger, the proposal's own people, a chair, someone whose assignment was
 * released, any agent). `review` is the viewer's own row, or nothing: a review that is someone
 * else's, or of another proposal, is never shown, whatever was handed in.
 */
export function projectOwnReview(
  viewer: Viewer,
  ctx: SubmissionContext,
  review: Review | null | undefined,
): OwnReview | null {
  if (!isReviewerOf(viewer, ctx)) return null;
  const own = mine(viewer, ctx, review);
  const open = reviewsOpen(ctx.phase);
  return {
    view: "own_review",
    submissionId: ctx.submission.id,
    status: own ? own.status : "not_started",
    version: own?.version ?? 0,
    scores: own ? scoresOf(poolOf(ctx), own) : {},
    comments: own?.comments ?? "",
    chairNote: own?.chairNote ?? "",
    recommendation: own?.recommendation ?? null,
    sentAt: own?.sentAt ?? null,
    updatedAt: own?.updatedAt ?? null,
    open,
    canDecline: open && own?.status !== "sent",
  };
}

/** A sent review as a chair who manages its proposal reads it: all of it, and when. */
export type ChairReview = {
  scores: Record<string, number>;
  comments: string;
  chairNote: string;
  recommendation: Recommendation | null;
  sentAt: string;
  /** When it was last changed, if that was after it was first sent. */
  changedAt: string | null;
};

/**
 * A review for a chair's view of its proposal; null for a draft, which is never a chair's to
 * see. Who may be handed this at all is decided by the caller (projectProposalReviewers).
 */
export function chairReview(ctx: SubmissionContext, review: Review): ChairReview | null {
  if (review.status !== "sent" || !review.sentAt) return null;
  if (review.submissionId !== ctx.submission.id) return null;
  return {
    scores: scoresOf(poolOf(ctx), review),
    comments: review.comments,
    chairNote: review.chairNote,
    recommendation: review.recommendation,
    sentAt: review.sentAt,
    changedAt: Date.parse(review.updatedAt) > Date.parse(review.sentAt) ? review.updatedAt : null,
  };
}

/** Someone who said they could not review a proposal, as the record of releases holds it. */
export type ReviewDecline = {
  submissionId: string;
  reviewerId: string;
  reason: DeclineReason;
  /** What they wrote for the chairs, if anything. */
  note: string | null;
  at: string;
};

/** One proposal on a reviewer's list: what it is, and where their review of it stands. */
export type MyReviewsRow = {
  submissionId: string;
  title: string;
  typeKey: string;
  /** The language of its abstract. */
  language: string;
  status: OwnReviewStatus;
};

/** A reviewer's list for one conference: "My reviews". */
export type MyReviews = {
  view: "my_reviews";
  conference: {
    slug: string;
    title: LocalizedText;
    timezone: string;
    defaultLanguage: string;
  };
  /** The conference is in review: reviews can be written. Later, they are read. */
  open: boolean;
  /** The day reviews are due, where the chairs set one. It locks nothing. */
  reviewsDue: string | null;
  counts: { sent: number; draft: number; notStarted: number };
  /** The committees they review for, each with the chairs' guidelines where there are any. */
  committees: { key: string; name: LocalizedText; guidelines: LocalizedText | null }[];
  /** The names of the formats of the proposals listed, by format key. */
  formats: Record<string, LocalizedText>;
  /** Drafts first, then those not started, then those sent. */
  proposals: MyReviewsRow[];
};

const RANK: Record<OwnReviewStatus, number> = { draft: 0, not_started: 1, sent: 2 };

/**
 * A reviewer's own list for a conference; null for anyone who does not hold the reviewer's role
 * there, for an agent, and while the conference's reviewers cannot read yet (before
 * `reviewing`). It lists the proposals this person reviews (isReviewerOf), and nothing else:
 * each row is taken from the projection of the proposal that the policy gives them (a
 * reviewer's; a chair's, for a chair who also reviews), so it holds nothing that projection
 * does not. `reviews` are counted only where they are this person's own.
 */
export function projectMyReviews(
  viewer: Viewer,
  conference: { id: string; slug: string; phase: string; config: ConferenceConfig },
  records: readonly SubmissionRecord[],
  reviews: readonly Review[],
): MyReviews | null {
  if (viewer.kind !== "person") return null;
  const role = hasRole(viewer, conference.id, ["reviewer"]);
  if (!role || !reviewersCanRead(conference.phase)) return null;
  const { config } = conference;
  const own = new Map(
    reviews.filter((r) => r.reviewerId === viewer.personId).map((r) => [r.submissionId, r]),
  );
  const proposals: MyReviewsRow[] = [];
  for (const rec of records) {
    if (rec.submission.conferenceId !== conference.id) continue;
    if (!isReviewerOf(viewer, rec)) continue;
    const shown = renderSubmission(submissionAccess(viewer, rec), rec);
    if (shown?.view !== "reviewer" && shown?.view !== "chair") continue;
    proposals.push({
      submissionId: shown.id,
      title: shown.title,
      typeKey: shown.typeKey,
      language: shown.language,
      status: own.get(shown.id)?.status ?? "not_started",
    });
  }
  // Stable: within a status, the order the proposals were handed in (as they were created).
  const sorted = proposals
    .map((row, i) => ({ row, i }))
    .sort((a, b) => RANK[a.row.status] - RANK[b.row.status] || a.i - b.i)
    .map((x) => x.row);
  const count = (status: OwnReviewStatus) => sorted.filter((p) => p.status === status).length;
  const poolKeys = reviewerPools(
    role.scope,
    config.reviewPools.map((p) => p.key),
  );
  const formats: Record<string, LocalizedText> = {};
  for (const row of sorted) {
    const type = findType(config, row.typeKey);
    if (type) formats[type.key] = { ...type.name };
  }
  return {
    view: "my_reviews",
    conference: {
      slug: conference.slug,
      title: { ...config.title },
      timezone: config.timezone,
      defaultLanguage: config.defaultLanguage,
    },
    open: reviewsOpen(conference.phase),
    reviewsDue: config.deadlines.reviewsDue ?? null,
    counts: { sent: count("sent"), draft: count("draft"), notStarted: count("not_started") },
    committees: config.reviewPools
      .filter((p) => poolKeys.includes(p.key))
      .map((p) => ({
        key: p.key,
        name: { ...p.name },
        guidelines: p.guidelines ? { ...p.guidelines } : null,
      })),
    formats,
    proposals: sorted,
  };
}
