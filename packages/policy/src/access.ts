import {
  type ActiveAssignment,
  type BlindMode,
  type ConferenceConfig,
  type Conflict,
  type Contribution,
  effectiveBlindMode,
  findType,
  isActiveAssignment,
  reviewersCanRead,
  type Submission,
} from "@elochair/schema";
import { hasRole, isConferenceChair, type PersonViewer, type Viewer } from "./viewer";

/** Everything needed to decide who may see a submission. */
export type SubmissionContext = {
  config: ConferenceConfig;
  /**
   * The phase the conference is in. An assigned reviewer reads the proposal from `reviewing` on
   * (spec 03, §1.3). A phase that is not one is not a phase of review.
   */
  phase: string;
  submission: Submission;
  contributions: Contribution[];
  /**
   * The active assignments for this submission. A released one is not put here (the server's
   * loader leaves it out), and counts for nothing if it is: read them through
   * activeAssignments().
   */
  assignments: ActiveAssignment[];
  /** Conflicts that name this submission or any of its contributors. */
  conflicts: Conflict[];
};

/**
 * The assignments of a submission that count: those that have not been released. Everything in
 * this package that decides or counts by assignments reads them here, so that a released
 * reviewer is a stranger to the proposal again, whatever a caller hands over.
 */
export function activeAssignments(ctx: Pick<SubmissionContext, "assignments">): ActiveAssignment[] {
  return ctx.assignments.filter(isActiveAssignment);
}

export type Access =
  | "none"
  | "public"
  | "metadata"
  /** Tier M view of the owner's own submission: no reviewer assignments. */
  | "metadata_own"
  | `reviewer_${BlindMode}`
  /** Owner or confirmed co-author: the full submission, every live contributor. */
  | "submitter"
  /** Invited, not yet confirmed: the submission, but other contributors' emails stay hidden. */
  | "invitee"
  | "chair";

const REVIEWABLE = new Set(["submitted", "accepted", "waitlisted", "rejected", "confirmed"]);

/**
 * Whether a submission is in a status its assigned reviewers still read: submitted, or carrying
 * a decision. A withdrawn one is not, and neither is a draft: an assignment to it is nobody's
 * work, and is not counted as a reviewer's load.
 */
export const isReviewable = (s: Pick<Submission, "status">): boolean => REVIEWABLE.has(s.status);

/** Never submitted: a draft in all but name (e.g. withdrawn before ever being submitted). */
export function isNeverSubmitted(s: Pick<Submission, "status" | "submittedAt">): boolean {
  return s.status === "draft" || s.submittedAt === null;
}

/**
 * Whether a person has a conflict with a submission: one that names the submission, or one
 * that names someone who is on it (invited or confirmed; not someone who declined or left).
 */
export function isConflicted(personId: string, ctx: SubmissionContext): boolean {
  const authors = new Set(
    ctx.contributions.filter((c) => c.status !== "declined").map((c) => c.personId),
  );
  return ctx.conflicts.some(
    (c) =>
      c.personId === personId &&
      (c.submissionId === ctx.submission.id ||
        (c.otherPersonId !== null && authors.has(c.otherPersonId))),
  );
}

function personAccess(p: PersonViewer, ctx: SubmissionContext, baseline: Access): Access {
  const { submission: s } = ctx;
  // Contributor rule: your own work, always as a submitter, whatever else you are. An invitee
  // already counts (and is conflicted from the moment of the invitation). Someone who declined
  // or left is no longer a contributor; their invitation conflict keeps them out as a reviewer.
  const mine = ctx.contributions.find((c) => c.personId === p.personId);
  if (mine?.status === "confirmed") return "submitter";
  if (mine?.status === "invited") return "invitee";

  // Nobody but contributors sees work that was never submitted.
  if (isNeverSubmitted(s)) return baseline;

  // Conflict rule: conflicted chairs and reviewers see only what the public sees.
  if (isConflicted(p.personId, ctx)) return baseline;

  if (isConferenceChair(p, s.conferenceId)) return "chair";

  const trackChair = hasRole(p, s.conferenceId, ["track_chair"]);
  if (
    trackChair &&
    (trackChair.scope.length === 0 || (s.trackKey && trackChair.scope.includes(s.trackKey)))
  ) {
    return "chair";
  }

  // Reviewer rule: only assigned reviewers, only in pools they serve, only once submitted, and
  // only once the conference is in review. Before that, and after the assignment is released,
  // an assigned reviewer gets what a stranger gets.
  const reviewer = hasRole(p, s.conferenceId, ["reviewer"]);
  const pool = findType(ctx.config, s.typeKey)?.reviewPool;
  const inPool = reviewer && pool && (reviewer.scope.length === 0 || reviewer.scope.includes(pool));
  const assigned = activeAssignments(ctx).some(
    (a) => a.reviewerId === p.personId && a.submissionId === s.id,
  );
  if (inPool && assigned && isReviewable(s) && reviewersCanRead(ctx.phase)) {
    return `reviewer_${effectiveBlindMode(ctx.config, s.typeKey)}`;
  }
  return baseline;
}

/**
 * The single decision point for submission visibility. Projections render exactly what an
 * access level allows; routes and MCP tools never decide this themselves.
 */
export function submissionAccess(viewer: Viewer, ctx: SubmissionContext): Access {
  const baseline: Access = ctx.submission.status === "published" ? "public" : "none";
  if (viewer.kind === "public") return baseline;
  if (viewer.kind === "person") return personAccess(viewer, ctx, baseline);

  // Agents: only for conferences their token names, only while the owner chairs it.
  if (viewer.conferenceId !== ctx.submission.conferenceId) return "none";
  if (!isConferenceChair(viewer.owner, ctx.submission.conferenceId)) return baseline;
  const owner = personAccess(viewer.owner, ctx, baseline);
  if (viewer.tier === "C") return owner;
  // Tier M: published records are public anyway; everything else collapses to metadata.
  if (ctx.submission.status === "published") return "public";
  if (owner === "none") return "none";
  // A chair's agent looking at the chair's own submission must not learn who reviews it.
  return owner === "submitter" || owner === "invitee" ? "metadata_own" : "metadata";
}
