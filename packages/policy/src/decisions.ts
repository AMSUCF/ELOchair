import {
  type ConferenceConfig,
  type Decision,
  type DecisionOutcome,
  decisionOutcomesFor,
  decisionsCanBeRecorded,
  decisionsCanBeSent,
  type Person,
  RECOMMENDATIONS,
  type Recommendation,
  type Review,
  removeStrayInvisible,
} from "@elochair/schema";
import { type SubmissionContext, submissionAccess } from "./access";
import {
  type AssignmentsPosition,
  type AssignmentsRank,
  assignmentsAfter,
  assignmentsPosition,
  canManageReviewers,
  reviewPoolOf,
} from "./assignments";
import { canManagePeople } from "./people";
import type { SubmissionRecord } from "./projections";
import type { PersonViewer, Viewer } from "./viewer";

/*
 * Decisions (spec 03, §1.6): who may record one, for which proposals, what the chairs are shown
 * of them, what sending them would do, and what a proposal's authors are shown once they are
 * sent.
 *
 * Five rules decide everything here:
 * - A decision is recorded by a chair of the conference, in person, and only for a proposal
 *   that chair manages as a chair (canManageReviewers: never their own, never one they have a
 *   conflict with). Never an agent, whatever its tier.
 * - A recorded decision is not the proposal's status. Nothing here hands it to anyone but such
 *   a chair: the proposal's own people, its reviewers and every agent are shown nothing of it,
 *   and the proposal reads to them as it did before.
 * - Sending is for all of a conference's decisions that are waiting, also those of proposals
 *   the sending chair is kept from. Of those the chair is given numbers and nothing else: they
 *   are counted, and never listed or named.
 * - Once a decision is sent, the proposal's owner and its confirmed co-authors are shown it,
 *   with the comments the reviewers wrote for the authors as they were sent: under a number,
 *   and never with a name, a score, the note for the chairs or a recommendation.
 * - Reviewers learn nothing of any of it: no projection here answers for a reviewer.
 */

/**
 * Whether the viewer may record, change or take back a decision for the proposal: a chair of
 * the conference, in person, who is given it as a chair. One rule with managing its reviewers,
 * so that whoever reads its reviews is who decides it.
 */
export function canDecide(viewer: Viewer, ctx: SubmissionContext): viewer is PersonViewer {
  return canManageReviewers(viewer, ctx);
}

/**
 * Whether a proposal is one the chairs still decide: it was submitted and is under
 * consideration, or its authors were told that it is on the waiting list. A draft and a
 * withdrawn proposal are not, and neither is one whose accept or reject was sent.
 */
export function awaitsDecision(s: SubmissionContext["submission"]): boolean {
  return s.submittedAt !== null && decisionOutcomesFor(s.status).length > 0;
}

/** Whether a decision can be recorded for a proposal now, or why not. */
export type TakesDecision =
  | "yes"
  /** The conference is not in review yet: decisions are recorded from `reviewing` on. */
  | "not_in_review"
  /** Its authors were told accepted or not accepted: that is final in the app. */
  | "decided"
  /** It was withdrawn, or never submitted: there is nothing to decide. */
  | "not_under_consideration";

/** The statuses a proposal has once its accept or its reject was sent, and afterwards. */
const DECIDED: ReadonlySet<string> = new Set(["accepted", "rejected", "confirmed", "published"]);

export function takesDecision(ctx: Pick<SubmissionContext, "submission" | "phase">): TakesDecision {
  if (!awaitsDecision(ctx.submission)) {
    return DECIDED.has(ctx.submission.status) ? "decided" : "not_under_consideration";
  }
  return decisionsCanBeRecorded(ctx.phase) ? "yes" : "not_in_review";
}

/** Everything needed to say what was decided at a conference, and what sending would do. */
export type DecisionsRecord = {
  conferenceId: string;
  config: ConferenceConfig;
  phase: string;
  /** The conference's submissions, each with the person records of its people. */
  submissions: SubmissionRecord[];
  /** Every decision of the conference: those waiting to be sent, and those that were. */
  decisions: readonly Decision[];
  /**
   * The conference's reviews that were sent. A draft is its reviewer's own and is not handed
   * over; one that is handed over all the same is read nowhere here.
   */
  reviews: readonly Review[];
};

/** The decision recorded for a proposal and not sent yet, if there is one. */
export function waitingDecision(
  decisions: readonly Decision[],
  submissionId: string,
): Decision | undefined {
  return decisions.find((d) => d.submissionId === submissionId && d.sentAt === null);
}

/**
 * What a proposal's authors were last told: its latest decision that was sent, if any was. A
 * proposal has two at most, "waiting list" and then the accept or the reject that ended it: so
 * where two were sent at one and the same instant, the waiting list is the earlier one.
 */
export function sentDecision(
  decisions: readonly Decision[],
  submissionId: string,
): (Decision & { sentAt: string }) | undefined {
  const waited = (d: Decision) => Number(d.outcome === "waitlisted");
  return decisions
    .filter(
      (d): d is Decision & { sentAt: string } =>
        d.submissionId === submissionId && d.sentAt !== null,
    )
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || waited(a) - waited(b))
    .at(0);
}

/** A proposal's sent reviews: nothing else is ever read of a review here. */
const sentOf = (rec: Pick<DecisionsRecord, "reviews">, submissionId: string): Review[] =>
  rec.reviews.filter(
    (r) => r.submissionId === submissionId && r.status === "sent" && r.sentAt !== null,
  );

/** How many of a proposal's sent reviews recommend each of the three. */
export type RecommendationCounts = Record<Recommendation, number>;

const recommendationsOf = (reviews: readonly Review[]): RecommendationCounts => {
  const out: RecommendationCounts = { accept: 0, unsure: 0, reject: 0 };
  for (const r of reviews) {
    if (r.recommendation && RECOMMENDATIONS.includes(r.recommendation)) out[r.recommendation] += 1;
  }
  return out;
};

/**
 * What the authors are sent of a proposal's reviews with its decision: each sent review's
 * comments for the authors, and nothing else of it. The order is that of the reviews' own ids,
 * which are random: it is the same every time, and says nothing about who wrote which, when
 * they were assigned or when they sent it. A review whose comments hold nothing that can be
 * read is left out: empty, or only spaces, line breaks and characters that do not show. That
 * is decided here, once, so that the email and the page number the same comments alike.
 */
export function commentsForAuthors(
  rec: Pick<DecisionsRecord, "reviews">,
  submissionId: string,
): string[] {
  return sentOf(rec, submissionId)
    .sort((a, b) => a.id.localeCompare(b.id, "en"))
    .map((r) => r.comments)
    .filter(
      (text) =>
        removeStrayInvisible(text)
          .replace(/\p{Cc}/gu, " ")
          .trim() !== "",
    );
}

/** One proposal on the Decisions page: what it is, what its reviewers said, what is recorded. */
export type DecisionsProposal = {
  id: string;
  title: string;
  typeKey: string;
  /** Its authors were told that it is on the waiting list: it can be given another decision. */
  waitlisted: boolean;
  /** How many reviews of it were sent. Drafts are not counted: they are their reviewers' own. */
  sent: number;
  /** What those reviews recommend, by recommendation. A review without one is in none. */
  recommendations: RecommendationCounts;
  /** The decision recorded and not sent yet; null where there is none. */
  recorded: DecisionOutcome | null;
};

/** One pool on the Decisions page: its totals, and its proposals. */
export type DecisionsPool = {
  key: string;
  /** How many reviews the pool asks for per proposal. */
  needed: number;
  /** How many proposals are listed, and how many of them have no decision at all yet. */
  proposals: number;
  undecided: number;
  /**
   * Those with no decision yet first, then those with one recorded and not sent, then those on
   * the waiting list with nothing new recorded; each as they were created (decisionsRank).
   */
  items: DecisionsProposal[];
};

export type DecisionsView = {
  view: "decisions";
  /** Decisions can be recorded: the conference is in review, or past it. */
  canRecord: boolean;
  /** They can be sent: the conference is in `deciding`, or past it. */
  canSend: boolean;
  /**
   * Proposals that await a decision and are not listed, because the person looking does not
   * manage them: their own, and those they have a conflict with. A number, and nothing else.
   */
  excluded: number;
  /** The conference's pools, in the order of its configuration. */
  pools: DecisionsPool[];
};

/**
 * Where a proposal stands in its pool's list on the Decisions page. 0: no decision yet. 1: one
 * is recorded and not sent. 2: its authors were told it is on the waiting list, and nothing new
 * is recorded. The server pages the list by this, as it does the Assignments page's.
 */
export const decisionsRank = (
  item: Pick<DecisionsProposal, "waitlisted" | "recorded">,
): AssignmentsRank => (item.recorded ? 1 : item.waitlisted ? 2 : 0);

export const decisionsPosition = (
  item: Pick<DecisionsProposal, "waitlisted" | "recorded">,
  s: Pick<SubmissionContext["submission"], "createdAt" | "id">,
): AssignmentsPosition => assignmentsPosition(decisionsRank(item), s);

/**
 * The Decisions page, for a chair of the conference in person; null for everyone else. By pool:
 * every proposal that awaits a decision and that the chair manages, with what its reviewers
 * recommend and the decision recorded for it. Reviews and decisions of a proposal the chair
 * does not manage are not looked at.
 */
export function projectDecisions(viewer: Viewer, rec: DecisionsRecord): DecisionsView | null {
  if (!canManagePeople(viewer, rec.conferenceId)) return null;
  const open = rec.submissions.filter(
    (s) => s.submission.conferenceId === rec.conferenceId && awaitsDecision(s.submission),
  );
  const mine = open.filter((s) => canDecide(viewer, s));
  const pools = rec.config.reviewPools.map((pool): DecisionsPool => {
    const listed = mine
      .filter((s) => reviewPoolOf(s)?.key === pool.key)
      .map((s) => {
        const sent = sentOf(rec, s.submission.id);
        const item: DecisionsProposal = {
          id: s.submission.id,
          title: s.submission.title,
          typeKey: s.submission.typeKey,
          waitlisted: s.submission.status === "waitlisted",
          sent: sent.length,
          recommendations: recommendationsOf(sent),
          recorded: waitingDecision(rec.decisions, s.submission.id)?.outcome ?? null,
        };
        return { position: decisionsPosition(item, s.submission), item };
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
      undecided: listed.filter((x) => x.position[0] === 0).length,
      items: listed.map((x) => x.item),
    };
  });
  return {
    view: "decisions",
    canRecord: decisionsCanBeRecorded(rec.phase),
    canSend: decisionsCanBeSent(rec.phase),
    excluded: open.length - mine.length,
    pools,
  };
}

/** The Decision section of a proposal's page, for a chair who manages the proposal. */
export type ProposalDecision = {
  view: "proposal_decision";
  submissionId: string;
  /** Whether a decision can be recorded for it now, or why not. */
  takes: TakesDecision;
  /** The outcomes that can be recorded now: empty unless `takes` is "yes". */
  outcomes: DecisionOutcome[];
  /** The decision recorded and not sent yet, and when it was recorded or last changed. */
  recorded: { outcome: DecisionOutcome; at: string } | null;
  /** What its authors were last told, and when; null while nothing was sent. */
  told: { outcome: DecisionOutcome; at: string } | null;
  /** How many reviews were sent of how many its committee asks for, and what they recommend. */
  reviews: { sent: number; asked: number; recommendations: RecommendationCounts };
  /** The chairs can send the decisions now (the phase): said beside what is recorded. */
  canSend: boolean;
};

/**
 * What is decided about one proposal, for a chair of the conference in person who manages it;
 * null for everyone else, and for a proposal that is not this conference's.
 */
export function projectProposalDecision(
  viewer: Viewer,
  rec: DecisionsRecord,
  submissionId: string,
): ProposalDecision | null {
  const ctx = rec.submissions.find(
    (s) => s.submission.id === submissionId && s.submission.conferenceId === rec.conferenceId,
  );
  if (!ctx || !canDecide(viewer, ctx)) return null;
  const takes = takesDecision(ctx);
  const waiting = waitingDecision(rec.decisions, submissionId);
  const told = sentDecision(rec.decisions, submissionId);
  const sent = sentOf(rec, submissionId);
  return {
    view: "proposal_decision",
    submissionId,
    takes,
    outcomes: takes === "yes" ? [...decisionOutcomesFor(ctx.submission.status)] : [],
    recorded: waiting ? { outcome: waiting.outcome, at: waiting.decidedAt } : null,
    told: told ? { outcome: told.outcome, at: told.sentAt } : null,
    reviews: {
      sent: sent.length,
      asked: reviewPoolOf(ctx)?.reviewsPerSubmission ?? 0,
      recommendations: recommendationsOf(sent),
    },
    canSend: decisionsCanBeSent(rec.phase),
  };
}

/** One decision that sending would send: to whom, and with which comments. */
export type PlannedDecision = {
  decision: Decision;
  record: SubmissionRecord;
  /**
   * Who is written to: the proposal's owner and its confirmed co-authors, each once. Someone
   * who was invited and has not confirmed has agreed to nothing, and is told nothing.
   */
  recipients: Person[];
  /** The reviewers' comments for the authors, in the order they are numbered. */
  comments: string[];
};

/**
 * What sending the decisions would do at a conference, as things stand. This is for the server,
 * which does it: it holds people and review text, and is never anyone's to be shown (the
 * chairs get projectSendSummary).
 */
export type SendPlan = {
  /** Every decision that is waiting, for a proposal that still awaits one. */
  send: PlannedDecision[];
  /**
   * Decisions that are waiting and will not be sent: their proposal no longer awaits one (it
   * was withdrawn since, or is a draft again). Nobody is told anything of these.
   */
  dropped: Decision[];
  /** Proposals under consideration with no decision recorded: they are told nothing. */
  undecided: number;
};

export function sendPlan(rec: DecisionsRecord): SendPlan {
  const byId = new Map(rec.submissions.map((s) => [s.submission.id, s]));
  const waiting = rec.decisions
    .filter((d) => d.conferenceId === rec.conferenceId && d.sentAt === null)
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const send: PlannedDecision[] = [];
  const dropped: Decision[] = [];
  for (const decision of waiting) {
    const record = byId.get(decision.submissionId);
    // Only what can be recorded for a proposal can be sent to it: nothing for a proposal that
    // is no longer decided, and no second "waiting list" for one that is on it.
    if (
      !record ||
      !awaitsDecision(record.submission) ||
      !decisionOutcomesFor(record.submission.status).includes(decision.outcome)
    ) {
      dropped.push(decision);
      continue;
    }
    const ids = new Set([
      record.submission.ownerPersonId,
      ...record.contributions.filter((c) => c.status === "confirmed").map((c) => c.personId),
    ]);
    send.push({
      decision,
      record,
      recipients: [...ids]
        .sort()
        .flatMap((id) => record.people.get(id) ?? [])
        .filter((p) => p.email !== ""),
      comments: commentsForAuthors(rec, decision.submissionId),
    });
  }
  const decided = new Set(waiting.map((d) => d.submissionId));
  return {
    send,
    dropped,
    undecided: rec.submissions.filter(
      (s) =>
        s.submission.conferenceId === rec.conferenceId &&
        s.submission.status === "submitted" &&
        awaitsDecision(s.submission) &&
        !decided.has(s.submission.id),
    ).length,
  };
}

/**
 * What the confirmation says before the decisions are sent, and what the result says after:
 * numbers, and nothing else. They count every decision of the conference that is waiting, also
 * those of proposals the chair looking is kept from, which are never listed or named.
 */
export type SendSummary = {
  view: "send_decisions";
  /** The chairs can send now: the conference is in `deciding`, or past it. */
  canSend: boolean;
  /** How many proposals would be told each outcome. */
  accepted: number;
  waitlisted: number;
  rejected: number;
  /** How many people would be emailed: someone on two of those proposals is one person. */
  people: number;
  /** Proposals under consideration with no decision yet: they are told nothing. */
  undecided: number;
  /**
   * Decisions that are waiting and will not be sent: their proposal was withdrawn since, or
   * returned to a draft.
   */
  dropped: number;
};

/**
 * The numbers of a plan, for a chair of the conference in person; null for everyone else.
 * `plan` is what sendPlan gives for the conference, as it is or as it was just carried out.
 */
export function projectSendSummary(
  viewer: Viewer,
  rec: Pick<DecisionsRecord, "conferenceId" | "phase">,
  plan: SendPlan,
): SendSummary | null {
  if (!canManagePeople(viewer, rec.conferenceId)) return null;
  const told = (outcome: DecisionOutcome) =>
    plan.send.filter((p) => p.decision.outcome === outcome).length;
  return {
    view: "send_decisions",
    canSend: decisionsCanBeSent(rec.phase),
    accepted: told("accepted"),
    waitlisted: told("waitlisted"),
    rejected: told("rejected"),
    people: new Set(plan.send.flatMap((p) => p.recipients.map((person) => person.id))).size,
    undecided: plan.undecided,
    dropped: plan.dropped.length,
  };
}

/** The decision about a proposal as its authors are shown it, once it was sent. */
export type AuthorDecision = {
  view: "author_decision";
  submissionId: string;
  outcome: DecisionOutcome;
  /** When the decisions were sent. */
  sentAt: string;
  /**
   * The reviewers' comments for the authors, as they were sent: the first is "Reviewer 1". No
   * name, no score, no note for the chairs, no recommendation, and nothing that leads to one.
   */
  comments: string[];
};

/**
 * The decision about a proposal, for its owner and its confirmed co-authors, in person, once
 * it was sent; null before that, and for everyone else: someone who was invited and has not
 * confirmed, a reviewer, a chair (who reads it on the chairs' pages, where it is theirs), a
 * stranger, the public and every agent. Only a decision that was sent is ever read: one that
 * is waiting changes nothing here, whatever was handed in.
 */
export function projectAuthorDecision(
  viewer: Viewer,
  ctx: SubmissionContext,
  decisions: readonly Decision[],
): AuthorDecision | null {
  if (viewer.kind !== "person") return null;
  if (submissionAccess(viewer, ctx) !== "submitter") return null;
  const told = sentDecision(decisions, ctx.submission.id);
  if (!told) return null;
  return {
    view: "author_decision",
    submissionId: ctx.submission.id,
    outcome: told.outcome,
    sentAt: told.sentAt,
    comments: [...(told.comments ?? [])],
  };
}

/** What the proposals export says of a proposal's decision and reviews, for a chair. */
export type DecisionColumns = {
  /** The decision that stands: the one waiting to be sent, or else the last one sent. */
  decision: DecisionOutcome | null;
  /** Whether that decision was sent to the authors. */
  sent: boolean;
  /** How many reviews of the proposal were sent. */
  reviewsSent: number;
};

/**
 * By proposal id, for the proposals the viewer manages as a chair of the conference, in
 * person; null for everyone else (a track chair, and an agent whatever its tier: neither is
 * shown anything of reviews or of a decision that is not sent).
 */
export function projectDecisionColumns(
  viewer: Viewer,
  rec: DecisionsRecord,
): Record<string, DecisionColumns> | null {
  if (!canManagePeople(viewer, rec.conferenceId)) return null;
  const out: Record<string, DecisionColumns> = {};
  for (const s of rec.submissions) {
    if (s.submission.conferenceId !== rec.conferenceId || !canDecide(viewer, s)) continue;
    const waiting = waitingDecision(rec.decisions, s.submission.id);
    const told = sentDecision(rec.decisions, s.submission.id);
    out[s.submission.id] = {
      decision: waiting?.outcome ?? told?.outcome ?? null,
      sent: !waiting && told !== undefined,
      reviewsSent: sentOf(rec, s.submission.id).length,
    };
  }
  return out;
}
