import { projectCheck, projectSubmission, submissionIssues } from "@elochair/policy";
import {
  ContributorChangeInput,
  findType,
  InviteInput,
  type Submission,
  SubmitInput,
  sizeIssues,
  UpdateSubmissionInput,
  VersionInput,
} from "@elochair/schema";
import { and, count, eq, gt, max } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { audit } from "../audit";
import type { AppEnv } from "../context";
import type { Db } from "../db/client";
import {
  agreementAcks,
  conflicts,
  contributions,
  invitationTokens,
  submissions,
} from "../db/schema";
import { createInvitationToken } from "../invitations";
import {
  findOrCreatePerson,
  getPerson,
  loadSubmission,
  loadSubmissionRecords,
  normalizeEmail,
} from "../repo";
import {
  mailContext,
  mutateSubmission,
  personLang,
  requireVersion,
  unprocessable,
} from "../services/mutations";
import { ownCapCount } from "../services/submissions";
import {
  answeredMessage,
  draftDeletedMessage,
  invitationMessage,
  type MailLang,
  receivedMessage,
  withdrawnMessage,
} from "../templates";
import { person, Refusal, writer } from "./common";

const DAY = 24 * 60 * 60 * 1000;
const INVITES_PER_OWNER_PER_DAY = 20;
const INVITES_PER_RECIPIENT_PER_DAY = 5;
const RESEND_INTERVAL = 60 * 60 * 1000;

async function json(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json();
}

/** The language the owner chose when inviting someone (kept on their invitation links). */
async function invitationLang(
  tx: Db,
  submissionId: string,
  personId: string,
  fallback: MailLang,
): Promise<MailLang> {
  const [tok] = await tx
    .select({ lang: invitationTokens.lang })
    .from(invitationTokens)
    .where(
      and(eq(invitationTokens.submissionId, submissionId), eq(invitationTokens.personId, personId)),
    )
    .limit(1);
  return tok?.lang === "es" || tok?.lang === "pt" || tok?.lang === "en" ? tok.lang : fallback;
}

/** Re-read after a change and project for the viewer. */
async function projected(c: Context<AppEnv>, id: string) {
  const loaded = await loadSubmission(c.get("deps").db, id);
  return loaded ? projectSubmission(c.get("viewer"), loaded.rec) : null;
}

export const submissionRoutes = new Hono<AppEnv>()
  .get("/:id", async (c) => {
    const loaded = await loadSubmission(c.get("deps").db, c.req.param("id"));
    const out = loaded && projectSubmission(c.get("viewer"), loaded.rec);
    return out ? c.json(out) : c.json({ error: "not_found" }, 404);
  })

  .get("/:id/check", async (c) => {
    const viewer = c.get("viewer");
    if (viewer.kind === "agent") throw new Refusal(403, "agents_read_only");
    const p = person(c);
    const { db } = c.get("deps");
    const loaded = await loadSubmission(db, c.req.param("id"));
    if (!loaded) throw new Refusal(404, "not_found");
    const records = await loadSubmissionRecords(db, loaded.conference);
    const check = projectCheck(
      p,
      loaded.rec,
      ownCapCount(records, p.personId, loaded.rec.submission.id),
    );
    return check ? c.json(check) : c.json({ error: "not_found" }, 404);
  })

  .patch("/:id", async (c) => {
    const viewer = writer(c);
    const input = UpdateSubmissionInput.parse(await json(c));
    const id = c.req.param("id");
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "edit",
      async ({ tx, rec, conference, now }) => {
        requireVersion(rec, input.version);
        const before = rec.submission;
        if (input.typeKey && input.typeKey !== before.typeKey && before.status !== "draft") {
          unprocessable([{ path: "typeKey", code: "locked" }]);
        }
        if (input.typeKey && !findType(conference.config, input.typeKey)) {
          unprocessable([{ path: "typeKey", code: "unknown_type" }]);
        }
        const { version: _v, ...changes } = input;
        const next: Submission = {
          ...before,
          ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
        };
        const sizes = sizeIssues(conference.config, next);
        if (sizes.length) unprocessable(sizes);
        if (next.status === "submitted") {
          // Submitted work must stay valid: refuse the edit rather than save an invalid proposal.
          const issues = submissionIssues(conference.config, next, rec.contributions, rec.people);
          if (issues.length) unprocessable(issues);
        }
        await tx
          .update(submissions)
          .set({
            typeKey: next.typeKey,
            title: next.title,
            abstract: next.abstract,
            trackKey: next.trackKey,
            topicKeys: next.topicKeys,
            language: next.language,
            fields: next.fields,
            participationMode: next.participationMode,
            version: before.version + 1,
            updatedAt: now,
          })
          .where(eq(submissions.id, id));
        await audit(tx, viewer, {
          action: "submission.updated",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: {
            changed: Object.keys(changes)
              .filter((k) => changes[k as keyof typeof changes] !== undefined)
              .sort(),
          },
        });
      },
    );
    return c.json(await projected(c, id));
  })

  .delete("/:id", async (c) => {
    const viewer = writer(c);
    const { version } = VersionInput.parse(await json(c));
    const id = c.req.param("id");
    const origin = new URL(c.get("deps").env.APP_ORIGIN).origin;
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "delete_draft",
      async ({ tx, rec, conference, mail }) => {
        requireVersion(rec, version);
        for (const contrib of rec.contributions.filter((x) => x.status === "invited")) {
          const p = rec.people.get(contrib.personId);
          const lang = await invitationLang(tx, id, contrib.personId, personLang(p, conference));
          const to = contrib.invitedEmail ?? p?.email;
          if (to)
            await mail(
              "draft_deleted",
              draftDeletedMessage(lang, to, mailContext(conference, rec, lang, origin)),
            );
        }
        await tx.delete(submissions).where(eq(submissions.id, id));
        await audit(tx, viewer, {
          action: "submission.deleted",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
        });
      },
    );
    return c.body(null, 204);
  })

  .post("/:id/submit", async (c) => {
    const viewer = writer(c);
    const input = SubmitInput.parse(await json(c));
    const id = c.req.param("id");
    const deps = c.get("deps");
    const origin = new URL(deps.env.APP_ORIGIN).origin;
    await mutateSubmission(
      deps,
      viewer,
      id,
      "submit",
      async ({ tx, rec, conference, now, mail }) => {
        requireVersion(rec, input.version);
        const config = conference.config;
        const issues = submissionIssues(config, rec.submission, rec.contributions, rec.people);
        const accepted = new Set(input.acceptedAgreements.map((a) => `${a.key}@${a.version}`));
        if (config.agreements.some((a) => !accepted.has(`${a.key}@${a.version}`))) {
          issues.push({ path: "agreements", code: "agreements_required" });
        }
        if (issues.length) unprocessable(issues);
        const changed = await tx
          .update(submissions)
          .set({
            status: "submitted",
            submittedAt: now,
            updatedAt: now,
            version: rec.submission.version + 1,
          })
          .where(and(eq(submissions.id, id), eq(submissions.status, "draft")))
          .returning({ id: submissions.id });
        if (changed.length === 0)
          throw new Refusal(409, "stale", { version: rec.submission.version });
        if (config.agreements.length) {
          await tx
            .insert(agreementAcks)
            .values(
              config.agreements.map((a) => ({
                personId: viewer.personId,
                conferenceId: conference.id,
                key: a.key,
                version: a.version,
                acceptedAt: now,
              })),
            )
            .onConflictDoNothing();
          await audit(tx, viewer, {
            action: "agreements.accepted",
            conferenceId: conference.id,
            targetType: "person",
            targetId: viewer.personId,
            details: { agreements: config.agreements.map((a) => `${a.key}@${a.version}`) },
          });
        }
        const deadline = `${new Intl.DateTimeFormat("en-CA", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: config.timezone,
        }).format(new Date(config.deadlines.submissionsClose))} (${config.timezone})`;
        for (const contrib of rec.contributions.filter((x) => x.status === "confirmed")) {
          const p = rec.people.get(contrib.personId);
          if (!p) continue;
          const lang = personLang(p, conference);
          await mail(
            "submission_received",
            receivedMessage(lang, p.email, {
              ...mailContext(conference, rec, lang, origin),
              title: rec.submission.title,
              deadline,
            }),
          );
        }
        await audit(tx, viewer, {
          action: "submission.submitted",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
        });
      },
    );
    const { db } = deps;
    const loaded = await loadSubmission(db, id);
    const records = loaded ? await loadSubmissionRecords(db, loaded.conference) : [];
    return c.json({
      submission: loaded && projectSubmission(viewer, loaded.rec),
      check: loaded && projectCheck(viewer, loaded.rec, ownCapCount(records, viewer.personId, id)),
    });
  })

  .post("/:id/unsubmit", async (c) => {
    const viewer = writer(c);
    const { version } = VersionInput.parse(await json(c));
    const id = c.req.param("id");
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "unsubmit",
      async ({ tx, rec, conference, now }) => {
        requireVersion(rec, version);
        await tx
          .update(submissions)
          .set({ status: "draft", updatedAt: now, version: rec.submission.version + 1 })
          .where(eq(submissions.id, id));
        await audit(tx, viewer, {
          action: "submission.unsubmitted",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
        });
      },
    );
    return c.json(await projected(c, id));
  })

  .post("/:id/withdraw", async (c) => {
    const viewer = writer(c);
    const { version } = VersionInput.parse(await json(c));
    const id = c.req.param("id");
    const origin = new URL(c.get("deps").env.APP_ORIGIN).origin;
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "withdraw",
      async ({ tx, rec, conference, now, mail }) => {
        requireVersion(rec, version);
        await tx
          .update(submissions)
          .set({ status: "withdrawn", updatedAt: now, version: rec.submission.version + 1 })
          .where(eq(submissions.id, id));
        const recipients = new Map<string, ReturnType<typeof personLang>>();
        for (const contrib of rec.contributions.filter((x) => x.status !== "declined")) {
          const p = rec.people.get(contrib.personId);
          const to = contrib.status === "confirmed" ? p?.email : (contrib.invitedEmail ?? p?.email);
          if (to) recipients.set(to, personLang(p, conference));
        }
        recipients.set(
          conference.config.contactEmail,
          conference.config.defaultLanguage === "es"
            ? "es"
            : conference.config.defaultLanguage === "pt"
              ? "pt"
              : "en",
        );
        for (const [to, lang] of recipients) {
          await mail(
            "submission_withdrawn",
            withdrawnMessage(lang, to, {
              ...mailContext(conference, rec, lang, origin),
              title: rec.submission.title,
            }),
          );
        }
        await audit(tx, viewer, {
          action: "submission.withdrawn",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: { phase: conference.phase },
        });
      },
    );
    return c.json(await projected(c, id));
  })

  .post("/:id/contributors", async (c) => {
    const viewer = writer(c);
    const input = InviteInput.parse(await json(c));
    const id = c.req.param("id");
    const deps = c.get("deps");
    const origin = new URL(deps.env.APP_ORIGIN).origin;
    await mutateSubmission(
      deps,
      viewer,
      id,
      "manage_contributors",
      async ({ tx, rec, conference, now, mail }) => {
        requireVersion(rec, input.version);
        const email = normalizeEmail(input.email);
        const since = new Date(now.getTime() - DAY);

        // Abuse limits: per owner and per recipient address, across all submissions.
        const [byOwner] = await tx
          .select({ n: count() })
          .from(contributions)
          .innerJoin(submissions, eq(submissions.id, contributions.submissionId))
          .where(
            and(eq(submissions.ownerPersonId, viewer.personId), gt(contributions.invitedAt, since)),
          );
        const [byRecipient] = await tx
          .select({ n: count() })
          .from(contributions)
          .where(and(eq(contributions.invitedEmail, email), gt(contributions.invitedAt, since)));
        if (
          (byOwner?.n ?? 0) >= INVITES_PER_OWNER_PER_DAY ||
          (byRecipient?.n ?? 0) >= INVITES_PER_RECIPIENT_PER_DAY
        ) {
          await audit(tx, viewer, {
            action: "contributor.invite_rate_limited",
            conferenceId: conference.id,
            targetType: "submission",
            targetId: id,
          });
          throw new Refusal(429, "rate_limited");
        }

        // Never write what the owner typed into anyone's profile: it goes on the invitation.
        const invitee = await findOrCreatePerson(tx, email);
        const existing = rec.contributions.find((x) => x.personId === invitee.id);
        if (existing?.status === "declined")
          unprocessable([{ path: "email", code: "declined_cannot_reinvite" }]);
        if (existing) unprocessable([{ path: "email", code: "already_contributor" }]);
        const type = findType(conference.config, rec.submission.typeKey);
        const liveCount = rec.contributions.filter((x) => x.status !== "declined").length;
        if (type && liveCount + 1 > type.team.max) {
          unprocessable([
            {
              path: "contributions",
              code: "team_size",
              params: { count: liveCount + 1, min: type.team.min, max: type.team.max },
            },
          ]);
        }
        const [pos] = await tx
          .select({ m: max(contributions.position) })
          .from(contributions)
          .where(eq(contributions.submissionId, id));
        await tx.insert(contributions).values({
          submissionId: id,
          personId: invitee.id,
          role: input.role,
          position: (pos?.m ?? -1) + 1,
          status: "invited",
          invitedEmail: email,
          invitedName: input.name ?? null,
          invitedAffiliation: input.affiliation ?? null,
          invitedAt: now,
          lastSentAt: now,
        });
        // Whoever has seen a submission as its co-author may never review it, even after declining.
        await tx.insert(conflicts).values({
          conferenceId: conference.id,
          personId: invitee.id,
          submissionId: id,
          kind: "coauthor",
          declaredBy: "system",
        });
        if (rec.submission.status === "submitted") {
          const after = await loadSubmission(tx, id);
          const issues = after
            ? submissionIssues(
                conference.config,
                after.rec.submission,
                after.rec.contributions,
                after.rec.people,
              )
            : [];
          if (issues.length) unprocessable(issues);
        }
        await tx
          .update(submissions)
          .set({ version: rec.submission.version + 1, updatedAt: now })
          .where(eq(submissions.id, id));

        const token = await createInvitationToken(tx, {
          submissionId: id,
          personId: invitee.id,
          lang: input.lang,
          now,
          callCloses: new Date(conference.config.deadlines.submissionsClose),
        });
        const owner = rec.people.get(viewer.personId);
        const ctx = mailContext(conference, rec, input.lang, origin);
        await mail(
          "invitation",
          invitationMessage(input.lang, email, {
            ownerName: owner?.displayName ?? null,
            conference: ctx.conference,
            format: ctx.format,
            role: input.role,
            link: `${origin}/${input.lang}/invitation#token=${token}`,
          }),
        );
        await audit(tx, viewer, {
          action: "contributor.invited",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: { personId: invitee.id, role: input.role },
        });
      },
    );
    return c.json(await projected(c, id), 201);
  })

  .patch("/:id/contributors/:personId", async (c) => {
    const viewer = writer(c);
    const input = ContributorChangeInput.parse(await json(c));
    const id = c.req.param("id");
    const target = c.req.param("personId");
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "manage_contributors",
      async ({ tx, rec, conference, now }) => {
        requireVersion(rec, input.version);
        const mine = rec.contributions.find(
          (x) => x.personId === target && x.status !== "declined",
        );
        if (!mine) throw new Refusal(404, "not_found");
        if (input.role === "lead" && mine.status !== "confirmed") {
          unprocessable([{ path: "role", code: "lead_unconfirmed" }]);
        }
        const updated = rec.contributions.map((x) =>
          x.personId === target ? { ...x, role: input.role ?? x.role } : x,
        );
        if (input.position !== undefined) {
          // Move the person to the new position and renumber everyone 0..n-1.
          const others = [...updated]
            .filter((x) => x.personId !== target)
            .sort((a, b) => a.position - b.position);
          const moved = updated.find((x) => x.personId === target);
          if (moved) others.splice(Math.min(input.position, others.length), 0, moved);
          others.forEach((x, i) => {
            x.position = i;
          });
        }
        if (rec.submission.status === "submitted") {
          const issues = submissionIssues(conference.config, rec.submission, updated, rec.people);
          if (issues.length) unprocessable(issues);
        }
        for (const x of updated) {
          await tx
            .update(contributions)
            .set({ role: x.role, position: x.position })
            .where(and(eq(contributions.submissionId, id), eq(contributions.personId, x.personId)));
        }
        await tx
          .update(submissions)
          .set({ version: rec.submission.version + 1, updatedAt: now })
          .where(eq(submissions.id, id));
        await audit(tx, viewer, {
          action: "contributor.changed",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: {
            personId: target,
            changed: Object.keys(input)
              .filter((k) => k !== "version")
              .sort(),
          },
        });
      },
    );
    return c.json(await projected(c, id));
  })

  .delete("/:id/contributors/:personId", async (c) => {
    const viewer = writer(c);
    const { version } = VersionInput.parse(await json(c));
    const id = c.req.param("id");
    const target = c.req.param("personId");
    await mutateSubmission(
      c.get("deps"),
      viewer,
      id,
      "manage_contributors",
      async ({ tx, rec, conference, now }) => {
        requireVersion(rec, version);
        if (target === rec.submission.ownerPersonId)
          unprocessable([{ path: "personId", code: "owner_cannot_be_removed" }]);
        const mine = rec.contributions.find(
          (x) => x.personId === target && x.status !== "declined",
        );
        if (!mine) throw new Refusal(404, "not_found");
        const remaining = rec.contributions.filter((x) => x.personId !== target);
        if (rec.submission.status === "submitted") {
          const issues = submissionIssues(conference.config, rec.submission, remaining, rec.people);
          if (issues.length) unprocessable(issues);
        }
        // The invitation conflict stays: they have seen the submission.
        await tx
          .delete(contributions)
          .where(and(eq(contributions.submissionId, id), eq(contributions.personId, target)));
        await tx
          .delete(invitationTokens)
          .where(and(eq(invitationTokens.submissionId, id), eq(invitationTokens.personId, target)));
        await tx
          .update(submissions)
          .set({ version: rec.submission.version + 1, updatedAt: now })
          .where(eq(submissions.id, id));
        await audit(tx, viewer, {
          action: "contributor.removed",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: { personId: target },
        });
      },
    );
    return c.json(await projected(c, id));
  })

  .post("/:id/contributors/:personId/resend", async (c) => {
    const viewer = writer(c);
    const { version } = VersionInput.parse(await json(c));
    const id = c.req.param("id");
    const target = c.req.param("personId");
    const deps = c.get("deps");
    const origin = new URL(deps.env.APP_ORIGIN).origin;
    await mutateSubmission(
      deps,
      viewer,
      id,
      "manage_contributors",
      async ({ tx, rec, conference, now, mail }) => {
        requireVersion(rec, version);
        const mine = rec.contributions.find((x) => x.personId === target && x.status === "invited");
        if (!mine?.invitedEmail) throw new Refusal(404, "not_found");
        const [row] = await tx
          .select({ lastSentAt: contributions.lastSentAt })
          .from(contributions)
          .where(and(eq(contributions.submissionId, id), eq(contributions.personId, target)));
        if (row?.lastSentAt && now.getTime() - row.lastSentAt.getTime() < RESEND_INTERVAL) {
          throw new Refusal(429, "rate_limited");
        }
        const lang = await invitationLang(tx, id, target, "en");
        const token = await createInvitationToken(tx, {
          submissionId: id,
          personId: target,
          lang,
          now,
          callCloses: new Date(conference.config.deadlines.submissionsClose),
        });
        await tx
          .update(contributions)
          .set({ lastSentAt: now })
          .where(and(eq(contributions.submissionId, id), eq(contributions.personId, target)));
        const ctx = mailContext(conference, rec, lang, origin);
        await mail(
          "invitation",
          invitationMessage(lang, mine.invitedEmail, {
            ownerName: rec.people.get(viewer.personId)?.displayName ?? null,
            conference: ctx.conference,
            format: ctx.format,
            role: mine.role,
            link: `${origin}/${lang}/invitation#token=${token}`,
          }),
        );
        await audit(tx, viewer, {
          action: "contributor.invitation_resent",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
          details: { personId: target },
        });
      },
    );
    return c.body(null, 204);
  })

  .post("/:id/leave", async (c) => {
    const viewer = writer(c);
    const id = c.req.param("id");
    const deps = c.get("deps");
    const origin = new URL(deps.env.APP_ORIGIN).origin;
    await mutateSubmission(
      deps,
      viewer,
      id,
      "leave",
      async ({ tx, rec, conference, now, mail }) => {
        await tx
          .update(contributions)
          .set({ status: "declined" })
          .where(
            and(eq(contributions.submissionId, id), eq(contributions.personId, viewer.personId)),
          );
        await tx
          .update(submissions)
          .set({ version: rec.submission.version + 1, updatedAt: now })
          .where(eq(submissions.id, id));
        const owner =
          rec.people.get(rec.submission.ownerPersonId) ??
          (await getPerson(tx, rec.submission.ownerPersonId)) ??
          undefined;
        if (owner) {
          const lang = personLang(owner, conference);
          const ctx = mailContext(conference, rec, lang, origin);
          await mail(
            "invitation_answered",
            answeredMessage(lang, owner.email, {
              conference: ctx.conference,
              who: rec.people.get(viewer.personId)?.displayName ?? "—",
              answer: "left",
              link: ctx.link,
            }),
          );
        }
        await audit(tx, viewer, {
          action: "contributor.left",
          conferenceId: conference.id,
          targetType: "submission",
          targetId: id,
        });
      },
    );
    return c.body(null, 204);
  });
