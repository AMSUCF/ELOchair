import { createHash } from "node:crypto";
import {
  type AuthorDecision,
  canDecide,
  canManagePeople,
  type DecisionColumns,
  type DecisionsPool,
  type DecisionsRecord,
  type DecisionsView,
  decisionsPosition,
  type PersonViewer,
  type ProposalDecision,
  projectAuthorDecision,
  projectDecisionColumns,
  projectDecisions,
  projectProposalDecision,
  projectSendSummary,
  type SendPlan,
  type SendSummary,
  type SubmissionRecord,
  sendPlan,
  submissionAccess,
  takesDecision,
  type Viewer,
} from "@elochair/policy";
import {
  DECISION_MESSAGES,
  type DecisionOutcome,
  decisionOutcomesFor,
  decisionsCanBeSent,
} from "@elochair/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { CursorCodec } from "../cursor";
import type { Db } from "../db/client";
import { decisions, reviews, submissions } from "../db/schema";
import { deliverPending, enqueueMail } from "../mail";
import {
  type ConferenceRow,
  loadDecisions,
  loadSentReviews,
  loadSubmission,
  loadSubmissionRecords,
  shareConference,
  toReview,
} from "../repo";
import { Refusal } from "../routes/common";
import { decisionMessage } from "../templates";
import { lockProposal, pageOfPool } from "./assignments";
import { mailContext, personLang } from "./mutations";
import { stillChair } from "./roles";
import { cursorContext } from "./submissions";

/*
 * Decisions (spec 03, §1.6): what the chairs' pages about them are rendered from, the two
 * writes that record one (recording or changing it, and taking it back), and the one that
 * sends them.
 *
 * Who may do what, which proposals take a decision and what sending would do are decided in
 * packages/policy (decisions.ts). This module loads what the policy needs and writes what it
 * allows.
 *
 * RECORDING changes one table, `decisions`, and nothing else: not the proposal's status, not
 * its version, not the day it was last changed. So nothing its owner, its co-authors, its
 * reviewers or an agent can read says that a decision was recorded. It takes the locks of every
 * chair's write about one proposal, in the one order of services/roles.ts: the proposal's row
 * (for no key update), the conference's roles lock (shared, with the chair read again under it:
 * stillChair), then the conference's row (shared).
 *
 * SENDING is the one write that changes many proposals at once: for every decision that is
 * waiting it sets the proposal's status, marks the decision sent with what the authors are sent
 * of the reviews, and queues one email for each of the proposal's people, all in one
 * transaction. services/roles.ts says why that is safe; in short:
 * - it takes the rows of all those proposals first, in the order of their ids, before any
 *   other lock, so two sends at once take them in the same order, and the second finds
 *   nothing left to send;
 * - every other write holds one proposal's row at most, and takes it before anything else: an
 *   owner's withdrawal and a chair's change of a decision each run wholly before the send (which
 *   then sees what they did) or wholly after it (and then find the decision sent);
 * - then the roles lock (shared) and the conference's row (shared): a phase move and a settings
 *   save wait, so the decisions go out in the phase and with the wording in force when they
 *   are sent.
 *
 * WHAT WAS CONFIRMED IS WHAT IS SENT. The confirmation a chair reads is made of the plan as it
 * stood (sendPlan), and carries a token of it: which decisions, and to whom. The send names
 * that token and is refused (409 `stale`, with the numbers as they are) where the plan is no
 * longer that one: a decision recorded, changed or taken back meanwhile, a proposal withdrawn,
 * someone who left a proposal. Nothing goes out that no chair was shown.
 */

/** A proposal's sent reviews, for the Decision section of its page. */
async function sentReviewsOf(db: Db, submissionId: string) {
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.submissionId, submissionId), eq(reviews.status, "sent")));
  return rows.map(toReview);
}

/** Everything packages/policy needs to say what was decided at a conference. */
export async function loadDecisionsRecord(
  db: Db,
  conference: ConferenceRow,
  records?: SubmissionRecord[],
): Promise<DecisionsRecord> {
  return {
    conferenceId: conference.id,
    config: conference.config,
    phase: conference.phase,
    submissions: records ?? (await loadSubmissionRecords(db, conference)),
    decisions: await loadDecisions(db, conference.id),
    // Sent reviews only: a draft is its reviewer's own, and is not read for a chair.
    reviews: await loadSentReviews(db, conference.id),
  };
}

/** A pool on the Decisions page with one page of its proposals, and where the next begins. */
export type DecisionsPoolPage = DecisionsPool & { nextCursor: string | null };
export type DecisionsPage = Omit<DecisionsView, "pools"> & { pools: DecisionsPoolPage[] };

/**
 * The Decisions page for a chair in person (null for anyone else), a page of each pool at a
 * time. It is projected whole first and cut afterwards, as the Assignments page is, so paging
 * cannot reveal what the projection leaves out. With `only`, the answer holds that pool alone,
 * from `only.cursor`.
 */
export async function decisionsPage(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  v: { limit: number; cursors: CursorCodec; only?: { pool: string; cursor?: string } },
): Promise<DecisionsPage | null> {
  if (!canManagePeople(viewer, conference.id)) return null;
  const rec = await loadDecisionsRecord(db, conference);
  const view = projectDecisions(viewer, rec);
  if (!view) return null;
  const created = new Map(rec.submissions.map((s) => [s.submission.id, s.submission.createdAt]));
  const pools = view.pools
    .filter((pool) => !v.only || pool.key === v.only.pool)
    .map(
      (pool): DecisionsPoolPage => ({
        ...pool,
        ...pageOfPool({
          items: pool.items,
          positionOf: (item) =>
            decisionsPosition(item, { id: item.id, createdAt: created.get(item.id) ?? "" }),
          list: `${cursorContext(viewer, conference.id)}:decisions:${pool.key}`,
          cursors: v.cursors,
          cursor: v.only?.cursor,
          limit: v.limit,
        }),
      }),
    );
  return { ...view, pools };
}

/**
 * The Decision section of one proposal's page, for a chair in person who manages it; null for
 * everyone else (the answer a missing proposal gets). Only that proposal's decisions and sent
 * reviews are read.
 */
export async function proposalDecision(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  submissionId: string,
): Promise<ProposalDecision | null> {
  if (!canManagePeople(viewer, conference.id)) return null;
  const [record] = await loadSubmissionRecords(db, conference, { submissionId });
  if (!record || !canDecide(viewer, record)) return null;
  return projectProposalDecision(
    viewer,
    {
      conferenceId: conference.id,
      config: conference.config,
      phase: conference.phase,
      submissions: [record],
      decisions: await loadDecisions(db, conference.id, { submissionId }),
      reviews: await sentReviewsOf(db, submissionId),
    },
    submissionId,
  );
}

/**
 * What both writes about one proposal's decision begin with: the locks, in the one order, and
 * under them the chair and the proposal as they are now. 404 `not_found` for a proposal the
 * chair does not manage as a chair (their own, one they have a conflict with, a draft, another
 * conference's): the answer a missing one gets.
 */
async function asDecidingChair(
  tx: Db,
  viewer: PersonViewer,
  k: ConferenceRow,
  submissionId: string,
): Promise<{ actor: PersonViewer; conference: ConferenceRow; record: SubmissionRecord }> {
  await lockProposal(tx, k, submissionId);
  const actor = await stillChair(tx, viewer, k.id);
  const conference = await shareConference(tx, k.id);
  if (!conference) throw new Refusal(404, "not_found");
  const [record] = await loadSubmissionRecords(tx, conference, { submissionId });
  if (!record || !canDecide(actor, record)) throw new Refusal(404, "not_found");
  return { actor, conference, record };
}

/** The decision that is waiting to be sent for a proposal, read under the proposal's row. */
async function waitingRow(tx: Db, submissionId: string) {
  const [row] = await tx
    .select()
    .from(decisions)
    .where(and(eq(decisions.submissionId, submissionId), isNull(decisions.sentAt)));
  return row;
}

/**
 * A chair records a decision for one proposal, or changes the one that is recorded and not
 * sent. Nobody is told, and nothing about the proposal itself is written.
 * - 404 `not_found` for a proposal the chair does not manage as a chair.
 * - 409 `not_in_review`, `decided` or `not_under_consideration` when the proposal takes no
 *   decision now (takesDecision): the conference is not in review yet, its accept or reject
 *   was sent, or it was withdrawn.
 * - 409 `already_waitlisted` for "waiting list" again for a proposal whose authors were told
 *   just that: what it can be given now is an accept or a reject.
 * Recording what is recorded already changes nothing, and is not audited again.
 */
export async function recordDecision(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  v: { submissionId: string; outcome: DecisionOutcome },
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const { actor, conference, record } = await asDecidingChair(tx, viewer, k, v.submissionId);
    const takes = takesDecision(record);
    if (takes !== "yes") throw new Refusal(409, takes);
    if (!decisionOutcomesFor(record.submission.status).includes(v.outcome)) {
      throw new Refusal(409, "already_waitlisted");
    }
    const waiting = await waitingRow(tx, v.submissionId);
    if (waiting?.outcome === v.outcome) return;
    const written = waiting
      ? await tx
          .update(decisions)
          .set({ outcome: v.outcome, decidedByPersonId: actor.personId, decidedAt: now })
          .where(and(eq(decisions.id, waiting.id), isNull(decisions.sentAt)))
          .returning({ id: decisions.id })
      : await tx
          .insert(decisions)
          .values({
            conferenceId: conference.id,
            submissionId: v.submissionId,
            outcome: v.outcome,
            decidedByPersonId: actor.personId,
            decidedAt: now,
          })
          .returning({ id: decisions.id });
    const [row] = written;
    // Read and written under the proposal's row: there is a row, or something is badly wrong.
    if (!row) throw new Error("the decision was not written");
    await audit(tx, viewer, {
      action: waiting ? "decision.changed" : "decision.recorded",
      conferenceId: conference.id,
      targetType: "submission",
      targetId: v.submissionId,
      // IDs and the outcome: never a name, a title or a word of a review.
      details: { decisionId: row.id, outcome: v.outcome },
    });
  });
}

/**
 * A chair takes back the decision that is recorded for a proposal and not sent: it is deleted,
 * and the proposal is as if none had been recorded. A sent decision is never taken back.
 * - 404 `not_found` for a proposal the chair does not manage as a chair.
 * - 409 `no_decision` where nothing is waiting to be sent for it (it was sent meanwhile, or
 *   another chair took it back).
 */
export async function takeBackDecision(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  v: { submissionId: string },
): Promise<void> {
  await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const { conference } = await asDecidingChair(tx, viewer, k, v.submissionId);
    const waiting = await waitingRow(tx, v.submissionId);
    if (!waiting) throw new Refusal(409, "no_decision");
    await tx.delete(decisions).where(and(eq(decisions.id, waiting.id), isNull(decisions.sentAt)));
    await audit(tx, viewer, {
      action: "decision.taken_back",
      conferenceId: conference.id,
      targetType: "submission",
      targetId: v.submissionId,
      details: { decisionId: waiting.id, outcome: waiting.outcome },
    });
  });
}

/**
 * Names a plan: which decisions it would send, with which outcome and to whom, and which it
 * would not send. Two plans have the same token exactly when sending them would do the same.
 * It is a hash, and holds nothing that can be read back.
 */
export const planToken = (plan: SendPlan): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        send: plan.send.map((p) => [
          p.decision.id,
          p.decision.outcome,
          p.recipients.map((person) => person.id),
        ]),
        dropped: plan.dropped.map((d) => d.id),
      }),
    )
    .digest("hex")
    .slice(0, 32);

/** What the confirmation says, with the token that a send has to name. */
export type SendConfirmation = SendSummary & { token: string };

/**
 * What sending the decisions would do now, for a chair of the conference in person: numbers,
 * and the token of the plan they describe. Null for anyone else.
 */
export async function sendConfirmation(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
): Promise<SendConfirmation | null> {
  if (!canManagePeople(viewer, conference.id)) return null;
  const rec = await loadDecisionsRecord(db, conference);
  const plan = sendPlan(rec);
  const summary = projectSendSummary(viewer, rec, plan);
  return summary && { ...summary, token: planToken(plan) };
}

/**
 * A chair sends the decisions: every decision of the conference that is waiting, also those of
 * proposals this chair is kept from. In one transaction, for each: the proposal's status
 * becomes the outcome, the decision is marked sent with the reviewers' comments for the authors
 * as they are sent, and one email is queued for the proposal's owner and each confirmed
 * co-author, in that person's language. Returns what was sent, as numbers.
 * - 409 `not_deciding` unless the conference is in `deciding` or a later phase.
 * - 409 `stale`, with the confirmation as it would read now (`summary`), where what would be
 *   sent is not what `token` names. Nothing is sent. Two chairs who send at once send once: the
 *   second finds the decisions sent, which is not what it confirmed.
 * - 409 `nothing_to_send` where there is no decision to send.
 * A decision whose proposal no longer awaits one (withdrawn since) is not sent: it is counted in
 * the confirmation and in the answer (`dropped`), and deleted with the decisions that are sent,
 * so that it is said once and does not wait for good. Where it is all that waits, nothing is
 * sent and it stays: a chair can take it back on its proposal's page (a withdrawn proposal's;
 * a draft is no chair's to open, and its decision goes with the next ones that are sent).
 */
export async function sendDecisions(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  v: { token: string },
): Promise<SendSummary> {
  const now = deps.now();
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  const sent = await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // The rows of what this changes come first, as everywhere: here, of every proposal with a
    // decision waiting, in the order of their ids (the rows are locked as they are returned,
    // sorted). For no key update, as the other chairs' writes take a proposal's row.
    const waiting = await tx
      .selectDistinct({ submissionId: decisions.submissionId })
      .from(decisions)
      .where(and(eq(decisions.conferenceId, k.id), isNull(decisions.sentAt)));
    const held = new Set(
      waiting.length === 0
        ? []
        : (
            await tx
              .select({ id: submissions.id })
              .from(submissions)
              .where(
                and(
                  eq(submissions.conferenceId, k.id),
                  inArray(
                    submissions.id,
                    waiting.map((w) => w.submissionId),
                  ),
                ),
              )
              .orderBy(submissions.id)
              .for("no key update")
          ).map((row) => row.id),
    );
    const actor = await stillChair(tx, viewer, k.id);
    const conference = await shareConference(tx, k.id);
    if (!conference) throw new Refusal(404, "not_found");
    if (!decisionsCanBeSent(conference.phase)) throw new Refusal(409, "not_deciding");

    // Everything is read again under those locks: the plan as it is when this commits.
    const rec = await loadDecisionsRecord(tx, conference);
    const plan = sendPlan(rec);
    const summary = projectSendSummary(actor, rec, plan);
    if (!summary) throw new Refusal(403, "forbidden");
    const token = planToken(plan);
    // A decision recorded for another proposal since the rows were taken is in the plan and
    // not under a lock of ours: it is also not what the token names, so nothing is sent.
    const all = [...plan.send.map((p) => p.decision), ...plan.dropped];
    if (token !== v.token || all.some((d) => !held.has(d.submissionId))) {
      throw new Refusal(409, "stale", { summary: { ...summary, token } });
    }
    if (plan.send.length === 0) throw new Refusal(409, "nothing_to_send");

    for (const { decision, record, recipients, comments } of plan.send) {
      const s = record.submission;
      await tx
        .update(submissions)
        .set({ status: decision.outcome, version: sql`${submissions.version} + 1`, updatedAt: now })
        .where(eq(submissions.id, s.id));
      await tx
        .update(decisions)
        .set({ sentAt: now, sentByPersonId: actor.personId, comments })
        .where(and(eq(decisions.id, decision.id), isNull(decisions.sentAt)));
      for (const person of recipients) {
        const lang = personLang(person, conference);
        const at = mailContext(conference, record, lang, origin);
        await enqueueMail(
          tx,
          DECISION_MESSAGES[decision.outcome],
          decisionMessage(conference.config, lang, person.email, {
            outcome: decision.outcome,
            conference: at.conference,
            format: at.format,
            title: s.title,
            link: at.link,
            comments,
          }),
          now,
        );
      }
      await audit(tx, viewer, {
        action: "decision.sent",
        conferenceId: conference.id,
        targetType: "submission",
        targetId: s.id,
        details: { decisionId: decision.id, outcome: decision.outcome },
      });
    }
    // What will never be sent does not stay waiting: it would be counted at every send.
    for (const decision of plan.dropped) {
      await tx
        .delete(decisions)
        .where(and(eq(decisions.id, decision.id), isNull(decisions.sentAt)));
      await audit(tx, viewer, {
        action: "decision.dropped",
        conferenceId: conference.id,
        targetType: "submission",
        targetId: decision.submissionId,
        details: { decisionId: decision.id, outcome: decision.outcome },
      });
    }
    return summary;
  });
  deliverPending(deps.db, deps.mail, { now: deps.now }).catch((err) =>
    console.error("mail delivery failed", err),
  );
  return sent;
}

/**
 * The decision about a proposal as its own people are shown it: for its owner and its confirmed
 * co-authors, once it was sent (projectAuthorDecision). Null before that, and for everyone
 * else: the answer a missing proposal gets.
 */
export async function authorDecision(
  db: Db,
  viewer: Viewer,
  submissionId: string,
): Promise<AuthorDecision | null> {
  if (viewer.kind !== "person") return null;
  const loaded = await loadSubmission(db, submissionId);
  // Asked before anything of a decision is read: for whoever is not its owner or a confirmed
  // co-author, none is.
  if (!loaded || submissionAccess(viewer, loaded.rec) !== "submitter") return null;
  return projectAuthorDecision(
    viewer,
    loaded.rec,
    await loadDecisions(db, loaded.conference.id, { submissionId }),
  );
}

/**
 * What the proposals export says of each proposal's decision and reviews, for a chair of the
 * conference in person: null for a track chair and for an agent, whatever its tier, for whom
 * neither a decision nor a review is read at all.
 */
export async function decisionColumns(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  records: SubmissionRecord[],
): Promise<Record<string, DecisionColumns> | null> {
  if (!canManagePeople(viewer, conference.id)) return null;
  return projectDecisionColumns(viewer, await loadDecisionsRecord(db, conference, records));
}
