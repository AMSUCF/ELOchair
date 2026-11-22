import {
  type ConferenceConfig,
  callState,
  findType,
  type Person,
  type ReviewPool,
  type Submission,
} from "@elochair/schema";
import {
  activeAssignments,
  isConflicted,
  type SubmissionContext,
  submissionAccess,
} from "./access";
import { assignedCount, byName, canManagePeople, type RoleHolder } from "./people";
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
 * - Only active assignments exist here. A released one is never handed over (see
 *   SubmissionContext.assignments), with one exception: the reviewers released from a proposal
 *   because of a conflict are named to the record, so that they are never offered for it again.
 * - A reviewer's load is counted as the chair looking may know it (assignedCount).
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
  /** Person records of the reviewers, and of anyone else who has an active assignment. */
  people: Map<string, Person>;
  /** The conference's submissions, each with its active assignments. */
  submissions: SubmissionContext[];
  /**
   * By submission id: the reviewers who were released from it because of a conflict. They are
   * never offered for it again. Nothing else about a released assignment is known here.
   */
  conflictReleased: ReadonlyMap<string, readonly string[]>;
};

/** Whether someone can be assigned to a proposal: offered, there already, or neither. */
export type ReviewerOffer = "offered" | "assigned" | "not_offered";

/**
 * Whether a person is offered as a reviewer of a proposal. Offered are the reviewers of the pool
 * that reviews its format (a reviewer's role names their pools; no scope is every pool). Never
 * offered: anyone on the proposal, whatever their status (invited, confirmed, or declined);
 * anyone with a conflict with it or with one of its people (isConflicted, as for reading it);
 * and anyone who was released from it because of a conflict. Someone who has an active
 * assignment to it is there already.
 *
 * One answer covers every reason for not being offered: a refusal never says which it was.
 */
export function reviewerOffer(
  rec: ReviewersRecord,
  ctx: SubmissionContext,
  personId: string,
): ReviewerOffer {
  if (activeAssignments(ctx).some((a) => a.reviewerId === personId)) return "assigned";
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
  return {
    view: "proposal_reviewers",
    submissionId: ctx.submission.id,
    pool: pool?.key ?? null,
    needed: pool?.reviewsPerSubmission ?? 0,
    assigned: byName(
      activeAssignments(ctx).map((a) => ({
        ...holder(rec, a.reviewerId),
        assignedAt: a.createdAt,
        blocked: !couldReview(rec, ctx, a.reviewerId),
      })),
    ),
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
};

/** One pool on the Assignments page: its totals, and its proposals. */
export type AssignmentsPool = {
  key: string;
  /** How many reviewers the pool asks for per proposal. */
  needed: number;
  /** How many proposals are listed, and how many of them are still short of reviewers. */
  proposals: number;
  short: number;
  /** Those still short first; then as they were created (assignmentsPosition). */
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

/**
 * Where a proposal stands in its pool's list: those still short of reviewers first, then by
 * when it was created, then by id. The server pages the list by this position.
 */
export type AssignmentsPosition = readonly [rank: 0 | 1, createdMs: number, id: string];

export const assignmentsPosition = (
  short: boolean,
  s: Pick<Submission, "createdAt" | "id">,
): AssignmentsPosition => [short ? 0 : 1, Date.parse(s.createdAt), s.id];

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
          activeAssignments(s)
            .filter((a) => couldReview(rec, s, a.reviewerId))
            .map((a) => holder(rec, a.reviewerId)),
        );
        const short = reviewers.length < pool.reviewsPerSubmission;
        return {
          position: assignmentsPosition(short, s.submission),
          item: {
            id: s.submission.id,
            title: s.submission.title,
            typeKey: s.submission.typeKey,
            reviewers,
            short,
          },
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
