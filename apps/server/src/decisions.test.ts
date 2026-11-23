import { findLeaks } from "@elochair/policy/testing";
import type { ConferenceConfig } from "@elochair/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "./context";
import type { Db } from "./db/client";
import {
  auditLog,
  conferenceRoles,
  conflicts,
  contributions,
  decisions,
  outbox,
  reviewerProfiles,
  reviews,
  submissions,
} from "./db/schema";
import { fixtureCall, seedDecisionsRoom, seedTestCall } from "./fixtures";
import type { MemoryTransport } from "./mail";
import { RateLimiter } from "./ratelimit";
import {
  createApiToken,
  findOrCreatePerson,
  getConference,
  grantRole,
  saveConference,
  shareConference,
} from "./repo";
import { lockRoles } from "./services/roles";
import { call, makeTestApp, ORIGIN, personId, signIn, type TestApp } from "./testkit";

/*
 * Decisions (spec 03, §1.6): a chair records accept, waitlist or reject for a proposal, which
 * tells nobody and can be changed or taken back; the chairs send the decisions in a step of
 * its own, which gives each proposal its status and writes to its authors with the reviewers'
 * comments; and what nobody may learn of any of it before, or ever. The last part runs only
 * against a real Postgres, and shows what holds when requests arrive at the same moment.
 */

const NOW = new Date("2027-02-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const SLUG = "decide-call";
const EARLY = "decide-early";
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
const [POOL_A, POOL_B] = fixtureCall.reviewPools.map((p) => p.key) as [string, string];
const CRITERIA_A = fixtureCall.reviewPools[0]?.criteria.map((c) => c.key) ?? [];
const CRITERIA_B = fixtureCall.reviewPools[1]?.criteria.map((c) => c.key) ?? [];
const NEEDED_A = fixtureCall.reviewPools[0]?.reviewsPerSubmission ?? 0;
const words = (n: number, word = "verse") => Array.from({ length: n }, () => word).join(" ");

type Who = { cookie?: string; token?: string };
type World = {
  t: TestApp;
  slug: string;
  conferenceId: string;
  person: (email: string, name?: string, languages?: string[]) => Promise<string>;
  id: (email: string) => Promise<string>;
};

/** Everything a person typed in these tests: none of it may reach the audit log. */
const secrets: string[] = [];
/** What a reviewer wrote for the authors: it reaches them once the decisions are sent. */
const forAuthors = (what: string) => {
  const marked = `COMMENTS-FOR-AUTHORS ${what}`;
  secrets.push(marked);
  return marked;
};
/** What a reviewer wrote for the chairs only: it never reaches an author. */
const forChairs = (what: string) => {
  const marked = `NOTE-FOR-CHAIRS ${what}`;
  secrets.push(marked);
  return marked;
};

async function world(t: TestApp, slug: string): Promise<World> {
  const { conferenceId } = await seedTestCall(t.db, { slug, now: NOW });
  const person = async (email: string, name?: string, languages = ["en"]) => {
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
          languages,
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

/** Give someone the reviewer's role for these pools, as if they had accepted an invitation. */
async function reviewer(w: World, email: string, pools: string[]) {
  const id = await w.id(email);
  await grantRole(w.t.db, {
    conferenceId: w.conferenceId,
    personId: id,
    role: "reviewer",
    scope: pools,
  });
  const said = { maxLoad: 8, languages: ["en"] };
  await w.t.db
    .insert(reviewerProfiles)
    .values({ conferenceId: w.conferenceId, personId: id, pools, ...said })
    .onConflictDoUpdate({
      target: [reviewerProfiles.conferenceId, reviewerProfiles.personId],
      set: said,
    });
  return id;
}

type Sub = { id: string; version: number };

/** A draft by `owner`, filled in: a talk unless told otherwise. */
async function draft(
  w: World,
  owner: string,
  title: string,
  type: "talk" | "performance" = "talk",
): Promise<Sub> {
  secrets.push(title);
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
  return filled.json;
}

async function submit(w: World, owner: string, id: string): Promise<string> {
  const now = await call(w.t.public, "GET", `/api/submissions/${id}`, { cookie: owner });
  const res = await call(w.t.public, "POST", `/api/submissions/${id}/submit`, {
    cookie: owner,
    body: { version: now.json.version, acceptedAgreements: AGREEMENTS },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return id;
}

/** A proposal by `owner`, filled in and submitted. */
const proposal = async (
  w: World,
  owner: string,
  title: string,
  type: "talk" | "performance" = "talk",
) => submit(w, owner, (await draft(w, owner, title, type)).id);

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
  `/api/conferences/${typeof w === "string" ? w : w.slug}${rest}`;
const assign = (w: World, chair: string, id: string, reviewerId: string) =>
  call(w.t.public, "POST", at(w, `/assignments/submissions/${id}/reviewers`), {
    cookie: chair,
    body: { reviewerId, confirmedFull: true },
  });
const unassign = (w: World, chair: string, id: string, reviewerId: string) =>
  call(w.t.public, "DELETE", at(w, `/assignments/submissions/${id}/reviewers/${reviewerId}`), {
    cookie: chair,
    body: {},
  });
const movePhase = (w: World, chair: string, phase: string, from: string, back = false) =>
  call(w.t.public, "PUT", at(w, "/phase"), {
    cookie: chair,
    body: { phase, from, ...(back ? { force: true, reason: "A test puts it back" } : {}) },
  });

type Recommendation = "accept" | "unsure" | "reject";
/** A review that can be sent: every criterion scored, comments, a note, a recommendation. */
const complete = (
  criteria: string[],
  comments: string,
  chairNote: string,
  recommendation: Recommendation,
  score = 4,
) => ({
  scores: Object.fromEntries(criteria.map((key) => [key, score])),
  comments,
  chairNote,
  recommendation,
});
const sendReview = (t: TestApp, who: Who, id: string, content: ReturnType<typeof complete>) =>
  call(t.public, "PUT", `/api/submissions/${id}/review`, {
    ...who,
    body: { version: 0, send: true, ...content },
  });

const record = (w: World, who: Who, id: string, outcome: unknown, app = w.t.public) =>
  call(app, "PUT", at(w, `/decisions/submissions/${id}`), { ...who, body: { outcome } });
const takeBack = (w: World, who: Who, id: string, app = w.t.public) =>
  call(app, "DELETE", at(w, `/decisions/submissions/${id}`), { ...who, body: {} });
const section = (w: World, who: Who, id: string, app = w.t.public) =>
  call(app, "GET", at(w, `/decisions/submissions/${id}`), who);
const page = (w: World, who: Who, query = "", app = w.t.public) =>
  call(app, "GET", at(w, `/decisions${query}`), who);
const confirmation = (w: World, who: Who, app = w.t.public) =>
  call(app, "GET", at(w, "/decisions/send"), who);
const send = (w: World, who: Who, token: unknown, app = w.t.public) =>
  call(app, "POST", at(w, "/decisions/send"), { ...who, body: { token } });
/** Ask for the confirmation, and send what it says. */
async function sendNow(w: World, chair: string) {
  const asked = await confirmation(w, { cookie: chair });
  expect(asked.status).toBe(200);
  return send(w, { cookie: chair }, asked.json.token);
}
const authorView = (t: TestApp, who: Who, id: string, app = t.public) =>
  call(app, "GET", `/api/submissions/${id}/decision`, who);

const decisionRows = (t: TestApp, submissionId: string) =>
  t.db
    .select()
    .from(decisions)
    .where(eq(decisions.submissionId, submissionId))
    .orderBy(decisions.decidedAt, decisions.id);
const statusOf = async (t: TestApp, id: string) =>
  (await t.db.select().from(submissions).where(eq(submissions.id, id)))[0]?.status;
const audited = async (t: TestApp, conferenceId: string, since = 0) =>
  (
    await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.conferenceId, conferenceId), like(auditLog.action, "decision.%")))
      .orderBy(auditLog.id)
  )
    .slice(since)
    .map((r) => ({
      action: r.action,
      actor: r.actorPersonId,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.details,
    }));
/** Every email delivered to an address so far (the outbox is delivered first), by its kind. */
async function mailTo(t: TestApp, email: string) {
  await call(t.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return (t.deps.mail as MemoryTransport).sent.filter((m) => m.to === email);
}
const decisionMail = async (t: TestApp, email: string) =>
  (await mailTo(t, email)).filter((m) => m.kind?.startsWith("decision_"));

/** RFC 4180 rows of a CSV answer, as objects keyed by header. */
async function csv(t: TestApp, path: string, who: Who, app = t.public) {
  const headers: Record<string, string> = {};
  if (who.cookie) headers.cookie = who.cookie;
  if (who.token) headers.authorization = `Bearer ${who.token}`;
  const res = await app.request(path, { headers });
  expect(res.status).toBe(200);
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const rows = text
    .trimEnd()
    .split("\r\n")
    .map((line) =>
      Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), (m) =>
        (m[1] ?? "").replace(/""/g, '"'),
      ),
    );
  const [header, ...body] = rows;
  return {
    header: header ?? [],
    rows: body.map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ""]))),
    text,
  };
}

/** A real MCP client whose HTTP requests go straight into the in-process app. */
async function connect(app: Hono<AppEnv>, token: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://local/api/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.request(String(input), init as RequestInit),
  });
  await client.connect(transport);
  return client;
}

let t: TestApp;
let w: World;
let early: World;
const cookies = {} as Record<
  | "chair"
  | "second"
  | "authorChair"
  | "conflictedChair"
  | "track"
  | "owner"
  | "coauthor"
  | "invitee"
  | "stranger"
  | "r1"
  | "r2"
  | "released"
  | "other",
  string
>;
const ids = {} as Record<keyof typeof cookies, string>;
const mail = (who: string) => `decide-${who.toLowerCase()}@example.org`;
/** Proposals of the conference, by what they are for. */
const subs = {} as Record<
  | "main"
  | "second"
  | "third"
  | "unreviewed"
  | "own"
  | "conflicted"
  | "performance"
  | "withdrawn"
  | "leaves"
  | "aDraft"
  | "beside",
  string
>;
let earlyTalk: string;
let agentM: string;
let agentC: string;
/** What the reviewers of the main talk wrote, by reviewer. */
const wrote = {
  r1: { comments: forAuthors("first reviewer"), note: forChairs("first reviewer") },
  r2: {
    comments: `${forAuthors("second reviewer")}\n\nA second paragraph.`,
    note: forChairs("second reviewer"),
  },
};

/** What was answered, without the addresses that were asked for (they name the proposal). */
const answers = (all: { json: unknown }[]) => all.map((x) => x.json);

/** Everything `who` can read about a proposal and about the conference's decisions. */
async function everything(who: Who, id: string, app: Hono<AppEnv> = t.public) {
  const get = async (path: string) => {
    const res = await call(app, "GET", path, who);
    return { path, status: res.status, json: res.json };
  };
  return Promise.all(
    [
      `/api/submissions/${id}`,
      `/api/submissions/${id}/decision`,
      `/api/submissions/${id}/review`,
      `/api/submissions/${id}/check`,
      "/api/me/submissions",
      "/api/me/reviews",
      at(w, "/submissions?status=submitted,accepted,waitlisted,rejected,withdrawn"),
      at(w, "/overview"),
      at(w, "/cap-report"),
      at(w, "/assignments"),
      at(w, `/assignments/submissions/${id}`),
      at(w, "/decisions"),
      at(w, `/decisions/submissions/${id}`),
      at(w, "/submissions.csv"),
    ].map(get),
  );
}

beforeAll(async () => {
  t = await makeTestApp();
  lifted(t);
  w = await world(t, SLUG);
  early = await world(t, EARLY);

  const names: Record<keyof typeof cookies, string> = {
    chair: "Cora Chairperson",
    second: "Selma Secondchair",
    authorChair: "Aura Authorchair",
    conflictedChair: "Cleo Conflictedchair",
    track: "Tariq Trackchair",
    owner: "Olga Ownerperson",
    coauthor: "Carlos Coautor",
    invitee: "Ines Invitee",
    stranger: "Stella Stranger",
    r1: "Rhea Reviewerone",
    r2: "Rolf Reviewertwo",
    released: "Rudi Released",
    other: "Otto Otherpool",
  };
  for (const who of Object.keys(names) as (keyof typeof cookies)[]) {
    // The co-author reads Spanish: their email comes in it.
    cookies[who] = await w.person(mail(who), names[who], who === "coauthor" ? ["es"] : ["en"]);
    ids[who] = await w.id(mail(who));
  }
  for (const to of [w, early]) {
    await grantRole(t.db, { conferenceId: to.conferenceId, personId: ids.chair, role: "chair" });
  }
  for (const who of ["second", "authorChair", "conflictedChair"] as const) {
    await grantRole(t.db, { conferenceId: w.conferenceId, personId: ids[who], role: "chair" });
  }
  await grantRole(t.db, { conferenceId: w.conferenceId, personId: ids.track, role: "track_chair" });
  for (const who of ["r1", "r2", "released"] as const) await reviewer(w, mail(who), [POOL_A]);
  await reviewer(w, mail("other"), [POOL_B]);

  // The main talk has an owner, a co-author who confirmed, and someone invited who has not.
  const main = await draft(w, cookies.owner, "The main talk");
  let invited = await call(t.public, "POST", `/api/submissions/${main.id}/contributors`, {
    cookie: cookies.owner,
    body: {
      version: main.version,
      email: mail("coauthor"),
      name: "Typed Coauthor",
      role: "coauthor",
      lang: "es",
    },
  });
  expect(invited.status, JSON.stringify(invited.json)).toBe(201);
  invited = await call(t.public, "POST", `/api/submissions/${main.id}/contributors`, {
    cookie: cookies.owner,
    body: {
      version: invited.json.version,
      email: mail("invitee"),
      name: "Typed Invitee",
      role: "coauthor",
      lang: "en",
    },
  });
  expect(invited.status, JSON.stringify(invited.json)).toBe(201);
  const joined = await call(t.public, "POST", `/api/me/invitations/${main.id}/answer`, {
    cookie: cookies.coauthor,
    body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
  });
  expect(joined.json).toEqual({ answer: "confirmed" });
  subs.main = await submit(w, cookies.owner, main.id);

  subs.second = await proposal(w, cookies.owner, "A second talk");
  subs.third = await proposal(w, cookies.owner, "A third talk");
  subs.unreviewed = await proposal(w, cookies.stranger, "A talk nobody reviewed");
  subs.own = await proposal(w, cookies.authorChair, "A chair's own talk");
  subs.conflicted = await proposal(w, cookies.owner, "A talk a chair has a conflict with");
  subs.performance = await proposal(w, cookies.owner, "A performance", "performance");
  subs.withdrawn = await proposal(w, cookies.owner, "A talk that will be withdrawn");
  // A talk with a co-author who will leave it.
  const leaves = await draft(w, cookies.owner, "A talk someone leaves");
  const asked = await call(t.public, "POST", `/api/submissions/${leaves.id}/contributors`, {
    cookie: cookies.owner,
    body: {
      version: leaves.version,
      email: mail("coauthor"),
      name: "Typed Coauthor",
      role: "coauthor",
      lang: "es",
    },
  });
  expect(asked.status, JSON.stringify(asked.json)).toBe(201);
  expect(
    (
      await call(t.public, "POST", `/api/me/invitations/${leaves.id}/answer`, {
        cookie: cookies.coauthor,
        body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
      })
    ).json,
  ).toEqual({ answer: "confirmed" });
  subs.leaves = await submit(w, cookies.owner, leaves.id);
  subs.aDraft = (await draft(w, cookies.owner, "A draft that stays one")).id;
  earlyTalk = await proposal(early, cookies.owner, "A talk before the review");
  // The clock of these tests stands still: the proposals are given the times they would have
  // had, a minute apart in the order they were made, which is the order the pages list them in.
  for (const [i, id] of Object.values(subs).entries()) {
    await t.db
      .update(submissions)
      .set({ createdAt: new Date(NOW.getTime() - HOUR + i * 60_000) })
      .where(eq(submissions.id, id));
  }
  await t.db.insert(conflicts).values({
    conferenceId: w.conferenceId,
    personId: ids.conflictedChair,
    submissionId: subs.conflicted,
    kind: "declared",
    declaredBy: "chair",
  });

  for (const to of [w, early]) await closeCall(to);
  const give = async (id: string, who: (keyof typeof cookies)[]) => {
    for (const r of who) {
      const res = await assign(w, cookies.chair, id, ids[r]);
      expect(res.status, `${id} ${r} ${JSON.stringify(res.json)}`).toBe(204);
    }
  };
  await give(subs.main, ["r1", "r2", "released"]);
  await give(subs.second, ["r1"]);
  await give(subs.third, ["r2"]);
  await give(subs.own, ["r2"]);
  await give(subs.conflicted, ["r1"]);
  await give(subs.performance, ["other"]);
  await give(subs.withdrawn, ["r1"]);
  expect((await movePhase(w, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
  // One reviewer of the main talk is taken off it again: a stranger to it from then on.
  expect((await unassign(w, cookies.chair, subs.main, ids.released)).status).toBe(204);

  const reviewed: [keyof typeof cookies, string, string, string, Recommendation][] = [
    ["r1", subs.main, wrote.r1.comments, wrote.r1.note, "accept"],
    ["r2", subs.main, wrote.r2.comments, wrote.r2.note, "unsure"],
    [
      "r1",
      subs.second,
      forAuthors("of the second talk"),
      forChairs("of the second talk"),
      "reject",
    ],
    ["r2", subs.third, forAuthors("of the third talk"), "", "unsure"],
    [
      "r2",
      subs.own,
      forAuthors("of a chair's own talk"),
      forChairs("of a chair's own talk"),
      "accept",
    ],
    ["r1", subs.conflicted, forAuthors("of the conflicted talk"), "", "reject"],
    ["r1", subs.withdrawn, forAuthors("of the withdrawn talk"), "", "accept"],
  ];
  for (const [who, id, comments, note, recommendation] of reviewed) {
    const res = await sendReview(
      t,
      { cookie: cookies[who] },
      id,
      complete(CRITERIA_A, comments, note, recommendation),
    );
    expect(res.status, `${who} ${JSON.stringify(res.json)}`).toBe(200);
  }
  expect(
    (
      await sendReview(
        t,
        { cookie: cookies.other },
        subs.performance,
        complete(CRITERIA_B, forAuthors("of the performance"), "", "accept"),
      )
    ).status,
  ).toBe(200);

  for (const [tier, set] of [
    ["M", (token: string) => (agentM = token)],
    ["C", (token: string) => (agentC = token)],
  ] as const) {
    set(
      (
        await createApiToken(t.db, {
          personId: ids.chair,
          conferenceId: w.conferenceId,
          tier,
          name: tier,
        })
      ).token,
    );
  }
}, 240_000);
afterAll(() => t.close());

describe("recording a decision", () => {
  it("a chair who manages the proposal records one, changes it and takes it back, and each is audited with ids and the outcome", async () => {
    const since = (await audited(t, w.conferenceId)).length;
    const before = await section(w, { cookie: cookies.chair }, subs.main);
    expect(before.status).toBe(200);
    expect(before.json).toEqual({
      view: "proposal_decision",
      submissionId: subs.main,
      takes: "yes",
      outcomes: ["accepted", "waitlisted", "rejected"],
      recorded: null,
      told: null,
      reviews: {
        sent: 2,
        asked: NEEDED_A,
        recommendations: { accept: 1, unsure: 1, reject: 0 },
      },
      canSend: false,
    });

    expect((await record(w, { cookie: cookies.chair }, subs.main, "rejected")).status).toBe(204);
    const [first] = await decisionRows(t, subs.main);
    expect(first).toMatchObject({
      conferenceId: w.conferenceId,
      outcome: "rejected",
      decidedByPersonId: ids.chair,
      sentAt: null,
      sentByPersonId: null,
      comments: null,
    });
    expect((await section(w, { cookie: cookies.chair }, subs.main)).json.recorded).toEqual({
      outcome: "rejected",
      at: NOW.toISOString(),
    });

    // Another chair changes it: one decision for the proposal, with the new outcome.
    expect((await record(w, { cookie: cookies.second }, subs.main, "accepted")).status).toBe(204);
    const rows = await decisionRows(t, subs.main);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first?.id,
      outcome: "accepted",
      decidedByPersonId: ids.second,
    });
    // Recording what is recorded already changes nothing, and is not audited again.
    expect((await record(w, { cookie: cookies.chair }, subs.main, "accepted")).status).toBe(204);
    expect((await decisionRows(t, subs.main))[0]?.decidedByPersonId).toBe(ids.second);

    expect((await takeBack(w, { cookie: cookies.chair }, subs.main)).status).toBe(204);
    expect(await decisionRows(t, subs.main)).toEqual([]);
    expect((await section(w, { cookie: cookies.chair }, subs.main)).json.recorded).toBeNull();
    // Nothing is left to take back.
    const again = await takeBack(w, { cookie: cookies.chair }, subs.main);
    expect([again.status, again.json]).toEqual([409, { error: "no_decision" }]);

    const target = { targetType: "submission", targetId: subs.main };
    expect(await audited(t, w.conferenceId, since)).toEqual([
      {
        action: "decision.recorded",
        actor: ids.chair,
        ...target,
        details: { decisionId: first?.id, outcome: "rejected" },
      },
      {
        action: "decision.changed",
        actor: ids.second,
        ...target,
        details: { decisionId: first?.id, outcome: "accepted" },
      },
      {
        action: "decision.taken_back",
        actor: ids.chair,
        ...target,
        details: { decisionId: first?.id, outcome: "accepted" },
      },
    ]);
  });

  it("is for a chair of the conference, in person: everyone else is refused, and writes nothing", async () => {
    const before = (await t.db.select().from(decisions)).length;
    const others = [
      "track",
      "owner",
      "coauthor",
      "invitee",
      "stranger",
      "r1",
      "released",
      "other",
    ] as const;
    const tries = (who: Who, app = t.public) => [
      section(w, who, subs.main, app),
      record(w, who, subs.main, "accepted", app),
      takeBack(w, who, subs.main, app),
      page(w, who, "", app),
      confirmation(w, who, app),
      send(w, who, "0".repeat(32), app),
    ];
    for (const who of others) {
      for (const res of await Promise.all(tries({ cookie: cookies[who] }))) {
        expect([res.status, res.json], who).toEqual([403, { error: "forbidden" }]);
      }
    }
    // The public, and a chair's agents of either tier, on either listener.
    const nobody: [string, Who, TestApp["public"]][] = [
      ["the public", {}, t.public],
      ["tier M", { token: agentM }, t.public],
      ["tier C, public listener", { token: agentC }, t.public],
      ["tier C, internal listener", { token: agentC }, t.internal],
      ["tier M, internal listener", { token: agentM }, t.internal],
    ];
    for (const [what, who, app] of nobody) {
      for (const res of await Promise.all(tries(who, app))) {
        expect([401, 403], what).toContain(res.status);
        expect(res.json, what).not.toHaveProperty("view");
      }
    }
    expect((await t.db.select().from(decisions)).length).toBe(before);
  });

  it("is never a chair's for their own proposal, or one they have a conflict with: 404, as for one that is not there", async () => {
    const kept: [keyof typeof cookies, string][] = [
      ["authorChair", subs.own],
      ["conflictedChair", subs.conflicted],
      // A draft, another conference's proposal, and none at all.
      ["chair", subs.aDraft],
      ["chair", earlyTalk],
      ["chair", "00000000-0000-4000-8000-000000000000"],
      ["chair", "not-an-id"],
    ];
    for (const [who, id] of kept) {
      const all = await Promise.all([
        section(w, { cookie: cookies[who] }, id),
        record(w, { cookie: cookies[who] }, id, "accepted"),
        takeBack(w, { cookie: cookies[who] }, id),
      ]);
      for (const res of all) {
        expect([res.status, res.json], `${who} ${id}`).toEqual([404, { error: "not_found" }]);
      }
    }
    // Another chair records for both: those two chairs still get 404, and learn nothing of it.
    expect((await record(w, { cookie: cookies.second }, subs.own, "accepted")).status).toBe(204);
    expect((await record(w, { cookie: cookies.second }, subs.conflicted, "rejected")).status).toBe(
      204,
    );
    expect((await section(w, { cookie: cookies.authorChair }, subs.own)).status).toBe(404);
    expect((await takeBack(w, { cookie: cookies.authorChair }, subs.own)).status).toBe(404);
    expect((await section(w, { cookie: cookies.conflictedChair }, subs.conflicted)).status).toBe(
      404,
    );
    expect(await decisionRows(t, subs.own)).toHaveLength(1);
    expect(await decisionRows(t, subs.conflicted)).toHaveLength(1);
  });

  it("takes one of the three outcomes, and nothing else in the request", async () => {
    const bodies: unknown[] = [
      { outcome: "accept" },
      { outcome: "confirmed" },
      { outcome: "" },
      { outcome: null },
      {},
      { outcome: "accepted", submissionId: subs.second },
      { outcome: "accepted", sent: true },
      { outcome: "accepted", decidedByPersonId: ids.second },
    ];
    for (const body of bodies) {
      const res = await call(t.public, "PUT", at(w, `/decisions/submissions/${subs.second}`), {
        cookie: cookies.chair,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await decisionRows(t, subs.second)).toEqual([]);
  });

  it("is possible from `reviewing` on, for a proposal that is under consideration", async () => {
    // Before the conference is in review: nothing is recorded.
    const tooEarly = await record(early, { cookie: cookies.chair }, earlyTalk, "accepted");
    expect([tooEarly.status, tooEarly.json]).toEqual([409, { error: "not_in_review" }]);
    expect((await section(early, { cookie: cookies.chair }, earlyTalk)).json).toMatchObject({
      takes: "not_in_review",
      outcomes: [],
    });
    expect(await decisionRows(t, earlyTalk)).toEqual([]);
  });

  it("changes nothing its owner, a co-author, an invitee, a reviewer or an agent can read", async () => {
    const readers: [string, Who, TestApp["public"]][] = [
      ["the owner", { cookie: cookies.owner }, t.public],
      ["a confirmed co-author", { cookie: cookies.coauthor }, t.public],
      ["someone invited", { cookie: cookies.invitee }, t.public],
      ["a reviewer of it", { cookie: cookies.r1 }, t.public],
      ["a released reviewer", { cookie: cookies.released }, t.public],
      ["a reviewer of another committee", { cookie: cookies.other }, t.public],
      ["a track chair", { cookie: cookies.track }, t.public],
      ["a stranger", { cookie: cookies.stranger }, t.public],
      ["the public", {}, t.public],
      ["an agent, tier M", { token: agentM }, t.public],
      ["an agent, tier C", { token: agentC }, t.internal],
    ];
    const before = new Map<string, unknown>();
    for (const [what, who, app] of readers) before.set(what, await everything(who, subs.main, app));
    const submissionBefore = (
      await t.db.select().from(submissions).where(eq(submissions.id, subs.main))
    )[0];

    expect((await record(w, { cookie: cookies.chair }, subs.main, "accepted")).status).toBe(204);
    const [row] = await decisionRows(t, subs.main);
    for (const [what, who, app] of readers) {
      const after = await everything(who, subs.main, app);
      // Not a word, not a number, not a time is different.
      expect(after, what).toEqual(before.get(what));
      expect(findLeaks(answers(after), [row?.id ?? "no decision"]), what).toEqual([]);
    }
    // The proposal's own row is as it was: its status, its version, the day it was changed.
    expect((await t.db.select().from(submissions).where(eq(submissions.id, subs.main)))[0]).toEqual(
      submissionBefore,
    );
    // Its people are told nothing by email, and neither is anyone else.
    for (const who of ["owner", "coauthor", "invitee", "r1", "r2"] as const) {
      expect(await decisionMail(t, mail(who)), who).toEqual([]);
    }
    // An agent's tools say nothing of it either, whatever its tier.
    for (const [app, token] of [
      [t.public, agentM],
      [t.internal, agentC],
    ] as const) {
      const client = await connect(app, token);
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools.filter((name) => /decision/i.test(name))).toEqual([]);
      const listed = await client.callTool({ name: "list_submissions", arguments: {} });
      const overview = await client.callTool({ name: "conference_overview", arguments: {} });
      expect(findLeaks([listed, overview], [row?.id ?? "no decision"])).toEqual([]);
      expect(JSON.stringify(listed)).not.toContain("accepted");
      await client.close();
    }
  });
});

describe("the Decisions page", () => {
  type Item = {
    id: string;
    title: string;
    typeKey: string;
    waitlisted: boolean;
    sent: number;
    recommendations: Record<Recommendation, number>;
    recorded: string | null;
  };
  type Pool = {
    key: string;
    needed: number;
    proposals: number;
    undecided: number;
    items: Item[];
    nextCursor: string | null;
  };

  it("lists, by committee, the proposals a chair manages, those with no decision first, with what the reviewers recommend", async () => {
    const res = await page(w, { cookie: cookies.chair });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      view: "decisions",
      canRecord: true,
      canSend: false,
      excluded: 0,
    });
    const pools = res.json.pools as Pool[];
    expect(pools.map((p) => [p.key, p.needed, p.proposals, p.undecided])).toEqual([
      [POOL_A, NEEDED_A, 8, 5],
      [POOL_B, 2, 1, 1],
    ]);
    const talks = pools[0]?.items ?? [];
    // No decision yet, as they were created; then those with one recorded, as they were.
    expect(talks.map((x) => [x.id, x.recorded])).toEqual([
      [subs.second, null],
      [subs.third, null],
      [subs.unreviewed, null],
      [subs.withdrawn, null],
      [subs.leaves, null],
      [subs.main, "accepted"],
      [subs.own, "accepted"],
      [subs.conflicted, "rejected"],
    ]);
    expect(talks.find((x) => x.id === subs.main)).toEqual({
      id: subs.main,
      title: "The main talk",
      typeKey: "talk",
      waitlisted: false,
      sent: 2,
      recommendations: { accept: 1, unsure: 1, reject: 0 },
      recorded: "accepted",
    });
    expect(talks.find((x) => x.id === subs.unreviewed)).toMatchObject({
      sent: 0,
      recommendations: { accept: 0, unsure: 0, reject: 0 },
    });
    expect(pools[1]?.items.map((x) => [x.id, x.sent, x.recommendations.accept])).toEqual([
      [subs.performance, 1, 1],
    ]);
    // Nothing a reviewer wrote, and nobody's name: the reviews are on each proposal's page.
    expect(
      findLeaks(
        res.json,
        secrets.filter((x) => /COMMENTS|NOTE|Reviewer|@/.test(x)),
      ),
    ).toEqual([]);
  });

  it("leaves out a chair's own proposal and one they have a conflict with, and says how many", async () => {
    for (const [who, hidden] of [
      ["authorChair", subs.own],
      ["conflictedChair", subs.conflicted],
    ] as const) {
      const res = await page(w, { cookie: cookies[who] });
      expect(res.status).toBe(200);
      expect(res.json.excluded, who).toBe(1);
      const pools = res.json.pools as Pool[];
      expect(pools[0]?.proposals, who).toBe(7);
      expect(findLeaks(res.json, [hidden]), who).toEqual([]);
    }
  });

  it("comes a page at a time, by a cursor that opens only on that committee's list for that person", async () => {
    const first = await page(w, { cookie: cookies.chair }, "?limit=3");
    const pool = (first.json.pools as Pool[])[0];
    expect(pool?.items.map((x) => x.id)).toEqual([subs.second, subs.third, subs.unreviewed]);
    expect(pool?.proposals).toBe(8);
    const next = (cursor: string | null | undefined, who = cookies.chair, key = POOL_A) =>
      call(
        t.public,
        "GET",
        at(w, `/decisions/pools/${key}?limit=3&cursor=${encodeURIComponent(cursor ?? "")}`),
        { cookie: who },
      );
    const second = await next(pool?.nextCursor);
    expect(second.status).toBe(200);
    expect((second.json as Pool).items.map((x) => x.id)).toEqual([
      subs.withdrawn,
      subs.leaves,
      subs.main,
    ]);
    const third = await next((second.json as Pool).nextCursor);
    expect((third.json as Pool).items.map((x) => x.id)).toEqual([subs.own, subs.conflicted]);
    expect((third.json as Pool).nextCursor).toBeNull();
    // Another chair's, another committee's, the Assignments page's, and one that was made up.
    const assignments = await call(t.public, "GET", at(w, "/assignments?limit=3"), {
      cookie: cookies.chair,
    });
    const foreign = [
      (await next(pool?.nextCursor, cookies.second)).status,
      (await next(pool?.nextCursor, cookies.chair, POOL_B)).status,
      (await next(assignments.json.pools[0].nextCursor)).status,
      (await next(`s${"A".repeat(60)}`)).status,
    ];
    expect(foreign).toEqual([400, 400, 400, 400]);
    expect((await next("", cookies.chair, "no_such_pool")).status).toBe(404);
  });
});

describe("sending the decisions", () => {
  /** What the confirmation says while the main talk, a chair's own and the conflicted one are decided. */
  const waitingNow = {
    view: "send_decisions",
    accepted: 2,
    waitlisted: 0,
    rejected: 1,
    // The owner and the co-author of the main talk, and the chair who wrote the third.
    people: 3,
    // The second and third talks, the unreviewed one, the one to be withdrawn, the one someone
    // leaves, and the performance.
    undecided: 6,
    dropped: 0,
  };

  it("is not possible while the conference is in review: the reviews could still change", async () => {
    const asked = await confirmation(w, { cookie: cookies.chair });
    expect(asked.status).toBe(200);
    expect(asked.json).toEqual({ ...waitingNow, canSend: false, token: asked.json.token });
    expect(asked.json.token).toMatch(/^[0-9a-f]{32}$/);
    const res = await send(w, { cookie: cookies.chair }, asked.json.token);
    expect([res.status, res.json]).toEqual([409, { error: "not_deciding" }]);
    expect(await statusOf(t, subs.main)).toBe("submitted");
    expect(await decisionMail(t, mail("owner"))).toEqual([]);
    // From `deciding` on, it is.
    expect((await movePhase(w, cookies.chair, "deciding", "reviewing")).status).toBe(200);
    expect((await confirmation(w, { cookie: cookies.chair })).json.canSend).toBe(true);
    expect((await section(w, { cookie: cookies.chair }, subs.main)).json.canSend).toBe(true);
  });

  it("counts every decision that is waiting, also for the proposals a chair is kept from, and names none", async () => {
    for (const who of ["chair", "second", "authorChair", "conflictedChair"] as const) {
      const asked = await confirmation(w, { cookie: cookies[who] });
      expect(asked.status, who).toBe(200);
      expect(asked.json, who).toEqual({ ...waitingNow, canSend: true, token: asked.json.token });
      // Numbers, and a token that holds nothing to read: no proposal, no person, no decision.
      const rows = await t.db
        .select()
        .from(decisions)
        .where(eq(decisions.conferenceId, w.conferenceId));
      expect(
        findLeaks(asked.json, [
          ...Object.values(subs),
          ...Object.values(ids),
          ...rows.map((r) => r.id),
        ]),
        who,
      ).toEqual([]);
    }
  });

  it("sends nothing that the confirmation did not show: a decision changed meanwhile, and nothing goes out", async () => {
    const asked = await confirmation(w, { cookie: cookies.chair });
    // Another chair records one more decision before the first one presses Send.
    expect((await record(w, { cookie: cookies.second }, subs.second, "rejected")).status).toBe(204);
    const stale = await send(w, { cookie: cookies.chair }, asked.json.token);
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({
      error: "stale",
      summary: {
        ...waitingNow,
        canSend: true,
        rejected: 2,
        undecided: 5,
        token: stale.json.summary.token,
      },
    });
    expect(stale.json.summary.token).not.toBe(asked.json.token);
    // The same number of each, and another outcome for one of them: not what was shown either.
    const shown = await confirmation(w, { cookie: cookies.chair });
    expect((await record(w, { cookie: cookies.second }, subs.main, "rejected")).status).toBe(204);
    expect((await record(w, { cookie: cookies.second }, subs.second, "accepted")).status).toBe(204);
    const swapped = await send(w, { cookie: cookies.chair }, shown.json.token);
    expect(swapped.status).toBe(409);
    expect(swapped.json.summary).toMatchObject({ accepted: 2, waitlisted: 0, rejected: 2 });
    // Nothing was sent by either: every proposal is as it was, and nobody was written to.
    for (const id of [subs.main, subs.second, subs.own, subs.conflicted]) {
      expect(await statusOf(t, id), id).toBe("submitted");
      expect((await decisionRows(t, id)).map((d) => d.sentAt)).toEqual([null]);
    }
    expect(await t.db.select().from(outbox).where(like(outbox.kind, "decision_%"))).toEqual([]);
    // Put back as the next test finds it: the main talk accepted, the second one undecided.
    expect((await record(w, { cookie: cookies.chair }, subs.main, "accepted")).status).toBe(204);
    expect((await takeBack(w, { cookie: cookies.chair }, subs.second)).status).toBe(204);
    // A token that was never one, and a request that holds anything else, are refused.
    for (const body of [{}, { token: "short" }, { token: asked.json.token, all: true }]) {
      const res = await call(t.public, "POST", at(w, "/decisions/send"), {
        cookie: cookies.chair,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("gives each proposal its status, marks its decision sent, and writes to its owner and confirmed co-authors, each in their language", async () => {
    const since = (await audited(t, w.conferenceId)).length;
    const waiting = await t.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.conferenceId, w.conferenceId), isNull(decisions.sentAt)));
    const versions = new Map(
      (
        await t.db.select().from(submissions).where(eq(submissions.conferenceId, w.conferenceId))
      ).map((s) => [s.id, s.version]),
    );
    const later = new Date(NOW.getTime() + 2 * HOUR);
    t.setNow(later);
    // A chair who is kept from one of the proposals sends: every decision goes out all the same.
    const res = await sendNow(w, cookies.authorChair);
    t.setNow(NOW);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toEqual({ ...waitingNow, canSend: true });

    for (const [id, outcome] of [
      [subs.main, "accepted"],
      [subs.own, "accepted"],
      [subs.conflicted, "rejected"],
    ] as const) {
      const [row] = await t.db.select().from(submissions).where(eq(submissions.id, id));
      expect(row?.status, id).toBe(outcome);
      expect(row?.version, id).toBe((versions.get(id) ?? 0) + 1);
      expect(row?.updatedAt, id).toEqual(later);
      const [decision] = await decisionRows(t, id);
      expect(decision, id).toMatchObject({
        outcome,
        sentAt: later,
        sentByPersonId: ids.authorChair,
      });
    }
    // The others are as they were.
    for (const id of [subs.second, subs.third, subs.unreviewed, subs.performance]) {
      expect(await statusOf(t, id), id).toBe("submitted");
    }

    // What the authors of the main talk are sent of its two reviews: the comments, in the
    // order of the reviews' own ids, and nothing else of either.
    const sent = await t.db
      .select()
      .from(reviews)
      .where(eq(reviews.submissionId, subs.main))
      .orderBy(reviews.id);
    const numbered = sent.map((r) => r.comments);
    expect(numbered.sort()).toEqual([wrote.r1.comments, wrote.r2.comments].sort());
    expect((await decisionRows(t, subs.main))[0]?.comments).toEqual(sent.map((r) => r.comments));

    const link = (lang: string) => `${ORIGIN}/${lang}/s/${subs.main}`;
    const toOwner = (await decisionMail(t, mail("owner"))).find(
      (m) => m.kind === "decision_accepted",
    );
    expect(toOwner?.subject).toBe("Test call: your proposal has been accepted");
    expect(toOwner?.text).toBe(
      [
        'The chairs of Test call have accepted your proposal "The main talk" (Individual talk).',
        "Comments from the reviewers:",
        `Reviewer 1:\n${sent[0]?.comments}`,
        `Reviewer 2:\n${sent[1]?.comments}`,
        "You can also read this on the proposal's page:",
        link("en"),
      ].join("\n\n"),
    );
    // The co-author reads Spanish, and gets the same in it.
    const toCoauthor = await decisionMail(t, mail("coauthor"));
    expect(toCoauthor.map((m) => m.kind)).toEqual(["decision_accepted"]);
    expect(toCoauthor[0]?.subject).toBe("Convocatoria de prueba: tu propuesta ha sido aceptada");
    expect(toCoauthor[0]?.text).toBe(
      [
        "Quienes presiden Convocatoria de prueba han aceptado tu propuesta «The main talk» (Ponencia individual).",
        "Comentarios de quienes revisaron la propuesta:",
        `Revisión 1:\n${sent[0]?.comments}`,
        `Revisión 2:\n${sent[1]?.comments}`,
        "También puedes leerlo en la página de la propuesta:",
        link("es"),
      ].join("\n\n"),
    );
    // The owner has two proposals decided, and an email for each; the chair whose own talk was
    // decided is written to as its author.
    expect((await decisionMail(t, mail("owner"))).map((m) => m.kind).sort()).toEqual([
      "decision_accepted",
      "decision_rejected",
    ]);
    expect((await decisionMail(t, mail("authorChair"))).map((m) => m.kind)).toEqual([
      "decision_accepted",
    ]);
    // Someone who was invited and has not confirmed has agreed to nothing: no email. Neither
    // has any reviewer, any other chair, or the conference's contact address.
    for (const who of ["invitee", "r1", "r2", "released", "chair", "second", "stranger"] as const) {
      expect(await decisionMail(t, mail(who)), who).toEqual([]);
    }
    expect(await decisionMail(t, fixtureCall.contactEmail ?? "")).toEqual([]);

    // No email names a reviewer, a score, a recommendation or a note for the chairs.
    const all = (t.deps.mail as MemoryTransport).sent.filter((m) =>
      m.kind?.startsWith("decision_"),
    );
    expect(all).toHaveLength(4);
    expect(
      findLeaks(all, [
        "Rhea",
        "Rolf",
        "Reviewerone",
        "Reviewertwo",
        mail("r1"),
        mail("r2"),
        ids.r1,
        ids.r2,
        "NOTE-FOR-CHAIRS",
        "unsure",
        "Recommendation",
        "Clarity",
        ...sent.map((r) => r.id),
      ]),
    ).toEqual([]);

    // One audit row for each decision sent, with ids and the outcome, by the chair who sent.
    const rows = await audited(t, w.conferenceId, since);
    expect(rows.map((r) => r.action)).toEqual(["decision.sent", "decision.sent", "decision.sent"]);
    // In the order of the decisions' ids, which is the order they are sent in.
    expect(rows.map((r) => r.details)).toEqual(
      waiting
        .map((d) => ({ decisionId: d.id, outcome: d.outcome }))
        .sort((a, b) => a.decisionId.localeCompare(b.decisionId, "en")),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ actor: ids.authorChair, targetType: "submission" });
    }
  });

  it("sends once: the same confirmation again finds the decisions sent", async () => {
    const before = (t.deps.mail as MemoryTransport).sent.length;
    const asked = await confirmation(w, { cookie: cookies.chair });
    expect(asked.json).toMatchObject({ accepted: 0, waitlisted: 0, rejected: 0, people: 0 });
    const res = await send(w, { cookie: cookies.chair }, asked.json.token);
    expect([res.status, res.json]).toEqual([409, { error: "nothing_to_send" }]);
    await mailTo(t, mail("owner"));
    expect((t.deps.mail as MemoryTransport).sent.length).toBe(before);
  });
});

describe("what a proposal's people are shown once its decision is sent", () => {
  it("the owner and a confirmed co-author read the decision and the comments, numbered and never named", async () => {
    const sent = await t.db
      .select()
      .from(reviews)
      .where(eq(reviews.submissionId, subs.main))
      .orderBy(reviews.id);
    for (const who of ["owner", "coauthor"] as const) {
      const res = await authorView(t, { cookie: cookies[who] }, subs.main);
      expect(res.status, who).toBe(200);
      expect(res.json, who).toEqual({
        view: "author_decision",
        submissionId: subs.main,
        outcome: "accepted",
        sentAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
        comments: sent.map((r) => r.comments),
      });
      const page = await call(t.public, "GET", `/api/submissions/${subs.main}`, {
        cookie: cookies[who],
      });
      expect(page.json.status, who).toBe("accepted");
      // Not who reviewed, not what they scored or recommended, not what they told the chairs.
      expect(
        findLeaks(answers(await everything({ cookie: cookies[who] }, subs.main)), [
          "Rhea",
          "Rolf",
          mail("r1"),
          mail("r2"),
          ids.r1,
          ids.r2,
          "NOTE-FOR-CHAIRS",
          '"recommendation"',
          '"scores"',
          '"chairNote"',
          ...sent.map((r) => r.id),
        ]),
        who,
      ).toEqual([]);
    }
    // A chair is the author of their own proposal like anyone, and reads its decision as one.
    const own = await authorView(t, { cookie: cookies.authorChair }, subs.own);
    expect(own.json).toMatchObject({
      outcome: "accepted",
      comments: [expect.stringContaining("COMMENTS-FOR-AUTHORS of a chair's own talk")],
    });
    // "My submissions" says it too.
    const mine = await call(t.public, "GET", "/api/me/submissions", { cookie: cookies.owner });
    const statuses = Object.fromEntries(
      (mine.json.items as { submission: { id: string; status: string } }[]).map((i) => [
        i.submission.id,
        i.submission.status,
      ]),
    );
    expect(statuses[subs.main]).toBe("accepted");
    expect(statuses[subs.conflicted]).toBe("rejected");
    expect(statuses[subs.second]).toBe("submitted");
  });

  it("nobody else reads it: not someone invited, a reviewer, a chair, a stranger, the public or an agent", async () => {
    const others: [string, Who, TestApp["public"]][] = [
      ["someone invited", { cookie: cookies.invitee }, t.public],
      ["a reviewer of it", { cookie: cookies.r1 }, t.public],
      ["a released reviewer", { cookie: cookies.released }, t.public],
      ["a chair who manages it", { cookie: cookies.chair }, t.public],
      ["a track chair", { cookie: cookies.track }, t.public],
      ["a stranger", { cookie: cookies.stranger }, t.public],
      ["the public", {}, t.public],
      ["an agent, tier M", { token: agentM }, t.public],
      ["an agent, tier C", { token: agentC }, t.internal],
    ];
    for (const [what, who, app] of others) {
      const res = await authorView(t, who, subs.main, app);
      expect([res.status, res.json], what).toEqual([404, { error: "not_found" }]);
    }
    // A proposal whose decision was not sent reads the same to its own owner: nothing.
    for (const id of [subs.second, subs.aDraft, "not-an-id"]) {
      const res = await authorView(t, { cookie: cookies.owner }, id);
      expect([res.status, res.json], id).toEqual([404, { error: "not_found" }]);
    }
    // A chair kept from a proposal by a conflict gets nothing of it, decided or not.
    const kept = answers(await everything({ cookie: cookies.conflictedChair }, subs.conflicted));
    expect(
      findLeaks(kept, [subs.conflicted, "COMMENTS-FOR-AUTHORS of the conflicted talk"]),
    ).toEqual([]);
  });

  it("a reviewer learns nothing of the outcome: what they read of the proposal is what it was", async () => {
    for (const who of ["r1", "r2"] as const) {
      const all = await everything({ cookie: cookies[who] }, subs.main);
      const reads = Object.fromEntries(all.map((x) => [x.path, x]));
      const proposal = reads[`/api/submissions/${subs.main}`];
      expect(proposal?.json.view, who).toBe("reviewer");
      expect(proposal?.json, who).not.toHaveProperty("status");
      // No status of any proposal, no decision, and nothing of the other reviewer's review.
      const other = who === "r1" ? wrote.r2 : wrote.r1;
      const ownDecisions = await t.db.select().from(decisions);
      expect(
        findLeaks(answers(all), [
          '"accepted"',
          '"rejected"',
          '"waitlisted"',
          '"author_decision"',
          other.comments.split("\n")[0] ?? "",
          other.note,
          ...ownDecisions.map((d) => d.id),
        ]),
        who,
      ).toEqual([]);
      // Their own review is theirs to read, as before, and no longer to change.
      expect(reads[`/api/submissions/${subs.main}/review`]?.json, who).toMatchObject({
        status: "sent",
        open: false,
      });
    }
    // The reviewer who was taken off it, and one of another committee, get nothing of it at all.
    for (const who of ["released", "other"] as const) {
      const res = await call(t.public, "GET", `/api/submissions/${subs.main}`, {
        cookie: cookies[who],
      });
      expect(res.status, who).toBe(404);
    }
  });

  it("someone invited who has not confirmed sees the status, as they always have, and no comment", async () => {
    const all = await everything({ cookie: cookies.invitee }, subs.main);
    const proposal = all.find((x) => x.path === `/api/submissions/${subs.main}`);
    expect(proposal?.json).toMatchObject({ view: "invitee", status: "accepted" });
    expect(
      findLeaks(answers(all), ["COMMENTS-FOR-AUTHORS", "NOTE-FOR-CHAIRS", '"author_decision"']),
    ).toEqual([]);
  });

  it("an agent gets the status that was sent, and nothing of a decision that was not, or of a review", async () => {
    expect((await record(w, { cookie: cookies.chair }, subs.second, "rejected")).status).toBe(204);
    const [waiting] = await decisionRows(t, subs.second);
    for (const [app, token, view] of [
      [t.public, agentM, "metadata"],
      [t.internal, agentC, "chair"],
    ] as const) {
      const decided = await call(app, "GET", `/api/submissions/${subs.main}`, { token });
      expect(decided.json).toMatchObject({ view, status: "accepted" });
      const undecided = await call(app, "GET", `/api/submissions/${subs.second}`, { token });
      expect(undecided.json).toMatchObject({ view, status: "submitted" });
      const all = answers([
        ...(await everything({ token }, subs.main, app)),
        ...(await everything({ token }, subs.second, app)),
      ]);
      expect(
        findLeaks(all, [
          waiting?.id ?? "no decision",
          "COMMENTS-FOR-AUTHORS",
          "NOTE-FOR-CHAIRS",
          '"author_decision"',
          '"proposal_decision"',
          "decision_sent",
          "reviews_sent",
        ]),
        view,
      ).toEqual([]);
    }
    expect((await takeBack(w, { cookie: cookies.chair }, subs.second)).status).toBe(204);
  });
});

describe("what is final, and what a waiting list is for", () => {
  it("a sent accept or reject is final in the app: nothing more is recorded for the proposal", async () => {
    for (const [id, told] of [
      [subs.main, "accepted"],
      [subs.conflicted, "rejected"],
    ] as const) {
      const view = await section(w, { cookie: cookies.chair }, id);
      expect(view.json, id).toMatchObject({
        takes: "decided",
        outcomes: [],
        recorded: null,
        told: { outcome: told },
      });
      for (const outcome of ["accepted", "waitlisted", "rejected"]) {
        const res = await record(w, { cookie: cookies.chair }, id, outcome);
        expect([res.status, res.json], `${id} ${outcome}`).toEqual([409, { error: "decided" }]);
      }
      const back = await takeBack(w, { cookie: cookies.chair }, id);
      expect([back.status, back.json], id).toEqual([409, { error: "no_decision" }]);
      expect(await decisionRows(t, id), id).toHaveLength(1);
    }
    // They have left the list of what is still to decide.
    const listed = (await page(w, { cookie: cookies.chair })).json.pools[0].items as {
      id: string;
    }[];
    expect(listed.map((x) => x.id)).not.toContain(subs.main);
    expect(listed.map((x) => x.id)).not.toContain(subs.conflicted);
  });

  it("a proposal on the waiting list is given a new decision later, recorded and sent by the same two steps", async () => {
    expect((await record(w, { cookie: cookies.chair }, subs.third, "waitlisted")).status).toBe(204);
    const first = await sendNow(w, cookies.chair);
    expect(first.json).toMatchObject({ accepted: 0, waitlisted: 1, rejected: 0, people: 1 });
    expect(await statusOf(t, subs.third)).toBe("waitlisted");
    const [told] = (await decisionMail(t, mail("owner"))).slice(-1);
    expect(told?.kind).toBe("decision_waitlisted");
    expect(told?.subject).toBe("Test call: your proposal is on the waiting list");
    expect(told?.text).toContain("on the waiting list. It is not accepted so far");
    expect((await authorView(t, { cookie: cookies.owner }, subs.third)).json.outcome).toBe(
      "waitlisted",
    );

    // It stays on the Decisions page, after those with no decision, and takes the two that end it.
    const listed = (await page(w, { cookie: cookies.chair })).json.pools[0].items as {
      id: string;
      waitlisted: boolean;
      recorded: string | null;
    }[];
    expect(listed.at(-1)).toMatchObject({ id: subs.third, waitlisted: true, recorded: null });
    const view = await section(w, { cookie: cookies.chair }, subs.third);
    expect(view.json).toMatchObject({
      takes: "yes",
      outcomes: ["accepted", "rejected"],
      recorded: null,
      told: { outcome: "waitlisted" },
    });
    const again = await record(w, { cookie: cookies.chair }, subs.third, "waitlisted");
    expect([again.status, again.json]).toEqual([409, { error: "already_waitlisted" }]);
    // It takes no new reviewer meanwhile, and its owner cannot withdraw it in the app.
    const more = await assign(w, cookies.chair, subs.third, ids.r1);
    expect([more.status, more.json]).toEqual([409, { error: "not_under_consideration" }]);

    expect((await record(w, { cookie: cookies.chair }, subs.third, "accepted")).status).toBe(204);
    // Recorded, and not sent: its authors still read "waiting list", and nothing new.
    expect(await statusOf(t, subs.third)).toBe("waitlisted");
    expect((await authorView(t, { cookie: cookies.owner }, subs.third)).json.outcome).toBe(
      "waitlisted",
    );
    const second = await sendNow(w, cookies.chair);
    expect(second.json).toMatchObject({ accepted: 1, waitlisted: 0, rejected: 0, people: 1 });
    expect(await statusOf(t, subs.third)).toBe("accepted");
    // Two decisions that were sent: the waiting list, and the accept that ended it.
    expect(
      (await decisionRows(t, subs.third)).map((d) => [d.outcome, d.sentAt !== null]).sort(),
    ).toEqual([
      ["accepted", true],
      ["waitlisted", true],
    ]);
    const [last] = (await decisionMail(t, mail("owner"))).slice(-1);
    expect(last?.kind).toBe("decision_accepted");
    expect(last?.text).toContain("COMMENTS-FOR-AUTHORS of the third talk");
    expect((await authorView(t, { cookie: cookies.owner }, subs.third)).json).toMatchObject({
      outcome: "accepted",
      comments: [expect.stringContaining("COMMENTS-FOR-AUTHORS of the third talk")],
    });
  });

  it("a proposal nobody reviewed is decided all the same, and its email says that no comments come with it", async () => {
    expect((await record(w, { cookie: cookies.chair }, subs.unreviewed, "rejected")).status).toBe(
      204,
    );
    expect((await sendNow(w, cookies.chair)).status).toBe(200);
    const [told] = await decisionMail(t, mail("stranger"));
    expect(told?.kind).toBe("decision_rejected");
    expect(told?.text).toBe(
      [
        'The chairs of Test call have not accepted your proposal "A talk nobody reviewed" (Individual talk).',
        "No comments from reviewers come with this decision.",
        "You can also read this on the proposal's page:",
        `${ORIGIN}/en/s/${subs.unreviewed}`,
      ].join("\n\n"),
    );
    expect((await authorView(t, { cookie: cookies.stranger }, subs.unreviewed)).json).toMatchObject(
      { outcome: "rejected", comments: [] },
    );
  });
});

describe("what is no longer true when the decisions are sent", () => {
  it("a decision whose proposal was withdrawn meanwhile is not sent, and the confirmation and the result say so", async () => {
    const since = (await audited(t, w.conferenceId)).length;
    expect((await record(w, { cookie: cookies.chair }, subs.withdrawn, "accepted")).status).toBe(
      204,
    );
    const [waiting] = await decisionRows(t, subs.withdrawn);
    const before = (await decisionMail(t, mail("owner"))).length;
    const now = await call(t.public, "GET", `/api/submissions/${subs.withdrawn}`, {
      cookie: cookies.owner,
    });
    const gone = await call(t.public, "POST", `/api/submissions/${subs.withdrawn}/withdraw`, {
      cookie: cookies.owner,
      body: { version: now.json.version },
    });
    expect(gone.status).toBe(200);
    // Nothing more is recorded for it, and what was recorded can still be taken back.
    expect((await section(w, { cookie: cookies.chair }, subs.withdrawn)).json).toMatchObject({
      takes: "not_under_consideration",
      outcomes: [],
      recorded: { outcome: "accepted" },
    });
    const more = await record(w, { cookie: cookies.chair }, subs.withdrawn, "rejected");
    expect([more.status, more.json]).toEqual([409, { error: "not_under_consideration" }]);

    // It is all that waits: there is nothing to send, and it stays where it is.
    const alone = await confirmation(w, { cookie: cookies.chair });
    expect(alone.json).toMatchObject({
      accepted: 0,
      waitlisted: 0,
      rejected: 0,
      people: 0,
      dropped: 1,
    });
    const nothing = await send(w, { cookie: cookies.chair }, alone.json.token);
    expect([nothing.status, nothing.json]).toEqual([409, { error: "nothing_to_send" }]);
    expect(await decisionRows(t, subs.withdrawn)).toHaveLength(1);

    // With the next decisions that are sent, the confirmation and the result say that it is
    // not, and it does not wait any longer.
    const title = "A talk decided beside a withdrawn one";
    secrets.push(title);
    const [beside] = await t.db
      .insert(submissions)
      .values({
        conferenceId: w.conferenceId,
        ownerPersonId: ids.stranger,
        typeKey: "talk",
        language: "en",
        title,
        abstract: words(260),
        status: "submitted",
        submittedAt: NOW,
      })
      .returning({ id: submissions.id });
    subs.beside = beside?.id ?? "";
    await t.db
      .insert(contributions)
      .values({ submissionId: subs.beside, personId: ids.stranger, role: "lead", position: 0 });
    expect((await record(w, { cookie: cookies.chair }, subs.beside, "rejected")).status).toBe(204);
    const [other] = await decisionRows(t, subs.beside);
    const asked = await confirmation(w, { cookie: cookies.chair });
    expect(asked.json).toMatchObject({
      accepted: 0,
      waitlisted: 0,
      rejected: 1,
      people: 1,
      dropped: 1,
    });
    const res = await send(w, { cookie: cookies.chair }, asked.json.token);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      accepted: 0,
      waitlisted: 0,
      rejected: 1,
      people: 1,
      dropped: 1,
    });
    // It stays withdrawn, nobody is told anything about it, and its decision is gone.
    expect(await statusOf(t, subs.withdrawn)).toBe("withdrawn");
    expect(await statusOf(t, subs.beside)).toBe("rejected");
    expect(await decisionRows(t, subs.withdrawn)).toEqual([]);
    expect((await decisionMail(t, mail("owner"))).length).toBe(before);
    expect((await authorView(t, { cookie: cookies.owner }, subs.withdrawn)).status).toBe(404);
    expect((await confirmation(w, { cookie: cookies.chair })).json.dropped).toBe(0);
    expect((await audited(t, w.conferenceId, since)).map((r) => [r.action, r.details])).toEqual([
      ["decision.recorded", { decisionId: waiting?.id, outcome: "accepted" }],
      ["decision.recorded", { decisionId: other?.id, outcome: "rejected" }],
      ["decision.sent", { decisionId: other?.id, outcome: "rejected" }],
      ["decision.dropped", { decisionId: waiting?.id, outcome: "accepted" }],
    ]);
  });

  it("a decision whose proposal went back to a draft is not sent either, and waits again if the proposal is submitted again", async () => {
    // A proposal goes back to a draft only where the chairs opened the call again after
    // decisions were recorded. What its owner's "Return to draft" leaves is written to the row
    // here, so that this world's phase stays where the other tests need it.
    const title = "A talk that went back to a draft";
    secrets.push(title);
    const [row] = await t.db
      .insert(submissions)
      .values({
        conferenceId: w.conferenceId,
        ownerPersonId: ids.stranger,
        typeKey: "talk",
        language: "en",
        title,
        abstract: words(260),
        status: "submitted",
        submittedAt: NOW,
      })
      .returning({ id: submissions.id });
    const id = row?.id ?? "";
    await t.db
      .insert(contributions)
      .values({ submissionId: id, personId: ids.stranger, role: "lead", position: 0 });
    expect((await record(w, { cookie: cookies.chair }, id, "accepted")).status).toBe(204);
    await t.db.update(submissions).set({ status: "draft" }).where(eq(submissions.id, id));

    // No chair is given a draft: its decision is not read, changed or taken back on its page.
    expect((await section(w, { cookie: cookies.chair }, id)).status).toBe(404);
    expect((await record(w, { cookie: cookies.chair }, id, "rejected")).status).toBe(404);
    expect((await takeBack(w, { cookie: cookies.chair }, id)).status).toBe(404);
    // It is not sent while the proposal is a draft, and the confirmation says that one is not.
    const alone = await confirmation(w, { cookie: cookies.chair });
    expect(alone.json).toMatchObject({
      accepted: 0,
      waitlisted: 0,
      rejected: 0,
      people: 0,
      dropped: 1,
    });
    const nothing = await send(w, { cookie: cookies.chair }, alone.json.token);
    expect([nothing.status, nothing.json]).toEqual([409, { error: "nothing_to_send" }]);
    expect(await decisionRows(t, id)).toHaveLength(1);

    // Submitted again before anything was sent, it has its decision waiting as before.
    await t.db.update(submissions).set({ status: "submitted" }).where(eq(submissions.id, id));
    expect((await section(w, { cookie: cookies.chair }, id)).json).toMatchObject({
      takes: "yes",
      recorded: { outcome: "accepted" },
    });
    expect((await confirmation(w, { cookie: cookies.chair })).json).toMatchObject({
      accepted: 1,
      people: 1,
      dropped: 0,
    });
    // Taken back, and the proposal gone: the world is as the tests after this one count it.
    expect((await takeBack(w, { cookie: cookies.chair }, id)).status).toBe(204);
    await t.db.delete(submissions).where(eq(submissions.id, id));
    expect((await confirmation(w, { cookie: cookies.chair })).json).toMatchObject({
      accepted: 0,
      dropped: 0,
    });
  });

  it("when the proposal's people have changed since the confirmation, nothing is sent until a chair has seen it", async () => {
    expect((await record(w, { cookie: cookies.chair }, subs.leaves, "accepted")).status).toBe(204);
    const asked = await confirmation(w, { cookie: cookies.chair });
    expect(asked.json).toMatchObject({ accepted: 1, people: 2 });
    // The co-author leaves the proposal: one person fewer to write to than was shown.
    const left = await call(t.public, "POST", `/api/submissions/${subs.leaves}/leave`, {
      cookie: cookies.coauthor,
      body: {},
    });
    expect(left.status).toBe(204);
    const before = (await decisionMail(t, mail("coauthor"))).length;
    const stale = await send(w, { cookie: cookies.chair }, asked.json.token);
    expect(stale.status).toBe(409);
    expect(stale.json.summary).toMatchObject({ accepted: 1, people: 1 });
    expect(await statusOf(t, subs.leaves)).toBe("submitted");
    // Sent with what the confirmation says now: to the owner alone.
    const res = await send(w, { cookie: cookies.chair }, stale.json.summary.token);
    expect(res.json).toMatchObject({ accepted: 1, people: 1 });
    expect(await statusOf(t, subs.leaves)).toBe("accepted");
    expect((await decisionMail(t, mail("coauthor"))).length).toBe(before);
    expect((await authorView(t, { cookie: cookies.coauthor }, subs.leaves)).status).toBe(404);
    expect((await authorView(t, { cookie: cookies.owner }, subs.leaves)).status).toBe(200);
  });

  it("a chair who is removed while their request is on its way records and sends nothing", async () => {
    const email = mail("removed-chair");
    const cookie = await w.person(email, "Rosa Removedchair");
    const id = await w.id(email);
    await grantRole(t.db, { conferenceId: w.conferenceId, personId: id, role: "chair" });
    expect((await record(w, { cookie }, subs.second, "rejected")).status).toBe(204);
    const asked = await confirmation(w, { cookie });
    await t.db
      .delete(conferenceRoles)
      .where(
        and(eq(conferenceRoles.conferenceId, w.conferenceId), eq(conferenceRoles.personId, id)),
      );
    for (const res of [
      await record(w, { cookie }, subs.second, "accepted"),
      await takeBack(w, { cookie }, subs.second),
      await send(w, { cookie }, asked.json.token),
    ]) {
      expect([res.status, res.json]).toEqual([403, { error: "forbidden" }]);
    }
    expect((await decisionRows(t, subs.second)).map((d) => [d.outcome, d.sentAt])).toEqual([
      ["rejected", null],
    ]);
    expect((await takeBack(w, { cookie: cookies.chair }, subs.second)).status).toBe(204);
  });
});

describe("everything that reads a proposal's status, once proposals are decided", () => {
  it("the proposals export says, to a chair, what is decided and how many reviews were sent", async () => {
    expect((await record(w, { cookie: cookies.chair }, subs.second, "rejected")).status).toBe(204);
    const out = await csv(
      t,
      at(w, "/submissions.csv?status=submitted,accepted,waitlisted,rejected"),
      {
        cookie: cookies.chair,
      },
    );
    expect(out.header.slice(0, 7)).toEqual([
      "reference",
      "id",
      "status",
      "decision",
      "decision_sent",
      "reviews_sent",
      "type",
    ]);
    const row = (id: string) => {
      const found = out.rows.find((r) => r.id === id);
      return [found?.status, found?.decision, found?.decision_sent, found?.reviews_sent];
    };
    expect(row(subs.main)).toEqual(["accepted", "accepted", "yes", "2"]);
    expect(row(subs.conflicted)).toEqual(["rejected", "rejected", "yes", "1"]);
    expect(row(subs.third)).toEqual(["accepted", "accepted", "yes", "1"]);
    // Recorded and not sent: its authors read "submitted" still.
    expect(row(subs.second)).toEqual(["submitted", "rejected", "no", "1"]);
    expect(row(subs.performance)).toEqual(["submitted", "", "", "1"]);
    expect((await takeBack(w, { cookie: cookies.chair }, subs.second)).status).toBe(204);

    // A chair's own proposal is not in their export at all, as before.
    const own = await csv(t, at(w, "/submissions.csv?status=accepted"), {
      cookie: cookies.authorChair,
    });
    expect(own.rows.map((r) => r.id)).not.toContain(subs.own);
    // A track chair and an agent get the export without these columns: neither a decision that
    // is not sent nor a number of reviews is theirs.
    for (const [who, app] of [
      [{ cookie: cookies.track }, t.public],
      [{ token: agentC }, t.internal],
    ] as const) {
      const less = await csv(t, at(w, "/submissions.csv"), who, app);
      expect(less.header.slice(0, 4)).toEqual(["reference", "id", "status", "type"]);
      expect(less.header).not.toContain("decision");
      expect(less.header).not.toContain("reviews_sent");
    }
  });

  it("the lists and filters, the overview and the cap report take a decided proposal by its status", async () => {
    const list = async (status: string) =>
      (
        (
          await call(t.public, "GET", at(w, `/submissions?status=${status}`), {
            cookie: cookies.chair,
          })
        ).json.items as { id: string }[]
      )
        .map((x) => x.id)
        .sort();
    expect(await list("accepted")).toEqual([subs.main, subs.own, subs.third, subs.leaves].sort());
    expect(await list("rejected")).toEqual([subs.conflicted, subs.unreviewed, subs.beside].sort());
    expect(await list("waitlisted")).toEqual([]);
    expect(await list("submitted")).toEqual([subs.second, subs.performance].sort());
    const overview = await call(t.public, "GET", at(w, "/overview"), { cookie: cookies.chair });
    expect(overview.json.byStatus).toEqual({
      accepted: 4,
      rejected: 3,
      submitted: 2,
      withdrawn: 1,
    });
    // The cap counts work under consideration and accepted work: the owner leads the main
    // talk, the third and the one someone left (accepted), and the second and the performance
    // (under consideration); the rejected and the withdrawn ones no longer count.
    const cap = await call(t.public, "GET", at(w, "/cap-report"), { cookie: cookies.chair });
    expect(cap.json.statuses).toEqual(["submitted"]);
    const counted = await call(
      t.public,
      "GET",
      at(w, "/cap-report?statuses=submitted,accepted,confirmed,published"),
      { cookie: cookies.chair },
    );
    expect(
      (counted.json.counts as { personId: string; count: number }[]).find(
        (c) => c.personId === ids.owner,
      )?.count,
    ).toBe(5);
  });

  it("an accepted proposal that has become invalid is incomplete, as one under consideration is", async () => {
    // The format is made to need two people: the main talk has two confirmed, the others one.
    const k = await getConference(t.db, SLUG);
    if (!k) throw new Error("no conference");
    const overview = () => call(t.public, "GET", at(w, "/overview"), { cookie: cookies.chair });
    expect((await overview()).json.incomplete).toBe(0);
    const stricter = structuredClone(k.config) as ConferenceConfig;
    const talk = stricter.submissionTypes.find((x) => x.key === "talk");
    if (!talk) throw new Error("no talk");
    talk.team = { min: 2, max: 4 };
    await saveConference(t.db, stricter);
    try {
      // The second talk (under consideration), and the third, the one someone left and a
      // chair's own (accepted): not the rejected ones, and not the withdrawn one.
      expect((await overview()).json.incomplete).toBe(4);
      const listed = await call(t.public, "GET", at(w, "/submissions?incomplete=true"), {
        cookie: cookies.chair,
      });
      expect((listed.json.items as { id: string }[]).map((x) => x.id).sort()).toEqual(
        [subs.second, subs.third, subs.leaves, subs.own].sort(),
      );
    } finally {
      await saveConference(t.db, k.config);
    }
  });

  it("a decided proposal takes no new reviewer, is not withdrawn or edited by its owner, and its reviewers still read it", async () => {
    const more = await assign(w, cookies.chair, subs.main, ids.released);
    expect([more.status, more.json]).toEqual([409, { error: "not_under_consideration" }]);
    const assignments = await call(t.public, "GET", at(w, "/assignments"), {
      cookie: cookies.chair,
    });
    const listed = (assignments.json.pools as { items: { id: string }[] }[]).flatMap((p) =>
      p.items.map((x) => x.id),
    );
    expect(listed.sort()).toEqual([subs.second, subs.performance].sort());
    const now = await call(t.public, "GET", `/api/submissions/${subs.main}`, {
      cookie: cookies.owner,
    });
    for (const action of ["withdraw", "unsubmit"]) {
      const res = await call(t.public, "POST", `/api/submissions/${subs.main}/${action}`, {
        cookie: cookies.owner,
        body: { version: now.json.version },
      });
      expect(res.status, action).toBe(403);
    }
    const edit = await call(t.public, "PATCH", `/api/submissions/${subs.main}`, {
      cookie: cookies.owner,
      body: { version: now.json.version, title: "Another title" },
    });
    expect(edit.status).toBe(403);
    expect(await statusOf(t, subs.main)).toBe("accepted");
    // Its reviewers read it and their own reviews, as the People page still counts it for them.
    expect(
      (await call(t.public, "GET", `/api/submissions/${subs.main}`, { cookie: cookies.r1 })).status,
    ).toBe(200);
    const mine = await call(t.public, "GET", "/api/me/reviews", { cookie: cookies.r1 });
    expect(
      (mine.json.conferences[0].proposals as { submissionId: string }[]).map((p) => p.submissionId),
    ).toContain(subs.main);
  });
});

describe("the emails about a decision, in a conference's own words", () => {
  it("are sent as the chairs reworded them, with or without the comments, and cleaned whatever the text says", async () => {
    const room = await world(t, "decide-worded");
    const chair = cookies.chair;
    await grantRole(t.db, { conferenceId: room.conferenceId, personId: ids.chair, role: "chair" });
    const author = await room.person(mail("worded-author"), "Wanda Wordedauthor");
    const first = await proposal(room, author, "A title\u202E on two\nlines");
    const second = await proposal(room, author, "Another talk");
    await closeCall(room);
    const reviewerId = await reviewer(room, mail("r1"), [POOL_A]);
    for (const id of [first, second]) {
      expect((await assign(room, chair, id, reviewerId)).status).toBe(204);
    }
    expect((await movePhase(room, chair, "reviewing", "cfp_open")).status).toBe(200);
    // What a reviewer may type: invisible characters, every kind of line break, a placeholder.
    const typed =
      "First\u200B line {link}\r\nsecond line\u2028third\tline   \n\n\n\nA last paragraph.\u202E";
    secrets.push("First\u200B line");
    expect(
      (
        await sendReview(
          t,
          { cookie: cookies.r1 },
          first,
          complete(CRITERIA_A, typed, "", "accept"),
        )
      ).status,
    ).toBe(200);
    const long = `${words(900, "long")} THE-END`;
    expect(
      (
        await sendReview(
          t,
          { cookie: cookies.r1 },
          second,
          complete(CRITERIA_A, long, "", "reject"),
        )
      ).status,
    ).toBe(200);
    expect((await movePhase(room, chair, "deciding", "reviewing")).status).toBe(200);

    const got = await call(t.public, "GET", at(room, "/settings"), { cookie: chair });
    const config = structuredClone(got.json.config) as ConferenceConfig;
    config.messages = {
      decision_accepted: {
        subject: { en: "[worded] {conference}: {title} ({format}) {comments} {link}" },
        body: { en: "[worded] {title} | {format} | {conference}\n\n{comments}\n\n{link}" },
      },
      // A rewording may leave the comments out.
      decision_rejected: { body: { en: "[worded] No, for {title}.\n\n{link}" } },
    };
    const saved = await call(t.public, "PUT", at(room, "/config"), {
      cookie: chair,
      ifMatch: got.json.token,
      body: config,
    });
    // A subject cannot hold the comments or the link: it is refused, and nothing is stored.
    expect(saved.status).toBe(400);
    config.messages = {
      ...config.messages,
      decision_accepted: {
        subject: { en: "[worded] {conference}: {title} ({format})" },
        body: config.messages?.decision_accepted?.body,
      },
    };
    expect(
      (
        await call(t.public, "PUT", at(room, "/config"), {
          cookie: chair,
          ifMatch: got.json.token,
          body: config,
        })
      ).status,
    ).toBe(200);

    expect((await record(room, { cookie: chair }, first, "accepted")).status).toBe(204);
    expect((await record(room, { cookie: chair }, second, "rejected")).status).toBe(204);
    expect((await sendNow(room, chair)).status).toBe(200);
    const told = await decisionMail(t, mail("worded-author"));
    expect(told).toHaveLength(2);
    const accepted = told.find((m) => m.kind === "decision_accepted");
    const rejected = told.find((m) => m.kind === "decision_rejected");
    const link = `${ORIGIN}/en/s/${first}`;
    // The title on one line and the comments as plain text of several lines, without what
    // cannot be seen; and a placeholder a reviewer typed stays those six characters.
    expect(accepted?.subject).toBe("[worded] Test call: A title on two lines (Individual talk)");
    expect(accepted?.text).toBe(
      [
        "[worded] A title on two lines | Individual talk | Test call",
        "Comments from the reviewers:",
        "Reviewer 1:\nFirst line {link}\nsecond line\nthird line\n\nA last paragraph.",
        link,
      ].join("\n\n"),
    );
    expect(rejected?.subject).toBe("Test call: your proposal was not accepted");
    expect(rejected?.text).toBe(`[worded] No, for Another talk.\n\n${ORIGIN}/en/s/${second}`);
    // What was stored for the authors' page is what the reviewer wrote, whole: also the long one.
    expect((await authorView(t, { cookie: author }, first)).json.comments).toEqual([typed]);
    expect((await authorView(t, { cookie: author }, second)).json.comments).toEqual([long]);

    // Comments longer than an email carries are cut there, and the email says so, with the link.
    const config2 = (await call(t.public, "GET", at(room, "/settings"), { cookie: chair })).json;
    const standard = structuredClone(config2.config) as ConferenceConfig;
    delete standard.messages;
    expect(
      (
        await call(t.public, "PUT", at(room, "/config"), {
          cookie: chair,
          ifMatch: config2.token,
          body: standard,
        })
      ).status,
    ).toBe(200);
    const third = await t.db
      .insert(submissions)
      .values({
        conferenceId: room.conferenceId,
        ownerPersonId: await room.id(mail("worded-author")),
        typeKey: "talk",
        language: "en",
        title: "A talk with a very long review",
        abstract: words(260),
        status: "submitted",
        submittedAt: NOW,
      })
      .returning({ id: submissions.id });
    const thirdId = third[0]?.id ?? "";
    await t.db.insert(reviews).values({
      conferenceId: room.conferenceId,
      submissionId: thirdId,
      reviewerId,
      status: "sent",
      sentAt: NOW,
      comments: long,
    });
    expect((await record(room, { cookie: chair }, thirdId, "waitlisted")).status).toBe(204);
    expect((await sendNow(room, chair)).status).toBe(200);
    const [cut] = (await decisionMail(t, mail("worded-author"))).slice(-1);
    expect(cut?.kind).toBe("decision_waitlisted");
    expect(cut?.text).not.toContain("THE-END");
    expect(cut?.text).toContain(
      `long…\n[This comment is longer than an email carries. All of it is on the proposal's page:]\n${ORIGIN}/en/s/${thirdId}\n\nYou can also read this`,
    );
    expect((cut?.text ?? "").length).toBeLessThan(4_700);
  });
});

describe("the conference seeded for trying decisions", () => {
  it("is in `deciding`, with reviewed talks, and one of its chair's own that a co-chair decided", async () => {
    await findOrCreatePerson(t.db, "decide-seedchair@example.org");
    const seeded = await seedDecisionsRoom(t.db, {
      slug: "decide-seeded",
      chairEmail: "decide-seedchair@example.org",
    });
    const cookie = await signIn(t, "decide-seedchair@example.org");
    const listed = await call(t.public, "GET", at(seeded.slug, "/decisions"), { cookie });
    expect(listed.json).toMatchObject({ canRecord: true, canSend: true, excluded: 1 });
    expect(
      listed.json.pools[0].items.map((x: { title: string; sent: number }) => [x.title, x.sent]),
    ).toEqual([
      ["Decisions room: a talk with two reviews", 2],
      ["Decisions room: a talk with one review", 1],
      ["Decisions room: a talk for the waiting list", 1],
      ["Decisions room: a talk nobody has reviewed", 0],
    ]);
    const asked = await call(t.public, "GET", at(seeded.slug, "/decisions/send"), { cookie });
    expect(asked.json).toMatchObject({
      accepted: 1,
      waitlisted: 0,
      rejected: 0,
      people: 1,
      undecided: 4,
    });
  });
});

describe("what the database itself holds to", () => {
  it("one decision waiting for a proposal, an outcome out of three, and sent only with what was sent", async () => {
    const waiting = {
      conferenceId: w.conferenceId,
      submissionId: subs.performance,
      decidedAt: NOW,
    };
    await t.db.insert(decisions).values({ ...waiting, outcome: "accepted" });
    await expect(
      t.db.insert(decisions).values({ ...waiting, outcome: "rejected" }),
    ).rejects.toThrow();
    await expect(t.db.insert(decisions).values({ ...waiting, outcome: "maybe" })).rejects.toThrow();
    // Sent without what was sent, or with it and not sent: neither is a decision.
    await t.db.delete(decisions).where(eq(decisions.submissionId, subs.performance));
    await expect(
      t.db.insert(decisions).values({ ...waiting, outcome: "accepted", sentAt: NOW }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(decisions).values({ ...waiting, outcome: "accepted", comments: [] }),
    ).rejects.toThrow();
    // Any number that were sent, beside the one that waits.
    await t.db.insert(decisions).values([
      { ...waiting, outcome: "waitlisted", sentAt: NOW, comments: [] },
      { ...waiting, outcome: "accepted" },
    ]);
    expect(await decisionRows(t, subs.performance)).toHaveLength(2);
    await t.db.delete(decisions).where(eq(decisions.submissionId, subs.performance));
  });

  it("a decision goes with its proposal, and outlives the chairs it names", async () => {
    const gone = await world(t, "decide-gone");
    const owner = await gone.person(mail("gone-owner"), "Gus Goneowner");
    const kept = await proposal(gone, owner, "A talk whose chair goes");
    const deleted = await draft(gone, owner, "A draft that is deleted");
    const decider = await findOrCreatePerson(t.db, mail("gone-decider"));
    for (const submissionId of [kept, deleted.id]) {
      await t.db.insert(decisions).values({
        conferenceId: gone.conferenceId,
        submissionId,
        outcome: "accepted",
        decidedByPersonId: decider.id,
        decidedAt: NOW,
      });
    }
    // An owner deleting a draft never fails on it, and nothing is left of it.
    const res = await call(t.public, "DELETE", `/api/submissions/${deleted.id}`, {
      cookie: owner,
      body: { version: deleted.version },
    });
    expect(res.status).toBe(204);
    expect(await decisionRows(t, deleted.id)).toEqual([]);
    const { people } = await import("./db/schema");
    await t.db.delete(people).where(eq(people.id, decider.id));
    expect((await decisionRows(t, kept)).map((d) => [d.outcome, d.decidedByPersonId])).toEqual([
      ["accepted", null],
    ]);
  });
});

describe("the audit log", () => {
  it("has a row for every decision recorded, changed, taken back and sent, with ids and the outcome and never a word", async () => {
    const rows = await t.db.select().from(auditLog).where(like(auditLog.action, "decision.%"));
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) {
      expect(row.targetType).toBe("submission");
      expect(row.actorKind).toBe("human");
      expect(Object.keys(row.details as object).sort()).toEqual(["decisionId", "outcome"]);
      expect(["accepted", "waitlisted", "rejected"]).toContain(
        (row.details as { outcome: string }).outcome,
      );
    }
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "decision.recorded",
        "decision.changed",
        "decision.taken_back",
        "decision.sent",
        "decision.dropped",
      ]),
    );
    const all = await t.db.select().from(auditLog);
    expect(
      findLeaks(
        all,
        secrets.filter((x) => x.length > 6),
      ),
    ).toEqual([]);
  });
});

/*
 * The in-memory database runs one transaction at a time. Against a real Postgres
 * (TEST_DATABASE_URL, as for reviews.test.ts), requests really do run at once. Run this file on
 * its own:
 *
 *   docker run --rm -d --name elochair-decisions -e POSTGRES_PASSWORD=decisions \
 *     -p 127.0.0.1:55436:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:decisions@127.0.0.1:55436/postgres \
 *     npx vitest run apps/server/src/decisions.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "on Postgres, requests made at the same moment",
  () => {
    let pg: TestApp;
    let p: World;
    const run = Date.now();
    let chair: string;
    let second: string;
    let owner: string;
    let ownerId: string;
    const address = (who: string) => `decide-pg-${run}-${who}@example.org`;
    const within = <T>(promise: Promise<T>, ms: number): Promise<T | "waiting"> =>
      Promise.race([promise, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);
    /**
     * A request that starts a little after the one beside it, later in each round: so that over
     * the rounds each of the two is sometimes the first to take the proposal's row.
     */
    const later = <T>(round: number, request: () => Promise<T>): Promise<T> =>
      new Promise<void>((r) => setTimeout(r, round % 8)).then(request);
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
    /** A new submitted talk by the owner, as the table holds one (the call has closed). */
    async function talk(title: string) {
      const [row] = await pg.db
        .insert(submissions)
        .values({
          conferenceId: p.conferenceId,
          ownerPersonId: ownerId,
          typeKey: "talk",
          language: "en",
          title,
          abstract: words(260),
          status: "submitted",
          submittedAt: NOW,
        })
        .returning({ id: submissions.id, version: submissions.version });
      if (!row) throw new Error("no talk");
      const { contributions } = await import("./db/schema");
      await pg.db
        .insert(contributions)
        .values({ submissionId: row.id, personId: ownerId, role: "lead", position: 0 });
      return row;
    }
    const mailed = async (ids: string[]) => {
      const rows = await pg.db.select().from(outbox).where(like(outbox.kind, "decision_%"));
      return rows.filter((m) => ids.some((id) => m.bodyText.includes(id)));
    };
    /** Decisions left waiting by one test are sent before the next, so that each starts clean. */
    async function settle() {
      for (let i = 0; i < 5; i++) {
        const res = await sendNow(p, chair);
        if (res.status !== 409 || res.json.error !== "stale") return;
      }
    }

    beforeAll(async () => {
      pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
      lifted(pg);
      // A call of its own each run: the database may still hold an earlier run's rows.
      p = await world(pg, `decide-pg-${run}`);
      chair = await p.person(address("chair"), "Chair Postgres");
      second = await p.person(address("second"), "Second Postgres");
      for (const who of ["chair", "second"]) {
        await grantRole(pg.db, {
          conferenceId: p.conferenceId,
          personId: await p.id(address(who)),
          role: "chair",
        });
      }
      owner = await p.person(address("owner"), "Owner Postgres");
      ownerId = await p.id(address("owner"));
      await closeCall(p);
      expect((await movePhase(p, chair, "reviewing", "cfp_open")).status).toBe(200);
      expect((await movePhase(p, chair, "deciding", "reviewing")).status).toBe(200);
    }, 240_000);
    afterAll(() => pg?.close());

    it("two chairs who send at the same moment send once", async () => {
      for (let round = 0; round < 8; round++) {
        const talks = [];
        for (let i = 0; i < 6; i++) talks.push(await talk(`A talk sent once ${round}-${i}`));
        for (const [i, s] of talks.entries()) {
          const outcome = ["accepted", "waitlisted", "rejected"][i % 3];
          expect((await record(p, { cookie: chair }, s.id, outcome)).status).toBe(204);
        }
        const asked = await confirmation(p, { cookie: chair });
        expect(asked.json).toMatchObject({ accepted: 2, waitlisted: 2, rejected: 2, people: 1 });
        const sends = await Promise.all([
          send(p, { cookie: chair }, asked.json.token),
          send(p, { cookie: second }, asked.json.token),
          send(p, { cookie: chair }, asked.json.token),
        ]);
        expect(sends.map((s) => s.status).sort(), `round ${round}`).toEqual([200, 409, 409]);
        for (const lost of sends.filter((s) => s.status === 409)) {
          // The others found the decisions sent: nothing waits, which is not what they confirmed.
          expect(lost.json.error, `round ${round}`).toBe("stale");
          expect(lost.json.summary, `round ${round}`).toMatchObject({
            accepted: 0,
            waitlisted: 0,
            rejected: 0,
          });
        }
        // One email for each proposal, one audit row, and each decision sent once.
        const ids = talks.map((s) => s.id);
        expect(await mailed(ids), `round ${round}`).toHaveLength(6);
        const rows = await pg.db
          .select()
          .from(decisions)
          .where(inArray(decisions.submissionId, ids));
        expect(
          rows.filter((d) => d.sentAt !== null),
          `round ${round}`,
        ).toHaveLength(6);
        const audits = await pg.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.action, "decision.sent"), inArray(auditLog.targetId, ids)));
        expect(audits, `round ${round}`).toHaveLength(6);
      }
    }, 240_000);

    it("a send while a decision is changed: what goes out is what a chair confirmed, or nothing does", async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 16; round++) {
        const s = await talk(`A talk decided twice ${round}`);
        const other = await talk(`A talk beside it ${round}`);
        expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
        expect((await record(p, { cookie: chair }, other.id, "accepted")).status).toBe(204);
        const asked = await confirmation(p, { cookie: chair });
        const [sent, changed] = await Promise.all([
          send(p, { cookie: chair }, asked.json.token),
          later(round, () => record(p, { cookie: second }, s.id, "rejected")),
        ]);
        outcomes.add(`${sent.status}/${changed.status}`);
        const mails = await mailed([s.id, other.id]);
        if (sent.status === 200) {
          // The send went first, with what was confirmed: the change found the decision sent.
          expect([changed.status, changed.json], `round ${round}`).toEqual([
            409,
            { error: "decided" },
          ]);
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("accepted");
          expect(
            mails.map((m) => m.kind),
            `round ${round}`,
          ).toEqual(["decision_accepted", "decision_accepted"]);
        } else {
          // The change went first: the send was no longer what was confirmed, and sent nothing,
          // not for this proposal and not for the one beside it.
          expect(changed.status, `round ${round}`).toBe(204);
          expect([sent.status, sent.json.error], `round ${round}`).toEqual([409, "stale"]);
          expect(sent.json.summary, `round ${round}`).toMatchObject({ accepted: 1, rejected: 1 });
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("submitted");
          expect(await statusOf(pg, other.id), `round ${round}`).toBe("submitted");
          expect(mails, `round ${round}`).toEqual([]);
          // Confirmed as it is now, it goes out as it is now.
          expect((await send(p, { cookie: chair }, sent.json.summary.token)).status).toBe(200);
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("rejected");
          expect(
            (await mailed([s.id])).map((m) => m.kind),
            `round ${round}`,
          ).toEqual(["decision_rejected"]);
        }
        // Never a status that is not the decision that was sent.
        const [row] = await pg.db.select().from(decisions).where(eq(decisions.submissionId, s.id));
        expect(row?.outcome, `round ${round}`).toBe(await statusOf(pg, s.id));
        expect(row?.sentAt, `round ${round}`).not.toBeNull();
      }
      expect([...outcomes].filter((o) => !["200/409", "409/204"].includes(o))).toEqual([]);
    }, 240_000);

    it("a send while its proposal is withdrawn: sent and no longer withdrawn, or withdrawn and never sent", async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 16; round++) {
        const s = await talk(`A talk withdrawn at the last moment ${round}`);
        expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
        const asked = await confirmation(p, { cookie: chair });
        const [sent, gone] = await Promise.all([
          send(p, { cookie: chair }, asked.json.token),
          later(round, () =>
            call(pg.public, "POST", `/api/submissions/${s.id}/withdraw`, {
              cookie: owner,
              body: { version: s.version },
            }),
          ),
        ]);
        outcomes.add(`${sent.status}/${gone.status}`);
        if (sent.status === 200) {
          // The send went first: the proposal is accepted, and is no longer its owner's to
          // withdraw (the page they pressed on was out of date).
          expect([403, 409], `round ${round}`).toContain(gone.status);
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("accepted");
          expect(
            (await mailed([s.id])).map((m) => m.kind),
            `round ${round}`,
          ).toEqual(["decision_accepted"]);
        } else {
          // The withdrawal went first: nothing is sent for it, now or later.
          expect(gone.status, `round ${round}`).toBe(200);
          expect([sent.status, sent.json.error], `round ${round}`).toEqual([409, "stale"]);
          expect(sent.json.summary, `round ${round}`).toMatchObject({ accepted: 0, dropped: 1 });
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("withdrawn");
          // Confirmed as it is now, there is nothing to send: its decision is all that waits.
          const again = await send(p, { cookie: chair }, sent.json.summary.token);
          expect([again.status, again.json], `round ${round}`).toEqual([
            409,
            { error: "nothing_to_send" },
          ]);
          expect(await statusOf(pg, s.id), `round ${round}`).toBe("withdrawn");
          expect(await mailed([s.id]), `round ${round}`).toEqual([]);
          // A chair takes it back, and nothing waits for the next round.
          expect((await takeBack(p, { cookie: chair }, s.id)).status, `round ${round}`).toBe(204);
          expect(
            await pg.db.select().from(decisions).where(eq(decisions.submissionId, s.id)),
            `round ${round}`,
          ).toEqual([]);
        }
      }
      expect([...outcomes].filter((o) => !/^(200\/(403|409)|409\/200)$/.test(o))).toEqual([]);
    }, 240_000);

    it("a send waits for a withdrawal under way, and then does not send for that proposal", async () => {
      const s = await talk("A talk being withdrawn");
      expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
      const asked = await confirmation(p, { cookie: chair });
      // The withdrawal as it stands after its locks and its write, before it commits.
      const withdrawal = hold(async (tx) => {
        await tx.select().from(submissions).where(eq(submissions.id, s.id)).for("update");
        await shareConference(tx, p.conferenceId);
        await tx.update(submissions).set({ status: "withdrawn" }).where(eq(submissions.id, s.id));
      });
      await withdrawal.ready;
      const sending = send(p, { cookie: chair }, asked.json.token);
      try {
        expect(await within(sending, 500)).toBe("waiting");
      } finally {
        await withdrawal.release();
      }
      const sent = await sending;
      expect([sent.status, sent.json.error]).toEqual([409, "stale"]);
      expect(sent.json.summary).toMatchObject({ accepted: 0, dropped: 1 });
      expect(await statusOf(pg, s.id)).toBe("withdrawn");
      expect(await mailed([s.id])).toEqual([]);
      expect((await takeBack(p, { cookie: chair }, s.id)).status).toBe(204);
    }, 60_000);

    it("a withdrawal and a change of the decision wait for a send under way, and then find it sent", async () => {
      const s = await talk("A talk whose decision is on its way");
      expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
      // The send as it stands after its locks and its writes, before it commits.
      const sending = hold(async (tx) => {
        await tx.select().from(submissions).where(eq(submissions.id, s.id)).for("no key update");
        await lockRoles(tx, p.conferenceId, "shared");
        await shareConference(tx, p.conferenceId);
        await tx.update(submissions).set({ status: "accepted" }).where(eq(submissions.id, s.id));
        await tx
          .update(decisions)
          .set({ sentAt: NOW, comments: [] })
          .where(eq(decisions.submissionId, s.id));
      });
      await sending.ready;
      const withdrawing = call(pg.public, "POST", `/api/submissions/${s.id}/withdraw`, {
        cookie: owner,
        body: { version: s.version },
      });
      const changing = record(p, { cookie: second }, s.id, "rejected");
      const takingBack = takeBack(p, { cookie: second }, s.id);
      try {
        expect(await within(withdrawing, 500)).toBe("waiting");
        expect(await within(changing, 100)).toBe("waiting");
        expect(await within(takingBack, 100)).toBe("waiting");
      } finally {
        await sending.release();
      }
      expect((await withdrawing).status).toBe(403);
      expect([(await changing).status, (await changing).json]).toEqual([409, { error: "decided" }]);
      expect([(await takingBack).status, (await takingBack).json]).toEqual([
        409,
        { error: "no_decision" },
      ]);
      expect(await statusOf(pg, s.id)).toBe("accepted");
    }, 60_000);

    it("a send waits for a phase move and for a settings save under way, and goes by what they leave", async () => {
      const s = await talk("A talk sent after the phase moved");
      expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
      const asked = await confirmation(p, { cookie: chair });
      const { conferences } = await import("./db/schema");
      // A chair takes the conference back into review: the reviews can change again.
      const moving = hold(async (tx) => {
        await tx.select().from(conferences).where(eq(conferences.id, p.conferenceId)).for("update");
        await tx
          .update(conferences)
          .set({ phase: "reviewing" })
          .where(eq(conferences.id, p.conferenceId));
      });
      await moving.ready;
      const sending = send(p, { cookie: chair }, asked.json.token);
      try {
        expect(await within(sending, 500)).toBe("waiting");
      } finally {
        await moving.release();
      }
      const refused = await sending;
      expect([refused.status, refused.json]).toEqual([409, { error: "not_deciding" }]);
      expect(await statusOf(pg, s.id)).toBe("submitted");
      expect((await movePhase(p, chair, "deciding", "reviewing")).status).toBe(200);
      await settle();
      expect(await statusOf(pg, s.id)).toBe("accepted");
    }, 60_000);

    it("two chairs who record for one proposal at the same moment leave one decision", async () => {
      for (let round = 0; round < 12; round++) {
        const s = await talk(`A talk two chairs decide ${round}`);
        const both = await Promise.all([
          record(p, { cookie: chair }, s.id, "accepted"),
          record(p, { cookie: second }, s.id, "rejected"),
        ]);
        expect(
          both.map((r) => r.status),
          `round ${round}`,
        ).toEqual([204, 204]);
        const rows = await pg.db.select().from(decisions).where(eq(decisions.submissionId, s.id));
        expect(rows, `round ${round}`).toHaveLength(1);
        expect(["accepted", "rejected"], `round ${round}`).toContain(rows[0]?.outcome);
        const audits = await pg.db
          .select()
          .from(auditLog)
          .where(and(like(auditLog.action, "decision.%"), eq(auditLog.targetId, s.id)))
          .orderBy(auditLog.id);
        expect(
          audits.map((a) => a.action),
          `round ${round}`,
        ).toEqual(["decision.recorded", "decision.changed"]);
        expect(audits[1]?.details, `round ${round}`).toMatchObject({ outcome: rows[0]?.outcome });
      }
      await settle();
    }, 240_000);

    it("sends, decisions, withdrawals, a chair's removal, a settings save and a phase move all at once all finish", async () => {
      const removed = await p.person(address("removed"), "Removed Postgres");
      const removedId = await p.id(address("removed"));
      for (let round = 0; round < 6; round++) {
        await grantRole(pg.db, {
          conferenceId: p.conferenceId,
          personId: removedId,
          role: "chair",
        });
        const talks = [];
        for (let i = 0; i < 8; i++)
          talks.push(await talk(`A talk in the middle of it ${round}-${i}`));
        for (const s of talks.slice(0, 5)) {
          expect((await record(p, { cookie: chair }, s.id, "accepted")).status).toBe(204);
        }
        const asked = await confirmation(p, { cookie: chair });
        const got = await call(pg.public, "GET", at(p, "/settings"), { cookie: chair });
        const config = structuredClone(got.json.config) as ConferenceConfig;
        config.messages = {
          decision_accepted: { subject: { en: `{conference}: accepted, round ${round}` } },
        };
        const all = Promise.all([
          send(p, { cookie: chair }, asked.json.token),
          send(p, { cookie: second }, asked.json.token),
          send(p, { cookie: removed }, asked.json.token),
          ...talks.slice(5).map((s) => record(p, { cookie: second }, s.id, "rejected")),
          record(p, { cookie: removed }, talks[0]?.id ?? "", "waitlisted"),
          takeBack(p, { cookie: second }, talks[1]?.id ?? ""),
          call(pg.public, "POST", `/api/submissions/${talks[2]?.id}/withdraw`, {
            cookie: owner,
            body: { version: talks[2]?.version },
          }),
          call(pg.public, "DELETE", at(p, `/people/${removedId}/roles/chair`), {
            cookie: chair,
            body: {},
          }),
          call(pg.public, "PUT", at(p, "/config"), {
            cookie: chair,
            ifMatch: got.json.token,
            body: config,
          }),
          movePhase(p, second, "confirming", "deciding"),
        ]);
        // Nobody waits on the one waiting for them: all of it is answered.
        const done = await within(all, 30_000);
        expect(done, `round ${round}`).not.toBe("waiting");
        if (done === "waiting") return;
        expect(done.map((r) => r.status).filter((status) => status >= 500)).toEqual([]);
        // Whatever happened, a proposal's status is the decision that was sent for it, or it
        // has none that was sent.
        for (const s of talks) {
          const status = await statusOf(pg, s.id);
          const rows = await pg.db.select().from(decisions).where(eq(decisions.submissionId, s.id));
          const sent = rows.filter((d) => d.sentAt !== null);
          expect(rows.filter((d) => d.sentAt === null).length).toBeLessThanOrEqual(1);
          if (status === "submitted" || status === "withdrawn") expect(sent).toEqual([]);
          else expect(sent.map((d) => d.outcome)).toEqual([status]);
        }
        // Back to `deciding`, with nothing waiting, for the next round.
        const k = await getConference(pg.db, p.slug);
        if (k?.phase === "confirming") {
          expect((await movePhase(p, chair, "deciding", "confirming", true)).status).toBe(200);
        }
        await settle();
      }
    }, 240_000);
  },
);
