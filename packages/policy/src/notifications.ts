import {
  type ConferenceConfig,
  DECLINE_REASONS,
  DEFAULT_NOTIFICATION_CHOICES,
  type DeclineReason,
  type LocalizedText,
  type NoticeFrequency,
  type NotificationChoices,
  type NotificationKind,
  reviewersCanRead,
  reviewReminderDays,
} from "@elochair/schema";
import type { SubmissionContext } from "./access";
import { canManageReviewers, reviewPoolOf } from "./assignments";
import { canWriteReview } from "./reviews";
import { hasRole, type Viewer } from "./viewer";

/*
 * The emails of the review phase (spec 03, §1.7): whose they are, what a person is shown of
 * their own choices, and what an email may be made of.
 *
 * Three rules decide everything here:
 * - An email goes to one person about their own work at a conference: to a reviewer about the
 *   proposals assigned to them, to a chair about the proposals they manage as a chair. A chair
 *   is told nothing about their own proposal or one they have a conflict with: who reviews
 *   those, and whether they have been reviewed, is not theirs to learn (canManageReviewers).
 * - What was true when something happened is asked again when the email is made. Someone who
 *   was taken off a proposal, or lost the role, is told nothing about it.
 * - An email carries a number and, for a proposal given back, the reasons out of three. Never
 *   a title, an author, a reviewer or a word anyone wrote: nothing here hands one over.
 *
 * An agent is nobody's reader: it is told nothing, and has no choices to see or to make.
 */

/**
 * Which of these emails are a person's at a conference: a reviewer's (new assignments, the
 * reminder), a chair's (notices about reviewing), both or neither. A chair is someone who holds
 * the `chair` or the `admin` role there: a site admin without one is not written to, as they
 * are not listed among a conference's people.
 */
export function emailRoles(
  viewer: Viewer,
  conferenceId: string,
): { reviewer: boolean; chair: boolean } {
  if (viewer.kind !== "person") return { reviewer: false, chair: false };
  return {
    reviewer: hasRole(viewer, conferenceId, ["reviewer"]) !== undefined,
    chair: hasRole(viewer, conferenceId, ["chair", "admin"]) !== undefined,
  };
}

/** A person's stored choices at a conference; whatever is not stored is the default. */
export type StoredChoices = Partial<NotificationChoices> & {
  personId: string;
  conferenceId: string;
};

/** A person's choices at a conference, as "Your account" shows them. */
export type EmailChoicesView = {
  view: "email_choices";
  conference: { slug: string; title: LocalizedText; defaultLanguage: string };
  /** For someone who reviews there; null for anyone else. */
  reviewer: {
    assignments: NoticeFrequency;
    reminder: boolean;
    /** How many days before the day reviews are due this conference's reminder goes out. */
    reminderDays: number;
  } | null;
  /** For someone who chairs it; null for anyone else. */
  chair: { notices: NoticeFrequency } | null;
};

/**
 * The choices in force for a person at a conference: what is stored for exactly the two, else
 * the defaults. A row that is someone else's, or another conference's, is never read.
 */
export function choicesInForce(
  personId: string,
  conferenceId: string,
  stored: StoredChoices | null | undefined,
): NotificationChoices {
  const own = stored?.personId === personId && stored.conferenceId === conferenceId ? stored : null;
  return {
    assignments: own?.assignments ?? DEFAULT_NOTIFICATION_CHOICES.assignments,
    reminder: own?.reminder ?? DEFAULT_NOTIFICATION_CHOICES.reminder,
    chairNotices: own?.chairNotices ?? DEFAULT_NOTIFICATION_CHOICES.chairNotices,
  };
}

/**
 * A person's own choices about these emails at one conference; null for an agent, for the
 * public, for someone who neither reviews nor chairs there, and for an archived conference,
 * where nothing is sent any more. Each part is there only for the role it belongs to.
 * `stored` is the viewer's own row, or nothing: a row that is someone else's, or another
 * conference's, is never read, whatever was handed in.
 */
export function projectEmailChoices(
  viewer: Viewer,
  conference: { id: string; slug: string; phase: string; config: ConferenceConfig },
  stored: StoredChoices | null | undefined,
): EmailChoicesView | null {
  const roles = emailRoles(viewer, conference.id);
  if (viewer.kind !== "person" || (!roles.reviewer && !roles.chair)) return null;
  if (conference.phase === "archived") return null;
  const choices = choicesInForce(viewer.personId, conference.id, stored);
  const { config } = conference;
  return {
    view: "email_choices",
    conference: {
      slug: conference.slug,
      title: { ...config.title },
      defaultLanguage: config.defaultLanguage,
    },
    reviewer: roles.reviewer
      ? {
          assignments: choices.assignments,
          reminder: choices.reminder,
          reminderDays: reviewReminderDays(config),
        }
      : null,
    chair: roles.chair ? { notices: choices.chairNotices } : null,
  };
}

/**
 * Whether something a person was to be told about still holds for them, as things stand:
 * - `assigned`: they review the proposal, and reviews can be written (canWriteReview: the role,
 *   the committee, an assignment that stands, no conflict, a proposal reviewers read, and the
 *   conference in `reviewing`);
 * - `declined`, `reviews_complete`: they chair the conference, and manage the proposal as a
 *   chair (canManageReviewers), so never their own and never one they have a conflict with;
 * - `reviews_complete`, besides: the proposal still has all its reviews. `sentReviews` is how
 *   many reviews of it are sent now, and it holds while that is at least what its committee
 *   asks for now: where the chairs raised the number meanwhile, it no longer has them all.
 *
 * Whether the proposal is the person's to hear of is asked first: for one that is kept from
 * them, nothing is made to depend on how many reviews it has.
 */
export function notificationHolds(
  viewer: Viewer,
  kind: NotificationKind,
  ctx: SubmissionContext | undefined,
  sentReviews = 0,
): boolean {
  if (!ctx) return false;
  if (kind === "assigned") return canWriteReview(viewer, ctx);
  if (!emailRoles(viewer, ctx.submission.conferenceId).chair) return false;
  if (!canManageReviewers(viewer, ctx)) return false;
  if (kind !== "reviews_complete") return true;
  const needed = reviewPoolOf(ctx)?.reviewsPerSubmission;
  return needed !== undefined && sentReviews >= needed;
}

/** Something a person is to be told about, as it was recorded when it happened. */
export type PendingNotice = {
  id: string;
  kind: NotificationKind;
  submissionId: string;
  /** For `declined`: why the reviewer said they cannot review it. */
  reason: DeclineReason | null;
  createdAt: string;
};

/**
 * What an email of one kind is made of, and nothing else goes into one: how many proposals,
 * and for proposals given back the reasons that were given, each once. `ids` are the
 * notifications it answers, for whoever marks them.
 */
export type NoticeEmail = { ids: string[]; count: number; reasons: DeclineReason[] };

export type NoticePlan =
  /** Not yet: every notification stays as it is. */
  | { action: "wait" }
  /** Decided: these emails are made, and the notifications in `dropped` are answered by none. */
  | { action: "decide"; emails: NoticeEmail[]; dropped: string[] };

/** One person's waiting notifications of one kind at one conference, and how they chose. */
type Waiting = {
  kind: NotificationKind;
  frequency: NoticeFrequency;
  /** The phase the conference is in. */
  phase: string;
  pending: readonly PendingNotice[];
  /** The last time the conference's clock read the summary's hour. */
  summaryAt: Date;
};

/**
 * Whether those notifications are left as they are for now. It needs nothing of the proposals
 * they are about, so whoever runs the job asks this first.
 * - A new assignment waits for the conference to be in review: before that the reviewer cannot
 *   open the proposal.
 * - "One summary a day" waits until the summary's hour has passed since the oldest of them.
 * Someone who chose no email has nothing to wait for.
 */
export function noticesWait(v: Waiting): boolean {
  if (v.frequency === "none") return false;
  if (v.kind === "assigned" && !reviewersCanRead(v.phase)) return true;
  if (v.frequency !== "daily") return false;
  const pending = v.pending.filter((n) => n.kind === v.kind);
  return !pending.some((n) => Date.parse(n.createdAt) < v.summaryAt.getTime());
}

/**
 * What to make of one person's waiting notifications of one kind at one conference.
 * - Someone who chose no email gets none: everything is dropped.
 * - What waits, waits (noticesWait): a new assignment for the conference to be in review, a
 *   summary for its hour. So a run that was missed is made up for by the next one.
 * - "One summary a day" is then one email that counts all that has gathered; "each one" is an
 *   email for each proposal, at once.
 * - Whatever no longer holds is dropped, and counted nowhere (notificationHolds): a new
 *   assignment once review is over among them, and a proposal that no longer has all the
 *   reviews its committee asks for.
 * - What is counted is proposals: one that was assigned to the same person twice meanwhile is
 *   one new assignment, one that two reviewers gave back is one proposal given back (with both
 *   their reasons), and one that reached its number of reviews twice is one.
 */
export function planNotices(
  viewer: Viewer,
  v: Waiting & {
    /** The conference's submissions, by id. */
    submissions: ReadonlyMap<string, SubmissionContext>;
    /**
     * How many reviews of each proposal are sent, by its id: a number, and nothing of what a
     * review says. Read for a proposal with all its reviews only; one that is not in it has
     * none.
     */
    sentReviews: ReadonlyMap<string, number>;
  },
): NoticePlan {
  const pending = v.pending.filter((n) => n.kind === v.kind);
  const all = pending.map((n) => n.id);
  if (v.frequency === "none") return { action: "decide", emails: [], dropped: all };
  if (noticesWait(v)) return { action: "wait" };
  const byProposal = new Map<string, PendingNotice[]>();
  const dropped: string[] = [];
  for (const n of pending) {
    const sent = v.sentReviews.get(n.submissionId) ?? 0;
    if (!notificationHolds(viewer, v.kind, v.submissions.get(n.submissionId), sent)) {
      dropped.push(n.id);
      continue;
    }
    byProposal.set(n.submissionId, [...(byProposal.get(n.submissionId) ?? []), n]);
  }
  const email = (proposals: PendingNotice[][]): NoticeEmail => {
    const given = new Set(proposals.flat().map((n) => n.reason));
    return {
      ids: proposals.flat().map((n) => n.id),
      count: proposals.length,
      reasons: DECLINE_REASONS.filter((r) => given.has(r)),
    };
  };
  const proposals = [...byProposal.values()];
  const emails =
    v.frequency === "each"
      ? proposals.map((p) => email([p]))
      : proposals.length
        ? [email(proposals)]
        : [];
  return { action: "decide", emails, dropped };
}

/**
 * How many reviews a person still has to send at a conference: the proposals they review, while
 * reviews can be written, that have no sent review of theirs. It is what the reminder says, and
 * a reminder goes only to someone for whom it is not zero. `sent` names the reviews that were
 * sent, by proposal and reviewer; a draft is not among them, and counts as not sent.
 */
export function unsentReviews(
  viewer: Viewer,
  submissions: readonly SubmissionContext[],
  sent: readonly { submissionId: string; reviewerId: string }[],
): number {
  if (viewer.kind !== "person") return 0;
  const done = new Set(
    sent.filter((r) => r.reviewerId === viewer.personId).map((r) => r.submissionId),
  );
  return submissions.filter((s) => canWriteReview(viewer, s) && !done.has(s.submission.id)).length;
}
