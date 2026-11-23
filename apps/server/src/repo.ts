import type { PersonViewer, SubmissionRecord, Tier } from "@elochair/policy";
import {
  type Assignment,
  CONFERENCE_PHASES,
  ConferenceConfig,
  type Conflict,
  type Contribution,
  type Decision,
  isForwardPhaseMove,
  type Person,
  type Review,
  type RoleGrant,
  readStoredConfig,
  reviewersCanRead,
  type Submission,
} from "@elochair/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  apiTokens,
  assignments,
  conferenceRoles,
  conferences,
  conflicts,
  contributions,
  decisions,
  people,
  reviews,
  submissions,
} from "./db/schema";
import { hashToken, newToken } from "./secrets";

/*
 * Data access. Functions here return domain records (packages/schema shapes), never raw rows,
 * and never decide visibility: that is packages/policy's job.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export type ConferenceRow = {
  id: string;
  slug: string;
  phase: string;
  config: ConferenceConfig;
  /**
   * When the conference was first found in a phase in which reviewers can read; null if it
   * never was. Set once and never cleared (see "The mark that review has begun" below).
   */
  reviewBeganAt: string | null;
};

type ConferenceDbRow = typeof conferences.$inferSelect;

/**
 * A conference's row as a record. `config` is given where it was validated already (it has
 * just been written). Otherwise the stored configuration is read here, and nowhere else:
 * through readStoredConfig, which leaves out the wording of emails this version does not know
 * (a later version's, after a roll-back) and validates the rest as strictly as a save does.
 * Every write of a configuration still goes through ConferenceConfig itself (the settings save
 * and its review, saveConference, createConferenceIfMissing, the CLI's import-config).
 */
const toConference = (row: ConferenceDbRow, config?: ConferenceConfig): ConferenceRow => ({
  id: row.id,
  slug: row.slug,
  phase: row.phase,
  config: config ?? readStoredConfig(row.config),
  reviewBeganAt: isoOrNull(row.reviewBeganAt),
});

export async function getConference(db: Db, slug: string): Promise<ConferenceRow | null> {
  const [row] = await db.select().from(conferences).where(eq(conferences.slug, slug));
  return row ? toConference(row) : null;
}

/** A conference by its id, without a lock (lockConference and shareConference take one). */
export async function getConferenceById(db: Db, id: string): Promise<ConferenceRow | null> {
  const [row] = await db.select().from(conferences).where(eq(conferences.id, id));
  return row ? toConference(row) : null;
}

export async function listConferences(db: Db): Promise<ConferenceRow[]> {
  const rows = await db.select().from(conferences).orderBy(conferences.slug);
  return rows.map((r) => toConference(r));
}

/*
 * The mark that review has begun (`conferences.review_began_at`).
 *
 * Reviews are written while a conference is in `reviewing`, and stay when it leaves that phase,
 * also backwards: a chair can force a conference back to `cfp_open`. So whether reviews may
 * exist cannot be read from the phase a conference is in now. The mark says it durably: it is
 * set the first time the conference is found in a phase in which its reviewers can read
 * (reviewersCanRead: `reviewing` or a later one), and is never cleared. The guard on the review
 * form's settings decides by it (reviewsOutsideForm in services/settings.ts), where it may not
 * look at the reviews themselves. It is a fact every chair knows, and reveals nothing.
 *
 * Everything that gives a conference a phase sets it, and nothing else writes `phase`:
 * - createConferenceIfMissing and saveConference, for a conference created in such a phase, or
 *   put into one (saveConference with a phase, which only fixtures and new conferences pass);
 * - movePhase, which every move through the API and the CLI goes through, when the conference
 *   moves into such a phase, and also when it moves out of one with the mark still empty (a
 *   conference that was in review before this column existed, or under an earlier version of
 *   the app, which does not set it);
 * - markReviewBegun, once at every start of the server: a conference found in such a phase
 *   without the mark gets it, before any request is served.
 */

/** The phases in which reviewers can read, as the database is asked for them. */
const REVIEW_PHASES = CONFERENCE_PHASES.filter(reviewersCanRead);

/**
 * At the start of the server: every conference that is in a phase in which reviewers can read,
 * and has no mark yet, gets it. Returns how many did. These are the conferences that reached
 * review before the column existed, or while an earlier version of the app was running.
 */
export async function markReviewBegun(db: Db, now: Date): Promise<number> {
  const marked = await db
    .update(conferences)
    .set({ reviewBeganAt: now })
    .where(and(isNull(conferences.reviewBeganAt), inArray(conferences.phase, REVIEW_PHASES)))
    .returning({ id: conferences.id });
  return marked.length;
}

/** Create a conference only if its slug is new. Returns null when it already exists. */
export async function createConferenceIfMissing(
  db: Db,
  input: unknown,
  phase: string,
): Promise<ConferenceRow | null> {
  const config = ConferenceConfig.parse(input);
  const [row] = await db
    .insert(conferences)
    .values({
      slug: config.slug,
      config,
      phase,
      // Created in review, or past it: it has been in review from its first moment.
      ...(reviewersCanRead(phase) ? { reviewBeganAt: new Date() } : {}),
    })
    .onConflictDoNothing({ target: conferences.slug })
    .returning();
  return row ? toConference(row, config) : null;
}

/**
 * Create or replace a conference's configuration (validated first). `phase` is written as is,
 * also over an existing conference's phase, without the forward-only check: only fixtures and
 * new conferences pass it. To move an existing conference, use movePhase().
 *
 * With a phase, the mark that review has begun is kept in step: set for a conference created in
 * a phase in which reviewers can read, and for an existing one that is put into such a phase or
 * taken out of one with the mark still empty. A mark that is there stays as it is.
 */
export async function saveConference(
  db: Db,
  input: unknown,
  phase?: string,
): Promise<ConferenceRow> {
  const config = ConferenceConfig.parse(input);
  const now = new Date();
  const into = phase !== undefined && reviewersCanRead(phase);
  const [row] = await db
    .insert(conferences)
    .values({
      slug: config.slug,
      config,
      ...(phase ? { phase } : {}),
      ...(into ? { reviewBeganAt: now } : {}),
    })
    .onConflictDoUpdate({
      target: conferences.slug,
      set: {
        config,
        updatedAt: now,
        ...(phase
          ? {
              phase,
              // In an upsert, `conferences.phase` on the right-hand side is the phase the row
              // holds before this write.
              reviewBeganAt: into
                ? sql`coalesce(${conferences.reviewBeganAt}, ${now.toISOString()}::timestamptz)`
                : sql`coalesce(${conferences.reviewBeganAt}, case when ${inArray(conferences.phase, REVIEW_PHASES)} then ${now.toISOString()}::timestamptz end)`,
            }
          : {}),
      },
    })
    .returning();
  if (!row) throw new Error("failed to save conference");
  return toConference(row, config);
}

/**
 * Lock a conference's row until the transaction ends, and read it as it is at that moment.
 * A configuration save holds this while it checks submitted work against the new rules.
 */
export async function lockConference(tx: Db, conferenceId: string): Promise<ConferenceRow | null> {
  const [row] = await tx
    .select()
    .from(conferences)
    .where(eq(conferences.id, conferenceId))
    .for("update");
  return row ? toConference(row) : null;
}

/**
 * Hold a conference's row in share mode until the transaction ends, and read it as it is at
 * that moment. Every write to a submission or to its contributions takes this before it reads
 * or writes anything else about them (spec 02, §1.9): a configuration save holds the same row
 * for update while it checks submitted work, so the two wait for each other and the save never
 * checks work that is changing under it. Writers do not wait for one another.
 */
export async function shareConference(tx: Db, conferenceId: string): Promise<ConferenceRow | null> {
  const [row] = await tx
    .select()
    .from(conferences)
    .where(eq(conferences.id, conferenceId))
    .for("share");
  return row ? toConference(row) : null;
}

/** Replace a conference's configuration. Run it under lockConference(), after the checks. */
export async function writeConfig(
  tx: Db,
  conferenceId: string,
  config: ConferenceConfig,
  now: Date,
): Promise<void> {
  await tx
    .update(conferences)
    .set({ config, updatedAt: now })
    .where(eq(conferences.id, conferenceId));
}

/**
 * Spec 1.3: phases move forward only (draft ⇄ cfp_open aside). Any other move, including one to
 * the phase the conference already holds, needs force and a non-blank reason.
 */
export function phaseMoveAllowed(
  from: string,
  to: string,
  force: boolean | undefined,
  reason: string | null | undefined,
): boolean {
  return isForwardPhaseMove(from, to) || (Boolean(force) && Boolean(reason?.trim()));
}

export type PhaseMoveResult =
  | { ok: true; from: string }
  | { ok: false; code: "not_found" }
  /** The move is not forward and was not forced with a reason. */
  | { ok: false; code: "phase_backwards"; from: string }
  /**
   * The conference is not in the phase the caller said it was moving from (`move.from`), or the
   * phase changed between the check and the update (only possible outside a transaction).
   */
  | { ok: false; code: "stale"; from: string };

/**
 * Move a conference to another phase. Run it inside a transaction: it locks the conference row,
 * checks the move against the phase the row holds now (not one read before the lock), and
 * updates it only while it still holds that phase. The caller audits the move in the same
 * transaction. Every phase change (API and CLI) goes through here.
 *
 * It also sets the mark that review has begun, where the conference has none yet: when it moves
 * into a phase in which reviewers can read, and when it moves out of one (it was in review
 * before anything marked it). A forced move back never clears the mark.
 *
 * `move.from` is the phase the caller believes the conference is in. When it is given and is no
 * longer true, nothing moves: a step confirmed on a page that is out of date must not become a
 * jump of several phases, forced or not.
 */
export async function movePhase(
  tx: Db,
  conferenceId: string,
  move: { to: string; from?: string; force?: boolean; reason?: string | null; now: Date },
): Promise<PhaseMoveResult> {
  const [row] = await tx
    .select({ phase: conferences.phase, reviewBeganAt: conferences.reviewBeganAt })
    .from(conferences)
    .where(eq(conferences.id, conferenceId))
    .for("update");
  if (!row) return { ok: false, code: "not_found" };
  const from = row.phase;
  // Read under the row's lock, so two moves at once cannot both find it empty.
  const begins =
    row.reviewBeganAt === null && (reviewersCanRead(move.to) || reviewersCanRead(from));
  if (move.from !== undefined && move.from !== from) return { ok: false, code: "stale", from };
  if (!phaseMoveAllowed(from, move.to, move.force, move.reason)) {
    return { ok: false, code: "phase_backwards", from };
  }
  const updated = await tx
    .update(conferences)
    .set({ phase: move.to, updatedAt: move.now, ...(begins ? { reviewBeganAt: move.now } : {}) })
    .where(and(eq(conferences.id, conferenceId), eq(conferences.phase, from)))
    .returning({ id: conferences.id });
  return updated.length ? { ok: true, from } : { ok: false, code: "stale", from };
}

type PersonRow = typeof people.$inferSelect;

export function toPerson(r: PersonRow): Person {
  return {
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    orcid: r.orcid,
    affiliation: r.affiliation,
    country: r.country,
    languages: r.languages,
    bios: (r.bios ?? {}) as Record<string, string>,
    pronouns: r.pronouns,
  };
}

export async function getPerson(db: Db, id: string): Promise<Person | null> {
  const [r] = await db.select().from(people).where(eq(people.id, id));
  return r ? toPerson(r) : null;
}

export async function findOrCreatePerson(db: Db, email: string): Promise<Person> {
  const e = normalizeEmail(email);
  await db.insert(people).values({ email: e }).onConflictDoNothing({ target: people.email });
  const [r] = await db.select().from(people).where(eq(people.email, e));
  if (!r) throw new Error("failed to create person");
  return toPerson(r);
}

export async function loadPersonViewer(db: Db, personId: string): Promise<PersonViewer | null> {
  const [p] = await db.select().from(people).where(eq(people.id, personId));
  if (!p) return null;
  const grants: RoleGrant[] = (
    await db.select().from(conferenceRoles).where(eq(conferenceRoles.personId, personId))
  ).map((g) => ({
    conferenceId: g.conferenceId,
    role: g.role as RoleGrant["role"],
    scope: g.scope,
  }));
  return { kind: "person", personId, siteAdmin: p.siteAdmin, grants };
}

export async function grantRole(
  db: Db,
  grant: { conferenceId: string; personId: string; role: RoleGrant["role"]; scope?: string[] },
): Promise<void> {
  await db
    .insert(conferenceRoles)
    .values({ ...grant, scope: grant.scope ?? [] })
    .onConflictDoUpdate({
      target: [conferenceRoles.conferenceId, conferenceRoles.personId, conferenceRoles.role],
      set: { scope: grant.scope ?? [] },
    });
}

/**
 * A conference's assignments. The table holds the ones that stand, and nothing else: one that
 * was released is deleted from it, and its record kept in `assignment_releases` (spec 03, §1.3;
 * services/assignments.ts). So there is nothing to leave out here, and a released reviewer is a
 * stranger to the proposal everywhere at once: in what they may read, in who a chair is told
 * reviews it, and in every count.
 */
export async function loadAssignments(db: Db, conferenceId: string): Promise<Assignment[]> {
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.conferenceId, conferenceId));
  return rows.map((a) => ({
    id: a.id,
    conferenceId: a.conferenceId,
    reviewerId: a.reviewerId,
    submissionId: a.submissionId,
    createdAt: iso(a.createdAt),
    dueAt: isoOrNull(a.dueAt),
    assignedByPersonId: a.assignedByPersonId,
  }));
}

type ReviewRow = typeof reviews.$inferSelect;

export function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    conferenceId: r.conferenceId,
    submissionId: r.submissionId,
    reviewerId: r.reviewerId,
    version: r.version,
    status: r.status as Review["status"],
    scores: (r.scores ?? {}) as Review["scores"],
    comments: r.comments,
    chairNote: r.chairNote,
    recommendation: r.recommendation as Review["recommendation"],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    sentAt: isoOrNull(r.sentAt),
  };
}

/**
 * A conference's reviews that were sent (spec 03, §1.4): what the chairs' views, their counts
 * and the guard on the settings are given. A draft is its reviewer's own: it is read only for
 * that reviewer (services/reviews.ts), and never by this.
 */
export async function loadSentReviews(db: Db, conferenceId: string): Promise<Review[]> {
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.conferenceId, conferenceId), eq(reviews.status, "sent")));
  return rows.map(toReview);
}

type DecisionRow = typeof decisions.$inferSelect;

export function toDecision(r: DecisionRow): Decision {
  return {
    id: r.id,
    conferenceId: r.conferenceId,
    submissionId: r.submissionId,
    outcome: r.outcome as Decision["outcome"],
    decidedByPersonId: r.decidedByPersonId,
    decidedAt: iso(r.decidedAt),
    sentAt: isoOrNull(r.sentAt),
    sentByPersonId: r.sentByPersonId,
    comments: r.sentAt === null ? null : ((r.comments ?? []) as string[]),
  };
}

/**
 * A conference's decisions (spec 03, §1.6): those waiting to be sent, and those that were; of
 * one proposal, where one is named. They are read for the chairs' pages and for sending, and,
 * once sent, for the proposal's own people: who is shown what is packages/policy's to say.
 */
export async function loadDecisions(
  db: Db,
  conferenceId: string,
  only?: { submissionId: string },
): Promise<Decision[]> {
  const rows = await db
    .select()
    .from(decisions)
    .where(
      only
        ? and(
            eq(decisions.conferenceId, conferenceId),
            eq(decisions.submissionId, only.submissionId),
          )
        : eq(decisions.conferenceId, conferenceId),
    )
    .orderBy(decisions.decidedAt, decisions.id);
  return rows.map(toDecision);
}

/**
 * Everything packages/policy needs to project every submission of a conference: each with its
 * assignments (loadAssignments) and the phase the conference row holds.
 */
export async function loadSubmissionRecords(
  db: Db,
  conference: ConferenceRow,
  only?: { submissionId: string },
): Promise<SubmissionRecord[]> {
  const subs = await db
    .select()
    .from(submissions)
    .where(
      only
        ? and(eq(submissions.conferenceId, conference.id), eq(submissions.id, only.submissionId))
        : eq(submissions.conferenceId, conference.id),
    )
    .orderBy(submissions.createdAt, submissions.id);
  if (subs.length === 0) return [];
  const ids = subs.map((s) => s.id);

  const contribs = await db
    .select()
    .from(contributions)
    .where(inArray(contributions.submissionId, ids));
  const personIds = [...new Set(contribs.map((c) => c.personId))];
  const peopleRows = personIds.length
    ? await db.select().from(people).where(inArray(people.id, personIds))
    : [];
  const peopleById = new Map(peopleRows.map((p) => [p.id, toPerson(p)]));
  const assigns = await loadAssignments(db, conference.id);
  const confls = await db.select().from(conflicts).where(eq(conflicts.conferenceId, conference.id));

  const bySub = <T extends { submissionId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.submissionId) continue;
      m.set(r.submissionId, [...(m.get(r.submissionId) ?? []), r]);
    }
    return m;
  };
  const contribsBySub = bySub(contribs);
  const assignsBySub = bySub(assigns);

  return subs.map((s) => {
    const cs: Contribution[] = (contribsBySub.get(s.id) ?? []).map((c) => ({
      submissionId: c.submissionId,
      personId: c.personId,
      role: c.role as Contribution["role"],
      position: c.position,
      status: c.status as Contribution["status"],
      invitedEmail: c.invitedEmail,
      invitedName: c.invitedName,
      invitedAffiliation: c.invitedAffiliation,
    }));
    const authors = new Set(cs.map((c) => c.personId));
    const submission: Submission = {
      id: s.id,
      conferenceId: s.conferenceId,
      ownerPersonId: s.ownerPersonId,
      version: s.version,
      typeKey: s.typeKey,
      trackKey: s.trackKey,
      topicKeys: s.topicKeys,
      language: s.language,
      title: s.title,
      abstract: s.abstract,
      fields: s.fields as Submission["fields"],
      participationMode: s.participationMode as Submission["participationMode"],
      status: s.status as Submission["status"],
      createdAt: iso(s.createdAt),
      updatedAt: iso(s.updatedAt),
      submittedAt: isoOrNull(s.submittedAt),
    };
    const subConflicts: Conflict[] = confls
      .filter(
        (c) =>
          c.submissionId === s.id || (c.otherPersonId !== null && authors.has(c.otherPersonId)),
      )
      .map((c) => ({
        id: c.id,
        conferenceId: c.conferenceId,
        personId: c.personId,
        submissionId: c.submissionId,
        otherPersonId: c.otherPersonId,
        kind: c.kind as Conflict["kind"],
        declaredBy: c.declaredBy as Conflict["declaredBy"],
      }));
    return {
      config: conference.config,
      phase: conference.phase,
      submission,
      contributions: cs,
      assignments: assignsBySub.get(s.id) ?? [],
      conflicts: subConflicts,
      people: peopleById,
    };
  });
}

/** One submission with everything the policy needs, or null if it does not exist. */
export async function loadSubmission(
  db: Db,
  submissionId: string,
): Promise<{ conference: ConferenceRow; rec: SubmissionRecord } | null> {
  const [row] = await db
    .select({ conferenceId: submissions.conferenceId })
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  if (!row) return null;
  const [k] = await db.select().from(conferences).where(eq(conferences.id, row.conferenceId));
  if (!k) return null;
  const conference = toConference(k);
  const [rec] = await loadSubmissionRecords(db, conference, { submissionId });
  return rec ? { conference, rec } : null;
}

export async function getPersonByEmail(db: Db, email: string): Promise<Person | null> {
  const [r] = await db
    .select()
    .from(people)
    .where(eq(people.email, normalizeEmail(email)));
  return r ? toPerson(r) : null;
}

export class NotAChairError extends Error {}

/**
 * Agent tokens are for people who chair the conference. Tier M is cloud-safe; tier C works only
 * on the internal listener. The plain token is returned once and never stored.
 */
export async function createApiToken(
  db: Db,
  opts: { personId: string; conferenceId: string; tier: Tier; name: string; expiresAt?: Date },
): Promise<{ id: string; token: string }> {
  const viewer = await loadPersonViewer(db, opts.personId);
  const chairs =
    viewer?.siteAdmin ||
    viewer?.grants.some(
      (g) => g.conferenceId === opts.conferenceId && (g.role === "admin" || g.role === "chair"),
    );
  if (!chairs) throw new NotAChairError("agent tokens can only be issued to conference chairs");
  const token = newToken(opts.tier === "C" ? "elo_c_" : "elo_m_");
  const [row] = await db
    .insert(apiTokens)
    .values({
      personId: opts.personId,
      conferenceId: opts.conferenceId,
      tier: opts.tier,
      name: opts.name,
      tokenHash: hashToken(token),
      expiresAt: opts.expiresAt ?? null,
    })
    .returning({ id: apiTokens.id });
  if (!row) throw new Error("failed to create token");
  return { id: row.id, token };
}

/** Revoke a token. False when there is no such token or it was already revoked (kept as is). */
export async function revokeApiToken(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}
