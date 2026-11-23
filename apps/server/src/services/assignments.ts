import {
  type AssignmentsPool,
  type AssignmentsPosition,
  type AssignmentsProposal,
  type AssignmentsView,
  assignmentsAfter,
  assignmentsPosition,
  assignmentsRank,
  canManageReviewers,
  type PersonViewer,
  projectAssignments,
  type ReviewersRecord,
  reviewerCandidate,
  reviewerOffer,
  takesReviewers,
  type Viewer,
} from "@elochair/policy";
import {
  type AssignmentReleaseReason,
  DECLINE_REASONS,
  type DeclineReason,
} from "@elochair/schema";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { CursorCodec } from "../cursor";
import type { Db } from "../db/client";
import {
  assignmentReleases,
  assignments,
  conferenceRoles,
  people,
  reviewerProfiles,
  reviews,
  submissions,
} from "../db/schema";
import {
  type ConferenceRow,
  loadSentReviews,
  loadSubmissionRecords,
  shareConference,
  toPerson,
} from "../repo";
import { Refusal } from "../routes/common";
import { recordNotifications } from "./notifications";
import { stillChair } from "./roles";
import { cursorContext } from "./submissions";

/*
 * Assigning reviewers to proposals (spec 03, §1.3): what the chairs' two views are rendered
 * from, and the two writes, assigning a reviewer and releasing one.
 *
 * Who may do what, which proposals take reviewers and who is offered are decided in
 * packages/policy (assignments.ts). This module loads what the policy needs and writes what it
 * allows.
 *
 * Two tables. `assignments` holds the assignments that stand, as it always has: every reader of
 * it, in this version and in any earlier one, reads the ones that count. Releasing an
 * assignment deletes its row there and writes the record of it to `assignment_releases`, in one
 * transaction (releaseAssignments, the only code that releases). Assigning the same reviewer
 * again makes a new assignment.
 *
 * The record of releases gives nobody anything, and nothing outside this module reads it. Four
 * things are read of it. Three are IDs:
 * - who was released from which proposal because of a conflict, so that they are never offered
 *   for it again (loadReviewersRecord);
 * - which proposals have ever had a reviewer, for the guard on anonymity (everAssigned);
 * - whether one proposal has, for the rule that it then keeps its format (everHadReviewer).
 * The fourth is for the chairs who manage a proposal, on its page: who said they could not
 * review it, with their reason and the note they wrote (loadReviewersRecord; spec 03, §1.4).
 *
 * Reviews (spec 03, §1.4) hang on this: a review belongs to a proposal and a reviewer, and
 * releaseAssignments is what keeps the two tables in step. A release takes the reviewer's draft
 * with it, and an assignment whose review was sent is never released: a sent review is part of
 * the proposal's record, and keeps its assignment.
 *
 * Both writes are a chair's. They take their locks in the one order of services/roles.ts: the
 * proposal's row, then the conference's roles lock (shared, with the chair read again under it:
 * stillChair), then the conference's row (shared).
 * - The proposal's row puts every change to who reviews one proposal in order, and in order
 *   with its owner's writes: what is checked here (its status, who is on it, who has a conflict
 *   with it) cannot change before this commits.
 * - The roles lock does the same against a change to who holds a role. Removing a reviewer's
 *   role takes it exclusive, so it runs wholly before or wholly after an assignment of that
 *   reviewer: after, it releases the assignment; before, the reviewer is no longer offered.
 * - The conference's row does the same against a settings save and a phase move: the save's
 *   guard on anonymity never reads assignments that are changing under it.
 */

/** Everything packages/policy needs to say who reviews what at a conference, and who could. */
export async function loadReviewersRecord(
  db: Db,
  conference: ConferenceRow,
): Promise<ReviewersRecord> {
  const records = await loadSubmissionRecords(db, conference);
  const reviewers = await db
    .select({ personId: conferenceRoles.personId, scope: conferenceRoles.scope })
    .from(conferenceRoles)
    .where(
      and(eq(conferenceRoles.conferenceId, conference.id), eq(conferenceRoles.role, "reviewer")),
    );
  const profiles = await db
    .select()
    .from(reviewerProfiles)
    .where(eq(reviewerProfiles.conferenceId, conference.id));
  // Sent reviews only: a draft is its reviewer's own, and is not read for a chair.
  const sent = await loadSentReviews(db, conference.id);
  // What is read of the record of releases for the policy: who said they could not review
  // which proposal, with their reason and their note. Nothing of a release a chair made.
  const said = await db
    .select({
      submissionId: assignmentReleases.submissionId,
      reviewerId: assignmentReleases.reviewerId,
      reason: assignmentReleases.reason,
      note: assignmentReleases.note,
      releasedAt: assignmentReleases.releasedAt,
    })
    .from(assignmentReleases)
    .where(
      and(
        eq(assignmentReleases.conferenceId, conference.id),
        inArray(assignmentReleases.reason, [...DECLINE_REASONS]),
        // A person whose record was deleted is nobody to name, or to keep off a proposal.
        isNotNull(assignmentReleases.reviewerId),
      ),
    );
  const declines = said.flatMap((d) =>
    d.reviewerId
      ? [
          {
            submissionId: d.submissionId,
            reviewerId: d.reviewerId,
            reason: d.reason as DeclineReason,
            note: d.note,
            at: d.releasedAt.toISOString(),
          },
        ]
      : [],
  );
  // Who left a proposal because of a conflict: never offered for it again.
  const conflictReleased = new Map<string, string[]>();
  for (const d of declines) {
    if (d.reason !== ("conflict" satisfies AssignmentReleaseReason)) continue;
    conflictReleased.set(d.submissionId, [
      ...(conflictReleased.get(d.submissionId) ?? []),
      d.reviewerId,
    ]);
  }
  // Whoever is shown by name: the reviewers, anyone else who still has an assignment, whoever
  // sent a review, and whoever said they could not review a proposal.
  const named = [
    ...new Set([
      ...reviewers.map((r) => r.personId),
      ...records.flatMap((r) => r.assignments.map((a) => a.reviewerId)),
      ...sent.map((r) => r.reviewerId),
      ...declines.map((d) => d.reviewerId),
    ]),
  ];
  const rows = named.length ? await db.select().from(people).where(inArray(people.id, named)) : [];
  return {
    conferenceId: conference.id,
    config: conference.config,
    phase: conference.phase,
    reviewers,
    reviewerProfiles: profiles.map((p) => ({
      personId: p.personId,
      languages: p.languages,
      maxLoad: p.maxLoad,
    })),
    people: new Map(rows.map((p) => [p.id, toPerson(p)])),
    submissions: records,
    conflictReleased,
    reviews: sent,
    declines,
  };
}

/**
 * The submissions of a conference that have, or have had, a reviewer: one who is assigned now,
 * or one whose assignment was released. For the guard on anonymity alone (namesRevealed in
 * settings.ts): someone released from a proposal may have read it anonymized, and can be
 * assigned to it again.
 */
export async function everAssigned(db: Db, conferenceId: string): Promise<Set<string>> {
  const now = await db
    .selectDistinct({ submissionId: assignments.submissionId })
    .from(assignments)
    .where(eq(assignments.conferenceId, conferenceId));
  const before = await db
    .selectDistinct({ submissionId: assignmentReleases.submissionId })
    .from(assignmentReleases)
    .where(eq(assignmentReleases.conferenceId, conferenceId));
  return new Set([...now, ...before].map((r) => r.submissionId));
}

/**
 * Whether a proposal has, or has had, a reviewer: one assigned now, or one released. Such a
 * proposal keeps its format (the owner's edit refuses another one): its format decides what a
 * reviewer of it is shown, and which pool reviews it. Without this, a proposal taken back to a
 * draft while its call is open again could be sent in again in a format that shows names to
 * someone who was given it as anonymized.
 */
export async function everHadReviewer(db: Db, submissionId: string): Promise<boolean> {
  const [now] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.submissionId, submissionId))
    .limit(1);
  if (now) return true;
  const [before] = await db
    .select({ id: assignmentReleases.id })
    .from(assignmentReleases)
    .where(eq(assignmentReleases.submissionId, submissionId))
    .limit(1);
  return Boolean(before);
}

/** A pool on the Assignments page with one page of its proposals, and where the next begins. */
export type AssignmentsPoolPage = AssignmentsPool & { nextCursor: string | null };
export type AssignmentsPage = Omit<AssignmentsView, "pools"> & { pools: AssignmentsPoolPage[] };

/**
 * The cursor did not open: forged, damaged, or sealed for another list (400 at "cursor"). The
 * Decisions page is paged in the same way (pageOfPool), and refuses a cursor with the same.
 */
export class AssignmentsCursorRefused extends Error {}

/**
 * A position in a pool's list, as the client holds it. The codec seals (created, id) for one
 * list: `list` names the conference, the person looking and the pool. Whether the position is
 * among the proposals still short of reviewers, among those that wait for reviews, or after
 * them, is the letter in front, and it is sealed too, as part of the list's name: with the
 * letter changed, the cursor does not open.
 */
/** The letter of each part of a pool's list: short of reviewers, waiting for reviews, the rest. */
const RANK_LETTERS = ["s", "w", "f"] as const;

function sealPosition(cursors: CursorCodec, [rank, ms, id]: AssignmentsPosition, list: string) {
  return `${RANK_LETTERS[rank]}${cursors.seal([ms, id], `${list}:${rank}`)}`;
}

function openPosition(
  cursors: CursorCodec,
  cursor: string,
  list: string,
): AssignmentsPosition | null {
  const rank = RANK_LETTERS.findIndex((letter) => cursor.startsWith(letter));
  if (rank !== 0 && rank !== 1 && rank !== 2) return null;
  const at = cursors.open(cursor.slice(1), `${list}:${rank}`);
  return at ? [rank, at[0], at[1]] : null;
}

/**
 * One page of a pool's list, and where the next begins: the list from just after `cursor` (or
 * from its start), cut at `limit`. `items` are in the order of their positions, which have
 * three parts, as a pool's list has on the Assignments page and on the Decisions page. `list`
 * names the list a cursor is sealed for: the conference, the person looking, the page and the
 * pool. A cursor that does not open there is refused (AssignmentsCursorRefused).
 */
export function pageOfPool<T>(v: {
  items: readonly T[];
  positionOf: (item: T) => AssignmentsPosition;
  list: string;
  cursors: CursorCodec;
  cursor?: string;
  limit: number;
}): { items: T[]; nextCursor: string | null } {
  const after = v.cursor ? openPosition(v.cursors, v.cursor, v.list) : null;
  if (v.cursor && !after) throw new AssignmentsCursorRefused("cursor");
  const rest = after
    ? v.items.filter((item) => assignmentsAfter(v.positionOf(item), after))
    : [...v.items];
  const items = rest.slice(0, v.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last && items.length < rest.length
        ? sealPosition(v.cursors, v.positionOf(last), v.list)
        : null,
  };
}

/**
 * The Assignments page for a chair in person (null for anyone else), a page of each pool at a
 * time. It is projected whole first and cut afterwards, as the list of submissions is
 * (querySubmissions), so paging cannot reveal what the projection leaves out.
 *
 * A pool's list is paged by position: the cursor is the position just after the last proposal
 * of the page before (assignmentsPosition), sealed. It is compared, never looked up, so the next
 * page begins where the last one ended whatever has happened to that proposal since. With
 * `only`, the answer holds that pool alone, from `only.cursor`.
 */
export async function assignmentsPage(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  v: {
    now: Date;
    limit: number;
    cursors: CursorCodec;
    only?: { pool: string; cursor?: string };
  },
): Promise<AssignmentsPage | null> {
  const rec = await loadReviewersRecord(db, conference);
  const view = projectAssignments(viewer, rec, v.now);
  if (!view) return null;
  const created = new Map(rec.submissions.map((s) => [s.submission.id, s.submission.createdAt]));
  const pools = view.pools
    .filter((pool) => !v.only || pool.key === v.only.pool)
    .map((pool): AssignmentsPoolPage => {
      const positionOf = (item: AssignmentsProposal) =>
        assignmentsPosition(assignmentsRank(item, pool.needed), {
          id: item.id,
          createdAt: created.get(item.id) ?? "",
        });
      return {
        ...pool,
        ...pageOfPool({
          items: pool.items,
          positionOf,
          list: `${cursorContext(viewer, conference.id)}:assignments:${pool.key}`,
          cursors: v.cursors,
          cursor: v.only?.cursor,
          limit: v.limit,
        }),
      };
    });
  return { ...view, pools };
}

/**
 * The proposal of this conference with that id, its row locked until the transaction ends.
 *
 * Locked "for no key update", not "for update". Both put this in order with the owner's writes
 * (mutateSubmission) and with every other change to who reviews the proposal. The difference is
 * what a foreign key's check may do meanwhile: writing a row that points to the proposal takes a
 * key-share lock on it, which a lock for update makes wait and this one lets pass. That matters
 * for one writer. Removing a reviewer's role releases their assignments under the roles lock,
 * exclusive, and each record it writes points to a proposal. Were this lock for update, an
 * assignment that holds a proposal's row and waits for the roles lock, and a removal that holds
 * the roles lock and waits for that row, would wait for each other.
 */
export async function lockProposal(tx: Db, conference: ConferenceRow, submissionId: string) {
  const [row] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.conferenceId, conference.id)))
    .for("no key update");
  // Another conference's proposal does not exist here.
  if (!row) throw new Refusal(404, "not_found");
}

/**
 * A chair assigns one reviewer to one proposal.
 * - 404 `not_found` for a proposal the chair does not manage as a chair (their own, one they
 *   have a conflict with, a draft, another conference's): the answer a missing one gets.
 * - 409 `call_not_closed` or `not_under_consideration` when the proposal takes no reviewer now.
 * - 409 `already_assigned` for someone who reviews it already, and 409 `not_offered` for anyone
 *   else who is not among those offered. The answer never says why: not being a reviewer of the
 *   pool, being one of the proposal's people, and having a conflict all read the same.
 * - 409 `reviewer_full`, with their numbers as this chair may know them, for a reviewer who has
 *   reached the number they said they would take, unless the request says the chair was shown
 *   that (`confirmedFull`). The number is what they offered, not a lock.
 *
 * A reviewer who was released from the proposal (and not because of a conflict) can be
 * assigned to it again: that is a new assignment, made now, by this chair.
 *
 * The reviewer is told by email, as often as they have chosen (spec 03, §1.7): what is written
 * here is that they are to be told, in this transaction; the email is made afterwards.
 */
export async function assignReviewer(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  v: { submissionId: string; reviewerId: string; confirmedFull: boolean },
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await lockProposal(tx, k, v.submissionId);
    const actor = await stillChair(tx, viewer, k.id);
    // The configuration and the phase as they are when this commits say which pool reviews the
    // proposal, and whether the call has closed.
    const conference = await shareConference(tx, k.id);
    if (!conference) throw new Refusal(404, "not_found");
    const rec = await loadReviewersRecord(tx, conference);
    const ctx = rec.submissions.find((s) => s.submission.id === v.submissionId);
    if (!ctx || !canManageReviewers(actor, ctx)) throw new Refusal(404, "not_found");
    const takes = takesReviewers(ctx, now);
    if (takes !== "yes") throw new Refusal(409, takes);
    if (reviewerOffer(rec, ctx, v.reviewerId) === "assigned") {
      throw new Refusal(409, "already_assigned");
    }
    const candidate = reviewerCandidate(actor, rec, ctx, v.reviewerId);
    if (!candidate) throw new Refusal(409, "not_offered");
    if (candidate.full && !v.confirmedFull) {
      throw new Refusal(409, "reviewer_full", {
        assigned: candidate.assigned,
        maxLoad: candidate.maxLoad,
      });
    }
    // Whether they were on it before: said in the audit row, and nowhere else.
    const [before] = await tx
      .select({ id: assignmentReleases.id })
      .from(assignmentReleases)
      .where(
        and(
          eq(assignmentReleases.submissionId, v.submissionId),
          eq(assignmentReleases.reviewerId, v.reviewerId),
        ),
      )
      .limit(1);
    // One row for a reviewer and a proposal: the table refuses a second, whatever was checked.
    const made = await tx
      .insert(assignments)
      .values({
        conferenceId: conference.id,
        reviewerId: v.reviewerId,
        submissionId: v.submissionId,
        assignedByPersonId: actor.personId,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [assignments.reviewerId, assignments.submissionId] })
      .returning({ id: assignments.id });
    if (made.length === 0) throw new Refusal(409, "already_assigned");
    // The reviewer is to be told, as often as they have chosen: decided afterwards, by the job
    // of services/notifications.ts. Nothing is mailed here, and a chair who assigns a proposal
    // to themself is told nothing.
    await recordNotifications(tx, {
      conferenceId: conference.id,
      submissionId: v.submissionId,
      kind: "assigned",
      personIds: [v.reviewerId],
      by: actor.personId,
      now,
    });
    await audit(tx, viewer, {
      action: "assignment.made",
      conferenceId: conference.id,
      targetType: "submission",
      targetId: v.submissionId,
      details: { reviewerId: v.reviewerId, again: Boolean(before) },
    });
  });
}

/**
 * Release a conference's assignments that match: each row is deleted from `assignments` and its
 * record written to `assignment_releases`, with one audit row per release (the proposal, the
 * reviewer, the reason). This is the only code that releases.
 *
 * It is also what keeps reviews in step with assignments (spec 03, §1.4):
 * - an assignment whose review was sent is not released, whoever asks: the review is part of
 *   the proposal's record, and keeps its assignment. Those are counted as `kept`;
 * - the reviewer's draft for a proposal they are released from goes with the assignment: a
 *   draft was never anyone's but theirs.
 *
 * Returns how many were released and how many were kept. Run it inside the transaction of what
 * causes the release, under the locks that needs: a review is sent under its proposal's row and
 * the roles lock (services/reviews.ts), so one of the two is held here by every caller.
 */
export async function releaseAssignments(
  tx: Db,
  actor: Viewer,
  v: {
    conferenceId: string;
    reviewerId: string;
    /** One proposal's; without it, every assignment the reviewer has at the conference. */
    submissionId?: string;
    reason: AssignmentReleaseReason;
    /** What the reviewer wrote for the chairs, where the release is their own. */
    note?: string | null;
    now: Date;
  },
): Promise<{ released: number; kept: number }> {
  const matching = and(
    eq(assignments.conferenceId, v.conferenceId),
    eq(assignments.reviewerId, v.reviewerId),
    v.submissionId ? eq(assignments.submissionId, v.submissionId) : undefined,
  );
  // The proposals this reviewer has sent a review of: their assignments stay.
  const sent = (
    await tx
      .select({ submissionId: reviews.submissionId })
      .from(reviews)
      .where(
        and(
          eq(reviews.conferenceId, v.conferenceId),
          eq(reviews.reviewerId, v.reviewerId),
          eq(reviews.status, "sent"),
        ),
      )
  ).map((r) => r.submissionId);
  const kept = sent.length
    ? (
        await tx
          .select({ id: assignments.id })
          .from(assignments)
          .where(and(matching, inArray(assignments.submissionId, sent)))
      ).length
    : 0;
  const released = await tx
    .delete(assignments)
    .where(and(matching, sent.length ? notInArray(assignments.submissionId, sent) : undefined))
    .returning();
  if (released.length === 0) return { released: 0, kept };
  await tx.insert(assignmentReleases).values(
    released.map((a) => ({
      conferenceId: a.conferenceId,
      submissionId: a.submissionId,
      reviewerId: a.reviewerId,
      assignmentId: a.id,
      assignedByPersonId: a.assignedByPersonId,
      assignedAt: a.createdAt,
      // The person whose act this is: a chair, or the reviewer themself. Nobody, for one the
      // system makes.
      releasedByPersonId: actor.kind === "person" ? actor.personId : null,
      releasedAt: v.now,
      reason: v.reason,
      note: v.note ?? null,
    })),
  );
  // Their drafts for those proposals go with the assignments. (None of them is a sent review:
  // those kept their assignments, above.)
  const discarded = new Set(
    (
      await tx
        .delete(reviews)
        .where(
          and(
            eq(reviews.reviewerId, v.reviewerId),
            eq(reviews.status, "draft"),
            inArray(
              reviews.submissionId,
              released.map((a) => a.submissionId),
            ),
          ),
        )
        .returning({ submissionId: reviews.submissionId })
    ).map((r) => r.submissionId),
  );
  for (const row of released) {
    await audit(tx, actor, {
      action: "assignment.released",
      conferenceId: v.conferenceId,
      targetType: "submission",
      targetId: row.submissionId,
      details: {
        reviewerId: v.reviewerId,
        reason: v.reason,
        draftDiscarded: discarded.has(row.submissionId),
      },
    });
  }
  return { released: released.length, kept };
}

/**
 * A chair removes a reviewer from a proposal: the assignment is released (releaseAssignments),
 * and the reviewer's draft, if they had begun one, goes with it. From then on it counts
 * nowhere, and the reviewer no longer sees the proposal. 404 `not_found` for a proposal the
 * chair does not manage as a chair, and for someone who is not reviewing it (any more). A
 * proposal that takes no new reviewers can still lose one.
 *
 * 409 `review_sent` once that reviewer's review was sent: a sent review is part of the
 * proposal's record, and its reviewer stays on it.
 */
export async function releaseReviewer(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  v: { submissionId: string; reviewerId: string },
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await lockProposal(tx, k, v.submissionId);
    const actor = await stillChair(tx, viewer, k.id);
    const conference = await shareConference(tx, k.id);
    if (!conference) throw new Refusal(404, "not_found");
    const [rec] = await loadSubmissionRecords(tx, conference, { submissionId: v.submissionId });
    if (!rec || !canManageReviewers(actor, rec)) throw new Refusal(404, "not_found");
    const { released, kept } = await releaseAssignments(tx, viewer, {
      conferenceId: conference.id,
      reviewerId: v.reviewerId,
      submissionId: v.submissionId,
      reason: "chair",
      now,
    });
    if (kept > 0) throw new Refusal(409, "review_sent");
    if (released === 0) throw new Refusal(404, "not_found");
  });
}
