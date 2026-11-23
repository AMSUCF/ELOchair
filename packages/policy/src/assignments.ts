import {
  type ConferenceConfig,
  callState,
  type DeclineReason,
  findType,
  type Person,
  type Review,
  type ReviewPool,
  type Submission,
} from "@elochair/schema";
import { isConflicted, type SubmissionContext, submissionAccess } from "./access";
import { assignedCount, byName, canManagePeople, type RoleHolder } from "./people";
import { type ChairReview, chairReview, type ReviewDecline } from "./reviews";
import type { PersonViewer, Viewer } from "./viewer";

/*
 * Assigning reviewers to proposals (spec 03, §1.3): who may do it, to which proposals, and who
 * can be offered. The same answers render the chairs' two views (the Reviewers section of a
 * proposal's page, and the Assignments page) and decide the server's refusals.
 *
 * Three rules decide everything here:
 * - Reviewers are managed by a chair of the conference, in person, and only for a proposal that
 *   chair is given as a chair (submissionAccess). Their own proposals and those they have a
 *   conflict with are not theirs to manage: they do not learn who reviews them, by name, by id
 *   or by a number.
 * - An assignment that was released is no longer one: nothing here is told of it. The record
 *   of releases is kept apart, and one thing of it is handed over: who left a proposal because
 *   of a conflict, so that they are never offered for it again.
 * - A reviewer's load is counted as the chair looking may know it (assignedCount).
 *
 * The same views carry the reviews (spec 03, §1.4): a sent review is shown, in full and with
 * its reviewer, to a chair who manages the proposal, and counted for them. A draft is not a
 * chair's to see or to count: these views are handed sent reviews, and read no others.
 */

/**
 * A chair of the conference, in person, who gets the chair view of this proposal: the only one
 * who may see, assign or release its reviewers. Never an agent, whatever its tier, and never a
 * track chair. A chair's own proposal, one they have a conflict with, and work that was never
 * submitted are not given to them as a chair, so they fail here too.
 */
export function canManageReviewers(viewer: Viewer, ctx: SubmissionContext): viewer is PersonViewer {
  return (
    canManagePeople(viewer, ctx.submission.conferenceId) &&
    submissionAccess(viewer, ctx) === "chair"
  );
}

/**
 * Whether a proposal is one that takes new reviewers: it has been submitted and no decision has
 * been recorded for it. A draft and a withdrawn proposal never are. Every other status that an
 * assigned reviewer can still read (accepted, waitlisted, rejected, confirmed) carries a
 * decision: the reviewers it has keep it, and nobody new is asked to judge what is judged.
 */
export function underConsideration(s: Pick<Submission, "status" | "submittedAt">): boolean {
  return s.status === "submitted" && s.submittedAt !== null;
}

/** Whether a reviewer can be assigned to a proposal at `now`, or why not. */
export type TakesReviewers =
  | "yes"
  /** The proposal is not under consideration (underConsideration). */
  | "not_under_consideration"
  /** The call has not closed: its closing date has not passed, in a phase that takes proposals. */
  | "call_not_closed";

export function takesReviewers(ctx: SubmissionContext, now: Date): TakesReviewers {
  if (!underConsideration(ctx.submission)) return "not_under_consideration";
  return callState(ctx.config, ctx.phase, now) === "closed" ? "yes" : "call_not_closed";
}

/** The pool that reviews a proposal's format, if the conference still has both. */
export function reviewPoolOf(ctx: SubmissionContext): ReviewPool | undefined {
  const key = findType(ctx.config, ctx.submission.typeKey)?.reviewPool;
  return ctx.config.reviewPools.find((p) => p.key === key);
}

/** Everything needed to say who reviews what at a conference, and who could. */
export type ReviewersRecord = {
  conferenceId: string;
  config: ConferenceConfig;
  phase: string;
  /**
   * Who holds the reviewer's role at the conference, with its scope: the pools they review for.
   * No scope is every pool.
   */
  reviewers: { personId: string; scope: string[] }[];
  /** What each reviewer said on accepting. A reviewer given the role on the server has none. */
  reviewerProfiles: { personId: string; languages: string[]; maxLoad: number }[];
  /** Person records of the reviewers, and of anyone else who has an assignment. */
  people: Map<string, Person>;
  /** The conference's submissions, each with its assignments. */
  submissions: SubmissionContext[];
  /**
   * By submission id: the reviewers who were released from it because of a conflict. They are
   * never offered for it again. Nothing else of the record of releases is known here.
   */
  conflictReleased: ReadonlyMap<string, readonly string[]>;
  /**
   * The conference's reviews that were sent. A draft is its reviewer's own and is not handed
   * over; one that is handed over all the same is read nowhere here.
   */
  reviews: readonly Review[];
  /** Who said they could not review which proposal, with the reason and their note. */
  declines: readonly ReviewDecline[];
};

/** The sent reviews of one proposal, in the order they were first sent. */
export function sentReviews(rec: Pick<ReviewersRecord, "reviews">, submissionId: string): Review[] {
  return rec.reviews
    .filter((r) => r.submissionId === submissionId && r.status === "sent" && r.sentAt !== null)
    .sort(
      (a, b) =>
        Date.parse(a.sentAt ?? "") - Date.parse(b.sentAt ?? "") || a.id.localeCompare(b.id, "en"),
    );
}

/** Whether someone can be assigned to a proposal: offered, there already, or neither. */
export type ReviewerOffer = "offered" | "assigned" | "not_offered";

/**
 * Whether a person is offered as a reviewer of a proposal. Offered are the reviewers of the pool
 * that reviews its format (a reviewer's role names their pools; no scope is every pool). Never
 * offered: anyone on the proposal, whatever their status (invited, confirmed, or declined);
 * anyone with a conflict with it or with one of its people (isConflicted, as for reading it);
 * and anyone who was released from it because of a conflict. Someone who is assigned to it is
 * there already.
 *
 * One answer covers every reason for not being offered: a refusal never says which it was.
 */
export function reviewerOffer(
  rec: ReviewersRecord,
  ctx: SubmissionContext,
  personId: string,
): ReviewerOffer {
  if (ctx.assignments.some((a) => a.reviewerId === personId)) return "assigned";
  if (!couldReview(rec, ctx, personId)) return "not_offered";
  if (rec.conflictReleased.get(ctx.submission.id)?.includes(personId)) return "not_offered";
  return "offered";
}

/**
 * Whether a person could review a proposal at all: they review for the pool that reviews its
 * format, they are not on it (whatever their status), and they have no conflict with it or with
 * one of its people. It is asked of someone who would be assigned, and of someone who is: what
 * was true when a reviewer was assigned can stop being true (the owner invites them, a conflict
 * is recorded, their pools or the format's pool change), and then they do not count as one of
 * the proposal's reviewers, though their assignment stands until a chair removes them.
 */
export function couldReview(
  rec: ReviewersRecord,
  ctx: SubmissionContext,
  personId: string,
): boolean {
  const pool = reviewPoolOf(ctx);
  const role = rec.reviewers.find((r) => r.personId === personId);
  if (!pool || !role) return false;
  if (role.scope.length > 0 && !role.scope.includes(pool.key)) return false;
  if (ctx.contributions.some((c) => c.personId === personId)) return false;
  return !isConflicted(personId, ctx);
}

/** A reviewer who can be assigned to a proposal, with what a chair needs to choose. */
export type ReviewerCandidate = RoleHolder & {
  /** The languages they said they review in; empty when they were given the role on the server. */
  languages: string[];
  /** Proposals assigned to them, among those the person looking manages (assignedCount). */
  assigned: number;
  /** The most they said they would take; null when they were given the role on the server. */
  maxLoad: number | null;
  /**
   * They have as many as they said they would take, or more. They are offered all the same,
   * after the others: the number is what they offered, not a lock.
   */
  full: boolean;
};

/** A reviewer of a proposal, with when they were assigned to it. */
export type AssignedReviewer = RoleHolder & {
  assignedAt: string;
  /**
   * They can no longer review it (couldReview): they are not counted among its reviewers, and
   * are shown so that a chair can remove them.
   */
  blocked: boolean;
  /**
   * Their review, once it is sent; null until then, whether or not they have begun one. A
   * reviewer whose review is sent is not removed from the proposal: it is part of its record.
   */
  review: ChairReview | null;
};

/** Someone who said they could not review the proposal: why, and what they wrote for the chairs. */
export type DeclinedReviewer = RoleHolder & {
  reason: DeclineReason;
  note: string | null;
  at: string;
};

/** The Reviewers section of a proposal's page, for a chair who manages the proposal. */
export type ProposalReviewers = {
  view: "proposal_reviewers";
  submissionId: string;
  /** The pool that reviews the proposal's format: a "committee" wherever a person reads it. */
  pool: string | null;
  /** How many reviewers that pool asks for per proposal; 0 without a pool. */
  needed: number;
  /** Everyone assigned to it, by name: those who can no longer review it are marked `blocked`. */
  assigned: AssignedReviewer[];
  /**
   * Sent reviews by people who are not assigned to it (any more). The app leaves none: a sent
   * review keeps its assignment. One that exists all the same is still the proposal's.
   */
  otherReviews: (RoleHolder & { review: ChairReview })[];
  /** Who said they could not review it, the latest first. */
  declined: DeclinedReviewer[];
  /** Whether a reviewer can be assigned now, or why not. */
  takes: TakesReviewers;
  /** Who can be assigned, by name, those who have reached their number last. Empty unless `takes` is "yes". */
  candidates: ReviewerCandidate[];
};

const holder = (rec: ReviewersRecord, personId: string): RoleHolder => {
  const p = rec.people.get(personId);
  return { personId, displayName: p?.displayName ?? null, email: p?.email ?? "" };
};

/**
 * A reviewer as a candidate, for the chair looking; null for someone who is not offered for the
 * proposal. The server's refusals read this too, so that what is refused is what was not shown.
 */
export function reviewerCandidate(
  viewer: PersonViewer,
  rec: ReviewersRecord,
  ctx: SubmissionContext,
  personId: string,
): ReviewerCandidate | null {
  if (reviewerOffer(rec, ctx, personId) !== "offered") return null;
  const profile = rec.reviewerProfiles.find((p) => p.personId === personId);
  const assigned = assignedCount(viewer, personId, rec.submissions);
  const maxLoad = profile?.maxLoad ?? null;
  return {
    ...holder(rec, personId),
    languages: [...(profile?.languages ?? [])],
    assigned,
    maxLoad,
    full: maxLoad !== null && assigned >= maxLoad,
  };
}

const submissionOf = (rec: ReviewersRecord, submissionId: string) =>
  rec.submissions.find(
    (s) => s.submission.id === submissionId && s.submission.conferenceId === rec.conferenceId,
  );

/**
 * Who reviews a proposal and who could, for a chair of the conference in person who manages it;
 * null for everyone else, and for a proposal that is not this conference's. `now` decides
 * whether the call has closed.
 */
export function projectProposalReviewers(
  viewer: Viewer,
  rec: ReviewersRecord,
  submissionId: string,
  now: Date,
): ProposalReviewers | null {
  const ctx = submissionOf(rec, submissionId);
  if (!ctx || !canManageReviewers(viewer, ctx)) return null;
  const pool = reviewPoolOf(ctx);
  const takes = takesReviewers(ctx, now);
  const candidates =
    takes === "yes"
      ? [...new Set(rec.reviewers.map((r) => r.personId))]
          .map((id) => reviewerCandidate(viewer, rec, ctx, id))
          .filter((c): c is ReviewerCandidate => c !== null)
      : [];
  const sent = new Map(
    sentReviews(rec, ctx.submission.id).flatMap((r) => {
      const shown = chairReview(ctx, r);
      return shown ? [[r.reviewerId, shown] as const] : [];
    }),
  );
  const assignedIds = new Set(ctx.assignments.map((a) => a.reviewerId));
  return {
    view: "proposal_reviewers",
    submissionId: ctx.submission.id,
    pool: pool?.key ?? null,
    needed: pool?.reviewsPerSubmission ?? 0,
    assigned: byName(
      ctx.assignments.map((a) => ({
        ...holder(rec, a.reviewerId),
        assignedAt: a.createdAt,
        blocked: !couldReview(rec, ctx, a.reviewerId),
        review: sent.get(a.reviewerId) ?? null,
      })),
    ),
    otherReviews: byName(
      [...sent]
        .filter(([reviewerId]) => !assignedIds.has(reviewerId))
        .map(([reviewerId, review]) => ({ ...holder(rec, reviewerId), review })),
    ),
    declined: rec.declines
      .filter((d) => d.submissionId === ctx.submission.id)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map((d) => ({ ...holder(rec, d.reviewerId), reason: d.reason, note: d.note, at: d.at })),
    takes,
    candidates: [
      ...byName(candidates.filter((c) => !c.full)),
      ...byName(candidates.filter((c) => c.full)),
    ],
  };
}

/** One proposal on the Assignments page: what it is, and who reviews it. */
export type AssignmentsProposal = {
  id: string;
  title: string;
  typeKey: string;
  /** Its reviewers, by name: those assigned to it who can review it (couldReview). */
  reviewers: RoleHolder[];
  /** It has fewer such reviewers than its pool asks for. */
  short: boolean;
  /** How many reviews of it were sent. Drafts are not counted: they are their reviewers' own. */
  sent: number;
};

/** One pool on the Assignments page: its totals, and its proposals. */
export type AssignmentsPool = {
  key: string;
  /** How many reviewers the pool asks for per proposal. */
  needed: number;
  /** How many proposals are listed, and how many of them are still short of reviewers. */
  proposals: number;
  short: number;
  /** How many have their reviewers and fewer sent reviews than the pool asks for. */
  waiting: number;
  /**
   * Those still short of reviewers first, then those that have them and still wait for
   * reviews, then the rest; each as they were created (assignmentsPosition).
   */
  items: AssignmentsProposal[];
};

export type AssignmentsView = {
  view: "assignments";
  /** The call has closed: reviewers can be assigned to the proposals listed. */
  callClosed: boolean;
  /**
   * Proposals that take reviewers and are not listed, because the person looking does not
   * manage them: their own, and those they have a conflict with. A number, and nothing else.
   */
  excluded: number;
  /** The conference's pools, in the order of its configuration. */
  pools: AssignmentsPool[];
};

/** 0: still short of reviewers. 1: has them, and waits for reviews. 2: has its reviews. */
export type AssignmentsRank = 0 | 1 | 2;

/**
 * Where a proposal stands in its pool's list: those still short of reviewers first, then those
 * with fewer sent reviews than the pool asks for, then the rest; within each by when it was
 * created, then by id. The server pages the list by this position.
 */
export type AssignmentsPosition = readonly [rank: AssignmentsRank, createdMs: number, id: string];

/** Whether a listed proposal has fewer sent reviews than its pool asks for. */
export const waitsForReviews = (item: Pick<AssignmentsProposal, "sent">, needed: number) =>
  item.sent < needed;

export const assignmentsRank = (
  item: Pick<AssignmentsProposal, "short" | "sent">,
  needed: number,
): AssignmentsRank => (item.short ? 0 : waitsForReviews(item, needed) ? 1 : 2);

export const assignmentsPosition = (
  rank: AssignmentsRank,
  s: Pick<Submission, "createdAt" | "id">,
): AssignmentsPosition => [rank, Date.parse(s.createdAt), s.id];

/** Whether position `a` comes after position `b` in a pool's list. */
export function assignmentsAfter(a: AssignmentsPosition, b: AssignmentsPosition): boolean {
  for (let i = 0; i < 3; i++) {
    const [x, y] = [a[i] as number | string, b[i] as number | string];
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * The Assignments page, for a chair of the conference in person; null for everyone else. By
 * pool: every proposal that takes reviewers and that the chair manages, with who reviews it.
 * `now` decides whether the call has closed.
 */
export function projectAssignments(
  viewer: Viewer,
  rec: ReviewersRecord,
  now: Date,
): AssignmentsView | null {
  if (!canManagePeople(viewer, rec.conferenceId)) return null;
  const open = rec.submissions.filter(
    (s) => s.submission.conferenceId === rec.conferenceId && underConsideration(s.submission),
  );
  const mine = open.filter((s) => canManageReviewers(viewer, s));
  const pools = rec.config.reviewPools.map((pool): AssignmentsPool => {
    const listed = mine
      .filter((s) => reviewPoolOf(s)?.key === pool.key)
      .map((s) => {
        const reviewers = byName(
          s.assignments
            .filter((a) => couldReview(rec, s, a.reviewerId))
            .map((a) => holder(rec, a.reviewerId)),
        );
        const short = reviewers.length < pool.reviewsPerSubmission;
        const item: AssignmentsProposal = {
          id: s.submission.id,
          title: s.submission.title,
          typeKey: s.submission.typeKey,
          reviewers,
          short,
          sent: sentReviews(rec, s.submission.id).length,
        };
        return {
          position: assignmentsPosition(
            assignmentsRank(item, pool.reviewsPerSubmission),
            s.submission,
          ),
          item,
        };
      })
      .sort((a, b) =>
        assignmentsAfter(a.position, b.position)
          ? 1
          : assignmentsAfter(b.position, a.position)
            ? -1
            : 0,
      );
    return {
      key: pool.key,
      needed: pool.reviewsPerSubmission,
      proposals: listed.length,
      short: listed.filter((x) => x.item.short).length,
      waiting: listed.filter((x) => x.position[0] === 1).length,
      items: listed.map((x) => x.item),
    };
  });
  return {
    view: "assignments",
    callClosed: callState(rec.config, rec.phase, now) === "closed",
    excluded: open.length - mine.length,
    pools,
  };
}
