import {
  assignedCount,
  invitedPools,
  type PeopleRecord,
  type PersonViewer,
  projectRoleInvitation,
  type RoleInvitationView,
  reviewerPools,
  sentCount,
  type Viewer,
} from "@elochair/policy";
import {
  type ConferenceRole,
  type InvitableRole,
  localize,
  type RemovableRole,
  ROLE_INVITATIONS,
  type RoleInvitation,
  type RoleInvitationAnswerInput,
  type RoleInvitationInput,
  roleInvitationState,
} from "@elochair/schema";
import { and, count, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { Db } from "../db/client";
import {
  conferenceRoles,
  people,
  reviewerProfiles,
  roleInvitationSends,
  roleInvitations,
} from "../db/schema";
import { deliverPending, enqueueMail, type MailMessage } from "../mail";
import {
  type ConferenceRow,
  findOrCreatePerson,
  getConferenceById,
  grantRole,
  loadSentReviews,
  loadSubmissionRecords,
  normalizeEmail,
  shareConference,
  toPerson,
} from "../repo";
import { RateLimited, Refusal } from "../routes/common";
import { hashToken, newToken } from "../secrets";
import { chairInvitationMessage, reviewerInvitationMessage } from "../templates";
import { releaseAssignments } from "./assignments";
import { lockRoles, stillChair } from "./roles";

/*
 * People and invitations (spec 03, §1.2): who holds a role at a conference, inviting someone to
 * one by email, answering such an invitation by its link, and taking a role away.
 *
 * What protects the invitee is what protects someone invited to a proposal (spec 02, §1.2):
 * - an invitation is kept and shown as the chair typed it, never from the invitee's profile;
 * - the link's token is stored as a hash, works once, and is removed from the stored mail;
 * - the emails are counted in a ledger that cancelling cannot empty.
 * And the role is bound to the address: accepting gives it to the person the invitation was
 * sent to, whoever opens the link.
 *
 * Locks are taken in the one order of services/roles.ts: the invitation's row, then the
 * conference's roles lock, then the conference's row, then the locks that count the day's
 * emails. What a chair does here shares the roles lock and reads the chair again (stillChair);
 * removing a role and accepting an invitation take it exclusive.
 */

const DAY = 24 * 60 * 60 * 1000;
const LINK_LIFE = ROLE_INVITATIONS.days * DAY;
const RESEND_INTERVAL = ROLE_INVITATIONS.resendMinutes * 60 * 1000;

/**
 * The rows in `conference_roles` that make up a role as the People page shows it. `admin` means
 * nothing more than `chair`: whoever holds either is a chair, and removing one removes both.
 */
const ROLE_ROWS: Record<RemovableRole, ConferenceRole[]> = {
  chair: ["chair", "admin"],
  reviewer: ["reviewer"],
  track_chair: ["track_chair"],
};

/** What is wrong with a request, at the value concerned (the shape of a submission's issues). */
type PeopleIssue = { path: string; code: "required" | "unknown_pool" };

type InvitationRow = typeof roleInvitations.$inferSelect;

/** An invitation as a domain record: everything but the hash of its link. */
export function toRoleInvitation(r: InvitationRow): RoleInvitation {
  return {
    id: r.id,
    conferenceId: r.conferenceId,
    personId: r.personId,
    role: r.role as RoleInvitation["role"],
    pools: r.pools,
    invitedEmail: r.invitedEmail,
    invitedName: r.invitedName,
    lang: r.lang as RoleInvitation["lang"],
    sentAt: r.lastSentAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    answer: r.answer as RoleInvitation["answer"],
    answeredAt: r.answeredAt ? r.answeredAt.toISOString() : null,
    cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
  };
}

/**
 * Everything packages/policy needs for the People page. Person records are loaded for the
 * people who hold a role and for nobody else: an invitee's profile is not even read.
 */
export async function loadPeopleRecord(db: Db, conference: ConferenceRow): Promise<PeopleRecord> {
  const grants = await db
    .select()
    .from(conferenceRoles)
    .where(eq(conferenceRoles.conferenceId, conference.id));
  const holderIds = [...new Set(grants.map((g) => g.personId))];
  const holders = holderIds.length
    ? await db.select().from(people).where(inArray(people.id, holderIds))
    : [];
  const profiles = await db
    .select()
    .from(reviewerProfiles)
    .where(eq(reviewerProfiles.conferenceId, conference.id));
  const invitations = await db
    .select()
    .from(roleInvitations)
    .where(
      and(
        eq(roleInvitations.conferenceId, conference.id),
        isNull(roleInvitations.cancelledAt),
        or(isNull(roleInvitations.answer), ne(roleInvitations.answer, "accepted")),
      ),
    );
  return {
    conferenceId: conference.id,
    poolKeys: conference.config.reviewPools.map((p) => p.key),
    grants: grants.map((g) => ({
      personId: g.personId,
      role: g.role as ConferenceRole,
      scope: g.scope,
    })),
    reviewerProfiles: profiles.map((p) => ({
      personId: p.personId,
      languages: p.languages,
      maxLoad: p.maxLoad,
    })),
    people: new Map(holders.map((p) => [p.id, toPerson(p)])),
    invitations: invitations.map(toRoleInvitation),
    submissions: await loadSubmissionRecords(db, conference),
    // Which reviews were sent, and nothing of what they say: the page counts them.
    sentReviews: (await loadSentReviews(db, conference.id)).map((r) => ({
      submissionId: r.submissionId,
      reviewerId: r.reviewerId,
    })),
  };
}

/**
 * One change to who holds a role or who is invited: a transaction, then the mail it queued.
 * A refusal over a limit is audited after the rollback, as for submissions (mutateSubmission).
 */
async function change<T>(deps: Deps, actor: Viewer, fn: (tx: Db) => Promise<T>): Promise<T> {
  const result = await deps.db
    .transaction(async (txRaw) => fn(txRaw as unknown as Db))
    .catch(async (err: unknown) => {
      if (err instanceof RateLimited) await audit(deps.db, actor, err.entry);
      throw err;
    });
  deliverPending(deps.db, deps.mail, { now: deps.now }).catch((err) =>
    console.error("mail delivery failed", err),
  );
  return result;
}

const advisoryLock = (tx: Db, key: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`);

type InvitationLimit = "per_inviter" | "per_recipient";

/**
 * The daily limits, counted from the send ledger, which cancelling an invitation cannot touch.
 * First invitations and resends both count. Locks the inviter's and the address's budgets until
 * the transaction ends, so that concurrent requests cannot both pass the count; that lock on
 * the address also puts two invitations to it in order, so that the second sees the first.
 * Call `over()` once the request is known to be one that would send an email.
 */
async function invitationBudget(tx: Db, v: { inviterId: string; email: string; now: Date }) {
  for (const key of [
    `role_invitations:inviter:${v.inviterId}`,
    `role_invitations:recipient:${v.email}`,
  ]) {
    await advisoryLock(tx, key);
  }
  // One person row per normalized address: an address never invited has no row and no sends.
  const [recipient] = await tx
    .select({ id: people.id })
    .from(people)
    .where(eq(people.email, v.email));
  const recipientId = recipient?.id ?? null;
  const since = new Date(v.now.getTime() - DAY);
  const sentSince = async (who: "inviter" | "recipient", personId: string) => {
    const column =
      who === "inviter"
        ? roleInvitationSends.inviterPersonId
        : roleInvitationSends.recipientPersonId;
    const [row] = await tx
      .select({ n: count() })
      .from(roleInvitationSends)
      .where(and(eq(column, personId), gt(roleInvitationSends.sentAt, since)));
    return row?.n ?? 0;
  };
  const over = async (): Promise<InvitationLimit | null> => {
    if ((await sentSince("inviter", v.inviterId)) >= ROLE_INVITATIONS.perInviterPerDay)
      return "per_inviter";
    if (
      recipientId &&
      (await sentSince("recipient", recipientId)) >= ROLE_INVITATIONS.perRecipientPerDay
    )
      return "per_recipient";
    return null;
  };
  return { recipientId, over };
}

/**
 * Refuses an invitation that would be a second one: the address already holds that role at this
 * conference (409 `already_has_role`), or an invitation to it is waiting (409 `already_invited`).
 * Both are things the People page shows the chair anyway, and nothing else about the address is
 * said. Call it under the address's lock (invitationBudget).
 */
async function refuseSecond(
  tx: Db,
  v: {
    conferenceId: string;
    email: string;
    recipientId: string | null;
    role: InvitableRole;
    now: Date;
    /** The invitation being sent again, which is not a second one. */
    except?: string;
  },
): Promise<void> {
  if (v.recipientId) {
    const held = await tx
      .select({ role: conferenceRoles.role })
      .from(conferenceRoles)
      .where(
        and(
          eq(conferenceRoles.conferenceId, v.conferenceId),
          eq(conferenceRoles.personId, v.recipientId),
          inArray(conferenceRoles.role, ROLE_ROWS[v.role]),
        ),
      );
    if (held.length) throw new Refusal(409, "already_has_role");
  }
  const waiting = await tx
    .select({ id: roleInvitations.id })
    .from(roleInvitations)
    .where(
      and(
        eq(roleInvitations.conferenceId, v.conferenceId),
        eq(roleInvitations.invitedEmail, v.email),
        eq(roleInvitations.role, v.role),
        isNull(roleInvitations.answeredAt),
        isNull(roleInvitations.cancelledAt),
        gt(roleInvitations.expiresAt, v.now),
      ),
    );
  if (waiting.some((w) => w.id !== v.except)) throw new Refusal(409, "already_invited");
}

/**
 * The invitation email, in the language the chair chose. It names the conference, for a
 * reviewer the review pools, and the link: nothing a person typed, and no person.
 */
function invitationMail(
  conference: ConferenceRow,
  inv: Pick<RoleInvitation, "role" | "pools" | "lang" | "invitedEmail">,
  token: string,
  origin: string,
): MailMessage {
  const { config } = conference;
  const title = localize(config.title, inv.lang, config.defaultLanguage);
  // The token travels in the fragment, which browsers send to no server.
  const link = `${origin}/${inv.lang}/role-invitation#token=${token}`;
  if (inv.role === "chair") {
    return chairInvitationMessage(config, inv.lang, inv.invitedEmail, { conference: title, link });
  }
  return reviewerInvitationMessage(config, inv.lang, inv.invitedEmail, {
    conference: title,
    committees: invitedPools(inv, config).map((p) =>
      localize(p.name, inv.lang, config.defaultLanguage),
    ),
    link,
  });
}

const unknownPools = (conference: ConferenceRow, pools: readonly string[]) =>
  pools.filter((key) => !conference.config.reviewPools.some((p) => p.key === key));

/** A chair invites one address to a role. Returns the new invitation's id. */
export async function inviteToRole(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  input: RoleInvitationInput,
): Promise<{ id: string }> {
  const now = deps.now();
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  const email = normalizeEmail(input.email);
  return change(deps, viewer, async (tx) => {
    await stillChair(tx, viewer, k.id);
    // The configuration as it is when this commits says which pools there are.
    const conference = await shareConference(tx, k.id);
    if (!conference) throw new Refusal(404, "not_found");
    if (unknownPools(conference, input.pools).length) {
      const issues: PeopleIssue[] = [{ path: "pools", code: "unknown_pool" }];
      throw new Refusal(422, "invalid", { issues });
    }
    const budget = await invitationBudget(tx, { inviterId: viewer.personId, email, now });
    await refuseSecond(tx, {
      conferenceId: conference.id,
      email,
      recipientId: budget.recipientId,
      role: input.role,
      now,
    });
    const over = await budget.over();
    if (over) {
      throw new RateLimited({
        action: "role_invitation.rate_limited",
        conferenceId: conference.id,
        details: {
          limit: over,
          kind: "invite",
          ...(budget.recipientId ? { personId: budget.recipientId } : {}),
        },
      });
    }
    // Never write what the chair typed into anyone's profile: it stays on the invitation.
    const invitee = await findOrCreatePerson(tx, email);
    const token = newToken("role_");
    const [row] = await tx
      .insert(roleInvitations)
      .values({
        conferenceId: conference.id,
        personId: invitee.id,
        role: input.role,
        pools: input.pools,
        invitedEmail: email,
        invitedName: input.name ?? null,
        lang: input.lang,
        tokenHash: hashToken(token),
        invitedByPersonId: viewer.personId,
        createdAt: now,
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + LINK_LIFE),
      })
      .returning({ id: roleInvitations.id });
    if (!row) throw new Error("insert failed");
    await enqueueMail(
      tx,
      "role_invitation",
      invitationMail(
        conference,
        { role: input.role, pools: input.pools, lang: input.lang, invitedEmail: email },
        token,
        origin,
      ),
      now,
    );
    await tx.insert(roleInvitationSends).values({
      inviterPersonId: viewer.personId,
      recipientPersonId: invitee.id,
      conferenceId: conference.id,
      invitationId: row.id,
      kind: "invite",
      sentAt: now,
    });
    await audit(tx, viewer, {
      action: "role_invitation.sent",
      conferenceId: conference.id,
      targetType: "role_invitation",
      targetId: row.id,
      details: { personId: invitee.id, role: input.role, pools: input.pools },
    });
    return { id: row.id };
  });
}

/** The invitation of this conference with that id, locked until the transaction ends. */
async function lockInvitation(
  tx: Db,
  conference: ConferenceRow,
  invitationId: string,
): Promise<InvitationRow> {
  const [row] = await tx
    .select()
    .from(roleInvitations)
    .where(
      and(eq(roleInvitations.id, invitationId), eq(roleInvitations.conferenceId, conference.id)),
    )
    .for("update");
  // Another conference's invitation does not exist here.
  if (!row) throw new Refusal(404, "not_found");
  return row;
}

/**
 * Send an invitation again: a new link in a new email, and the link in the earlier email stops
 * working. For an invitation that is waiting, or one that expired unanswered; at most once an
 * hour, and it counts toward the daily limits like any other email.
 */
export async function resendRoleInvitation(
  deps: Deps,
  viewer: PersonViewer,
  k: ConferenceRow,
  invitationId: string,
): Promise<void> {
  const now = deps.now();
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  await change(deps, viewer, async (tx) => {
    const row = await lockInvitation(tx, k, invitationId);
    await stillChair(tx, viewer, k.id);
    // The configuration as it is when this commits says which of its pools there still are.
    const conference = await shareConference(tx, k.id);
    if (!conference) throw new Refusal(404, "not_found");
    const inv = toRoleInvitation(row);
    const state = roleInvitationState(inv, now);
    if (state !== "waiting" && state !== "expired") throw new Refusal(409, "not_waiting");
    // A reviewer's invitation whose pools are all gone from the conference cannot be accepted:
    // its link gives nothing. It is cancelled, and the person invited again.
    if (inv.role === "reviewer" && invitedPools(inv, conference.config).length === 0) {
      throw new Refusal(409, "pools_gone");
    }
    const refusal = (limit: string) =>
      new RateLimited({
        action: "role_invitation.rate_limited",
        conferenceId: conference.id,
        targetType: "role_invitation",
        targetId: row.id,
        details: { limit, kind: "resend", personId: row.personId },
      });
    if (now.getTime() - row.lastSentAt.getTime() < RESEND_INTERVAL) {
      throw refusal("per_invitation_hourly");
    }
    const budget = await invitationBudget(tx, {
      inviterId: viewer.personId,
      email: row.invitedEmail,
      now,
    });
    // Since it was sent, the person may have been given the role, or been invited again.
    await refuseSecond(tx, {
      conferenceId: conference.id,
      email: row.invitedEmail,
      recipientId: row.personId,
      role: inv.role,
      now,
      except: row.id,
    });
    const over = await budget.over();
    if (over) throw refusal(over);
    const token = newToken("role_");
    await tx
      .update(roleInvitations)
      .set({
        tokenHash: hashToken(token),
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + LINK_LIFE),
      })
      .where(eq(roleInvitations.id, row.id));
    await enqueueMail(tx, "role_invitation", invitationMail(conference, inv, token, origin), now);
    await tx.insert(roleInvitationSends).values({
      inviterPersonId: viewer.personId,
      recipientPersonId: row.personId,
      conferenceId: conference.id,
      invitationId: row.id,
      kind: "resend",
      sentAt: now,
    });
    await audit(tx, viewer, {
      action: "role_invitation.resent",
      conferenceId: conference.id,
      targetType: "role_invitation",
      targetId: row.id,
      details: { personId: row.personId, role: inv.role, pools: inv.pools },
    });
  });
}

/**
 * Cancel an invitation: its link stops working and it leaves the chairs' list. The same takes
 * one that expired or was declined off that list. Nobody is told. An accepted invitation cannot
 * be cancelled: the role it gave is removed instead.
 */
export async function cancelRoleInvitation(
  deps: Deps,
  viewer: PersonViewer,
  conference: ConferenceRow,
  invitationId: string,
): Promise<void> {
  const now = deps.now();
  await change(deps, viewer, async (tx) => {
    const row = await lockInvitation(tx, conference, invitationId);
    await stillChair(tx, viewer, conference.id);
    const inv = toRoleInvitation(row);
    const state = roleInvitationState(inv, now);
    if (state === "accepted") throw new Refusal(409, "already_answered");
    // Cancelled before (a second tap, or another chair): there is nothing left to do or record.
    if (state === "cancelled") return;
    await tx
      .update(roleInvitations)
      .set({ cancelledAt: now })
      .where(eq(roleInvitations.id, row.id));
    await audit(tx, viewer, {
      action: "role_invitation.cancelled",
      conferenceId: conference.id,
      targetType: "role_invitation",
      targetId: row.id,
      details: { personId: row.personId, role: inv.role, pools: inv.pools, state },
    });
  });
}

/**
 * Take a role away from a person at a conference.
 * - A chair is whoever holds the `chair` or the `admin` role, and loses both.
 * - A chair cannot remove their own chair role, so that a conference keeps a chair.
 * - A reviewer's assignments at the conference are released in the same transaction, with the
 *   reason `role_removed` (each is recorded; spec 03, §1.3), and their reviewer profile is
 *   deleted. A review they sent stays, and so does the assignment it belongs to: a sent review
 *   is part of its proposal's record (spec 03, §1.2). Their drafts go with the assignments
 *   that are released. The request names the two numbers the confirmation showed (as the
 *   People page counts them for this chair): the proposals assigned to them, and how many of
 *   those have a sent review. When either is no longer the number, nothing is removed (409
 *   `stale`, with the numbers as they are now).
 * - The roles lock is taken exclusive, so no chair is assigning this reviewer meanwhile (an
 *   assignment shares it): one made before is released here, and one that comes after finds no
 *   reviewer to assign. Nor is this reviewer sending a review meanwhile (a review's write
 *   shares the lock too): one sent before is kept here, and one that comes after finds no
 *   reviewer. Nobody who is not a reviewer is left with an assignment, except beside a review
 *   they sent.
 *
 * `v.personId` comes from the address and is only ever used to find the role's rows. Whose role
 * it is, is then read from those rows: an id written another way (in capitals) names the same
 * person to the database, and must name the same person to every check made here.
 */
export async function removeRole(
  deps: Deps,
  viewer: PersonViewer,
  conference: ConferenceRow,
  v: { personId: string; role: RemovableRole; assignments?: number; reviews?: number },
): Promise<void> {
  const now = deps.now();
  await change(deps, viewer, async (tx) => {
    // Read again under the lock: of two chairs removing each other at the same moment, the
    // second finds that it is no longer a chair, and the conference keeps one.
    const actor = await stillChair(tx, viewer, conference.id, "exclusive");
    const held = await tx
      .select()
      .from(conferenceRoles)
      .where(
        and(
          eq(conferenceRoles.conferenceId, conference.id),
          eq(conferenceRoles.personId, v.personId),
          inArray(conferenceRoles.role, ROLE_ROWS[v.role]),
        ),
      );
    const target = held[0]?.personId;
    if (!target) throw new Refusal(404, "not_found");
    if (v.role === "chair" && target === actor.personId) throw new Refusal(409, "own_role");
    const mine = and(
      eq(conferenceRoles.conferenceId, conference.id),
      eq(conferenceRoles.personId, target),
      inArray(conferenceRoles.role, ROLE_ROWS[v.role]),
    );
    const details: Record<string, unknown> = { role: v.role };
    if (v.role === "chair") details.removed = held.map((g) => g.role).sort();
    if (v.role === "track_chair") details.tracks = held.flatMap((g) => g.scope);
    if (v.role === "reviewer") {
      const records = await loadSubmissionRecords(tx, conference);
      const shown = {
        assignments: assignedCount(actor, target, records),
        reviews: sentCount(actor, target, records, await loadSentReviews(tx, conference.id)),
      };
      if (v.assignments !== shown.assignments || (v.reviews ?? 0) !== shown.reviews) {
        throw new Refusal(409, "stale", shown);
      }
      // Every assignment the person has here, whoever could see it: each is released and
      // recorded, with the proposal's id, except those whose review was sent, which stay with
      // their reviews (releaseAssignments). The audit log is not a page.
      const { released, kept } = await releaseAssignments(tx, viewer, {
        conferenceId: conference.id,
        reviewerId: target,
        reason: "role_removed",
        now,
      });
      await tx
        .delete(reviewerProfiles)
        .where(
          and(
            eq(reviewerProfiles.conferenceId, conference.id),
            eq(reviewerProfiles.personId, target),
          ),
        );
      details.pools = held.flatMap((g) => g.scope);
      details.assignments = released;
      details.reviewsKept = kept;
    }
    await tx.delete(conferenceRoles).where(mine);
    await audit(tx, viewer, {
      action: "role.removed",
      conferenceId: conference.id,
      targetType: "person",
      targetId: target,
      details,
    });
  });
}

/** The invitation a link token belongs to, in whatever state it is; null for no such token. */
async function invitationByToken(db: Db, token: string, lock = false) {
  const query = db
    .select()
    .from(roleInvitations)
    .where(eq(roleInvitations.tokenHash, hashToken(token)));
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/**
 * What the invitation page shows for a link; null when the link does not work (no such token,
 * or an invitation that was answered, cancelled or has expired: one answer for all of them).
 */
export async function roleInvitationInfo(
  deps: Deps,
  viewer: Viewer,
  token: string,
): Promise<RoleInvitationView | null> {
  const row = await invitationByToken(deps.db, token);
  if (!row) return null;
  const conference = await getConferenceById(deps.db, row.conferenceId);
  if (!conference) return null;
  const [invitee] = await deps.db
    .select({ displayName: people.displayName })
    .from(people)
    .where(eq(people.id, row.personId));
  return projectRoleInvitation(viewer, toRoleInvitation(row), conference, invitee, deps.now());
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

/**
 * Answer an invitation to a role by its link.
 * - Whoever sends the link's token, the role goes to the person the invitation was addressed to
 *   (`person_id` on its row). Nothing in the request can name another person, role or pool, and
 *   nobody is signed in by it.
 * - Declining needs nothing.
 * - Accepting needs a name while the person's profile has none: their own words, never the name
 *   the chair typed. A reviewer also says which languages they can review in.
 * - A reviewer gets the role for the invitation's pools that the conference still has. Someone
 *   who is a reviewer already keeps their pools and gains these.
 * - A link that does not work (unknown, answered, cancelled, expired) gets one answer:
 *   400 `invalid_or_expired`.
 */
export async function answerRoleInvitation(
  deps: Deps,
  viewer: Viewer,
  input: RoleInvitationAnswerInput,
): Promise<"accepted" | "declined"> {
  const now = deps.now();
  const dead = () => new Refusal(400, "invalid_or_expired");
  return change(deps, viewer, async (tx) => {
    // Locked: of two answers to one invitation, the second finds it answered.
    const row = await invitationByToken(tx, input.token, true);
    if (!row) throw dead();
    const inv = toRoleInvitation(row);
    if (roleInvitationState(inv, now) !== "waiting") throw dead();
    // The person the invitation was addressed to acts, whoever opened the link.
    const invitee: PersonViewer = {
      kind: "person",
      personId: row.personId,
      siteAdmin: false,
      grants: [],
    };
    const record = { personId: row.personId, role: inv.role };
    const answered = (answer: "accepted" | "declined") =>
      tx
        .update(roleInvitations)
        .set({ answer, answeredAt: now })
        .where(eq(roleInvitations.id, row.id));

    // Accepting changes who holds a role: the roles lock, exclusive, and before the
    // conference's row (the one lock order, services/roles.ts). Declining changes no role.
    if (input.answer === "accept") await lockRoles(tx, row.conferenceId, "exclusive");
    // The configuration as it is when this commits says which pools there are.
    const conference = await shareConference(tx, row.conferenceId);
    if (!conference) throw dead();
    const pools = invitedPools(inv, conference.config).map((p) => p.key);
    // Never the reviewer's role without a pool: on a role, no scope means every pool. With
    // none of its pools left the link shows no invitation (roleInvitationInfo), so it takes no
    // answer either, not even a refusal: what cannot be read cannot be answered.
    if (inv.role === "reviewer" && pools.length === 0) throw dead();

    if (input.answer === "decline") {
      await answered("declined");
      await audit(tx, invitee, {
        action: "role_invitation.declined",
        conferenceId: row.conferenceId,
        targetType: "role_invitation",
        targetId: row.id,
        details: { ...record, pools: inv.pools },
      });
      return "declined" as const;
    }

    const [person] = await tx
      .select({ displayName: people.displayName })
      .from(people)
      .where(eq(people.id, row.personId));
    const profileName = person?.displayName?.trim();
    const givenName = input.displayName?.trim();
    const issues: PeopleIssue[] = [];
    if (!profileName && !givenName) issues.push({ path: "displayName", code: "required" });
    if (inv.role === "reviewer" && !input.languages?.length) {
      issues.push({ path: "languages", code: "required" });
    }
    if (issues.length) throw new Refusal(422, "invalid", { issues });

    if (inv.role === "chair") {
      await tx
        .insert(conferenceRoles)
        .values({ conferenceId: conference.id, personId: row.personId, role: "chair", scope: [] })
        .onConflictDoNothing();
    } else {
      const all = conference.config.reviewPools.map((p) => p.key);
      const [held] = await tx
        .select({ scope: conferenceRoles.scope })
        .from(conferenceRoles)
        .where(
          and(
            eq(conferenceRoles.conferenceId, conference.id),
            eq(conferenceRoles.personId, row.personId),
            eq(conferenceRoles.role, "reviewer"),
          ),
        );
      const [profile] = await tx
        .select({ pools: reviewerProfiles.pools })
        .from(reviewerProfiles)
        .where(
          and(
            eq(reviewerProfiles.conferenceId, conference.id),
            eq(reviewerProfiles.personId, row.personId),
          ),
        );
      // A reviewer already: the pools are added to what they have. A role without a scope is
      // every pool already, and stays that: adding to it would take pools away.
      const scope = !held
        ? pools
        : held.scope.length === 0
          ? []
          : reviewerPools(union(held.scope, pools), all);
      await grantRole(tx, {
        conferenceId: conference.id,
        personId: row.personId,
        role: "reviewer",
        scope,
      });
      const before = held ? (profile?.pools ?? reviewerPools(held.scope, all)) : [];
      const offered = {
        pools: reviewerPools(union(before, pools), all),
        languages: input.languages ?? [],
        maxLoad: input.maxLoad ?? ROLE_INVITATIONS.defaultLoad,
      };
      await tx
        .insert(reviewerProfiles)
        .values({ conferenceId: conference.id, personId: row.personId, ...offered })
        .onConflictDoUpdate({
          target: [reviewerProfiles.conferenceId, reviewerProfiles.personId],
          set: offered,
        });
    }
    if (!profileName && givenName) {
      // Only the invitee's own words reach their profile; the name the chair typed never does.
      const named = await tx
        .update(people)
        .set({ displayName: givenName })
        .where(
          and(
            eq(people.id, row.personId),
            or(isNull(people.displayName), sql`btrim(${people.displayName}) = ''`),
          ),
        )
        .returning({ id: people.id });
      if (named.length) {
        await audit(tx, invitee, {
          action: "person.profile_updated",
          targetType: "person",
          targetId: row.personId,
          details: { changed: ["displayName"], via: "role_invitation" },
        });
      }
    }
    await answered("accepted");
    await audit(tx, invitee, {
      action: "role_invitation.accepted",
      conferenceId: conference.id,
      targetType: "role_invitation",
      targetId: row.id,
      details: { ...record, pools },
    });
    return "accepted" as const;
  });
}
