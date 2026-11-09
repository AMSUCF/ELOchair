import type { PersonViewer } from "@elochair/policy";
import {
  AnswerByTokenInput,
  type AnswerInvitationInput,
  findType,
  InvitationTokenInput,
  isCallOpen,
  localize,
  type SubmissionIssue,
} from "@elochair/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { audit } from "../audit";
import type { AppEnv, Deps } from "../context";
import type { Db } from "../db/client";
import { agreementAcks, contributions, people, submissions } from "../db/schema";
import { findInvitationToken, useInvitationTokens } from "../invitations";
import { deliverPending, enqueueMail } from "../mail";
import { loadSubmission, loadSubmissionRecords } from "../repo";
import { mailContext, personLang } from "../services/mutations";
import { ownCapCount } from "../services/submissions";
import { answeredMessage } from "../templates";
import { Refusal } from "./common";

type Answer = z.infer<typeof AnswerInvitationInput>;

/**
 * Answer one's own invitation, by link token or by session.
 * - Declining is always possible, whatever the submission's status or the phase.
 * - Confirming needs live (not withdrawn) work, an open call and the conference's agreements.
 *   It also needs a name for the person's profile, since confirmed contributors are shown by it:
 *   their own words (`displayName`), never the name the owner typed.
 * - Someone with no contribution on the submission gets 404, as if it did not exist.
 */
export async function answerInvitation(
  deps: Deps,
  v: { submissionId: string; personId: string; input: Answer },
): Promise<"confirmed" | "declined"> {
  const now = deps.now();
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  const actor: PersonViewer = {
    kind: "person",
    personId: v.personId,
    siteAdmin: false,
    grants: [],
  };
  const result = await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, v.submissionId))
      .for("update");
    const loaded = await loadSubmission(tx, v.submissionId);
    // Missing and not-yours look the same, so this cannot probe for drafts one cannot see.
    const mine = loaded?.rec.contributions.find((c) => c.personId === v.personId);
    if (!loaded || !mine) throw new Refusal(404, "not_found");
    const { conference, rec } = loaded;
    if (mine.status !== "invited") throw new Refusal(409, "already_answered");

    const confirm = v.input.answer === "confirm";
    if (confirm) {
      if (
        rec.submission.status === "withdrawn" ||
        !isCallOpen(conference.config, conference.phase, now)
      )
        throw new Refusal(409, "call_closed");
      const issues: SubmissionIssue[] = [];
      const accepted = new Set(v.input.acceptedAgreements.map((a) => `${a.key}@${a.version}`));
      if (conference.config.agreements.some((a) => !accepted.has(`${a.key}@${a.version}`))) {
        issues.push({ path: "agreements", code: "agreements_required" });
      }
      const profileName = rec.people.get(v.personId)?.displayName?.trim();
      const givenName = v.input.displayName?.trim();
      if (!profileName && !givenName) issues.push({ path: "displayName", code: "required" });
      if (issues.length) throw new Refusal(422, "invalid", { issues });

      if (conference.config.agreements.length) {
        await tx
          .insert(agreementAcks)
          .values(
            conference.config.agreements.map((a) => ({
              personId: v.personId,
              conferenceId: conference.id,
              key: a.key,
              version: a.version,
              acceptedAt: now,
            })),
          )
          .onConflictDoNothing();
        await audit(tx, actor, {
          action: "agreements.accepted",
          conferenceId: conference.id,
          targetType: "person",
          targetId: v.personId,
          details: { agreements: conference.config.agreements.map((a) => `${a.key}@${a.version}`) },
        });
      }
      if (!profileName && givenName) {
        // Only the invitee's own words reach their profile; invitedName and invitedAffiliation
        // (what the owner typed) never do.
        const named = await tx
          .update(people)
          .set({ displayName: givenName })
          .where(
            and(
              eq(people.id, v.personId),
              or(isNull(people.displayName), sql`btrim(${people.displayName}) = ''`),
            ),
          )
          .returning({ id: people.id });
        if (named.length) {
          await audit(tx, actor, {
            action: "person.profile_updated",
            targetType: "person",
            targetId: v.personId,
            details: { changed: ["displayName"], via: "invitation" },
          });
        }
      }
    }
    await tx
      .update(contributions)
      .set({ status: confirm ? "confirmed" : "declined" })
      .where(
        and(eq(contributions.submissionId, v.submissionId), eq(contributions.personId, v.personId)),
      );
    await useInvitationTokens(tx, v.submissionId, v.personId, now);
    await tx
      .update(submissions)
      .set({ version: rec.submission.version + 1, updatedAt: now })
      .where(eq(submissions.id, v.submissionId));

    const owner = rec.people.get(rec.submission.ownerPersonId);
    if (owner) {
      const lang = personLang(owner, conference);
      const ctx = mailContext(conference, rec, lang, origin);
      await enqueueMail(
        tx,
        "invitation_answered",
        answeredMessage(lang, owner.email, {
          conference: ctx.conference,
          // The name as the owner typed it, else the address they invited: nothing the owner
          // has not seen, so answeredMessage() shows it as typed (on one line).
          who: mine.invitedName ?? mine.invitedEmail ?? "—",
          answer: confirm ? "confirmed" : "declined",
          link: ctx.link,
        }),
        now,
      );
    }
    await audit(tx, actor, {
      action: confirm ? "invitation.confirmed" : "invitation.declined",
      conferenceId: conference.id,
      targetType: "submission",
      targetId: v.submissionId,
    });
    return confirm ? ("confirmed" as const) : ("declined" as const);
  });
  deliverPending(deps.db, deps.mail, { now: deps.now }).catch((err) =>
    console.error("mail delivery failed", err),
  );
  return result;
}

/**
 * Checks shared by the link routes, in order: agents never answer invitations or read them
 * (403 before anything else); then the per-IP limit, whose first refusal in each window is
 * audited.
 */
async function guardLinkRoute(c: Context<AppEnv>, endpoint: "info" | "answer"): Promise<void> {
  if (c.get("viewer").kind === "agent") throw new Refusal(403, "agents_read_only");
  const deps = c.get("deps");
  const outcome = deps.limits.invitationLinksPerIp.attempt(c.get("clientIp"));
  if (outcome === "allowed") return;
  if (outcome === "refused_first") {
    await audit(deps.db, c.get("viewer"), {
      action: "invitation.rate_limited",
      details: { limit: "invitation_links_per_ip", endpoint },
    });
  }
  throw new Refusal(429, "rate_limited");
}

async function tokenTarget(deps: Deps, token: string) {
  const row = await findInvitationToken(deps.db, token, deps.now());
  if (!row) throw new Refusal(400, "invalid_or_expired");
  return row;
}

/** Answering from the invitation email: the link token proves the address, no account needed. */
export const invitationRoutes = new Hono<AppEnv>()
  .post("/info", async (c) => {
    await guardLinkRoute(c, "info");
    const deps = c.get("deps");
    const { token } = InvitationTokenInput.parse(await c.req.json());
    const row = await tokenTarget(deps, token);
    const loaded = await loadSubmission(deps.db, row.submissionId);
    if (!loaded) throw new Refusal(400, "invalid_or_expired");
    const { conference, rec } = loaded;
    const mine = rec.contributions.find((x) => x.personId === row.personId);
    if (!mine) throw new Refusal(400, "invalid_or_expired");
    if (mine.status !== "invited") throw new Refusal(409, "already_answered");
    const config = conference.config;
    const lang = row.lang;
    const type = findType(config, rec.submission.typeKey);
    const records = await loadSubmissionRecords(deps.db, conference);
    const counted =
      Boolean(type?.countsTowardPresenterCap) &&
      Boolean(config.rules.presenterCap?.countedRoles.includes(mine.role));
    return c.json({
      submissionId: rec.submission.id,
      /** "withdrawn" work can only be declined. */
      status: rec.submission.status,
      conference: {
        slug: conference.slug,
        title: config.title,
        timezone: config.timezone,
        submissionsClose: config.deadlines.submissionsClose,
        callOpen: isCallOpen(config, conference.phase, deps.now()),
      },
      format: type ? localize(type.name, lang, config.defaultLanguage) : rec.submission.typeKey,
      title: rec.submission.title,
      ownerName: rec.people.get(rec.submission.ownerPersonId)?.displayName ?? null,
      role: mine.role,
      invitedName: mine.invitedName,
      /** Confirming needs a name in the invitee's own words: their profile has none yet. */
      nameNeeded: !rec.people.get(row.personId)?.displayName?.trim(),
      presenterCap: config.rules.presenterCap
        ? {
            max: config.rules.presenterCap.max,
            roleCounts: counted,
            countIfConfirmed: ownCapCount(records, row.personId, rec.submission.id),
          }
        : null,
      agreements: config.agreements,
      lang,
    });
  })
  .post("/answer", async (c) => {
    await guardLinkRoute(c, "answer");
    const deps = c.get("deps");
    const { token, ...input } = AnswerByTokenInput.parse(await c.req.json());
    const row = await tokenTarget(deps, token);
    const answer = await answerInvitation(deps, {
      submissionId: row.submissionId,
      personId: row.personId,
      input,
    });
    return c.json({ answer });
  });
