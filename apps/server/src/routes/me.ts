import { projectSelf, projectSubmission } from "@elochair/policy";
import { AnswerInvitationInput, isCallOpen, ProfileInput } from "@elochair/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { audit } from "../audit";
import type { AppEnv } from "../context";
import { contributions, people, submissions } from "../db/schema";
import { type ConferenceRow, getPerson, listConferences, loadSubmissionRecords } from "../repo";
import { ownCapCount } from "../services/submissions";
import { person, writer } from "./common";
import { answerInvitation } from "./invitations";

/** Your submissions (and invitations), grouped with what you need to know about each call. */
async function mine(c: Context<AppEnv>, statuses: ("invited" | "confirmed")[]) {
  const viewer = person(c);
  const deps = c.get("deps");
  const rows = await deps.db
    .select({ submissionId: contributions.submissionId, conferenceId: submissions.conferenceId })
    .from(contributions)
    .innerJoin(submissions, eq(submissions.id, contributions.submissionId))
    .where(
      and(eq(contributions.personId, viewer.personId), inArray(contributions.status, statuses)),
    );
  const byConference = new Map<string, Set<string>>();
  for (const r of rows)
    byConference.set(
      r.conferenceId,
      (byConference.get(r.conferenceId) ?? new Set()).add(r.submissionId),
    );
  const conferences = (await listConferences(deps.db)).filter((k) => byConference.has(k.id));
  const now = deps.now();
  const items = [];
  for (const k of conferences) {
    const records = await loadSubmissionRecords(deps.db, k as ConferenceRow);
    const wanted = byConference.get(k.id) ?? new Set();
    const capCount = ownCapCount(records, viewer.personId, null);
    for (const r of records.filter((x) => wanted.has(x.submission.id))) {
      const submission = projectSubmission(viewer, r);
      if (!submission) continue;
      items.push({
        conference: {
          slug: k.slug,
          title: k.config.title,
          timezone: k.config.timezone,
          submissionsClose: k.config.deadlines.submissionsClose,
          callOpen: isCallOpen(k.config, k.phase, now),
          presenterCap:
            k.config.rules.presenterCap && capCount !== null
              ? { count: capCount, max: k.config.rules.presenterCap.max }
              : null,
        },
        submission,
      });
    }
  }
  return items;
}

export const meRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    if (viewer.kind === "public") return c.json({ error: "unauthenticated" }, 401);

    const slugs = new Map((await listConferences(db)).map((k) => [k.id, k.slug]));
    if (viewer.kind === "agent") {
      return c.json({
        kind: "agent",
        tier: viewer.tier,
        conference: slugs.get(viewer.conferenceId) ?? null,
        ownerId: viewer.owner.personId,
      });
    }
    const p = await getPerson(db, viewer.personId);
    return c.json({
      kind: "person",
      person: p && projectSelf(viewer, p),
      siteAdmin: viewer.siteAdmin,
      roles: viewer.grants.map((g) => ({
        conference: slugs.get(g.conferenceId) ?? null,
        role: g.role,
        scope: g.scope,
      })),
    });
  })
  .get("/submissions", async (c) => c.json({ items: await mine(c, ["invited", "confirmed"]) }))
  .get("/invitations", async (c) => c.json({ items: await mine(c, ["invited"]) }))
  .post("/invitations/:submissionId/answer", async (c) => {
    const viewer = writer(c);
    const input = AnswerInvitationInput.parse(await c.req.json());
    const answer = await answerInvitation(c.get("deps"), {
      submissionId: c.req.param("submissionId"),
      personId: viewer.personId,
      input,
    });
    return c.json({ answer });
  })
  .put("/profile", async (c) => {
    const viewer = writer(c);
    const input = ProfileInput.parse(await c.req.json());
    const { db } = c.get("deps");
    const before = await getPerson(db, viewer.personId);
    await db
      .update(people)
      .set({
        displayName: input.displayName,
        affiliation: input.affiliation,
        country: input.country,
        languages: input.languages,
        pronouns: input.pronouns,
        orcid: input.orcid,
        bios: input.bios,
      })
      .where(eq(people.id, viewer.personId));
    const after = await getPerson(db, viewer.personId);
    const changed =
      before && after
        ? (Object.keys(input) as (keyof typeof input)[]).filter(
            (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          )
        : [];
    await audit(db, viewer, {
      action: "person.profile_updated",
      targetType: "person",
      targetId: viewer.personId,
      details: { changed },
    });
    return c.json(after && projectSelf(viewer, after));
  });
