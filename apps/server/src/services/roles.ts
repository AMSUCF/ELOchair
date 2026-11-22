import { isConferenceChair, type PersonViewer } from "@elochair/policy";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadPersonViewer } from "../repo";
import { Refusal } from "../routes/common";

/*
 * The lock on who holds a role at a conference, and the check that rests on it.
 *
 * The rule: once the removal of a chair's role has committed, nothing that person began as a
 * chair commits afterwards. A route checks who is asking before its transaction begins, and a
 * chair may be removed between the two. So every change that is allowed because the caller
 * chairs the conference calls stillChair() inside its own transaction: it takes the conference's
 * roles lock in shared mode and reads the caller's role again. Removing a role (and accepting an
 * invitation, which gives one) takes that lock in exclusive mode. A removal therefore waits for
 * the changes already under way, which commit as a chair's, and every change that comes after it
 * finds the role gone and is refused.
 *
 * Which changes: saving the configuration, moving the phase, and on the People page inviting,
 * sending again, cancelling and removing. A new route that writes because its caller is a chair
 * does the same. Reads are checked once, when they are asked for; a CSV export is a read, and
 * what it writes is the record that it was made.
 *
 * ONE LOCK ORDER EVERYWHERE (spec 02, §1.9). A transaction takes what it needs of these, in
 * this order, and never goes back for an earlier one:
 *   1. the row of what it changes: a submission's, or a role invitation's (for update);
 *   2. the conference's roles lock (lockRoles): shared to act as a chair, exclusive to change
 *      who holds a role;
 *   3. the conference's row: shared by a write (shareConference), for update by a configuration
 *      save or a phase move (lockConference, movePhase);
 *   4. the locks that count a day's invitations: the sender's, then the address's.
 * No transaction holds the rows of two submissions, of two invitations or of two conferences.
 * So nothing waits for a lock while it holds one that comes later, and the orders cannot cross.
 */

export type RolesLock = "shared" | "exclusive";

/**
 * The conference's roles lock, held until the transaction ends. It comes after the row of a
 * submission or of a role invitation, and before the conference's row (see above). The column
 * is named so that the statement can be told from the other advisory locks (the tests that
 * check the order of locks read the statements).
 */
export async function lockRoles(tx: Db, conferenceId: string, mode: RolesLock): Promise<void> {
  const key = `people:${conferenceId}`;
  await tx.execute(
    mode === "exclusive"
      ? sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, 0)) as roles_lock`
      : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}::text, 0)) as roles_lock`,
  );
}

/**
 * The person acting, read again inside the transaction and under the roles lock: still a chair
 * of the conference (a chair, an admin or a site admin, which are one group), or 403. Returns
 * them as they are now, with the roles they hold now. `exclusive` is for a change to who holds
 * a role; every other change shares the lock, so that they do not wait for one another.
 *
 * A site admin holds no role row. Their flag (`people.site_admin`) is read afresh here like
 * everything else, so the check keeps working for them, and a flag cleared before this point
 * refuses the request. Nothing in the app clears that flag (it is set by the `site-admin`
 * command and unset only by hand, in the database), and doing so takes no lock: a request that
 * is already past this check can still commit after it. A command that revokes it would have to
 * take this lock, exclusive, for every conference.
 */
export async function stillChair(
  tx: Db,
  viewer: PersonViewer,
  conferenceId: string,
  mode: RolesLock = "shared",
): Promise<PersonViewer> {
  await lockRoles(tx, conferenceId, mode);
  const actor = await loadPersonViewer(tx, viewer.personId);
  if (!actor || !isConferenceChair(actor, conferenceId)) throw new Refusal(403, "forbidden");
  return actor;
}
