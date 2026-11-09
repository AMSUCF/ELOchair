import type { PersonViewer, SubmissionRecord, Tier } from "@elochair/policy";
import {
  type Assignment,
  ConferenceConfig,
  type Conflict,
  type Contribution,
  isForwardPhaseMove,
  type Person,
  type RoleGrant,
  type Submission,
} from "@elochair/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  apiTokens,
  assignments,
  conferenceRoles,
  conferences,
  conflicts,
  contributions,
  people,
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

export type ConferenceRow = { id: string; slug: string; phase: string; config: ConferenceConfig };

export async function getConference(db: Db, slug: string): Promise<ConferenceRow | null> {
  const [row] = await db.select().from(conferences).where(eq(conferences.slug, slug));
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    phase: row.phase,
    config: ConferenceConfig.parse(row.config),
  };
}

export async function listConferences(db: Db): Promise<ConferenceRow[]> {
  const rows = await db.select().from(conferences).orderBy(conferences.slug);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    phase: r.phase,
    config: ConferenceConfig.parse(r.config),
  }));
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
    .values({ slug: config.slug, config, phase })
    .onConflictDoNothing({ target: conferences.slug })
    .returning();
  return row ? { id: row.id, slug: row.slug, phase: row.phase, config } : null;
}

/**
 * Create or replace a conference's configuration (validated first). `phase` is written as is,
 * also over an existing conference's phase, without the forward-only check: only fixtures and
 * new conferences pass it. To move an existing conference, use movePhase().
 */
export async function saveConference(
  db: Db,
  input: unknown,
  phase?: string,
): Promise<ConferenceRow> {
  const config = ConferenceConfig.parse(input);
  const [row] = await db
    .insert(conferences)
    .values({ slug: config.slug, config, ...(phase ? { phase } : {}) })
    .onConflictDoUpdate({
      target: conferences.slug,
      set: { config, updatedAt: new Date(), ...(phase ? { phase } : {}) },
    })
    .returning();
  if (!row) throw new Error("failed to save conference");
  return { id: row.id, slug: row.slug, phase: row.phase, config };
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
  /** The phase changed between the check and the update (only possible outside a transaction). */
  | { ok: false; code: "stale"; from: string };

/**
 * Move a conference to another phase. Run it inside a transaction: it locks the conference row,
 * checks the move against the phase the row holds now (not one read before the lock), and
 * updates it only while it still holds that phase. The caller audits the move in the same
 * transaction. Every phase change (API and CLI) goes through here.
 */
export async function movePhase(
  tx: Db,
  conferenceId: string,
  move: { to: string; force?: boolean; reason?: string | null; now: Date },
): Promise<PhaseMoveResult> {
  const [row] = await tx
    .select({ phase: conferences.phase })
    .from(conferences)
    .where(eq(conferences.id, conferenceId))
    .for("update");
  if (!row) return { ok: false, code: "not_found" };
  const from = row.phase;
  if (!phaseMoveAllowed(from, move.to, move.force, move.reason)) {
    return { ok: false, code: "phase_backwards", from };
  }
  const updated = await tx
    .update(conferences)
    .set({ phase: move.to, updatedAt: move.now })
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

/** Everything packages/policy needs to project every submission of a conference. */
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
  const assigns = await db
    .select()
    .from(assignments)
    .where(eq(assignments.conferenceId, conference.id));
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
    const subAssignments: Assignment[] = (assignsBySub.get(s.id) ?? []).map((a) => ({
      id: a.id,
      conferenceId: a.conferenceId,
      reviewerId: a.reviewerId,
      submissionId: a.submissionId,
      createdAt: iso(a.createdAt),
      dueAt: isoOrNull(a.dueAt),
    }));
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
      submission,
      contributions: cs,
      assignments: subAssignments,
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
  const conference = {
    id: k.id,
    slug: k.slug,
    phase: k.phase,
    config: ConferenceConfig.parse(k.config),
  };
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
