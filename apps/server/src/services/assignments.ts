import {
  type AssignmentsPool,
  type AssignmentsPosition,
  type AssignmentsProposal,
  type AssignmentsView,
  assignmentsAfter,
  assignmentsPosition,
  canManageReviewers,
  type PersonViewer,
  projectAssignments,
  type ReviewersRecord,
  reviewerCandidate,
  reviewerOffer,
  takesReviewers,
  type Viewer,
} from "@elochair/policy";
import type { AssignmentReleaseReason } from "@elochair/schema";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { CursorCodec } from "../cursor";
import type { Db } from "../db/client";
import { assignments, conferenceRoles, people, reviewerProfiles, submissions } from "../db/schema";
import { type ConferenceRow, loadSubmissionRecords, shareConference, toPerson } from "../repo";
import { Refusal } from "../routes/common";
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
 * Released assignments are kept (their rows are never deleted) and count for nothing. Nothing
 * outside this module reads one: the policy is given the active ones (loadActiveAssignments in
 * repo.ts). Two things about released rows leave here, and both are IDs:
 * - which reviewers were released from which proposal because of a conflict, so that they are
 *   never offered for it again (loadReviewersRecord);
 * - which proposals have ever had a reviewer, for the guard on anonymity (everAssigned) and for
 *   the rule that such a proposal keeps its format (everHadReviewer).
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
  // Whoever is shown by name: the reviewers, and anyone else who still has an assignment.
  const named = [
    ...new Set([
      ...reviewers.map((r) => r.personId),
      ...records.flatMap((r) => r.assignments.map((a) => a.reviewerId)),
    ]),
  ];
  const rows = named.length ? await db.select().from(people).where(inArray(people.id, named)) : [];
  // The one thing read of released assignments for the policy: who left a proposal because of
  // a conflict. Not when, not by whom, and nothing of any other release.
  const conflicts = await db
    .select({ submissionId: assignments.submissionId, reviewerId: assignments.reviewerId })
    .from(assignments)
    .where(
      and(
        eq(assignments.conferenceId, conference.id),
        isNotNull(assignments.releasedAt),
        eq(assignments.releaseReason, "conflict" satisfies AssignmentReleaseReason),
      ),
    );
  const conflictReleased = new Map<string, string[]>();
  for (const c of conflicts) {
    conflictReleased.set(c.submissionId, [
      ...(conflictReleased.get(c.submissionId) ?? []),
      c.reviewerId,
    ]);
  }
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
  };
}

/**
 * The submissions of a conference that have, or have had, a reviewer: every assignment row
 * counts, released or not. For the guard on anonymity alone (namesRevealed in settings.ts):
 * someone released from a proposal may have read it anonymized, and can be assigned to it
 * again.
 */
export async function everAssigned(db: Db, conferenceId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ submissionId: assignments.submissionId })
    .from(assignments)
    .where(eq(assignments.conferenceId, conferenceId));
  return new Set(rows.map((r) => r.submissionId));
}

/**
 * Whether a proposal has, or has had, a reviewer: any assignment row, released or not. Such a
 * proposal keeps its format (the owner's edit refuses another one): its format decides what a
 * reviewer of it is shown, and which pool reviews it. Without this, a proposal taken back to a
 * draft while its call is open again could be sent in again in a format that shows names to
 * someone who was given it as anonymized.
 */
export async function everHadReviewer(db: Db, submissionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.submissionId, submissionId))
    .limit(1);
  return rows.length > 0;
}

/** A pool on the Assignments page with one page of its proposals, and where the next begins. */
export type AssignmentsPoolPage = AssignmentsPool & { nextCursor: string | null };
export type AssignmentsPage = Omit<AssignmentsView, "pools"> & { pools: AssignmentsPoolPage[] };

/** The cursor did not open: forged, damaged, or sealed for another list (400 at "cursor"). */
export class AssignmentsCursorRefused extends Error {}

/**
 * A position in a pool's list, as the client holds it. The codec seals (created, id) for one
 * list: `list` names the conference, the person looking and the pool. Whether the position is
 * among the proposals still short of reviewers is the letter in front, and it is sealed too, as
 * part of the list's name: with the letter changed, the cursor does not open.
 */
function sealPosition(cursors: CursorCodec, [rank, ms, id]: AssignmentsPosition, list: string) {
  return `${rank === 0 ? "s" : "f"}${cursors.seal([ms, id], `${list}:${rank}`)}`;
}

function openPosition(
  cursors: CursorCodec,
  cursor: string,
  list: string,
): AssignmentsPosition | null {
  const rank = cursor.startsWith("s") ? 0 : cursor.startsWith("f") ? 1 : null;
  if (rank === null) return null;
  const at = cursors.open(cursor.slice(1), `${list}:${rank}`);
  return at ? [rank, at[0], at[1]] : null;
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
  const positionOf = (item: AssignmentsProposal) =>
    assignmentsPosition(item.short, { id: item.id, createdAt: created.get(item.id) ?? "" });
  const pools = view.pools
    .filter((pool) => !v.only || pool.key === v.only.pool)
    .map((pool): AssignmentsPoolPage => {
      const list = `${cursorContext(viewer, conference.id)}:assignments:${pool.key}`;
      const after = v.only?.cursor ? openPosition(v.cursors, v.only.cursor, list) : null;
      if (v.only?.cursor && !after) throw new AssignmentsCursorRefused("cursor");
      const rest = after
        ? pool.items.filter((item) => assignmentsAfter(positionOf(item), after))
        : pool.items;
      const items = rest.slice(0, v.limit);
      const last = items.at(-1);
      return {
        ...pool,
        items,
        nextCursor:
          last && items.length < rest.length
            ? sealPosition(v.cursors, positionOf(last), list)
            : null,
      };
    });
  return { ...view, pools };
}

/** The proposal of this conference with that id, its row locked until the transaction ends. */
async function lockProposal(tx: Db, conference: ConferenceRow, submissionId: string) {
  const [row] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.conferenceId, conference.id)))
    .for("update");
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
 * A reviewer who was released from the proposal (and not because of a conflict) gets the same
 * row back, active, as a new assignment: made now, by this chair.
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
    // The one row for this reviewer and this proposal, if they were on it before.
    const [before] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(eq(assignments.submissionId, v.submissionId), eq(assignments.reviewerId, v.reviewerId)),
      );
    const made = before
      ? await tx
          .update(assignments)
          .set({
            releasedAt: null,
            releaseReason: null,
            assignedByPersonId: actor.personId,
            createdAt: now,
          })
          // Only a released row is made active again: an active one is somebody's already.
          .where(and(eq(assignments.id, before.id), isNotNull(assignments.releasedAt)))
          .returning({ id: assignments.id })
      : await tx
          .insert(assignments)
          .values({
            conferenceId: conference.id,
            reviewerId: v.reviewerId,
            submissionId: v.submissionId,
            assignedByPersonId: actor.personId,
            createdAt: now,
          })
          .returning({ id: assignments.id });
    if (made.length === 0) throw new Refusal(409, "already_assigned");
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
 * Release a conference's active assignments that match, and record each: one audit row per
 * release, with the proposal, the reviewer and the reason. Returns how many were released. Run
 * it inside the transaction of what causes the release, under the locks that needs.
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
    now: Date;
  },
): Promise<number> {
  const released = await tx
    .update(assignments)
    .set({ releasedAt: v.now, releaseReason: v.reason })
    .where(
      and(
        eq(assignments.conferenceId, v.conferenceId),
        eq(assignments.reviewerId, v.reviewerId),
        v.submissionId ? eq(assignments.submissionId, v.submissionId) : undefined,
        isNull(assignments.releasedAt),
      ),
    )
    .returning({ submissionId: assignments.submissionId });
  for (const row of released) {
    await audit(tx, actor, {
      action: "assignment.released",
      conferenceId: v.conferenceId,
      targetType: "submission",
      targetId: row.submissionId,
      details: { reviewerId: v.reviewerId, reason: v.reason },
    });
  }
  return released.length;
}

/**
 * A chair removes a reviewer from a proposal: the assignment is released, and its row kept.
 * From then on it counts nowhere, and the reviewer no longer sees the proposal. 404 `not_found`
 * for a proposal the chair does not manage as a chair, and for someone who is not reviewing it
 * (any more). A proposal that takes no new reviewers can still lose one.
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
    const released = await releaseAssignments(tx, viewer, {
      conferenceId: conference.id,
      reviewerId: v.reviewerId,
      submissionId: v.submissionId,
      reason: "chair",
      now,
    });
    if (released === 0) throw new Refusal(404, "not_found");
  });
}
