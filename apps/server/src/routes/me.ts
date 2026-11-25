import { projectMenu, projectSelf, projectSubmission } from "@elochair/policy";
import {
  AnswerInvitationInput,
  isCallOpen,
  NotificationChoicesInput,
  ProfileInput,
} from "@elochair/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { audit } from "../audit";
import type { AppEnv } from "../context";
import { contributions, people, submissions } from "../db/schema";
import { type ConferenceRow, getPerson, listConferences, loadSubmissionRecords } from "../repo";
import { readEmailChoices, saveEmailChoices } from "../services/notifications";
import { myReviews } from "../services/reviews";
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
  // What the page's frame asks about whoever is looking, signed in or not (projectMenu): who
  // is signed in, for the link to their account, and whether the main menu offers "My
  // submissions" (they are on a proposal, or invited to one: what that page lists) and "My
  // reviews". The public and an agent are told that nobody is signed in, and nothing is read.
  .get("/menu", async (c) => {
    const viewer = c.get("viewer");
    if (viewer.kind !== "person") return c.json(projectMenu(viewer, null, { submissions: false }));
    const { db } = c.get("deps");
    const [own] = await db
      .select({ submissionId: contributions.submissionId })
      .from(contributions)
      .where(
        and(
          eq(contributions.personId, viewer.personId),
          inArray(contributions.status, ["invited", "confirmed"]),
        ),
      )
      .limit(1);
    const self = await getPerson(db, viewer.personId);
    return c.json(projectMenu(viewer, self, { submissions: own !== undefined }));
  })
  .get("/submissions", async (c) => c.json({ items: await mine(c, ["invited", "confirmed"]) }))
  .get("/invitations", async (c) => c.json({ items: await mine(c, ["invited"]) }))
  // "My reviews" (spec 03, §1.4): the person's own assignments, at each conference where they
  // review and reviewers can read. In person: an agent has no reviews, and reads nobody's.
  .get("/reviews", async (c) =>
    c.json({ conferences: await myReviews(c.get("deps").db, person(c)) }),
  )
  // The person's own choices about the emails of the review phase (spec 03, §1.7), at each
  // conference where they review or chair. In person: an agent gets no email and has no choice
  // to see (401, as for the public) or to make (403 `agents_read_only`).
  .get("/notifications", async (c) =>
    c.json({ conferences: await readEmailChoices(c.get("deps").db, person(c)) }),
  )
  .put("/notifications/:slug", async (c) => {
    const viewer = writer(c);
    const input = NotificationChoicesInput.parse(await c.req.json());
    return c.json(await saveEmailChoices(c.get("deps"), viewer, c.req.param("slug"), input));
  })
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
