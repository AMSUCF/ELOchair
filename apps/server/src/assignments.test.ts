import { findLeaks } from "@elochair/policy/testing";
import type { ConferenceConfig } from "@elochair/schema";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import {
  assignmentReleases,
  assignments,
  auditLog,
  conferenceRoles,
  conferences,
  conflicts,
  outbox,
  people,
  reviewerProfiles,
  submissions,
} from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { RateLimiter } from "./ratelimit";
import {
  createApiToken,
  getConference,
  grantRole,
  loadPersonViewer,
  lockConference,
  saveConference,
  shareConference,
} from "./repo";
import { Refusal } from "./routes/common";
import {
  assignReviewer,
  everAssigned,
  everHadReviewer,
  releaseReviewer,
} from "./services/assignments";
import { removeRole } from "./services/people";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Assignments (spec 03, §1.3): a chair assigns reviewers to a proposal by hand and removes them
 * again; who may, to which proposals, and who is offered; that a released reviewer is a stranger
 * to the proposal everywhere; that a reviewer reads once the conference is in review; and what
 * none of it may reveal. The last part runs only against a real Postgres, and shows what holds
 * when requests arrive at the same moment.
 */

const NOW = new Date("2027-02-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const SLUG = "assign-call";
const OPEN = "assign-open";
const DRAFT = "assign-draft";
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
/** The fixture call reviews talks in the first pool, anonymized, and performances in the second. */
const [POOL_A, POOL_B] = fixtureCall.reviewPools.map((p) => p.key) as [string, string];
const NEEDED_A = fixtureCall.reviewPools[0]?.reviewsPerSubmission ?? 0;
const words = (n: number, word = "verse") => Array.from({ length: n }, () => word).join(" ");

type Who = { cookie?: string; token?: string };
type World = {
  t: TestApp;
  slug: string;
  conferenceId: string;
  /** Sign someone in; with a name, give them a profile. */
  person: (email: string, name?: string) => Promise<string>;
  id: (email: string) => Promise<string>;
};

/** Everything typed by a person in these tests: none of it may reach the audit log. */
const secrets: string[] = [];

async function world(t: TestApp, slug: string): Promise<World> {
  const { conferenceId } = await seedTestCall(t.db, { slug, now: NOW });
  const person = async (email: string, name?: string) => {
    secrets.push(email);
    const cookie = await signIn(t, email);
    if (name) {
      secrets.push(name);
      const res = await call(t.public, "PUT", "/api/me/profile", {
        cookie,
        body: {
          displayName: name,
          affiliation: null,
          country: null,
          languages: ["en"],
          pronouns: null,
          orcid: null,
          bios: {},
        },
      });
      expect(res.status).toBe(200);
    }
    return cookie;
  };
  return { t, slug, conferenceId, person, id: (email) => personId(t, email) };
}

const lifted = (t: TestApp) => {
  // Many people sign in and write from one address here; the limits have their own tests.
  t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerEmail = new RateLimiter(100_000, 60_000);
};

/** Give someone the reviewer's role for these pools; with `said`, as if they had accepted. */
async function reviewer(
  w: World,
  email: string,
  pools: string[],
  said: { maxLoad: number; languages: string[] } | null = { maxLoad: 8, languages: ["en"] },
) {
  const id = await w.id(email);
  await grantRole(w.t.db, {
    conferenceId: w.conferenceId,
    personId: id,
    role: "reviewer",
    scope: pools,
  });
  if (said) {
    await w.t.db
      .insert(reviewerProfiles)
      .values({ conferenceId: w.conferenceId, personId: id, pools, ...said })
      .onConflictDoUpdate({
        target: [reviewerProfiles.conferenceId, reviewerProfiles.personId],
        set: said,
      });
  }
  return id;
}

/** A proposal by `owner`: a talk unless told otherwise, filled in and submitted. */
async function proposal(
  w: World,
  owner: string,
  title: string,
  v: { type?: "talk" | "performance"; draft?: boolean } = {},
): Promise<string> {
  secrets.push(title);
  const type = v.type ?? "talk";
  const created = await call(w.t.public, "POST", `/api/conferences/${w.slug}/submissions`, {
    cookie: owner,
    body: { typeKey: type, language: "en", participationMode: "in_person" },
  });
  expect(created.status).toBe(201);
  const filled = await call(w.t.public, "PATCH", `/api/submissions/${created.json.id}`, {
    cookie: owner,
    body: {
      version: created.json.version,
      title,
      abstract: words(type === "talk" ? 260 : 400),
      ...(type === "performance"
        ? { fields: { tech_requirements: "A table.", work_url: "https://example.org/work" } }
        : {}),
    },
  });
  expect(filled.status, JSON.stringify(filled.json)).toBe(200);
  if (!v.draft) await submit(w, owner, created.json.id);
  return created.json.id;
}

async function submit(w: World, owner: string, id: string) {
  const got = await call(w.t.public, "GET", `/api/submissions/${id}`, { cookie: owner });
  const res = await call(w.t.public, "POST", `/api/submissions/${id}/submit`, {
    cookie: owner,
    body: { version: got.json.version, acceptedAgreements: AGREEMENTS },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
}

/** The owner invites an address to a proposal that is still a draft. */
async function invite(w: World, owner: string, id: string, email: string) {
  const got = await call(w.t.public, "GET", `/api/submissions/${id}`, { cookie: owner });
  const res = await call(w.t.public, "POST", `/api/submissions/${id}/contributors`, {
    cookie: owner,
    body: { version: got.json.version, email, role: "coauthor", lang: "en", name: "Nina Typed" },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
}

const answerInvitation = (w: World, cookie: string, id: string, answer: "confirm" | "decline") =>
  call(w.t.public, "POST", `/api/me/invitations/${id}/answer`, {
    cookie,
    body: answer === "confirm" ? { answer, acceptedAgreements: AGREEMENTS } : { answer },
  });

/** The call's closing date passes: the conference stays in the phase it is in. */
async function closeCall(w: World) {
  const k = await getConference(w.t.db, w.slug);
  if (!k) throw new Error("no conference");
  await saveConference(w.t.db, {
    ...k.config,
    deadlines: {
      ...k.config.deadlines,
      submissionsClose: new Date(NOW.getTime() - HOUR).toISOString(),
    },
  });
}

const at = (w: World | string, rest = "") =>
  `/api/conferences/${typeof w === "string" ? w : w.slug}/assignments${rest}`;
const reviewersOf = (w: World, who: Who, id: string) =>
  call(w.t.public, "GET", at(w, `/submissions/${id}`), who);
const assign = (
  w: World,
  who: Who,
  id: string,
  reviewerId: string,
  more: Record<string, unknown> = {},
) =>
  call(w.t.public, "POST", at(w, `/submissions/${id}/reviewers`), {
    ...who,
    body: { reviewerId, ...more },
  });
const release = (w: World, who: Who, id: string, reviewerId: string) =>
  call(w.t.public, "DELETE", at(w, `/submissions/${id}/reviewers/${reviewerId}`), {
    ...who,
    body: {},
  });
const page = (w: World, who: Who, query = "") => call(w.t.public, "GET", at(w, query), who);

type Candidate = {
  personId: string;
  displayName: string | null;
  email: string;
  languages: string[];
  assigned: number;
  maxLoad: number | null;
  full: boolean;
};
type Reviewers = {
  view: string;
  submissionId: string;
  pool: string | null;
  needed: number;
  assigned: { personId: string; displayName: string | null; email: string; assignedAt: string }[];
  takes: string;
  candidates: Candidate[];
};
type Listed = {
  key: string;
  needed: number;
  proposals: number;
  short: number;
  items: {
    id: string;
    title: string;
    typeKey: string;
    reviewers: { personId: string; displayName: string | null; email: string }[];
    short: boolean;
  }[];
  nextCursor: string | null;
};
type Page = { view: string; callClosed: boolean; excluded: number; pools: Listed[] };

/** The Reviewers section of a proposal, as its chair is given it. */
async function shown(w: World, cookie: string, id: string): Promise<Reviewers> {
  const res = await reviewersOf(w, { cookie }, id);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json;
}
/** A proposal's assignments: the table holds those that stand, and no others. */
const rowsOf = (t: TestApp, submissionId: string) =>
  t.db.select().from(assignments).where(eq(assignments.submissionId, submissionId));
/** The record of the assignments it had that were released, oldest first. */
const releasesOf = (t: TestApp, submissionId: string) =>
  t.db
    .select()
    .from(assignmentReleases)
    .where(eq(assignmentReleases.submissionId, submissionId))
    .orderBy(assignmentReleases.releasedAt, assignmentReleases.id);
const audited = async (t: TestApp, conferenceId: string) =>
  (
    await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.conferenceId, conferenceId), like(auditLog.action, "assignment.%")))
      .orderBy(auditLog.id)
  ).map((r) => ({
    action: r.action,
    actor: r.actorPersonId,
    kind: r.actorKind,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.details,
  }));
/** A proposal as someone is given it, or the status that says they are given nothing. */
const read = async (t: TestApp, cookie: string | undefined, id: string) => {
  const res = await call(t.public, "GET", `/api/submissions/${id}`, { cookie });
  return res.status === 200 ? res.json : res.status;
};

let t: TestApp;
let w: World;
let open: World;
let draft: World;
const cookies = {} as Record<
  | "chair"
  | "admin"
  | "authorChair"
  | "conflictedChair"
  | "track"
  | "owner"
  | "coauthor"
  | "invitee"
  | "decliner"
  | "stranger"
  | "elsewhere"
  | "r1"
  | "r2"
  | "r3"
  | "other"
  | "everyPool",
  string
>;
const ids = {} as Record<keyof typeof cookies | "full" | "declared" | "byPerson", string>;
const mail = (who: string) => `assign-${who.toLowerCase()}@example.org`;
/** Proposals of the closed call, by what they are for. */
const subs = {} as Record<
  "team" | "plain" | "performance" | "own" | "conflicted" | "draft" | "withdrawn" | "boundary",
  string
>;
let openTalk: string;

beforeAll(async () => {
  t = await makeTestApp();
  lifted(t);
  w = await world(t, SLUG);
  open = await world(t, OPEN);
  draft = await world(t, DRAFT);

  const names: Record<keyof typeof cookies, string> = {
    chair: "Cora Chairperson",
    admin: "Adam Administrator",
    authorChair: "Aura Authorchair",
    conflictedChair: "Cleo Conflictedchair",
    track: "Tariq Trackchair",
    owner: "Olga Ownerperson",
    coauthor: "Cato Coauthorson",
    invitee: "Ines Inviteeson",
    decliner: "Dana Declinerson",
    stranger: "Stella Stranger",
    elsewhere: "Elsa Elsewhere",
    r1: "Rhea Reviewerone",
    r2: "Rolf Reviewertwo",
    r3: "Runa Reviewerthree",
    other: "Otto Otherpool",
    everyPool: "Enzo Everypool",
  };
  for (const who of Object.keys(names) as (keyof typeof cookies)[]) {
    cookies[who] = await w.person(mail(who), names[who]);
    ids[who] = await w.id(mail(who));
  }
  const grant = (who: keyof typeof cookies, role: "chair" | "admin" | "track_chair", to = w) =>
    grantRole(t.db, { conferenceId: to.conferenceId, personId: ids[who], role });
  await grant("chair", "chair");
  await grant("chair", "chair", open);
  await grant("chair", "chair", draft);
  await grant("admin", "admin");
  await grant("authorChair", "chair");
  await grant("conflictedChair", "chair");
  await grant("track", "track_chair");
  await grant("elsewhere", "chair", open);

  // Reviewers of the first pool, who said what they offer; one of the second; and one given the
  // role on the server, with no scope (every pool) and nothing said.
  await reviewer(w, mail("r1"), [POOL_A], { maxLoad: 5, languages: ["es", "pt"] });
  await reviewer(w, mail("r2"), [POOL_A]);
  await reviewer(w, mail("r3"), [POOL_A]);
  await reviewer(w, mail("other"), [POOL_B]);
  await reviewer(w, mail("everyPool"), [], null);
  // The people on the proposals review for the first pool too, and so does a chair.
  for (const who of ["owner", "coauthor", "invitee", "decliner", "authorChair"] as const) {
    await reviewer(w, mail(who), [POOL_A]);
  }
  for (const who of ["full", "declared", "byPerson"] as const) {
    await w.person(mail(who), `${who} Reviewerperson`);
    ids[who] = await reviewer(w, mail(who), [POOL_A], { maxLoad: 1, languages: ["en"] });
  }
  await reviewer(open, mail("r1"), [POOL_A]);

  // A talk with a team: a confirmed co-author, someone still invited, someone who declined.
  subs.team = await proposal(w, cookies.owner, "Teamwork in hypertext", { draft: true });
  for (const who of ["coauthor", "invitee", "decliner"] as const) {
    await invite(w, cookies.owner, subs.team, mail(who));
  }
  expect((await answerInvitation(w, cookies.coauthor, subs.team, "confirm")).status).toBe(200);
  expect((await answerInvitation(w, cookies.decliner, subs.team, "decline")).status).toBe(200);
  await submit(w, cookies.owner, subs.team);
  subs.plain = await proposal(w, cookies.stranger, "A plain talk");
  subs.boundary = await proposal(w, cookies.stranger, "A talk at the boundary");
  subs.performance = await proposal(w, cookies.stranger, "A performance", { type: "performance" });
  subs.own = await proposal(w, cookies.authorChair, "A chair's own talk");
  subs.conflicted = await proposal(w, cookies.stranger, "A talk a chair has a conflict with");
  subs.draft = await proposal(w, cookies.stranger, "A draft talk", { draft: true });
  subs.withdrawn = await proposal(w, cookies.stranger, "A withdrawn talk");
  const got = await call(t.public, "GET", `/api/submissions/${subs.withdrawn}`, {
    cookie: cookies.stranger,
  });
  const gone = await call(t.public, "POST", `/api/submissions/${subs.withdrawn}/withdraw`, {
    cookie: cookies.stranger,
    body: { version: got.json.version },
  });
  expect(gone.status).toBe(200);
  openTalk = await proposal(open, cookies.stranger, "A talk whose call is open");

  // Conflicts as the conflicts table holds them: with a proposal, and with a person.
  await t.db.insert(conflicts).values([
    {
      conferenceId: w.conferenceId,
      personId: ids.conflictedChair,
      submissionId: subs.conflicted,
      kind: "declared",
      declaredBy: "chair",
    },
    {
      conferenceId: w.conferenceId,
      personId: ids.declared,
      submissionId: subs.plain,
      kind: "declared",
      declaredBy: "reviewer",
    },
    {
      conferenceId: w.conferenceId,
      personId: ids.byPerson,
      otherPersonId: ids.stranger,
      kind: "institution",
      declaredBy: "system",
    },
  ]);

  // The closing date passes. The conference is still in "cfp_open": chairs assign from now,
  // and reviewers read once it is in review.
  await closeCall(w);
  await t.db
    .update(conferences)
    .set({ phase: "draft" })
    .where(eq(conferences.id, draft.conferenceId));
}, 240_000);
afterAll(() => t.close());

describe("who may assign, release and see the reviewers of a proposal", () => {
  let agentM: string;
  let agentC: string;

  /** Every route, aimed at a proposal that takes reviewers and at a reviewer who is offered. */
  const routes = (slug = SLUG, id = subs.plain): [string, string, unknown][] => [
    ["GET", at(slug), undefined],
    ["GET", at(slug, `/pools/${POOL_A}`), undefined],
    ["GET", at(slug, `/submissions/${id}`), undefined],
    ["POST", at(slug, `/submissions/${id}/reviewers`), { reviewerId: ids.r1 }],
    ["DELETE", at(slug, `/submissions/${id}/reviewers/${ids.r2}`), {}],
  ];
  const untouched = async () => ({
    rows: (await t.db.select().from(assignments)).length,
    audited: (await audited(t, w.conferenceId)).length,
    mail: (await t.db.select().from(outbox)).length,
  });

  beforeAll(async () => {
    agentM = (
      await createApiToken(t.db, {
        personId: ids.chair,
        conferenceId: w.conferenceId,
        tier: "M",
        name: "m",
      })
    ).token;
    agentC = (
      await createApiToken(t.db, {
        personId: ids.chair,
        conferenceId: w.conferenceId,
        tier: "C",
        name: "c",
      })
    ).token;
    // A reviewer is on the proposal already, so that there is something to release and to see.
    expect((await assign(w, { cookie: cookies.chair }, subs.plain, ids.r2)).status).toBe(204);
  });

  it("refuses everyone who is not a chair of the conference, on every route: 403, and nothing happens", async () => {
    const before = await untouched();
    const everyone = [
      "track",
      "r1",
      "r2",
      "other",
      "owner",
      "coauthor",
      "invitee",
      "stranger",
      "elsewhere",
      "public",
    ];
    for (const who of everyone) {
      const cookie = (cookies as Record<string, string | undefined>)[who];
      // The proposal with a team as well: its own people are refused like anyone.
      for (const [method, path, body] of [...routes(), ...routes(SLUG, subs.team).slice(2)]) {
        const res = await call(t.public, method, path, { cookie, body });
        expect(res.status, `${who} ${method} ${path}`).toBe(403);
        expect(res.json, `${who} ${method} ${path}`).toEqual({ error: "forbidden" });
      }
    }
    expect(await untouched()).toEqual(before);
    expect((await rowsOf(t, subs.plain)).map((a) => a.reviewerId)).toEqual([ids.r2]);
  });

  it("refuses a chair's agents, whatever their tier and on either listener", async () => {
    const before = await untouched();
    for (const [method, path, body] of routes()) {
      const m = await call(t.public, method, path, { token: agentM, body });
      expect(m.status, `tier M ${method} ${path}`).toBe(403);
      expect(m.json).toEqual({ error: "forbidden" });
      const c = await call(t.internal, method, path, { token: agentC, body });
      expect(c.status, `tier C ${method} ${path}`).toBe(403);
      expect(c.json).toEqual({ error: "forbidden" });
      // A content-tier token never gets as far as a route on the public listener.
      expect((await call(t.public, method, path, { token: agentC, body })).status).toBe(403);
    }
    expect(await untouched()).toEqual(before);
    // What an agent is given of the proposal is what it was given before: ids, no names.
    const listed = await call(t.public, "GET", `/api/submissions/${subs.plain}`, { token: agentM });
    expect(listed.json).toMatchObject({ view: "metadata", assignedReviewerIds: [ids.r2] });
    expect(findLeaks(listed.json, ["Rolf Reviewertwo", mail("r2")])).toEqual([]);
  });

  it("keeps a draft conference a secret from those who cannot see it, and is its chair's all the same", async () => {
    const anyId = "00000000-0000-4000-8000-000000000000";
    for (const who of ["track", "r1", "owner", "stranger", "elsewhere", "public"]) {
      const cookie = (cookies as Record<string, string | undefined>)[who];
      for (const [method, path, body] of routes(DRAFT, anyId)) {
        const res = await call(t.public, method, path, { cookie, body });
        expect(res.status, `${who} ${method} ${path}`).toBe(404);
        expect(res.json).toEqual({ error: "not_found" });
      }
    }
    const mine = await page(draft, { cookie: cookies.chair });
    expect(mine.status).toBe(200);
    expect(mine.json).toMatchObject({ view: "assignments", excluded: 0 });
    // That chair's agent still may not.
    const agent = await createApiToken(t.db, {
      personId: ids.chair,
      conferenceId: draft.conferenceId,
      tier: "M",
      name: "draft",
    });
    for (const [method, path, body] of routes(DRAFT, anyId)) {
      const res = await call(t.public, method, path, { token: agent.token, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("lets a chair, an admin and a site admin see and change them, each recorded as themselves", async () => {
    const siteAdmin = await w.person(mail("site-admin"), "Sasha Siteadmin");
    await t.db
      .update(people)
      .set({ siteAdmin: true })
      .where(eq(people.email, mail("site-admin")));
    for (const [who, cookie] of [
      ["chair", cookies.chair],
      ["admin", cookies.admin],
      ["site admin", siteAdmin],
    ] as const) {
      const actor = who === "site admin" ? await w.id(mail("site-admin")) : ids[who];
      expect(
        (await shown(w, cookie, subs.plain)).assigned.map((a) => a.personId),
        who,
      ).toEqual([ids.r2]);
      expect((await page(w, { cookie })).status, who).toBe(200);
      expect((await assign(w, { cookie }, subs.plain, ids.r3)).status, who).toBe(204);
      expect((await release(w, { cookie }, subs.plain, ids.r3)).status, who).toBe(204);
      expect((await audited(t, w.conferenceId)).slice(-2), who).toEqual([
        {
          action: "assignment.made",
          actor,
          kind: "human",
          targetType: "submission",
          targetId: subs.plain,
          details: { reviewerId: ids.r3, again: who !== "chair" },
        },
        {
          action: "assignment.released",
          actor,
          kind: "human",
          targetType: "submission",
          targetId: subs.plain,
          details: { reviewerId: ids.r3, reason: "chair" },
        },
      ]);
    }
  });

  it("answers 404 for a proposal the chair does not manage: their own, a conflict, a draft, another conference's, none", async () => {
    await t.db.insert(assignments).values([
      { conferenceId: w.conferenceId, reviewerId: ids.r1, submissionId: subs.own },
      { conferenceId: w.conferenceId, reviewerId: ids.r1, submissionId: subs.conflicted },
    ]);
    const before = await untouched();
    const cases: [string, string, string][] = [
      ["their own proposal", cookies.authorChair, subs.own],
      ["one they have a conflict with", cookies.conflictedChair, subs.conflicted],
      ["a draft", cookies.chair, subs.draft],
      ["another conference's", cookies.chair, openTalk],
      ["one that does not exist", cookies.chair, "00000000-0000-4000-8000-00000000abcd"],
      ["an id that is none", cookies.chair, "not-an-id"],
    ];
    for (const [what, cookie, id] of cases) {
      for (const res of [
        await reviewersOf(w, { cookie }, id),
        await assign(w, { cookie }, id, ids.r2),
        await release(w, { cookie }, id, ids.r1),
      ]) {
        expect(res.status, what).toBe(404);
        expect(res.json, what).toEqual({ error: "not_found" });
      }
    }
    expect(await untouched()).toEqual(before);
    // Any other chair manages them like any proposal.
    expect((await shown(w, cookies.chair, subs.own)).assigned.map((a) => a.personId)).toEqual([
      ids.r1,
    ]);
    expect(
      (await shown(w, cookies.chair, subs.conflicted)).assigned.map((a) => a.personId),
    ).toEqual([ids.r1]);
    // An id in capitals is the same proposal, to the gate as to the database.
    expect(
      (await reviewersOf(w, { cookie: cookies.authorChair }, subs.own.toUpperCase())).status,
    ).toBe(404);
    expect(
      (await reviewersOf(w, { cookie: cookies.chair }, subs.own.toUpperCase())).json.submissionId,
    ).toBe(subs.own);
  });

  it("a chair removed while their request was on its way assigns and releases nothing", async () => {
    const email = mail("gone");
    await w.person(email, "Gail Gonechair");
    const goneId = await w.id(email);
    await grantRole(t.db, { conferenceId: w.conferenceId, personId: goneId, role: "chair" });
    const conference = await getConference(t.db, SLUG);
    // The chair as the route saw them: still a chair.
    const asSeen = await loadPersonViewer(t.db, goneId);
    const remover = await loadPersonViewer(t.db, ids.chair);
    if (!conference || !asSeen || !remover) throw new Error("no conference or no person");
    await removeRole(t.deps, remover, conference, { personId: goneId, role: "chair" });
    const before = await untouched();
    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "done";
      } catch (err) {
        return err instanceof Refusal ? `${err.status} ${err.code}` : String(err);
      }
    };
    expect(
      await refused(() =>
        assignReviewer(t.deps, asSeen, conference, {
          submissionId: subs.plain,
          reviewerId: ids.r3,
          confirmedFull: false,
        }),
      ),
    ).toBe("403 forbidden");
    expect(
      await refused(() =>
        releaseReviewer(t.deps, asSeen, conference, {
          submissionId: subs.plain,
          reviewerId: ids.r2,
        }),
      ),
    ).toBe("403 forbidden");
    expect(await untouched()).toEqual(before);
    expect((await rowsOf(t, subs.plain)).map((a) => a.reviewerId)).toEqual([ids.r2]);
  });
});

describe("which proposals take a reviewer, and when", () => {
  it("none while the call is open, though a chair sees the proposal and who reviews it", async () => {
    const view = await shown(open, cookies.chair, openTalk);
    expect(view).toMatchObject({ takes: "call_not_closed", candidates: [], assigned: [] });
    const res = await assign(open, { cookie: cookies.chair }, openTalk, ids.r1);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "call_not_closed" });
    expect(await rowsOf(t, openTalk)).toEqual([]);
    expect((await page(open, { cookie: cookies.chair })).json).toMatchObject({
      callClosed: false,
      pools: [
        { key: POOL_A, proposals: 1, short: 1 },
        { key: POOL_B, proposals: 0 },
      ],
    });
    // At the other conference the closing date has passed and the phase has not moved: it is
    // still "cfp_open", not in review, and a chair assigns.
    expect((await getConference(t.db, OPEN))?.phase).toBe("cfp_open");
    expect((await getConference(t.db, SLUG))?.phase).toBe("cfp_open");
    expect((await page(w, { cookie: cookies.chair })).json.callClosed).toBe(true);
    expect((await shown(w, cookies.chair, subs.boundary)).takes).toBe("yes");
    expect((await assign(w, { cookie: cookies.chair }, subs.boundary, ids.r3)).status).toBe(204);
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.r3)).status).toBe(204);
  });

  it("never a withdrawn one, which can still lose the reviewers it has", async () => {
    await t.db
      .insert(assignments)
      .values({ conferenceId: w.conferenceId, reviewerId: ids.r1, submissionId: subs.withdrawn });
    const view = await shown(w, cookies.chair, subs.withdrawn);
    expect(view).toMatchObject({ takes: "not_under_consideration", candidates: [] });
    expect(view.assigned.map((a) => a.personId)).toEqual([ids.r1]);
    // It is nobody's work any more: not counted as the reviewer's load, here or on the People
    // page (two proposals are Rhea's: those assigned in the test above).
    const load = (await shown(w, cookies.chair, subs.boundary)).candidates.find(
      (c) => c.personId === ids.r1,
    )?.assigned;
    const counted = (
      await call(t.public, "GET", `/api/conferences/${SLUG}/people`, { cookie: cookies.chair })
    ).json.reviewers.find((r: { personId: string }) => r.personId === ids.r1)?.assigned;
    expect([load, counted]).toEqual([2, 2]);
    const res = await assign(w, { cookie: cookies.chair }, subs.withdrawn, ids.r2);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "not_under_consideration" });
    expect((await release(w, { cookie: cookies.chair }, subs.withdrawn, ids.r1)).status).toBe(204);
    expect(await rowsOf(t, subs.withdrawn)).toEqual([]);
  });

  it("not one with a decision, in whatever status an assigned reviewer still reads it", async () => {
    for (const status of ["accepted", "waitlisted", "rejected", "confirmed"]) {
      await t.db.update(submissions).set({ status }).where(eq(submissions.id, subs.boundary));
      try {
        expect((await shown(w, cookies.chair, subs.boundary)).takes, status).toBe(
          "not_under_consideration",
        );
        const res = await assign(w, { cookie: cookies.chair }, subs.boundary, ids.r2);
        expect(res.json, status).toEqual({ error: "not_under_consideration" });
      } finally {
        await t.db
          .update(submissions)
          .set({ status: "submitted" })
          .where(eq(submissions.id, subs.boundary));
      }
    }
    expect(await rowsOf(t, subs.boundary)).toEqual([]);
  });
});

describe("who is offered, and who is refused if asked for", () => {
  const offered = async (cookie: string, id: string) =>
    (await shown(w, cookie, id)).candidates.map((c) => c.personId);
  const notOffered = async (id: string, reviewerId: string, what: string) => {
    const before = (await rowsOf(t, id)).length;
    const res = await assign(w, { cookie: cookies.chair }, id, reviewerId, { confirmedFull: true });
    expect(res.status, what).toBe(409);
    // One answer for every reason: it never says which.
    expect(res.json, what).toEqual({ error: "not_offered" });
    expect((await rowsOf(t, id)).length, what).toBe(before);
  };

  it("the reviewers of the pool that reviews the format, with name, languages and load", async () => {
    const view = await shown(w, cookies.chair, subs.performance);
    expect(view).toMatchObject({ pool: POOL_B, needed: 2, takes: "yes", assigned: [] });
    expect(view.candidates).toEqual([
      // Given the role on the server, for every pool: nothing said, so nothing shown for them.
      {
        personId: ids.everyPool,
        displayName: "Enzo Everypool",
        email: mail("everyPool"),
        languages: [],
        assigned: 0,
        maxLoad: null,
        full: false,
      },
      {
        personId: ids.other,
        displayName: "Otto Otherpool",
        email: mail("other"),
        languages: ["en"],
        assigned: 0,
        maxLoad: 8,
        full: false,
      },
    ]);
    // A reviewer of the first pool only is not offered for it, and is refused if asked for.
    await notOffered(subs.performance, ids.r1, "another pool's reviewer");
    // Nor is a chair who is no reviewer, someone with no role, or nobody at all.
    await notOffered(subs.performance, ids.chair, "a chair");
    await notOffered(subs.performance, ids.elsewhere, "someone with no role here");
    await notOffered(subs.performance, "00000000-0000-4000-8000-00000000dddd", "nobody");
    const r1 = (await shown(w, cookies.chair, subs.boundary)).candidates.find(
      (c) => c.personId === ids.r1,
    );
    // Rhea said Spanish and Portuguese, and at most five; she has two proposals so far.
    expect(r1).toEqual({
      personId: ids.r1,
      displayName: "Rhea Reviewerone",
      email: mail("r1"),
      languages: ["es", "pt"],
      assigned: 2,
      maxLoad: 5,
      full: false,
    });
  });

  it("never the proposal's own people, whatever their status, in capitals or not", async () => {
    const list = await offered(cookies.chair, subs.team);
    for (const who of ["owner", "coauthor", "invitee", "decliner"] as const) {
      expect(list, who).not.toContain(ids[who]);
      await notOffered(subs.team, ids[who], who);
      // An id in capitals names the same person to the database, and to this rule.
      await notOffered(subs.team, ids[who].toUpperCase(), `${who}, in capitals`);
    }
    // They are reviewers like any other for a proposal that is not theirs.
    const elsewhere = await offered(cookies.chair, subs.boundary);
    for (const who of ["owner", "coauthor", "invitee", "decliner"] as const) {
      expect(elsewhere, who).toContain(ids[who]);
    }
    // The decliner is kept off by being on the proposal at all: without the conflict their
    // invitation left behind, they are still not offered.
    await t.db
      .delete(conflicts)
      .where(and(eq(conflicts.personId, ids.decliner), eq(conflicts.submissionId, subs.team)));
    await notOffered(subs.team, ids.decliner, "the decliner, without a conflict row");
  });

  it("never anyone with a conflict with the proposal, or with one of its people", async () => {
    const list = await offered(cookies.chair, subs.plain);
    expect(list).not.toContain(ids.declared);
    expect(list).not.toContain(ids.byPerson);
    await notOffered(subs.plain, ids.declared, "a conflict with the proposal");
    await notOffered(subs.plain, ids.byPerson, "a conflict with its author");
    // The first is offered for another proposal by the same author; the second for none of them.
    expect(await offered(cookies.chair, subs.boundary)).toContain(ids.declared);
    expect(await offered(cookies.chair, subs.boundary)).not.toContain(ids.byPerson);
    expect(await offered(cookies.chair, subs.team)).toContain(ids.byPerson);
  });

  it("never someone already on it: asked for again, there is still one assignment", async () => {
    expect((await rowsOf(t, subs.plain)).map((a) => a.reviewerId)).toEqual([ids.r2]);
    expect(await offered(cookies.chair, subs.plain)).not.toContain(ids.r2);
    for (const cookie of [cookies.chair, cookies.admin]) {
      const res = await assign(w, { cookie }, subs.plain, ids.r2);
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: "already_assigned" });
    }
    expect((await rowsOf(t, subs.plain)).filter((a) => a.reviewerId === ids.r2)).toHaveLength(1);
    // Asked for at the same moment by two chairs: one assignment (see also the Postgres part).
    const both = await Promise.all([
      assign(w, { cookie: cookies.chair }, subs.boundary, ids.r3),
      assign(w, { cookie: cookies.admin }, subs.boundary, ids.r3),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([204, 409]);
    expect((await rowsOf(t, subs.boundary)).map((a) => a.reviewerId)).toEqual([ids.r3]);
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.r3)).status).toBe(204);
  });

  it("a reviewer who has reached their number is offered last, and assigned only once the chair has been told", async () => {
    // "full" said one proposal at most, and gets one.
    expect((await assign(w, { cookie: cookies.chair }, subs.team, ids.full)).status).toBe(204);
    const view = await shown(w, cookies.chair, subs.boundary);
    const last = view.candidates.at(-1);
    expect(last).toMatchObject({ personId: ids.full, assigned: 1, maxLoad: 1, full: true });
    expect(view.candidates.filter((c) => c.full)).toHaveLength(1);
    // Without the confirmation the server assigns nobody, and says their numbers.
    for (const body of [{}, { confirmedFull: false }]) {
      const res = await assign(w, { cookie: cookies.chair }, subs.boundary, ids.full, body);
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: "reviewer_full", assigned: 1, maxLoad: 1 });
    }
    expect(await rowsOf(t, subs.boundary)).toEqual([]);
    // Told, the chair assigns them all the same: the number is what they offered, not a lock.
    expect(
      (await assign(w, { cookie: cookies.chair }, subs.boundary, ids.full, { confirmedFull: true }))
        .status,
    ).toBe(204);
    expect(
      (await shown(w, cookies.chair, subs.plain)).candidates.find((c) => c.personId === ids.full),
    ).toMatchObject({ assigned: 2, maxLoad: 1, full: true });
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.full)).status).toBe(204);
    expect((await release(w, { cookie: cookies.chair }, subs.team, ids.full)).status).toBe(204);
    // Someone who is not full is assigned whether or not the request says so.
    expect(
      (await assign(w, { cookie: cookies.chair }, subs.boundary, ids.r3, { confirmedFull: true }))
        .status,
    ).toBe(204);
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.r3)).status).toBe(204);
  });

  it("takes nothing but a reviewer's id and that confirmation", async () => {
    for (const body of [
      {},
      { reviewerId: "not-an-id" },
      { reviewerId: ids.r3, submissionId: subs.own },
      { reviewerId: ids.r3, releaseReason: "conflict" },
      { reviewerId: ids.r3, assignedByPersonId: ids.admin },
      { reviewerId: ids.r3, confirmedFull: "yes" },
    ]) {
      const res = await call(t.public, "POST", at(w, `/submissions/${subs.boundary}/reviewers`), {
        cookie: cookies.chair,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await rowsOf(t, subs.boundary)).toEqual([]);
  });
});

describe("a chair's own proposal, and one they have a conflict with", () => {
  it("are not theirs to learn about from a load, a list or a count", async () => {
    // Rhea reviews the author-chair's own talk and the one the other chair has a conflict with
    // (both assigned above), and nothing else of theirs.
    const loadOf = async (cookie: string) =>
      (await shown(w, cookie, subs.boundary)).candidates.find((c) => c.personId === ids.r1)
        ?.assigned;
    const peopleCount = async (cookie: string) =>
      (
        await call(t.public, "GET", `/api/conferences/${SLUG}/people`, { cookie })
      ).json.reviewers.find((r: { personId: string }) => r.personId === ids.r1)?.assigned;
    expect([await loadOf(cookies.chair), await peopleCount(cookies.chair)]).toEqual([2, 2]);
    // Each of the two is shown one fewer: the load is the People page's number, for each chair.
    for (const cookie of [cookies.authorChair, cookies.conflictedChair]) {
      expect([await loadOf(cookie), await peopleCount(cookie)]).toEqual([1, 1]);
    }

    const all = (await page(w, { cookie: cookies.chair })).json as Page;
    const listedBy = async (cookie: string) => {
      const res = (await page(w, { cookie })).json as Page;
      return { excluded: res.excluded, ids: res.pools.flatMap((p) => p.items.map((i) => i.id)) };
    };
    expect(all.excluded).toBe(0);
    const everything = all.pools.flatMap((p) => p.items.map((i) => i.id));
    expect(everything).toContain(subs.own);
    expect(everything).toContain(subs.conflicted);
    expect(await listedBy(cookies.authorChair)).toEqual({
      excluded: 1,
      ids: everything.filter((id) => id !== subs.own),
    });
    expect(await listedBy(cookies.conflictedChair)).toEqual({
      excluded: 1,
      ids: everything.filter((id) => id !== subs.conflicted),
    });
    // Nothing the author-chair is given names the proposal, or says that Rhea reviews it: every
    // answer is the one they would get if nobody reviewed it.
    const seenByAuthor = async () => [
      (await page(w, { cookie: cookies.authorChair })).json,
      await shown(w, cookies.authorChair, subs.boundary),
      await shown(w, cookies.authorChair, subs.plain),
    ];
    const withReviewer = await seenByAuthor();
    expect(findLeaks(withReviewer[0], [subs.own, "A chair's own talk"])).toEqual([]);
    const [theirs] = await rowsOf(t, subs.own);
    if (!theirs) throw new Error("nobody reviews the chair's own talk");
    await t.db.delete(assignments).where(eq(assignments.id, theirs.id));
    try {
      expect(await seenByAuthor()).toEqual(withReviewer);
    } finally {
      await t.db.insert(assignments).values(theirs);
    }
    // Their own view of their proposal says nothing of reviewers, as before.
    const own = await read(t, cookies.authorChair, subs.own);
    expect(own.view).toBe("submitter");
    expect(findLeaks(own, [ids.r1, "assignedReviewerIds"])).toEqual([]);
  });

  it("a chair who reviews is assigned like any reviewer, by another chair or by themselves, never to their own", async () => {
    // The author-chair reviews for the first pool.
    expect(
      (await shown(w, cookies.chair, subs.boundary)).candidates.map((c) => c.personId),
    ).toContain(ids.authorChair);
    expect(
      (await assign(w, { cookie: cookies.authorChair }, subs.boundary, ids.authorChair)).status,
    ).toBe(204);
    expect(
      (await release(w, { cookie: cookies.authorChair }, subs.boundary, ids.authorChair)).status,
    ).toBe(204);
    const res = await assign(w, { cookie: cookies.chair }, subs.own, ids.authorChair);
    expect(res.json).toEqual({ error: "not_offered" });
  });
});

describe("assigning, releasing, and assigning again", () => {
  it("an assignment is one row, made by a chair at a time; released, the row is kept and counts nowhere", async () => {
    const id = subs.performance;
    const start = (await audited(t, w.conferenceId)).length;
    const mailBefore = (await t.db.select().from(outbox)).length;
    expect((await assign(w, { cookie: cookies.chair }, id, ids.other)).status).toBe(204);
    const [made] = await rowsOf(t, id);
    expect(made).toMatchObject({
      conferenceId: w.conferenceId,
      reviewerId: ids.other,
      submissionId: id,
      assignedByPersonId: ids.chair,
      createdAt: NOW,
    });
    if (!made) throw new Error("no assignment was made");
    expect(await releasesOf(t, id)).toEqual([]);
    // What the assignment was, who made it and when, and who ended it, when and why.
    const first = (releasedAt: Date) => ({
      conferenceId: w.conferenceId,
      submissionId: id,
      reviewerId: ids.other,
      assignmentId: made.id,
      assignedByPersonId: ids.chair,
      assignedAt: NOW,
      releasedByPersonId: ids.admin,
      releasedAt,
      reason: "chair",
    });
    const counts = async () => {
      const chairView = await read(t, cookies.chair, id);
      const listed = ((await page(w, { cookie: cookies.chair })).json as Page).pools
        .flatMap((p) => p.items)
        .find((i) => i.id === id);
      const peoplePage = await call(t.public, "GET", `/api/conferences/${SLUG}/people`, {
        cookie: cookies.chair,
      });
      return {
        assignedReviewerIds: chairView.assignedReviewerIds,
        section: (await shown(w, cookies.chair, id)).assigned.map((a) => a.personId),
        candidate: (await shown(w, cookies.chair, id)).candidates.some(
          (c) => c.personId === ids.other,
        ),
        listed: listed?.reviewers.map((r) => r.personId),
        short: listed?.short,
        people: peoplePage.json.reviewers.find(
          (r: { personId: string }) => r.personId === ids.other,
        )?.assigned,
      };
    };
    expect(await counts()).toEqual({
      assignedReviewerIds: [ids.other],
      section: [ids.other],
      candidate: false,
      listed: [ids.other],
      short: true,
      people: 1,
    });
    expect((await shown(w, cookies.chair, id)).assigned).toEqual([
      {
        personId: ids.other,
        displayName: "Otto Otherpool",
        email: mail("other"),
        assignedAt: NOW.toISOString(),
        blocked: false,
      },
    ]);

    // An hour later the chair removes them.
    const later = new Date(NOW.getTime() + HOUR);
    t.setNow(later);
    try {
      expect((await release(w, { cookie: cookies.admin }, id, ids.other)).status).toBe(204);
      // The assignment is gone from the table of assignments, and its record is kept apart.
      expect(await rowsOf(t, id)).toEqual([]);
      expect(await releasesOf(t, id)).toMatchObject([first(later)]);
      expect(await counts()).toEqual({
        assignedReviewerIds: [],
        section: [],
        candidate: true,
        listed: [],
        short: true,
        people: 0,
      });
      // Removing them again finds nobody on it, and records nothing.
      const again = await release(w, { cookie: cookies.admin }, id, ids.other);
      expect(again.status).toBe(404);
      expect(again.json).toEqual({ error: "not_found" });
      // Nor someone who was never on it, or an id that is none.
      expect((await release(w, { cookie: cookies.admin }, id, ids.r1)).status).toBe(404);
      expect((await release(w, { cookie: cookies.admin }, id, "nobody")).status).toBe(404);

      // Assigned again, two hours on: a new assignment, made then, by that chair.
      const evenLater = new Date(NOW.getTime() + 2 * HOUR);
      t.setNow(evenLater);
      expect((await assign(w, { cookie: cookies.admin }, id, ids.other)).status).toBe(204);
      const [second] = await rowsOf(t, id);
      expect(second).toMatchObject({
        reviewerId: ids.other,
        submissionId: id,
        assignedByPersonId: ids.admin,
        createdAt: evenLater,
      });
      expect(second?.id).not.toBe(made.id);
      expect(await rowsOf(t, id)).toHaveLength(1);
      expect(await releasesOf(t, id)).toMatchObject([first(later)]);
      expect((await counts()).assignedReviewerIds).toEqual([ids.other]);
      // An id in capitals in the address is the same reviewer.
      expect(
        (await release(w, { cookie: cookies.chair }, id.toUpperCase(), ids.other.toUpperCase()))
          .status,
      ).toBe(204);
    } finally {
      t.setNow(NOW);
    }
    expect(await rowsOf(t, id)).toEqual([]);
    // Two assignments were made and released: two records, in the order they ended.
    expect(
      (await releasesOf(t, id)).map((r) => [r.assignedByPersonId, r.releasedByPersonId]),
    ).toEqual([
      [ids.chair, ids.admin],
      [ids.admin, ids.chair],
    ]);
    // One audit row for each: the proposal, the reviewer, and for a release its reason.
    const target = { targetType: "submission", targetId: id, kind: "human" };
    expect((await audited(t, w.conferenceId)).slice(start)).toEqual([
      {
        ...target,
        action: "assignment.made",
        actor: ids.chair,
        details: { reviewerId: ids.other, again: false },
      },
      {
        ...target,
        action: "assignment.released",
        actor: ids.admin,
        details: { reviewerId: ids.other, reason: "chair" },
      },
      {
        ...target,
        action: "assignment.made",
        actor: ids.admin,
        details: { reviewerId: ids.other, again: true },
      },
      {
        ...target,
        action: "assignment.released",
        actor: ids.chair,
        details: { reviewerId: ids.other, reason: "chair" },
      },
    ]);
    // Nobody was written to about any of it.
    expect((await t.db.select().from(outbox)).length).toBe(mailBefore);
  });

  it("a reviewer released because of a conflict is never offered for that proposal again", async () => {
    const id = subs.performance;
    // Released for each reason there is (the record is written as the next step will write it
    // for the reasons a reviewer gives): only a conflict keeps them off.
    const [last] = await t.db
      .select()
      .from(assignmentReleases)
      .where(
        and(eq(assignmentReleases.submissionId, id), eq(assignmentReleases.reviewerId, ids.other)),
      )
      .orderBy(desc(assignmentReleases.releasedAt));
    if (!last) throw new Error("no release on record");
    const because = (reason: string) =>
      t.db.update(assignmentReleases).set({ reason }).where(eq(assignmentReleases.id, last.id));
    for (const reason of ["expertise", "time", "role_removed", "chair"] as const) {
      await because(reason);
      expect(
        (await shown(w, cookies.chair, id)).candidates.map((c) => c.personId),
        reason,
      ).toContain(ids.other);
    }
    await because("conflict");
    const view = await shown(w, cookies.chair, id);
    expect(view.candidates.map((c) => c.personId)).not.toContain(ids.other);
    // Named nowhere in what the chair is shown of the proposal.
    expect(findLeaks(view, [ids.other, "Otto Otherpool", mail("other")])).toEqual([]);
    const res = await assign(w, { cookie: cookies.chair }, id, ids.other, { confirmedFull: true });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "not_offered" });
    expect(await rowsOf(t, id)).toEqual([]);
    // The record says so, and no request can say otherwise.
    expect((await releasesOf(t, id)).map((r) => r.reason)).toEqual(["chair", "conflict"]);
  });

  it("the database refuses a second assignment of a reviewer to a proposal, and a reason there is not", async () => {
    // Rolf reviews the plain talk: there is one row for the two, and there cannot be another.
    expect((await rowsOf(t, subs.plain)).map((a) => a.reviewerId)).toEqual([ids.r2]);
    await expect(
      t.db.insert(assignments).values({
        conferenceId: w.conferenceId,
        reviewerId: ids.r2,
        submissionId: subs.plain,
      }),
    ).rejects.toThrow();
    const record = {
      conferenceId: w.conferenceId,
      submissionId: subs.performance,
      reviewerId: ids.r3,
      assignmentId: "00000000-0000-4000-8000-00000000aaaa",
      assignedAt: NOW,
      releasedAt: NOW,
    };
    await expect(
      t.db.insert(assignmentReleases).values({ ...record, reason: "withdrawn" }),
    ).rejects.toThrow();
    expect((await releasesOf(t, subs.performance)).map((r) => r.reviewerId)).toEqual([
      ids.other,
      ids.other,
    ]);
  });

  it("the record of a release goes with its proposal, and outlives the people it names", async () => {
    // A proposal's deletion: an owner deleting a draft must never fail on the record, and
    // nothing is left of a proposal that is gone.
    const [draft] = await t.db
      .insert(submissions)
      .values({
        conferenceId: w.conferenceId,
        ownerPersonId: ids.stranger,
        typeKey: "talk",
        language: "en",
        title: "",
        abstract: "",
        status: "draft",
      })
      .returning({ id: submissions.id });
    if (!draft) throw new Error("no draft");
    await t.db.insert(assignmentReleases).values({
      conferenceId: w.conferenceId,
      submissionId: draft.id,
      reviewerId: ids.r3,
      assignmentId: "00000000-0000-4000-8000-00000000bbbb",
      assignedAt: NOW,
      releasedAt: NOW,
      reason: "chair",
    });
    expect(await everHadReviewer(t.db, draft.id)).toBe(true);
    await t.db.delete(submissions).where(eq(submissions.id, draft.id));
    expect(await releasesOf(t, draft.id)).toEqual([]);
    expect(await everHadReviewer(t.db, draft.id)).toBe(false);

    // A person's deletion: it does not fail on the record either, and the record stays without
    // them. The proposal keeps the fact that it has had a reviewer, so the guard on anonymity
    // and the rule about its format keep what they know.
    const email = mail("ghost");
    await w.person(email, "Gus Ghostreviewer");
    const ghost = await reviewer(w, email, [POOL_B]);
    const [kept] = await t.db
      .insert(submissions)
      .values({
        conferenceId: w.conferenceId,
        ownerPersonId: ids.stranger,
        typeKey: "performance",
        language: "en",
        title: "A performance with a ghost",
        abstract: words(400),
        status: "submitted",
        submittedAt: NOW,
      })
      .returning({ id: submissions.id });
    if (!kept) throw new Error("no proposal");
    try {
      expect((await assign(w, { cookie: cookies.chair }, kept.id, ghost)).status).toBe(204);
      expect((await release(w, { cookie: cookies.chair }, kept.id, ghost)).status).toBe(204);
      expect(await releasesOf(t, kept.id)).toMatchObject([
        { reviewerId: ghost, assignedByPersonId: ids.chair, releasedByPersonId: ids.chair },
      ]);
      await t.db.delete(people).where(eq(people.id, ghost));
      expect(await t.db.select().from(people).where(eq(people.id, ghost))).toEqual([]);
      expect(await releasesOf(t, kept.id)).toMatchObject([
        {
          submissionId: kept.id,
          reviewerId: null,
          assignedByPersonId: ids.chair,
          releasedByPersonId: ids.chair,
          reason: "chair",
        },
      ]);
      expect(await everHadReviewer(t.db, kept.id)).toBe(true);
      expect((await everAssigned(t.db, w.conferenceId)).has(kept.id)).toBe(true);
      // Nobody is on it, and the chairs' page of it is as for any proposal without a reviewer.
      expect((await shown(w, cookies.chair, kept.id)).assigned).toEqual([]);
    } finally {
      await t.db.delete(submissions).where(eq(submissions.id, kept.id));
    }
  });
});

describe("when a reviewer can read what is assigned to them", () => {
  const listedAsReviewer = async (cookie: string) =>
    (
      await call(t.public, "GET", `/api/conferences/${SLUG}/submissions?limit=500`, { cookie })
    ).json.items.filter((x: { view: string }) => x.view === "reviewer");
  const move = (phase: string, from: string, more: Record<string, unknown> = {}) =>
    call(t.public, "PUT", `/api/conferences/${SLUG}/phase`, {
      cookie: cookies.chair,
      body: { phase, from, ...more },
    });

  it("not before the conference is in review: assigned, they get what a stranger gets", async () => {
    expect((await getConference(t.db, SLUG))?.phase).toBe("cfp_open");
    expect((await assign(w, { cookie: cookies.chair }, subs.boundary, ids.r2)).status).toBe(204);
    // Rolf is assigned to two talks now, and can open neither; nor can he list them.
    expect(await read(t, cookies.r2, subs.boundary)).toBe(404);
    expect(await read(t, cookies.r2, subs.plain)).toBe(404);
    expect(await read(t, cookies.r2, subs.boundary)).toBe(await read(t, cookies.r3, subs.boundary));
    expect(await listedAsReviewer(cookies.r2)).toEqual([]);
    for (const path of ["conference", "check"]) {
      expect(
        (
          await call(t.public, "GET", `/api/submissions/${subs.boundary}/${path}`, {
            cookie: cookies.r2,
          })
        ).status,
        path,
      ).toBe(404);
    }
    // The chairs see who is assigned all the while.
    expect((await read(t, cookies.chair, subs.boundary)).assignedReviewerIds).toEqual([ids.r2]);
  });

  it("from the moment it is in review, and in every later phase; what they are given is the reviewer's view, unchanged", async () => {
    expect((await move("reviewing", "cfp_open")).status).toBe(200);
    const view = await read(t, cookies.r2, subs.boundary);
    // Exactly the reviewer projection of an anonymized talk: its text, and nothing about who
    // wrote it, who else reviews it, who assigned it or when.
    expect(view).toEqual({
      view: "reviewer",
      blindMode: "double",
      id: subs.boundary,
      conferenceId: w.conferenceId,
      typeKey: "talk",
      trackKey: null,
      topicKeys: [],
      language: "en",
      title: "A talk at the boundary",
      abstract: words(260),
      fields: {},
    });
    expect(
      findLeaks(view, [ids.stranger, "Stella Stranger", mail("stranger"), ids.chair, ids.r2]),
    ).toEqual([]);
    expect((await listedAsReviewer(cookies.r2)).map((x: { id: string }) => x.id).sort()).toEqual(
      [subs.boundary, subs.plain].sort(),
    );
    // A reviewer who is not assigned still gets nothing, in review as before it.
    expect(await read(t, cookies.r3, subs.boundary)).toBe(404);
    // Later phases keep it readable; back before review, it is closed again.
    for (const [to, from] of [
      ["deciding", "reviewing"],
      ["confirming", "deciding"],
    ]) {
      expect((await move(to as string, from as string)).status).toBe(200);
      expect((await read(t, cookies.r2, subs.boundary)).view, to).toBe("reviewer");
    }
    const back = { force: true, reason: "Back for the test" };
    expect((await move("deciding", "confirming", back)).status).toBe(200);
    expect((await move("reviewing", "deciding", back)).status).toBe(200);
    expect((await move("cfp_open", "reviewing", back)).status).toBe(200);
    expect(await read(t, cookies.r2, subs.boundary)).toBe(404);
    expect((await move("reviewing", "cfp_open")).status).toBe(200);
    expect((await read(t, cookies.r2, subs.boundary)).view).toBe("reviewer");
  });

  it("released, they get what a stranger gets again, at once, and nobody is told they were there", async () => {
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.r2)).status).toBe(204);
    expect(await read(t, cookies.r2, subs.boundary)).toBe(404);
    expect(await read(t, cookies.r2, subs.boundary)).toBe(await read(t, cookies.r3, subs.boundary));
    expect((await listedAsReviewer(cookies.r2)).map((x: { id: string }) => x.id)).toEqual([
      subs.plain,
    ]);
    const chairView = await read(t, cookies.chair, subs.boundary);
    expect(chairView.assignedReviewerIds).toEqual([]);
    expect(findLeaks(chairView, [ids.r2])).toEqual([]);
    // Assigned again, they read it again.
    expect((await assign(w, { cookie: cookies.chair }, subs.boundary, ids.r2)).status).toBe(204);
    expect((await read(t, cookies.r2, subs.boundary)).view).toBe("reviewer");
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, ids.r2)).status).toBe(204);
  });

  it("a reviewer of another pool, and one with a conflict, read nothing even if a row says they are assigned", async () => {
    // Rows no route would write: the policy refuses them all the same. The conference is in
    // review, where an assigned reviewer of the pool without a conflict does read (Rolf, here).
    expect((await getConference(t.db, SLUG))?.phase).toBe("reviewing");
    expect((await read(t, cookies.r2, subs.plain)).view).toBe("reviewer");
    await t.db.insert(assignments).values([
      { conferenceId: w.conferenceId, reviewerId: ids.other, submissionId: subs.boundary },
      { conferenceId: w.conferenceId, reviewerId: ids.declared, submissionId: subs.plain },
    ]);
    try {
      expect(await read(t, cookies.other, subs.boundary)).toBe(404);
      const declared = await signIn(t, mail("declared"));
      expect(await read(t, declared, subs.plain)).toBe(404);
    } finally {
      await t.db
        .delete(assignments)
        .where(
          and(
            inArray(assignments.reviewerId, [ids.other, ids.declared]),
            inArray(assignments.submissionId, [subs.boundary, subs.plain]),
          ),
        );
    }
  });
});

describe("a proposal that has had a reviewer keeps its format", () => {
  const sub = (id: string, rest = "") => `/api/submissions/${id}${rest}`;
  const version = async (id: string) =>
    (await call(t.public, "GET", sub(id), { cookie: cookies.stranger })).json.version as number;
  const format = async (id: string, typeKey: string) =>
    call(t.public, "PATCH", sub(id), {
      cookie: cookies.stranger,
      body: { version: await version(id), typeKey },
    });
  const phase = (to: string, from: string, forced = false) =>
    call(t.public, "PUT", `/api/conferences/${SLUG}/phase`, {
      cookie: cookies.chair,
      body: { phase: to, from, ...(forced ? { force: true, reason: "The call is extended" } : {}) },
    });

  it("taken back to a draft while its call is open again, it cannot be sent in again in another format", async () => {
    // Rolf was assigned the plain talk, anonymized, and has read it as that.
    expect(await read(t, cookies.r2, subs.plain)).toMatchObject({
      view: "reviewer",
      blindMode: "double",
    });
    // The chairs extend the call: the conference goes back to "cfp_open" and the closing date
    // moves on. Authors can take a proposal back and change it again.
    const k = await getConference(t.db, SLUG);
    if (!k) throw new Error("no conference");
    await saveConference(t.db, {
      ...k.config,
      deadlines: {
        ...k.config.deadlines,
        submissionsClose: new Date(NOW.getTime() + 10 * 24 * HOUR).toISOString(),
      },
    });
    expect((await phase("cfp_open", "reviewing", true)).status).toBe(200);
    try {
      for (const id of [subs.plain, subs.boundary]) {
        const taken = await call(t.public, "POST", sub(id, "/unsubmit"), {
          cookie: cookies.stranger,
          body: { version: await version(id) },
        });
        expect(taken.status).toBe(200);
        expect(taken.json.status).toBe("draft");
        // A performance is reviewed by the other committee, with the authors' names shown. The
        // plain talk has a reviewer; the other one had reviewers, all released since.
        const refused = await format(id, "performance");
        expect(refused.status).toBe(422);
        expect(refused.json.issues).toEqual([{ path: "typeKey", code: "locked" }]);
        // Another format of the same committee is refused too: the rule is one sentence.
        expect((await format(id, "workshop")).status).toBe(422);
      }
      expect((await rowsOf(t, subs.plain)).map((a) => a.reviewerId)).toEqual([ids.r2]);
      expect(await rowsOf(t, subs.boundary)).toEqual([]);
      expect((await releasesOf(t, subs.boundary)).length).toBeGreaterThan(0);
      // Everything else about it can still be changed, and it is sent in again as a talk.
      const edited = await call(t.public, "PATCH", sub(subs.plain), {
        cookie: cookies.stranger,
        body: { version: await version(subs.plain), title: "A plain talk" },
      });
      expect(edited.status).toBe(200);
      // A draft that never had a reviewer changes its format as before.
      expect((await format(subs.draft, "workshop")).status).toBe(200);
      expect((await format(subs.draft, "talk")).status).toBe(200);
      // While it is a draft nobody reviews it, and its chair is given nothing of it.
      expect(await read(t, cookies.r2, subs.plain)).toBe(404);
      expect((await reviewersOf(w, { cookie: cookies.chair }, subs.plain)).status).toBe(404);
    } finally {
      for (const id of [subs.plain, subs.boundary]) await submit(w, cookies.stranger, id);
      await closeCall(w);
      expect((await phase("reviewing", "cfp_open")).status).toBe(200);
    }
    // In review again, the reviewer is given what they were given before: the same talk,
    // anonymized.
    const again = await read(t, cookies.r2, subs.plain);
    expect(again).toMatchObject({ view: "reviewer", blindMode: "double", typeKey: "talk" });
    expect(again).not.toHaveProperty("contributors");
  });
});

describe("removing a reviewer's role releases what they had", () => {
  it("each assignment is released with that reason, and the proposals lose the reviewer everywhere", async () => {
    const email = mail("leaver");
    const cookie = await w.person(email, "Lena Leaverson");
    const id = await reviewer(w, email, [POOL_A]);
    for (const sub of [subs.boundary, subs.team]) {
      expect((await assign(w, { cookie: cookies.chair }, sub, id)).status).toBe(204);
    }
    expect((await read(t, cookie, subs.boundary)).view).toBe("reviewer");
    const start = (await audited(t, w.conferenceId)).length;
    const removed = await call(
      t.public,
      "DELETE",
      `/api/conferences/${SLUG}/people/${id}/roles/reviewer`,
      { cookie: cookies.chair, body: { assignments: 2 } },
    );
    expect(removed.status).toBe(204);
    // Neither assignment is left, and each has its record: why, when, and by whose act.
    const theirs = () => t.db.select().from(assignments).where(eq(assignments.reviewerId, id));
    const records = () =>
      t.db.select().from(assignmentReleases).where(eq(assignmentReleases.reviewerId, id));
    expect(await theirs()).toEqual([]);
    expect((await records()).map((r) => [r.reason, r.releasedAt, r.releasedByPersonId])).toEqual([
      ["role_removed", NOW, ids.chair],
      ["role_removed", NOW, ids.chair],
    ]);
    expect((await records()).map((r) => r.submissionId).sort()).toEqual(
      [subs.boundary, subs.team].sort(),
    );
    expect((await audited(t, w.conferenceId)).slice(start)).toEqual(
      expect.arrayContaining(
        [subs.boundary, subs.team].map((targetId) => ({
          action: "assignment.released",
          actor: ids.chair,
          kind: "human",
          targetType: "submission",
          targetId,
          details: { reviewerId: id, reason: "role_removed" },
        })),
      ),
    );
    expect(await read(t, cookie, subs.boundary)).toBe(404);
    for (const sub of [subs.boundary, subs.team]) {
      const view = await shown(w, cookies.chair, sub);
      // No longer a reviewer: not on it, and not offered for it.
      expect(findLeaks(view, [id, "Lena Leaverson"]), sub).toEqual([]);
      expect((await assign(w, { cookie: cookies.chair }, sub, id)).json, sub).toEqual({
        error: "not_offered",
      });
    }
    // Invited again and a reviewer again, they can be assigned again: a new assignment.
    await reviewer(w, email, [POOL_A]);
    expect((await assign(w, { cookie: cookies.chair }, subs.boundary, id)).status).toBe(204);
    expect((await read(t, cookie, subs.boundary)).view).toBe("reviewer");
    expect((await theirs()).map((a) => a.submissionId)).toEqual([subs.boundary]);
    expect(await records()).toHaveLength(2);
    expect((await release(w, { cookie: cookies.chair }, subs.boundary, id)).status).toBe(204);
  });
});

describe("the Assignments page", () => {
  it("lists every proposal that takes reviewers, by pool, those still short first, with totals", async () => {
    const res = await page(w, { cookie: cookies.chair });
    expect(res.status).toBe(200);
    const view = res.json as Page;
    expect(view).toMatchObject({ view: "assignments", callClosed: true, excluded: 0 });
    expect(view.pools.map((p) => [p.key, p.needed])).toEqual([
      [POOL_A, NEEDED_A],
      [POOL_B, 2],
    ]);
    const [a, b] = view.pools as [Listed, Listed];
    // The draft and the withdrawn talk are not there; the five submitted talks are.
    expect(a.items.map((i) => i.id).sort()).toEqual(
      [subs.team, subs.plain, subs.boundary, subs.own, subs.conflicted].sort(),
    );
    expect(b.items.map((i) => i.id)).toEqual([subs.performance]);
    expect(a.proposals).toBe(5);
    expect(a.short).toBe(a.items.filter((i) => i.short).length);
    expect(a.nextCursor).toBeNull();
    for (const item of a.items) {
      expect(item.short, item.title).toBe(item.reviewers.length < NEEDED_A);
      const rows = await rowsOf(t, item.id);
      expect(item.reviewers.map((r) => r.personId).sort(), item.title).toEqual(
        rows.map((r) => r.reviewerId).sort(),
      );
    }
    expect(a.items.find((i) => i.id === subs.plain)).toEqual({
      id: subs.plain,
      title: "A plain talk",
      typeKey: "talk",
      reviewers: [{ personId: ids.r2, displayName: "Rolf Reviewertwo", email: mail("r2") }],
      short: true,
    });
    // Nothing of a proposal but its title and its format, and nobody who wrote one.
    expect(
      findLeaks(view, ["verse verse", "Stella Stranger", mail("stranger"), ids.stranger]),
    ).toEqual([]);
  });

  it("puts a proposal that has its reviewers after those that do not, and counts it", async () => {
    for (const who of ["r1", "r3"] as const) {
      expect((await assign(w, { cookie: cookies.chair }, subs.plain, ids[who])).status).toBe(204);
    }
    try {
      const [a] = ((await page(w, { cookie: cookies.chair })).json as Page).pools as [Listed];
      expect(a).toMatchObject({ proposals: 5, short: 4 });
      expect(a.items.at(-1)).toMatchObject({ id: subs.plain, short: false });
      expect(a.items.at(-1)?.reviewers).toHaveLength(NEEDED_A);
      expect(a.items.slice(0, 4).every((i) => i.short)).toBe(true);
      // Among those still short, as they were created.
      const created = await t.db
        .select({ id: submissions.id, createdAt: submissions.createdAt })
        .from(submissions)
        .where(eq(submissions.conferenceId, w.conferenceId));
      const when = (id: string) => created.find((c) => c.id === id)?.createdAt.getTime() ?? 0;
      const short = a.items.slice(0, 4).map((i) => i.id);
      expect(short).toEqual(
        [...short].sort((x, y) => when(x) - when(y) || (x < y ? -1 : x > y ? 1 : 0)),
      );
    } finally {
      for (const who of ["r1", "r3"] as const) {
        expect((await release(w, { cookie: cookies.chair }, subs.plain, ids[who])).status).toBe(
          204,
        );
      }
    }
  });

  it("comes a page at a time, by a cursor that opens only on the list it was made for", async () => {
    const whole = (((await page(w, { cookie: cookies.chair })).json as Page).pools[0] as Listed)
      .items;
    const first = ((await page(w, { cookie: cookies.chair }, "?limit=2")).json as Page)
      .pools[0] as Listed;
    expect(first.items).toEqual(whole.slice(0, 2));
    expect(first).toMatchObject({ proposals: 5 });
    expect(first.nextCursor).toMatch(/^[sf][A-Za-z0-9_-]{60,180}$/);
    const more = (cookie: string, pool: string, cursor: string | null, limit = 2) =>
      call(t.public, "GET", at(w, `/pools/${pool}?limit=${limit}&cursor=${cursor ?? ""}`), {
        cookie,
      });
    const second = await more(cookies.chair, POOL_A, first.nextCursor);
    expect(second.status).toBe(200);
    expect(second.json.items).toEqual(whole.slice(2, 4));
    expect(second.json).toMatchObject({ key: POOL_A, proposals: 5, needed: NEEDED_A });
    const third = await more(cookies.chair, POOL_A, second.json.nextCursor);
    expect(third.json.items).toEqual(whole.slice(4));
    expect(third.json.nextCursor).toBeNull();
    // Without a cursor, a pool's page starts at the beginning; a page as long as the list ends it.
    expect((await more(cookies.chair, POOL_A, null, 5)).json).toMatchObject({
      items: whole,
      nextCursor: null,
    });

    // The cursor is the position after the last proposal shown, compared and never looked up:
    // the next page continues there although that proposal has since got all its reviewers and
    // moved to the end of the list.
    const last = first.items[1]?.id ?? "";
    expect(first.items[1]?.short).toBe(true);
    const before = (await rowsOf(t, last)).length;
    // As many of those offered for it as it still needs, so that it has its reviewers.
    const offered = (await shown(w, cookies.chair, last)).candidates.filter((c) => !c.full);
    const added: string[] = [];
    for (const c of offered.slice(0, NEEDED_A - before)) {
      expect((await assign(w, { cookie: cookies.chair }, last, c.personId)).status).toBe(204);
      added.push(c.personId);
    }
    expect(before + added.length).toBe(NEEDED_A);
    try {
      const after = await more(cookies.chair, POOL_A, first.nextCursor, 5);
      expect(after.json.items.map((i: { id: string }) => i.id)).toEqual([
        ...whole.slice(2).map((i) => i.id),
        last,
      ]);
      expect(after.json.items.at(-1)).toMatchObject({ id: last, short: false });
    } finally {
      for (const id of added) await release(w, { cookie: cookies.chair }, last, id);
    }

    // A cursor is for one pool's list as one person is shown it.
    const refused = { error: "invalid", issues: [{ path: "cursor" }] };
    const cursor = first.nextCursor ?? "";
    for (const [what, res] of [
      ["another pool", await more(cookies.chair, POOL_B, cursor)],
      ["another chair", await more(cookies.admin, POOL_A, cursor)],
      // Moved among the proposals that have their reviewers, by the letter in front.
      ["its letter changed", await more(cookies.chair, POOL_A, `f${cursor.slice(1)}`)],
      ["made up", await more(cookies.chair, POOL_A, `s${"A".repeat(104)}`)],
      ["without its letter", await more(cookies.chair, POOL_A, cursor.slice(1))],
    ] as const) {
      expect(res.status, what).toBe(400);
      expect(res.json, what).toMatchObject(refused);
    }
    // A cursor from the list of submissions does not open here either.
    const list = await call(t.public, "GET", `/api/conferences/${SLUG}/submissions?limit=1`, {
      cookie: cookies.chair,
    });
    expect(list.json.nextCursor).toBeTruthy();
    expect((await more(cookies.chair, POOL_A, `s${list.json.nextCursor}`)).status).toBe(400);
    // A pool the conference does not have, and a page size it does not take.
    expect((await more(cookies.chair, "nosuchpool", null)).status).toBe(404);
    expect((await page(w, { cookie: cookies.chair }, "?limit=0")).status).toBe(400);
    expect((await page(w, { cookie: cookies.chair }, "?cursor=")).status).toBe(400);
  });
});

describe("the audit log", () => {
  it("holds ids and reasons for every assignment made and released, and never a name, an address or a title", async () => {
    const rows = await t.db.select().from(auditLog).where(like(auditLog.action, "assignment.%"));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.targetType).toBe("submission");
      expect(Object.keys(row.details as object).sort()).toEqual(
        row.action === "assignment.made" ? ["again", "reviewerId"] : ["reason", "reviewerId"],
      );
    }
    expect(
      findLeaks(
        rows,
        secrets.filter((x) => x.length > 6),
      ),
    ).toEqual([]);
    // Nothing was mailed to anyone because of an assignment: sign-in mail is all there is.
    const kinds = new Set((await t.db.select().from(outbox)).map((m) => m.kind));
    expect([...kinds].filter((k) => /assign|review/i.test(k))).toEqual([]);
  });
});

/*
 * The in-memory database runs one transaction at a time. Against a real Postgres
 * (TEST_DATABASE_URL, as for people.test.ts and settings-locks.test.ts), requests really do
 * run at once. Run this file on its own:
 *
 *   docker run --rm -d --name elochair-assignments -e POSTGRES_PASSWORD=assign \
 *     -p 127.0.0.1:55434:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:assign@127.0.0.1:55434/postgres \
 *     npx vitest run apps/server/src/assignments.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "on Postgres, requests made at the same moment",
  () => {
    let pg: TestApp;
    let p: World;
    const run = Date.now();
    const chairs: { cookie: string; id: string }[] = [];
    const reviewers: string[] = [];
    let owner: string;
    let talks: string[] = [];
    const address = (who: string) => `assign-pg-${run}-${who}@example.org`;
    const within = <T>(promise: Promise<T>, ms: number): Promise<T | "waiting"> =>
      Promise.race([promise, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);
    /** Hold locks in a transaction of its own until `release()`. Always release, in a `finally`. */
    function hold(lock: (tx: Db) => Promise<unknown>) {
      let release = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let taken = () => {};
      const ready = new Promise<void>((r) => {
        taken = r;
      });
      const done = pg.db.transaction(async (tx) => {
        await lock(tx as unknown as Db);
        taken();
        await gate;
      });
      return {
        ready,
        release: async () => {
          release();
          await done;
        },
      };
    }
    const active = (submissionId: string, reviewerId: string) =>
      pg.db
        .select()
        .from(assignments)
        .where(
          and(eq(assignments.submissionId, submissionId), eq(assignments.reviewerId, reviewerId)),
        );
    const isReviewer = async (id: string) =>
      (
        await pg.db
          .select()
          .from(conferenceRoles)
          .where(
            and(
              eq(conferenceRoles.conferenceId, p.conferenceId),
              eq(conferenceRoles.personId, id),
              eq(conferenceRoles.role, "reviewer"),
            ),
          )
      ).length > 0;
    const removing = (cookie: string, id: string, n: number) =>
      call(pg.public, "DELETE", `/api/conferences/${p.slug}/people/${id}/roles/reviewer`, {
        cookie,
        body: { assignments: n },
      });

    beforeAll(async () => {
      pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
      lifted(pg);
      // A call of its own each run: the database may still hold an earlier run's rows.
      p = await world(pg, `assign-pg-${run}`);
      for (let i = 0; i < 4; i++) {
        const cookie = await p.person(address(`chair-${i}`), `Chair ${i} Postgres`);
        const id = await p.id(address(`chair-${i}`));
        await grantRole(pg.db, { conferenceId: p.conferenceId, personId: id, role: "chair" });
        chairs.push({ cookie, id });
      }
      for (let i = 0; i < 8; i++) {
        await p.person(address(`reviewer-${i}`), `Reviewer ${i} Postgres`);
        reviewers.push(await reviewer(p, address(`reviewer-${i}`), [POOL_A]));
      }
      owner = await p.person(address("owner"), "Owner Postgres");
      talks = [];
      for (let i = 0; i < 4; i++) talks.push(await proposal(p, owner, `A Postgres talk ${i}`));
      await closeCall(p);
    }, 240_000);
    afterAll(() => pg?.close());

    it("two chairs assigning the same reviewer to one proposal: one assignment, each time", async () => {
      const [talk] = talks as [string];
      const [reviewerId] = reviewers as [string];
      for (let round = 0; round < 12; round++) {
        const results = await Promise.all(
          chairs.map((c) => assign(p, { cookie: c.cookie }, talk, reviewerId)),
        );
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([204, 409, 409, 409]);
        for (const r of results.filter((x) => x.status === 409)) {
          expect(r.json, `round ${round}`).toEqual({ error: "already_assigned" });
        }
        expect(
          await pg.db
            .select()
            .from(assignments)
            .where(and(eq(assignments.submissionId, talk), eq(assignments.reviewerId, reviewerId))),
          `round ${round}`,
        ).toHaveLength(1);
        expect(await active(talk, reviewerId), `round ${round}`).toHaveLength(1);
        // Released by all four at once: one release, and the others find nobody on it.
        const gone = await Promise.all(
          chairs.map((c) => release(p, { cookie: c.cookie }, talk, reviewerId)),
        );
        expect(gone.map((r) => r.status).sort(), `round ${round}`).toEqual([204, 404, 404, 404]);
        expect(await active(talk, reviewerId), `round ${round}`).toEqual([]);
      }
      // Twelve releases, twelve records of them, and no assignment left.
      expect(
        await pg.db
          .select()
          .from(assignmentReleases)
          .where(
            and(
              eq(assignmentReleases.submissionId, talk),
              eq(assignmentReleases.reviewerId, reviewerId),
            ),
          ),
      ).toHaveLength(12);
      // One audit row for each assignment made and each release: twelve of each.
      const rows = (await audited(pg, p.conferenceId)).filter(
        (r) => (r.details as { reviewerId: string }).reviewerId === reviewerId,
      );
      expect(rows.map((r) => r.action)).toEqual(
        Array.from({ length: 12 }, () => ["assignment.made", "assignment.released"]).flat(),
      );
    }, 120_000);

    it("two chairs assigning different reviewers to one proposal at once: both are assigned", async () => {
      const talk = talks[1] as string;
      const results = await Promise.all(
        chairs.map((c, i) => assign(p, { cookie: c.cookie }, talk, reviewers[1 + i] as string)),
      );
      expect(results.map((r) => r.status)).toEqual([204, 204, 204, 204]);
      expect(await rowsOf(pg, talk)).toHaveLength(4);
      for (const [i, c] of chairs.entries()) {
        expect(
          (await release(p, { cookie: c.cookie }, talk, reviewers[1 + i] as string)).status,
        ).toBe(204);
      }
    }, 60_000);

    it("a reviewer's role removed while a chair assigns them: never an active assignment for someone who is not a reviewer", async () => {
      const talk = talks[2] as string;
      const reviewerId = reviewers[5] as string;
      const outcomes: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        await reviewer(p, address("reviewer-5"), [POOL_A]);
        // Now one first, now the other, a moment apart or none.
        const pause = () => new Promise((r) => setTimeout(r, i % 3));
        const assigning = () => assign(p, { cookie: chairs[0]?.cookie }, talk, reviewerId);
        // The removal names the number of proposals the chair's page showed: none. When the
        // assignment got in first, that is no longer the number, and nothing is removed.
        const both =
          i % 2 === 0
            ? (async () => {
                const a = assigning();
                await pause();
                return [await a, await removing(chairs[1]?.cookie ?? "", reviewerId, 0)] as const;
              })()
            : (async () => {
                const r = removing(chairs[1]?.cookie ?? "", reviewerId, 0);
                await pause();
                const a = assigning();
                return [await a, await r] as const;
              })();
        const done = await within(both, 20_000);
        if (done === "waiting") throw new Error(`round ${i}: still waiting: a deadlock`);
        const [assigned, removed] = done;
        const key = `${assigned.status}/${removed.status}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
        expect(["204/409", "409/204"], `round ${i}`).toContain(key);
        if (key === "204/409") {
          // Assigned first: the removal found one proposal where its page showed none.
          expect(removed.json, `round ${i}`).toEqual({ error: "stale", assignments: 1 });
          expect(await isReviewer(reviewerId), `round ${i}`).toBe(true);
          expect(await active(talk, reviewerId), `round ${i}`).toHaveLength(1);
          // Confirmed with the number as it is, the removal releases it.
          expect((await removing(chairs[1]?.cookie ?? "", reviewerId, 1)).status).toBe(204);
        } else {
          // Removed first: there was no reviewer left to assign.
          expect(assigned.json, `round ${i}`).toEqual({ error: "not_offered" });
        }
        // Either way: not a reviewer any more, and no active assignment.
        expect(await isReviewer(reviewerId), `round ${i}`).toBe(false);
        expect(await active(talk, reviewerId), `round ${i}`).toEqual([]);
      }
      // Both things happened among the thirty: the race was a race.
      expect(Object.keys(outcomes).sort(), JSON.stringify(outcomes)).toEqual([
        "204/409",
        "409/204",
      ]);
    }, 180_000);

    it("a removal that is under way keeps an assignment waiting, which then finds no reviewer", async () => {
      const talk = talks[2] as string;
      const reviewerId = reviewers[6] as string;
      for (let i = 0; i < 4; i++) {
        await reviewer(p, address("reviewer-6"), [POOL_A]);
        // The removal is stopped at the role's row, which this test holds: it has the roles
        // lock, exclusive, and has not committed, so the reviewer still reads as one.
        const holder = hold((tx) =>
          tx
            .select()
            .from(conferenceRoles)
            .where(
              and(
                eq(conferenceRoles.conferenceId, p.conferenceId),
                eq(conferenceRoles.personId, reviewerId),
              ),
            )
            .for("update"),
        );
        await holder.ready;
        const removal = removing(chairs[1]?.cookie ?? "", reviewerId, 0);
        let released = false;
        try {
          expect(await within(removal, 300), `round ${i}: the removal`).toBe("waiting");
          const assigning = assign(p, { cookie: chairs[0]?.cookie }, talk, reviewerId);
          // The route's own check lets it in; inside, it waits for the removal.
          expect(await within(assigning, 500), `round ${i}: the assignment`).toBe("waiting");
          await holder.release();
          released = true;
          expect((await removal).status, `round ${i}`).toBe(204);
          const refused = await assigning;
          expect(refused.status, `round ${i}`).toBe(409);
          expect(refused.json, `round ${i}`).toEqual({ error: "not_offered" });
        } finally {
          if (!released) await holder.release();
        }
        expect(await active(talk, reviewerId), `round ${i}`).toEqual([]);
      }
    }, 120_000);

    it("a removal that releases a reviewer from a proposal while another is being assigned to it: both finish", async () => {
      // The removal writes the record of each release under the roles lock, and the record
      // points to the proposal: the database checks that with a lock of its own on the
      // proposal's row. An assignment holds that row and then waits for the roles lock. Were its
      // lock on the row "for update", the two would wait for each other.
      const talk = talks[3] as string;
      const leaving = reviewers[6] as string;
      const arriving = reviewers[4] as string;
      for (let i = 0; i < 4; i++) {
        await reviewer(p, address("reviewer-6"), [POOL_A]);
        expect((await assign(p, { cookie: chairs[0]?.cookie }, talk, leaving)).status).toBe(204);
        // The removal is stopped at the assignment it is about to release, whose row this test
        // holds: it has the roles lock, exclusive, and has written no record yet.
        const holder = hold((tx) =>
          tx
            .select()
            .from(assignments)
            .where(and(eq(assignments.submissionId, talk), eq(assignments.reviewerId, leaving)))
            .for("update"),
        );
        await holder.ready;
        const removal = removing(chairs[1]?.cookie ?? "", leaving, 1);
        let released = false;
        try {
          expect(await within(removal, 300), `round ${i}: the removal`).toBe("waiting");
          // The assignment takes the proposal's row, and waits for the roles lock.
          const assigning = assign(p, { cookie: chairs[0]?.cookie }, talk, arriving);
          expect(await within(assigning, 500), `round ${i}: the assignment`).toBe("waiting");
          await holder.release();
          released = true;
          const done = await within(Promise.all([removal, assigning]), 10_000);
          if (done === "waiting") throw new Error(`round ${i}: still waiting: a deadlock`);
          expect(
            done.map((r) => r.status),
            `round ${i}`,
          ).toEqual([204, 204]);
        } finally {
          if (!released) await holder.release();
        }
        expect(await active(talk, leaving), `round ${i}`).toEqual([]);
        expect(await active(talk, arriving), `round ${i}`).toHaveLength(1);
        expect((await release(p, { cookie: chairs[0]?.cookie }, talk, arriving)).status).toBe(204);
      }
    }, 120_000);

    it("an assignment begun first commits, and the removal waits for it and then releases it", async () => {
      const talk = talks[2] as string;
      const reviewerId = reviewers[7] as string;
      for (let i = 0; i < 4; i++) {
        await reviewer(p, address("reviewer-7"), [POOL_A]);
        // The assignment is stopped at the conference's row, which this test holds as a
        // settings save would: it has the proposal's row and the roles lock, shared.
        const holder = hold((tx) => lockConference(tx, p.conferenceId));
        await holder.ready;
        const assigning = assign(p, { cookie: chairs[0]?.cookie }, talk, reviewerId);
        let released = false;
        try {
          expect(await within(assigning, 300), `round ${i}: the assignment`).toBe("waiting");
          // The removal confirms the one proposal it will find: it cannot commit before the
          // assignment does, because it waits for the roles lock.
          const removal = removing(chairs[1]?.cookie ?? "", reviewerId, 1);
          expect(await within(removal, 500), `round ${i}: the removal`).toBe("waiting");
          await holder.release();
          released = true;
          expect((await assigning).status, `round ${i}`).toBe(204);
          expect((await removal).status, `round ${i}`).toBe(204);
        } finally {
          if (!released) await holder.release();
        }
        expect(await isReviewer(reviewerId), `round ${i}`).toBe(false);
        expect(await active(talk, reviewerId), `round ${i}`).toEqual([]);
        const [record] = await pg.db
          .select()
          .from(assignmentReleases)
          .where(
            and(
              eq(assignmentReleases.submissionId, talk),
              eq(assignmentReleases.reviewerId, reviewerId),
            ),
          )
          .orderBy(desc(assignmentReleases.releasedAt));
        expect(record?.reason, `round ${i}`).toBe("role_removed");
      }
    }, 120_000);

    it("an assignment and a save that would show names wait for each other: the save never misses one", async () => {
      // The save shows the first pool's reviewers who wrote what they review: it is taken while
      // no proposal of the pool has had a reviewer, and refused once one has. Each round starts
      // from a conference of its own, where none has.
      for (let i = 0; i < 3; i++) {
        const q = await world(pg, `assign-pg-guard-${run}-${i}`);
        await grantRole(pg.db, {
          conferenceId: q.conferenceId,
          personId: chairs[0]?.id ?? "",
          role: "chair",
        });
        const reviewerId = await reviewer(q, address("reviewer-0"), [POOL_A]);
        const talk = await proposal(q, owner, `A guarded talk ${i}`);
        await closeCall(q);
        const got = (
          await call(pg.public, "GET", `/api/conferences/${q.slug}/settings`, {
            cookie: chairs[0]?.cookie,
          })
        ).json as { config: ConferenceConfig; token: string };
        const config = structuredClone(got.config);
        const pool = config.reviewPools.find((x) => x.key === POOL_A);
        if (pool) pool.blindMode = "single";
        const save = () =>
          call(pg.public, "PUT", `/api/conferences/${q.slug}/config`, {
            cookie: chairs[0]?.cookie,
            ifMatch: got.token,
            body: config,
          });

        if (i === 0) {
          // The assignment in flight: stopped after its write and before its commit, holding
          // what it holds there. The save waits for it, then sees it, and is refused.
          const assigning = hold(async (tx) => {
            await tx.select().from(submissions).where(eq(submissions.id, talk)).for("update");
            await shareConference(tx, q.conferenceId);
            await tx
              .insert(assignments)
              .values({ conferenceId: q.conferenceId, reviewerId, submissionId: talk });
          });
          await assigning.ready;
          const saving = save();
          try {
            expect(await within(saving, 700)).toBe("waiting");
          } finally {
            await assigning.release();
          }
          const saved = await saving;
          expect(saved.status).toBe(409);
          expect(saved.json.error).toBe("reviewers_assigned");
        } else if (i === 1) {
          // The save in flight: while it holds the conference's row, the assignment waits. The
          // save went first and found no reviewer, so it is taken; the assignment is made
          // afterwards, under the mode the save left.
          const saving = hold((tx) => lockConference(tx, q.conferenceId));
          await saving.ready;
          const assigning = assign(q, { cookie: chairs[0]?.cookie }, talk, reviewerId);
          try {
            expect(await within(assigning, 500)).toBe("waiting");
            expect(await rowsOf(pg, talk)).toEqual([]);
          } finally {
            await saving.release();
          }
          expect((await assigning).status).toBe(204);
        } else {
          // Let loose on each other: whichever commits first, the two never both succeed with
          // the save having missed the assignment.
          const [saved, assigned] = await Promise.all([
            save(),
            assign(q, { cookie: chairs[0]?.cookie }, talk, reviewerId),
          ]);
          expect(assigned.status).toBe(204);
          expect([200, 409]).toContain(saved.status);
          const stored = await getConference(pg.db, q.slug);
          const mode = stored?.config.reviewPools.find((x) => x.key === POOL_A)?.blindMode;
          const first = (
            await pg.db
              .select()
              .from(auditLog)
              .where(eq(auditLog.conferenceId, q.conferenceId))
              .orderBy(auditLog.id)
          )
            .map((r) => r.action)
            .filter((a) => a === "assignment.made" || a === "conference.config_updated");
          if (saved.status === 200) {
            // It was saved before the assignment was made, and not after.
            expect(first).toEqual(["conference.config_updated", "assignment.made"]);
            expect(mode).toBe("single");
          } else {
            expect(saved.json.error).toBe("reviewers_assigned");
            expect(first).toEqual(["assignment.made"]);
            expect(mode).toBe("double");
          }
        }
      }
    }, 180_000);

    it("assignments, releases, removals, saves, phase moves and an owner's edits all at once: everything finishes", async () => {
      // One lock order everywhere (services/roles.ts): whatever runs beside whatever, nothing
      // waits for the one that waits for it. A deadlock would end a request with an error.
      const q = await world(pg, `assign-pg-busy-${run}`);
      for (const chair of chairs) {
        await grantRole(pg.db, { conferenceId: q.conferenceId, personId: chair.id, role: "chair" });
      }
      const draftTalk = await proposal(q, owner, "A talk still being written", { draft: true });
      const busy: string[] = [];
      for (let i = 0; i < 3; i++) busy.push(await proposal(q, owner, `A busy talk ${i}`));
      const on = (rest: string) => `/api/conferences/${q.slug}/${rest}`;
      const moving = (cookie: string, to: string) =>
        call(pg.public, "PUT", on("phase"), {
          cookie,
          body: { phase: to, force: true, reason: "Busy" },
        });
      for (let round = 0; round < 4; round++) {
        const mine: string[] = [];
        for (let i = 0; i < 6; i++)
          mine.push(await reviewer(q, address(`reviewer-${i}`), [POOL_A]));
        // The call is open, by its phase and its dates, at the start of each round: the owner
        // can write. Reviewers can be assigned only once it has closed, which a phase move does.
        await moving(chairs[0]?.cookie ?? "", "cfp_open");
        const current = await call(pg.public, "GET", `/api/submissions/${draftTalk}`, {
          cookie: owner,
        });
        const got = (await call(pg.public, "GET", on("settings"), { cookie: chairs[0]?.cookie }))
          .json as { config: ConferenceConfig; token: string };
        const saving = (cookie: string, host: string) => {
          const config = structuredClone(got.config);
          config.host = host;
          return call(pg.public, "PUT", on("config"), { cookie, ifMatch: got.token, body: config });
        };
        const requests: Promise<{ status: number }>[] = [];
        for (const [i, chair] of chairs.entries()) {
          requests.push(
            moving(chair.cookie, i % 2 ? "reviewing" : "deciding"),
            saving(chair.cookie, `Universidad Inventada ${round}.${i}`),
          );
          for (const [j, talk] of busy.entries()) {
            const who = mine[(i + j) % mine.length] as string;
            requests.push(
              assign(q, { cookie: chair.cookie }, talk, who, { confirmedFull: true }),
              release(q, { cookie: chair.cookie }, talk, mine[(i + j + 1) % mine.length] as string),
            );
          }
          requests.push(
            call(pg.public, "DELETE", on(`people/${mine[i] as string}/roles/reviewer`), {
              cookie: chair.cookie,
              body: { assignments: 0 },
            }),
            call(pg.public, "PATCH", `/api/submissions/${draftTalk}`, {
              cookie: owner,
              body: { version: current.json.version, title: `A busier talk ${round}.${i}` },
            }),
          );
        }
        const all = await within(Promise.all(requests), 30_000);
        if (all === "waiting") throw new Error(`round ${round}: still waiting: a deadlock`);
        // Each was done, or refused for a reason of its own (not offered, not there, a stale
        // number or version, a closed or an open call). A deadlock would be a 500.
        expect(
          all.map((r) => r.status).filter((x) => x >= 500),
          `round ${round}`,
        ).toEqual([]);
        // Whatever happened, nobody who is not a reviewer has an active assignment.
        const left = await pg.db
          .select({ reviewerId: assignments.reviewerId })
          .from(assignments)
          .where(eq(assignments.conferenceId, q.conferenceId));
        const roles = await pg.db
          .select({ personId: conferenceRoles.personId })
          .from(conferenceRoles)
          .where(
            and(
              eq(conferenceRoles.conferenceId, q.conferenceId),
              eq(conferenceRoles.role, "reviewer"),
            ),
          );
        const holders = new Set(roles.map((r) => r.personId));
        expect(
          left.filter((a) => !holders.has(a.reviewerId)),
          `round ${round}`,
        ).toEqual([]);
        // And no reviewer is on a proposal twice.
        const pairs = await pg.db
          .select()
          .from(assignments)
          .where(eq(assignments.conferenceId, q.conferenceId));
        expect(new Set(pairs.map((a) => `${a.reviewerId}:${a.submissionId}`)).size).toBe(
          pairs.length,
        );
      }
    }, 240_000);
  },
);
