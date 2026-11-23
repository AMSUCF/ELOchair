import {
  isReviewerOf,
  type MyReviews,
  type OwnReview,
  type PersonViewer,
  projectMyReviews,
  projectOwnReview,
  reviewsOpen,
  type SubmissionRecord,
  type Viewer,
} from "@elochair/policy";
import {
  type DeclineReviewInput,
  type Review,
  type ReviewContent,
  type ReviewInput,
  reviewContentIssues,
  reviewersCanRead,
  reviewIssues,
  reviewPoolFor,
} from "@elochair/schema";
import { and, count, eq } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { Db } from "../db/client";
import { conflicts, reviews, submissions } from "../db/schema";
import {
  type ConferenceRow,
  listConferences,
  loadPersonViewer,
  loadSubmission,
  loadSubmissionRecords,
  shareConference,
  toReview,
} from "../repo";
import { Refusal } from "../routes/common";
import { releaseAssignments } from "./assignments";
import { chairsToTell, recordNotifications } from "./notifications";
import { lockRoles } from "./roles";

/*
 * Reviews (spec 03, §1.4): a reviewer's own list, their review of one proposal, and the two
 * things they write: the review itself (a draft, then sent, then changed for as long as the
 * conference is in review), and "I cannot review this".
 *
 * Who may do what is decided in packages/policy (reviews.ts). This module loads what the policy
 * needs and writes what it allows. A draft is read only here, and only for its own reviewer:
 * the chairs' views are handed sent reviews (loadSentReviews in repo.ts), and nothing else.
 *
 * A chair who also reviews, and is assigned, is a proposal's reviewer like anyone (isReviewerOf):
 * they read the proposal as a chair, and write their review here.
 *
 * Both writes take their locks in the one order of services/roles.ts, the order of the two
 * writes that change who reviews a proposal: the proposal's row (for no key update), then the
 * conference's roles lock (shared), then the conference's row (shared). Under them the person
 * asking is read again, and so is what gives them the proposal as its reviewer. Whoever is not
 * its reviewer to begin with is answered before any of them is taken (notItsReviewer), so that
 * nobody holds a proposal's row who has nothing to write to it.
 * - The proposal's row puts a review in order with every change to who reviews the proposal
 *   (a chair removing the reviewer waits for a review that is being sent, and then finds it
 *   sent), with its owner's writes (a proposal withdrawn meanwhile takes no review), and with
 *   another save of the same review.
 * - The roles lock does the same against the removal of the reviewer's role, which takes it
 *   exclusive: a review sent before it is kept with its assignment, and one that comes after
 *   finds no reviewer.
 * - The conference's row does the same against a settings save and a phase move, which hold
 *   it for update: the save's check of sent reviews never misses one that is being sent, a
 *   review is checked against the form in force when it commits, and none is written once the
 *   conference has left `reviewing`.
 */

/** One person's own reviews at a conference, drafts included: for that person only. */
async function ownReviews(db: Db, conferenceId: string, personId: string): Promise<Review[]> {
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.conferenceId, conferenceId), eq(reviews.reviewerId, personId)));
  return rows.map(toReview);
}

/** One person's own review of one proposal, if they have begun one. */
async function ownReview(db: Db, submissionId: string, personId: string): Promise<Review | null> {
  const [row] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.submissionId, submissionId), eq(reviews.reviewerId, personId)));
  return row ? toReview(row) : null;
}

/**
 * "My reviews": for each conference where the person reviews and reviewers can read, their own
 * assignments with where each review stands (projectMyReviews). Conferences where they hold no
 * reviewer's role are not even loaded.
 */
export async function myReviews(db: Db, viewer: PersonViewer): Promise<MyReviews[]> {
  const reviewing = new Set(
    viewer.grants.filter((g) => g.role === "reviewer").map((g) => g.conferenceId),
  );
  if (reviewing.size === 0) return [];
  const out: MyReviews[] = [];
  for (const k of await listConferences(db)) {
    if (!reviewing.has(k.id) || !reviewersCanRead(k.phase)) continue;
    const view = projectMyReviews(
      viewer,
      k,
      await loadSubmissionRecords(db, k),
      await ownReviews(db, k.id, viewer.personId),
    );
    if (view) out.push(view);
  }
  return out;
}

/**
 * A reviewer's own review of a proposal, as it stands; null for anyone who is not the
 * proposal's reviewer (the answer a missing proposal gets).
 */
export async function readOwnReview(
  db: Db,
  viewer: Viewer,
  submissionId: string,
): Promise<OwnReview | null> {
  if (viewer.kind !== "person") return null;
  const loaded = await loadSubmission(db, submissionId);
  if (!loaded || !isReviewerOf(viewer, loaded.rec)) return null;
  return projectOwnReview(viewer, loaded.rec, await ownReview(db, submissionId, viewer.personId));
}

/**
 * Before any lock: someone who is not the proposal's reviewer as things stand is answered as a
 * missing proposal is, without taking a row or a lock that others would wait for. Nothing read
 * here decides anything else: under the locks all of it is read again (asReviewer).
 */
async function notItsReviewer(db: Db, viewer: PersonViewer, submissionId: string): Promise<void> {
  const loaded = await loadSubmission(db, submissionId);
  if (!loaded || !isReviewerOf(viewer, loaded.rec)) throw new Refusal(404, "not_found");
}

/**
 * What both writes begin with: the locks, in the one order, and under them the person asking
 * and the proposal as they are now.
 * - 404 `not_found` for anyone who is not the proposal's reviewer at that moment: a stranger,
 *   one of its people, a chair who is not assigned to it, a reviewer of another committee,
 *   someone whose assignment was released or whose role was removed, and for a proposal that
 *   does not exist.
 * - 409 `not_reviewing` when the conference is not in `reviewing`: reviews are written in that
 *   phase, and read in the later ones.
 */
async function asReviewer(
  tx: Db,
  viewer: PersonViewer,
  submissionId: string,
): Promise<{ actor: PersonViewer; conference: ConferenceRow; rec: SubmissionRecord }> {
  const missing = () => new Refusal(404, "not_found");
  // For no key update, as the writes that change who reviews it (services/assignments.ts say
  // why): a role's removal, which holds the roles lock, must be able to point a row at it.
  const [locked] = await tx
    .select({ conferenceId: submissions.conferenceId })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .for("no key update");
  if (!locked) throw missing();
  // Shared: a reviewer changes nobody's role. The removal of theirs takes it exclusive, and so
  // runs wholly before this (and then they are no reviewer below) or wholly after it.
  await lockRoles(tx, locked.conferenceId, "shared");
  const actor = await loadPersonViewer(tx, viewer.personId);
  const conference = await shareConference(tx, locked.conferenceId);
  if (!actor || !conference) throw missing();
  const [rec] = await loadSubmissionRecords(tx, conference, { submissionId });
  if (!rec || !isReviewerOf(actor, rec)) throw missing();
  if (!reviewsOpen(conference.phase)) throw new Refusal(409, "not_reviewing");
  return { actor, conference, rec };
}

/**
 * A reviewer saves their review of a proposal: a draft, or sent.
 * - 409 `stale`, with the version as it is, when the form was loaded on another version (two
 *   tabs, two devices): nothing is written, as for a proposal.
 * - 409 `already_sent` for a draft save of a review that was sent: a sent review stays with the
 *   chairs, and is changed by sending it again.
 * - 422 `invalid`, with the issues beside their fields, for an answer the form has no place for
 *   and, on sending, for whatever the form still requires (reviewIssues). A draft may be as
 *   incomplete as it likes.
 *
 * The form is the pool's as the configuration holds it when this commits.
 */
export async function saveReview(
  deps: Deps,
  viewer: PersonViewer,
  submissionId: string,
  input: ReviewInput,
): Promise<OwnReview> {
  const now = deps.now();
  await notItsReviewer(deps.db, viewer, submissionId);
  return deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const { actor, conference, rec } = await asReviewer(tx, viewer, submissionId);
    const pool = reviewPoolFor(conference.config, rec.submission.typeKey);
    // Nobody is a proposal's reviewer without a pool that reviews its format.
    if (!pool) throw new Refusal(404, "not_found");
    const current = await ownReview(tx, submissionId, actor.personId);
    const version = current?.version ?? 0;
    if (input.version !== version) throw new Refusal(409, "stale", { version });
    if (current?.status === "sent" && !input.send) throw new Refusal(409, "already_sent");
    const content: ReviewContent = {
      scores: input.scores,
      comments: input.comments,
      chairNote: input.chairNote,
      recommendation: input.recommendation,
    };
    const issues = input.send
      ? reviewIssues(pool, content, rec.submission.language)
      : reviewContentIssues(pool, content);
    if (issues.length) throw new Refusal(422, "invalid", { issues });

    const status = input.send ? "sent" : "draft";
    const written = current
      ? await tx
          .update(reviews)
          .set({
            ...content,
            status,
            version: version + 1,
            updatedAt: now,
            // The day it was first sent stays; a change shows as one (updatedAt).
            sentAt: current.sentAt ? new Date(current.sentAt) : input.send ? now : null,
          })
          .where(and(eq(reviews.id, current.id), eq(reviews.version, version)))
          .returning()
      : await tx
          .insert(reviews)
          .values({
            ...content,
            conferenceId: conference.id,
            submissionId,
            reviewerId: actor.personId,
            status,
            version: 1,
            createdAt: now,
            updatedAt: now,
            sentAt: input.send ? now : null,
          })
          // One review for a reviewer and a proposal: the table refuses a second.
          .onConflictDoNothing({ target: [reviews.submissionId, reviews.reviewerId] })
          .returning();
    const [row] = written;
    if (!row) throw new Refusal(409, "stale", { version });
    // A review sent for the first time may be the one that gives the proposal all the reviews
    // its committee asks for: the chairs are to be told (spec 03, §1.7). Counted under the
    // proposal's row, so two reviews sent at once are counted one after the other, and the
    // number is reached once. A sent review that is changed adds none.
    if (input.send && current?.status !== "sent") {
      const [sent] = await tx
        .select({ n: count() })
        .from(reviews)
        .where(and(eq(reviews.submissionId, submissionId), eq(reviews.status, "sent")));
      if (sent?.n === pool.reviewsPerSubmission) {
        await recordNotifications(tx, {
          conferenceId: conference.id,
          submissionId,
          kind: "reviews_complete",
          personIds: await chairsToTell(tx, conference.id),
          by: actor.personId,
          now,
        });
      }
    }
    await audit(tx, viewer, {
      action: !input.send
        ? "review.draft_saved"
        : current?.status === "sent"
          ? "review.changed"
          : "review.sent",
      conferenceId: conference.id,
      targetType: "submission",
      targetId: submissionId,
      // IDs and numbers: never a score, a recommendation or a word of the review.
      details: { reviewId: row.id, version: row.version },
    });
    const view = projectOwnReview(actor, rec, toReview(row));
    if (!view) throw new Refusal(404, "not_found");
    return view;
  });
}

/**
 * "I cannot review this proposal": the reviewer's assignment is released (releaseAssignments,
 * with their reason and their note for the chairs), their draft goes with it, and when the
 * reason is a conflict of interest that conflict is recorded, so that the policy never gives
 * them the proposal again and no chair is offered them for it. From then on they get of it
 * what a stranger gets.
 * - 409 `review_sent` once their review was sent: a sent review is part of the proposal's
 *   record. They change it, or write to the chairs.
 *
 * The chairs are told by email that a proposal was given back, as often as each has chosen.
 */
export async function declineReview(
  deps: Deps,
  viewer: PersonViewer,
  submissionId: string,
  input: DeclineReviewInput,
): Promise<void> {
  const now = deps.now();
  const note = input.note?.trim() || null;
  await notItsReviewer(deps.db, viewer, submissionId);
  await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const { actor, conference } = await asReviewer(tx, viewer, submissionId);
    const current = await ownReview(tx, submissionId, actor.personId);
    if (current?.status === "sent") throw new Refusal(409, "review_sent");
    const { released } = await releaseAssignments(tx, viewer, {
      conferenceId: conference.id,
      reviewerId: actor.personId,
      submissionId,
      reason: input.reason,
      note,
      now,
    });
    // They were its reviewer a moment ago, under these locks: there was an assignment.
    if (released === 0) throw new Refusal(404, "not_found");
    if (input.reason === "conflict") {
      await tx.insert(conflicts).values({
        conferenceId: conference.id,
        personId: actor.personId,
        submissionId,
        kind: "declared",
        declaredBy: "reviewer",
        createdAt: now,
      });
      await audit(tx, viewer, {
        action: "conflict.declared",
        conferenceId: conference.id,
        targetType: "submission",
        targetId: submissionId,
        details: { personId: actor.personId, kind: "declared" },
      });
    }
    // The chairs are to be told that a proposal was given back, and why in the app's own
    // words (spec 03, §1.7): never the note, and never to a chair who is kept from the
    // proposal, which is decided when the email is made.
    await recordNotifications(tx, {
      conferenceId: conference.id,
      submissionId,
      kind: "declined",
      personIds: await chairsToTell(tx, conference.id),
      by: actor.personId,
      reason: input.reason,
      now,
    });
  });
}
