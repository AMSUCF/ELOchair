import { findLeaks } from "@elochair/policy/testing";
import type { ConferenceConfig } from "@elochair/schema";
import { and, eq, like, or } from "drizzle-orm";
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
  reviews,
  submissions,
} from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { RateLimiter } from "./ratelimit";
import {
  createApiToken,
  getConference,
  grantRole,
  lockConference,
  saveConference,
  shareConference,
} from "./repo";
import { lockRoles } from "./services/roles";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Reviews (spec 03, §1.4, §1.5 and §1.8): a reviewer's own list, the review of one proposal (a
 * draft, then sent, then changed for as long as the conference is in review), "I cannot review
 * this", what the chairs are shown of it all, that sent reviews stay valid when the settings
 * change, and what none of it may reveal. The last part runs only against a real Postgres, and
 * shows what holds when requests arrive at the same moment.
 */

const NOW = new Date("2027-02-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const SLUG = "review-call";
const EARLY = "review-early";
const LATE = "review-late";
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
/** The fixture call reviews talks in the first pool, anonymized, and performances in the second. */
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
  person: (email: string, name?: string) => Promise<string>;
  id: (email: string) => Promise<string>;
};

/** Everything a person typed in these tests: none of it may reach the audit log. */
const secrets: string[] = [];
/** Text written in reviews and in notes: it reaches the people the policy names, and nobody else. */
const text = (what: string) => {
  const marked = `REVIEWTEXT ${what}`;
  secrets.push(marked);
  return marked;
};

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

/** A proposal by `owner`, filled in and submitted: a talk unless told otherwise. */
async function proposal(
  w: World,
  owner: string,
  title: string,
  type: "talk" | "performance" = "talk",
): Promise<string> {
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
  const res = await call(w.t.public, "POST", `/api/submissions/${created.json.id}/submit`, {
    cookie: owner,
    body: { version: filled.json.version, acceptedAgreements: AGREEMENTS },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return created.json.id;
}

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

type Content = {
  scores: Record<string, number>;
  comments: string;
  chairNote: string;
  recommendation: "accept" | "unsure" | "reject" | null;
};
const EMPTY: Content = { scores: {}, comments: "", chairNote: "", recommendation: null };
/** A review of a talk that can be sent: every criterion scored, comments, a recommendation. */
const complete = (comments: string, more: Partial<Content> = {}): Content => ({
  scores: Object.fromEntries(CRITERIA_A.map((key) => [key, 4])),
  comments,
  chairNote: "",
  recommendation: "accept",
  ...more,
});

const readReview = (t: TestApp, who: Who, id: string) =>
  call(t.public, "GET", `/api/submissions/${id}/review`, who);
const saveReview = (
  t: TestApp,
  who: Who,
  id: string,
  version: number,
  send: boolean,
  content: Content,
) =>
  call(t.public, "PUT", `/api/submissions/${id}/review`, {
    ...who,
    body: { version, send, ...content },
  });
const decline = (t: TestApp, who: Who, id: string, body: unknown) =>
  call(t.public, "POST", `/api/submissions/${id}/review/decline`, { ...who, body });
const myReviews = (t: TestApp, who: Who) => call(t.public, "GET", "/api/me/reviews", who);

type Section = {
  assigned: {
    personId: string;
    blocked: boolean;
    review: (Content & { sentAt: string; changedAt: string | null }) | null;
  }[];
  otherReviews: { personId: string }[];
  declined: { personId: string; reason: string; note: string | null; at: string }[];
  candidates: { personId: string }[];
};
/** The Reviewers section of a proposal, as a chair who manages it is given it. */
async function section(w: World, chair: string, id: string): Promise<Section> {
  const res = await call(w.t.public, "GET", at(w, `/assignments/submissions/${id}`), {
    cookie: chair,
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json;
}
const reviewRows = (t: TestApp, submissionId: string) =>
  t.db.select().from(reviews).where(eq(reviews.submissionId, submissionId));
const assignmentRows = (t: TestApp, submissionId: string) =>
  t.db.select().from(assignments).where(eq(assignments.submissionId, submissionId));
const releaseRows = (t: TestApp, submissionId: string) =>
  t.db
    .select()
    .from(assignmentReleases)
    .where(eq(assignmentReleases.submissionId, submissionId))
    .orderBy(assignmentReleases.releasedAt, assignmentReleases.id);
const audited = async (t: TestApp, conferenceId: string, since = 0) =>
  (
    await t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.conferenceId, conferenceId),
          or(
            like(auditLog.action, "review.%"),
            like(auditLog.action, "assignment.%"),
            like(auditLog.action, "conflict.%"),
            like(auditLog.action, "role.%"),
          ),
        ),
      )
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

/** The stored configuration, to change and send back, with the token a save is based on. */
async function stored(w: World, chair: string) {
  const got = await call(w.t.public, "GET", at(w, "/settings"), { cookie: chair });
  expect(got.status).toBe(200);
  return {
    config: structuredClone(got.json.config) as ConferenceConfig,
    token: got.json.token as string,
  };
}
const preview = (w: World, chair: string, config: ConferenceConfig, token: string) =>
  call(w.t.public, "POST", at(w, "/config/preview"), {
    cookie: chair,
    ifMatch: token,
    body: config,
  });
const saveConfig = (w: World, chair: string, config: ConferenceConfig, token: string) =>
  call(w.t.public, "PUT", at(w, "/config"), { cookie: chair, ifMatch: token, body: config });
/** One change to the stored configuration: what a review of it says, without saving. */
async function reviewOf(w: World, chair: string, change: (config: ConferenceConfig) => void) {
  const { config, token } = await stored(w, chair);
  change(config);
  const res = await preview(w, chair, config, token);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as {
    issues: { path: string; code: string; params?: Record<string, number> }[];
    canSave: boolean;
    changes: { path: string }[];
  };
}
const poolIn = (config: ConferenceConfig, key: string) => {
  const pool = config.reviewPools.find((p) => p.key === key);
  if (!pool) throw new Error(`no pool ${key}`);
  return pool;
};
const criterionIn = (config: ConferenceConfig, pool: string, key: string) => {
  const criterion = poolIn(config, pool).criteria.find((c) => c.key === key);
  if (!criterion) throw new Error(`no criterion ${key}`);
  return criterion;
};

let t: TestApp;
let w: World;
let early: World;
let late: World;
const cookies = {} as Record<
  | "chair"
  | "authorChair"
  | "conflictedChair"
  | "track"
  | "owner"
  | "stranger"
  | "r1"
  | "r2"
  | "r3"
  | "r4"
  | "other",
  string
>;
const ids = {} as Record<keyof typeof cookies, string>;
const mail = (who: string) => `review-${who.toLowerCase()}@example.org`;
/** Proposals of the conference in review, by what they are for. */
const subs = {} as Record<
  | "main"
  | "second"
  | "third"
  | "own"
  | "conflicted"
  | "performance"
  | "time"
  | "conflict"
  | "expertise"
  | "removal",
  string
>;
let earlyTalk: string;
let lateTalk: string;
let agentM: string;
let agentC: string;

beforeAll(async () => {
  t = await makeTestApp();
  lifted(t);
  w = await world(t, SLUG);
  early = await world(t, EARLY);
  late = await world(t, LATE);

  const names: Record<keyof typeof cookies, string> = {
    chair: "Cora Chairperson",
    authorChair: "Aura Authorchair",
    conflictedChair: "Cleo Conflictedchair",
    track: "Tariq Trackchair",
    owner: "Olga Ownerperson",
    stranger: "Stella Stranger",
    r1: "Rhea Reviewerone",
    r2: "Rolf Reviewertwo",
    r3: "Runa Reviewerthree",
    r4: "Remy Reviewerfour",
    other: "Otto Otherpool",
  };
  for (const who of Object.keys(names) as (keyof typeof cookies)[]) {
    cookies[who] = await w.person(mail(who), names[who]);
    ids[who] = await w.id(mail(who));
  }
  for (const to of [w, early, late]) {
    await grantRole(t.db, { conferenceId: to.conferenceId, personId: ids.chair, role: "chair" });
    await reviewer(to, mail("r1"), [POOL_A]);
  }
  await grantRole(t.db, { conferenceId: w.conferenceId, personId: ids.authorChair, role: "chair" });
  await grantRole(t.db, {
    conferenceId: w.conferenceId,
    personId: ids.conflictedChair,
    role: "chair",
  });
  await grantRole(t.db, { conferenceId: w.conferenceId, personId: ids.track, role: "track_chair" });
  for (const who of ["r2", "r3", "r4"] as const) await reviewer(w, mail(who), [POOL_A]);
  await reviewer(w, mail("other"), [POOL_B]);

  subs.main = await proposal(w, cookies.owner, "The main talk");
  subs.second = await proposal(w, cookies.owner, "A second talk");
  subs.third = await proposal(w, cookies.owner, "A third talk");
  subs.own = await proposal(w, cookies.authorChair, "A chair's own talk");
  subs.conflicted = await proposal(w, cookies.owner, "A talk a chair has a conflict with");
  subs.performance = await proposal(w, cookies.owner, "A performance", "performance");
  subs.time = await proposal(w, cookies.owner, "A talk nobody has time for");
  subs.conflict = await proposal(w, cookies.owner, "A talk someone knows the author of");
  subs.expertise = await proposal(w, cookies.owner, "A talk outside someone's field");
  subs.removal = await proposal(w, cookies.owner, "A talk that loses a reviewer");
  earlyTalk = await proposal(early, cookies.owner, "A talk before the review");
  lateTalk = await proposal(late, cookies.owner, "A talk after the review");
  await t.db.insert(conflicts).values({
    conferenceId: w.conferenceId,
    personId: ids.conflictedChair,
    submissionId: subs.conflicted,
    kind: "declared",
    declaredBy: "chair",
  });

  for (const to of [w, early, late]) await closeCall(to);
  const give = async (to: World, id: string, who: (keyof typeof cookies)[]) => {
    for (const r of who) {
      const res = await assign(to, cookies.chair, id, ids[r]);
      expect(res.status, `${id} ${r} ${JSON.stringify(res.json)}`).toBe(204);
    }
  };
  await give(w, subs.main, ["r1", "r2"]);
  await give(w, subs.second, ["r1"]);
  await give(w, subs.third, ["r1", "r2", "r3"]);
  await give(w, subs.own, ["r3"]);
  await give(w, subs.conflicted, ["r2"]);
  await give(w, subs.performance, ["other"]);
  await give(w, subs.time, ["r1", "r4"]);
  await give(w, subs.conflict, ["r4"]);
  await give(w, subs.expertise, ["r4"]);
  await give(w, subs.removal, ["r4"]);
  await give(early, earlyTalk, ["r1"]);
  await give(late, lateTalk, ["r1"]);
  // The conference moves into review; one stays before it, and one will go past it.
  expect((await movePhase(w, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
  expect((await movePhase(late, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);

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

describe("who may read and write a review", () => {
  const everyoneElse = [
    "stranger",
    "owner",
    "chair",
    "authorChair",
    "conflictedChair",
    "track",
    "r3",
    "other",
  ] as const;

  it("the proposal's reviewers each have their own, and nothing before they begin", async () => {
    for (const who of ["r1", "r2"] as const) {
      const res = await readReview(t, { cookie: cookies[who] }, subs.main);
      expect(res.status, who).toBe(200);
      expect(res.json, who).toEqual({
        view: "own_review",
        submissionId: subs.main,
        status: "not_started",
        version: 0,
        scores: {},
        comments: "",
        chairNote: "",
        recommendation: null,
        sentAt: null,
        updatedAt: null,
        open: true,
        canDecline: true,
      });
    }
  });

  it("answers everyone else as it answers for a proposal that does not exist: 404, on every route", async () => {
    const before = (await t.db.select().from(reviews)).length;
    const routes = (id: string): [string, string, unknown][] => [
      ["GET", `/api/submissions/${id}/review`, undefined],
      ["PUT", `/api/submissions/${id}/review`, { version: 0, send: false, ...EMPTY }],
      ["POST", `/api/submissions/${id}/review/decline`, { reason: "time" }],
    ];
    for (const who of everyoneElse) {
      for (const [method, path, body] of routes(subs.main)) {
        const res = await call(t.public, method, path, { cookie: cookies[who], body });
        expect(res.status, `${who} ${method}`).toBe(404);
        expect(res.json, `${who} ${method}`).toEqual({ error: "not_found" });
      }
    }
    // A proposal that is not there, and an id that is not one, read the same to a reviewer.
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      for (const [method, path, body] of routes(id)) {
        const res = await call(t.public, method, path, { cookie: cookies.r1, body });
        expect(res.status, `${id} ${method}`).toBe(404);
        expect(res.json).toEqual({ error: "not_found" });
      }
    }
    // The public reads nothing, and must sign in to write.
    expect((await readReview(t, {}, subs.main)).status).toBe(404);
    expect((await saveReview(t, {}, subs.main, 0, false, EMPTY)).status).toBe(401);
    expect((await decline(t, {}, subs.main, { reason: "time" })).status).toBe(401);
    expect((await t.db.select().from(reviews)).length).toBe(before);
    expect((await assignmentRows(t, subs.main)).length).toBe(2);
  });

  it("refuses a chair's agents, whatever their tier and on either listener", async () => {
    const tries: [string, TestApp["public"], string][] = [
      ["tier M", t.public, agentM],
      ["tier C", t.internal, agentC],
    ];
    for (const [tier, app, token] of tries) {
      const read = await call(app, "GET", `/api/submissions/${subs.main}/review`, { token });
      expect(read.status, tier).toBe(404);
      const write = await call(app, "PUT", `/api/submissions/${subs.main}/review`, {
        token,
        body: { version: 0, send: false, ...EMPTY },
      });
      expect(write.status, tier).toBe(403);
      expect(write.json, tier).toEqual({ error: "agents_read_only" });
      const cannot = await call(app, "POST", `/api/submissions/${subs.main}/review/decline`, {
        token,
        body: { reason: "time" },
      });
      expect(cannot.status, tier).toBe(403);
      // An agent has no reviews of its own, and reads nobody's list.
      expect((await call(app, "GET", "/api/me/reviews", { token })).status, tier).toBe(401);
      expect((await call(app, "GET", "/api/me/menu", { token })).json, tier).toEqual({
        reviews: false,
      });
    }
    // A content-tier token never gets as far as a route on the public listener.
    expect((await readReview(t, { token: agentC }, subs.main)).status).toBe(403);
  });

  it("gives an assigned reviewer nothing before the conference is in review", async () => {
    expect((await readReview(early.t, { cookie: cookies.r1 }, earlyTalk)).status).toBe(404);
    const res = await saveReview(t, { cookie: cookies.r1 }, earlyTalk, 0, false, EMPTY);
    expect(res.status).toBe(404);
    expect((await decline(t, { cookie: cookies.r1 }, earlyTalk, { reason: "time" })).status).toBe(
      404,
    );
    expect(await reviewRows(t, earlyTalk)).toEqual([]);
    expect(await assignmentRows(t, earlyTalk)).toHaveLength(1);
  });

  it("takes only what a review is: no reviewer, no proposal, no state named in the request", async () => {
    const base = { version: 0, send: false, ...EMPTY };
    for (const bad of [
      { ...base, reviewerId: ids.r2 },
      { ...base, submissionId: subs.second },
      { ...base, status: "sent" },
      { ...base, sentAt: NOW.toISOString() },
      { ...base, scores: { fit: "5" } },
      { ...base, scores: { fit: 2.5 } },
      { ...base, recommendation: "maybe" },
      { ...base, comments: "x".repeat(20_001) },
      { version: 0, send: false },
      {},
    ]) {
      const res = await call(t.public, "PUT", `/api/submissions/${subs.main}/review`, {
        cookie: cookies.r1,
        body: bad,
      });
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    for (const bad of [{}, { reason: "chair" }, { reason: "role_removed" }, { reason: "bored" }]) {
      const res = await decline(t, { cookie: cookies.r1 }, subs.main, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await reviewRows(t, subs.main)).toEqual([]);
    expect(await assignmentRows(t, subs.main)).toHaveLength(2);
  });
});

describe("a draft, then sent, then changed", () => {
  const draftText = text("a first thought, not finished");
  const draftNote = text("a note in a draft");
  const sentText = text("the comments as they were first sent");
  const sentNote = text("a note for the chairs only");
  const changedText = text("the comments as changed after sending");
  /** What each kind of person can ask the server for that could hold a word of a review. */
  const everything = async (who: Who, app = t.public) =>
    Promise.all(
      [
        `/api/submissions/${subs.main}`,
        `/api/submissions/${subs.main}/review`,
        `/api/submissions/${subs.main}/check`,
        "/api/me/reviews",
        "/api/me/submissions",
        at(w, "/submissions?limit=100"),
        at(w, `/assignments/submissions/${subs.main}`),
        at(w, "/assignments"),
        at(w, "/people"),
        at(w, "/overview"),
        at(w),
      ].map(async (path) => (await call(app, "GET", path, who)).json),
    );
  /** Everything a chair is shown that could say a draft exists. */
  const chairSees = async (chair = cookies.chair) =>
    Promise.all(
      [
        at(w, `/assignments/submissions/${subs.main}`),
        at(w, "/assignments"),
        at(w, "/people"),
        `/api/submissions/${subs.main}`,
        at(w, "/submissions?limit=100"),
        at(w, "/overview"),
      ].map(async (path) => (await call(t.public, "GET", path, { cookie: chair })).json),
    );

  it("a draft keeps whatever is filled in, and nothing a chair can read says that it exists", async () => {
    const before = await chairSees();
    const firstAudit = (await audited(t, w.conferenceId)).length;
    const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, 0, false, {
      scores: { [CRITERIA_A[0] ?? ""]: 2 },
      comments: draftText,
      chairNote: draftNote,
      recommendation: null,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toEqual({
      view: "own_review",
      submissionId: subs.main,
      status: "draft",
      version: 1,
      scores: { [CRITERIA_A[0] ?? ""]: 2 },
      comments: draftText,
      chairNote: draftNote,
      recommendation: null,
      sentAt: null,
      updatedAt: NOW.toISOString(),
      open: true,
      canDecline: true,
    });
    // Read again, it is what was saved.
    expect((await readReview(t, { cookie: cookies.r1 }, subs.main)).json).toEqual(res.json);
    // To the letter what the chair was shown before: the section, the lists, the counts.
    expect(await chairSees()).toEqual(before);
    expect(findLeaks(await chairSees(), [draftText, draftNote])).toEqual([]);
    // A review of the settings does not count it either: drafts never block.
    const narrowed = await reviewOf(w, cookies.chair, (config) => {
      criterionIn(config, POOL_A, CRITERIA_A[0] ?? "").min = 3;
    });
    expect(narrowed).toMatchObject({ issues: [], canSave: true });
    expect(await audited(t, w.conferenceId, firstAudit)).toEqual([
      {
        action: "review.draft_saved",
        actor: ids.r1,
        targetType: "submission",
        targetId: subs.main,
        details: { reviewId: (await reviewRows(t, subs.main))[0]?.id, version: 1 },
      },
    ]);
  });

  it("a save names the version it was made on: an older one changes nothing", async () => {
    for (const version of [0, 2, 7]) {
      const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, version, false, {
        ...EMPTY,
        comments: "From another tab.",
      });
      expect(res.status, `${version}`).toBe(409);
      expect(res.json, `${version}`).toEqual({ error: "stale", version: 1 });
    }
    expect((await readReview(t, { cookie: cookies.r1 }, subs.main)).json).toMatchObject({
      version: 1,
      comments: draftText,
    });
  });

  it("a draft may be incomplete, and may not hold what the form has no place for", async () => {
    const tries: [Partial<Content>, unknown[]][] = [
      [
        { scores: { [CRITERIA_A[0] ?? ""]: 6 } },
        [{ path: `scores.${CRITERIA_A[0]}`, code: "out_of_range", params: { min: 1, max: 5 } }],
      ],
      [{ scores: { nosuch: 3 } }, [{ path: "scores.nosuch", code: "not_on_form" }]],
      // A criterion of the other committee is not this form's.
      [
        { scores: { [CRITERIA_B[0] ?? ""]: 3 } },
        [{ path: `scores.${CRITERIA_B[0]}`, code: "not_on_form" }],
      ],
    ];
    for (const [content, issues] of tries) {
      const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, 1, false, {
        ...EMPTY,
        ...content,
      });
      expect(res.status, JSON.stringify(content)).toBe(422);
      expect(res.json).toEqual({ error: "invalid", issues });
    }
    expect((await readReview(t, { cookie: cookies.r1 }, subs.main)).json.version).toBe(1);
  });

  it("sending needs everything the form requires, said beside each field", async () => {
    const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, 1, true, {
      scores: { [CRITERIA_A[0] ?? ""]: 2 },
      comments: "  ",
      chairNote: "",
      recommendation: null,
    });
    expect(res.status).toBe(422);
    expect(res.json).toEqual({
      error: "invalid",
      issues: [
        ...CRITERIA_A.slice(1).map((key) => ({ path: `scores.${key}`, code: "required" })),
        { path: "comments", code: "required" },
        { path: "recommendation", code: "required" },
      ],
    });
    // Nothing was sent, and nothing of the draft was lost.
    expect((await readReview(t, { cookie: cookies.r1 }, subs.main)).json).toMatchObject({
      status: "draft",
      version: 1,
      comments: draftText,
    });
  });

  it("once sent, the chairs who manage the proposal read it in full, and know who wrote it", async () => {
    const firstAudit = (await audited(t, w.conferenceId)).length;
    const mailBefore = (await t.db.select().from(outbox)).length;
    t.setNow(new Date(NOW.getTime() + HOUR));
    const content = complete(sentText, { chairNote: sentNote, recommendation: "unsure" });
    const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, 1, true, content);
    t.setNow(NOW);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const sentAt = new Date(NOW.getTime() + HOUR).toISOString();
    expect(res.json).toMatchObject({
      status: "sent",
      version: 2,
      ...content,
      sentAt,
      updatedAt: sentAt,
      open: true,
      // After a review is sent "I cannot review this" is no longer offered.
      canDecline: false,
    });
    const view = await section(w, cookies.chair, subs.main);
    expect(view.assigned.map((a) => [a.personId, a.review]).sort()).toEqual(
      [
        [ids.r1, { ...content, sentAt, changedAt: null }],
        [ids.r2, null],
      ].sort(),
    );
    const [row] = await reviewRows(t, subs.main);
    expect(await audited(t, w.conferenceId, firstAudit)).toEqual([
      {
        action: "review.sent",
        actor: ids.r1,
        targetType: "submission",
        targetId: subs.main,
        details: { reviewId: row?.id, version: 2 },
      },
    ]);
    // The lists count it: one review sent, for this chair.
    const page = await call(t.public, "GET", at(w, "/assignments"), { cookie: cookies.chair });
    const listed = page.json.pools
      .flatMap((p: { items: { id: string; sent: number }[] }) => p.items)
      .find((x: { id: string }) => x.id === subs.main);
    expect(listed).toMatchObject({ sent: 1, short: true });
    const peopleNow = await call(t.public, "GET", at(w, "/people"), { cookie: cookies.chair });
    expect(
      peopleNow.json.reviewers.find((r: { personId: string }) => r.personId === ids.r1),
    ).toMatchObject({ sent: 1 });
    // Nobody was written to: this step sends no email.
    expect((await t.db.select().from(outbox)).length).toBe(mailBefore);
  });

  it("a sent review stays sent: it is not saved as a draft again, and it is changed by sending it again", async () => {
    const asDraft = await saveReview(t, { cookie: cookies.r1 }, subs.main, 2, false, {
      ...complete("Back to a draft?"),
    });
    expect(asDraft.status).toBe(409);
    expect(asDraft.json).toEqual({ error: "already_sent" });
    // A change must be complete too: the chairs never read half a review.
    const half = await saveReview(t, { cookie: cookies.r1 }, subs.main, 2, true, {
      ...complete(""),
    });
    expect(half.status).toBe(422);
    expect((await section(w, cookies.chair, subs.main)).assigned[0]?.review).toMatchObject({
      comments: sentText,
    });

    const firstAudit = (await audited(t, w.conferenceId)).length;
    t.setNow(new Date(NOW.getTime() + 3 * HOUR));
    const content = complete(changedText, { chairNote: sentNote, recommendation: "accept" });
    const res = await saveReview(t, { cookie: cookies.r1 }, subs.main, 2, true, content);
    t.setNow(NOW);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const sentAt = new Date(NOW.getTime() + HOUR).toISOString();
    const changedAt = new Date(NOW.getTime() + 3 * HOUR).toISOString();
    // The day it was first sent stays; the change shows as one.
    expect(res.json).toMatchObject({ status: "sent", version: 3, sentAt, updatedAt: changedAt });
    expect(
      (await section(w, cookies.chair, subs.main)).assigned.find((a) => a.personId === ids.r1)
        ?.review,
    ).toEqual({ ...content, sentAt, changedAt });
    expect((await audited(t, w.conferenceId, firstAudit)).map((r) => r.action)).toEqual([
      "review.changed",
    ]);
    expect(await reviewRows(t, subs.main)).toHaveLength(1);
  });

  it("shows a review to its reviewer and to the chairs who manage the proposal, and to nobody else", async () => {
    const written = [draftText, draftNote, sentText, sentNote, changedText];
    // Its reviewer, and a chair who manages the proposal: the review as it stands now.
    expect(findLeaks(await everything({ cookie: cookies.r1 }), written)).toEqual([
      sentNote,
      changedText,
    ]);
    expect(findLeaks(await everything({ cookie: cookies.chair }), written)).toEqual([
      sentNote,
      changedText,
    ]);
    const nobody: [string, Who, TestApp["public"]][] = [
      ["the other reviewer of the same proposal", { cookie: cookies.r2 }, t.public],
      ["a reviewer of another proposal", { cookie: cookies.r3 }, t.public],
      ["a reviewer of another committee", { cookie: cookies.other }, t.public],
      ["the proposal's owner", { cookie: cookies.owner }, t.public],
      ["a track chair", { cookie: cookies.track }, t.public],
      ["a stranger", { cookie: cookies.stranger }, t.public],
      ["the public", {}, t.public],
      ["a chair's cloud agent (tier M)", { token: agentM }, t.public],
      ["a chair's local agent (tier C)", { token: agentC }, t.internal],
    ];
    for (const [who, as, app] of nobody) {
      const seen = await everything(as, app);
      expect(findLeaks(seen, written), who).toEqual([]);
      // Nor who reviews it, by name or by address. (A chair's agents and a track chair are
      // given the reviewers' ids with the proposal, as before this step, and nothing more.)
      expect(
        findLeaks(seen, ["Rhea Reviewerone", mail("r1"), "Rolf Reviewertwo", mail("r2")]).filter(
          (name) => !(who.includes("the other reviewer") && name.includes("two")),
        ),
        who,
      ).toEqual([]);
    }
    // The other reviewer has their own review of it, which is nobody else's: not started.
    expect((await readReview(t, { cookie: cookies.r2 }, subs.main)).json).toMatchObject({
      status: "not_started",
      version: 0,
      comments: "",
    });
    // What each reviewer is given of the proposal itself names no reviewer at all.
    for (const who of ["r1", "r2"] as const) {
      const given = await call(t.public, "GET", `/api/submissions/${subs.main}`, {
        cookie: cookies[who],
      });
      expect(given.json.view).toBe("reviewer");
      expect(findLeaks(given.json, [ids.r1, ids.r2, "assignedReviewerIds"]), who).toEqual([]);
    }
  });

  it("is never a chair's to read for their own proposal, or one they have a conflict with", async () => {
    const ownText = text("a review of a chair's own talk");
    const conflictText = text("a review of a talk a chair has a conflict with");
    expect(
      (await saveReview(t, { cookie: cookies.r3 }, subs.own, 0, true, complete(ownText))).status,
    ).toBe(200);
    expect(
      (
        await saveReview(
          t,
          { cookie: cookies.r2 },
          subs.conflicted,
          0,
          true,
          complete(conflictText),
        )
      ).status,
    ).toBe(200);
    for (const [who, id, written] of [
      ["authorChair", subs.own, ownText],
      ["conflictedChair", subs.conflicted, conflictText],
    ] as const) {
      const res = await call(t.public, "GET", at(w, `/assignments/submissions/${id}`), {
        cookie: cookies[who],
      });
      expect(res.status, who).toBe(404);
      const seen = await Promise.all(
        [
          at(w, "/assignments"),
          at(w, "/people"),
          at(w, "/submissions?limit=100"),
          `/api/submissions/${id}`,
          `/api/submissions/${id}/review`,
        ].map(async (path) => (await call(t.public, "GET", path, { cookie: cookies[who] })).json),
      );
      expect(findLeaks(seen, [written]), who).toEqual([]);
      // Another chair, who manages it, reads it.
      const other = await section(w, cookies.chair, id);
      expect(
        other.assigned.map((a) => a.review?.comments),
        who,
      ).toContain(written);
    }
    // The author's counts do not say that a review of their own talk was sent: their page
    // shows that reviewer with what they have of the proposals this chair manages.
    const mine = await call(t.public, "GET", at(w, "/people"), { cookie: cookies.authorChair });
    const full = await call(t.public, "GET", at(w, "/people"), { cookie: cookies.chair });
    const of = (page: typeof mine, id: string) =>
      page.json.reviewers.find((r: { personId: string }) => r.personId === id);
    expect(of(full, ids.r3)).toMatchObject({ assigned: 2, sent: 1 });
    expect(of(mine, ids.r3)).toMatchObject({ assigned: 1, sent: 0 });
  });

  it("is read only once the conference has left `reviewing`: nothing is saved, sent or given back", async () => {
    const lateText = text("a review sent while the conference was in review");
    const sent = await saveReview(t, { cookie: cookies.r1 }, lateTalk, 0, true, complete(lateText));
    expect(sent.status).toBe(200);
    expect((await movePhase(late, cookies.chair, "deciding", "reviewing")).status).toBe(200);
    const read = await readReview(t, { cookie: cookies.r1 }, lateTalk);
    expect(read.json).toMatchObject({
      status: "sent",
      comments: lateText,
      open: false,
      canDecline: false,
    });
    const change = await saveReview(
      t,
      { cookie: cookies.r1 },
      lateTalk,
      1,
      true,
      complete("Late."),
    );
    expect(change.status).toBe(409);
    expect(change.json).toEqual({ error: "not_reviewing" });
    const cannot = await decline(t, { cookie: cookies.r1 }, lateTalk, { reason: "time" });
    expect(cannot.status).toBe(409);
    expect(cannot.json).toEqual({ error: "not_reviewing" });
    expect((await readReview(t, { cookie: cookies.r1 }, lateTalk)).json).toMatchObject({
      version: 1,
      comments: lateText,
    });
    // The list says so too: it is still theirs to read.
    const list = await myReviews(t, { cookie: cookies.r1 });
    expect(
      list.json.conferences.find(
        (k: { conference: { slug: string } }) => k.conference.slug === LATE,
      ),
    ).toMatchObject({ open: false, counts: { sent: 1, draft: 0, notStarted: 0 } });
  });

  it("a late review counts: the day reviews are due locks nothing while the conference is in review", async () => {
    const { config, token } = await stored(w, cookies.chair);
    // Due half an hour ago, as the settings would have it: after the call closed (an hour
    // ago), and before decisions are sent.
    config.deadlines.reviewsDue = new Date(NOW.getTime() - HOUR / 2).toISOString();
    const saved = await saveConfig(w, cookies.chair, config, token);
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const list = await myReviews(t, { cookie: cookies.r2 });
    expect(
      list.json.conferences.find(
        (k: { conference: { slug: string } }) => k.conference.slug === SLUG,
      ),
    ).toMatchObject({ open: true, reviewsDue: config.deadlines.reviewsDue });
    const lateText = text("sent after the day reviews were due");
    const res = await saveReview(t, { cookie: cookies.r2 }, subs.main, 0, true, complete(lateText));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "sent", open: true });
    expect(
      (await section(w, cookies.chair, subs.main)).assigned.filter((a) => a.review).length,
    ).toBe(2);
  });
});

describe("my reviews: a reviewer's own list", () => {
  type Listed = {
    conference: { slug: string };
    open: boolean;
    reviewsDue: string | null;
    counts: { sent: number; draft: number; notStarted: number };
    committees: { key: string; guidelines: Record<string, string> | null }[];
    formats: Record<string, Record<string, string>>;
    proposals: {
      submissionId: string;
      title: string;
      typeKey: string;
      language: string;
      status: string;
    }[];
  };
  const listOf = async (who: keyof typeof cookies): Promise<Listed[]> => {
    const res = await myReviews(t, { cookie: cookies[who] });
    expect(res.status).toBe(200);
    return res.json.conferences;
  };

  it("lists each conference in review with their own assignments, and where each review stands", async () => {
    // A draft of the second talk, so that the list has one of each.
    const draft = await saveReview(t, { cookie: cookies.r1 }, subs.second, 0, false, {
      ...EMPTY,
      comments: text("a draft on the list"),
    });
    expect(draft.status).toBe(200);
    const mine = await listOf("r1");
    // Not the conference that is not in review yet; the one past it is still theirs to read.
    expect(mine.map((k) => k.conference.slug).sort()).toEqual([SLUG, LATE].sort());
    const here = mine.find((k) => k.conference.slug === SLUG);
    const row = (submissionId: string, title: string, status: string) => ({
      submissionId,
      title,
      typeKey: "talk",
      language: "en",
      status,
    });
    // Drafts first, then those not started (as they were created), then those sent.
    expect(here?.proposals.map((p) => p.status)).toEqual([
      "draft",
      "not_started",
      "not_started",
      "sent",
    ]);
    expect(here?.proposals[0]).toEqual(row(subs.second, "A second talk", "draft"));
    expect(here?.proposals[3]).toEqual(row(subs.main, "The main talk", "sent"));
    expect(here?.proposals.slice(1, 3)).toEqual(
      expect.arrayContaining([
        row(subs.third, "A third talk", "not_started"),
        row(subs.time, "A talk nobody has time for", "not_started"),
      ]),
    );
    expect(here?.counts).toEqual({ sent: 1, draft: 1, notStarted: 2 });
    expect(here?.committees.map((c) => c.key)).toEqual([POOL_A]);
    expect(Object.keys(here?.formats ?? {})).toEqual(["talk"]);
    // Nobody else is on it: no other reviewer, no author, and no proposal that is not theirs.
    expect(
      findLeaks(mine, [
        ...(["r2", "r3", "r4", "other", "owner", "chair"] as const).flatMap((x) => [
          ids[x],
          mail(x),
        ]),
        "Olga Ownerperson",
        subs.own,
        subs.conflicted,
        subs.performance,
        "A performance",
      ]),
    ).toEqual([]);
  });

  it("is each reviewer's own: another committee's reviewer has their proposals, and nobody else any", async () => {
    const other = await listOf("other");
    expect(other).toHaveLength(1);
    expect(other[0]?.proposals.map((p) => [p.submissionId, p.typeKey, p.status])).toEqual([
      [subs.performance, "performance", "not_started"],
    ]);
    expect(other[0]?.committees.map((c) => c.key)).toEqual([POOL_B]);
    for (const who of ["stranger", "owner", "chair", "track"] as const) {
      expect(await listOf(who), who).toEqual([]);
    }
    expect((await myReviews(t, {})).status).toBe(401);
  });

  it("shows the chairs' guidelines for the committee, once they are written", async () => {
    const { config, token } = await stored(w, cookies.chair);
    poolIn(config, POOL_A).guidelines = { en: "Made-up guidelines.\n\nRead twice." };
    expect((await saveConfig(w, cookies.chair, config, token)).status).toBe(200);
    const here = (await listOf("r1")).find((k) => k.conference.slug === SLUG);
    expect(here?.committees).toMatchObject([
      { key: POOL_A, guidelines: { en: "Made-up guidelines.\n\nRead twice." } },
    ]);
  });

  it("the main menu offers it to people who review somewhere, and to nobody else", async () => {
    const menu = async (who: Who) => (await call(t.public, "GET", "/api/me/menu", who)).json;
    for (const who of ["r1", "r2", "other"] as const) {
      expect(await menu({ cookie: cookies[who] }), who).toEqual({ reviews: true });
    }
    for (const who of ["stranger", "owner", "chair", "track"] as const) {
      expect(await menu({ cookie: cookies[who] }), who).toEqual({ reviews: false });
    }
    // Asked by everyone on every page: it answers the public too, with a no.
    expect(await menu({})).toEqual({ reviews: false });
  });
});

describe("I cannot review this proposal", () => {
  const offered = async (id: string) =>
    (await section(w, cookies.chair, id)).candidates.map((c) => c.personId);

  it("releases the assignment with the reason and the note, discards the draft, and the proposal is a stranger's again", async () => {
    const note = text("away at a festival until the deadline");
    const draft = text("a draft that goes with the assignment");
    const saved = await saveReview(t, { cookie: cookies.r4 }, subs.time, 0, false, {
      ...EMPTY,
      comments: draft,
    });
    expect(saved.status).toBe(200);
    const firstAudit = (await audited(t, w.conferenceId)).length;
    t.setNow(new Date(NOW.getTime() + 2 * HOUR));
    const res = await decline(t, { cookie: cookies.r4 }, subs.time, { reason: "time", note });
    t.setNow(NOW);
    expect(res.status, JSON.stringify(res.json)).toBe(204);

    // The assignment is gone from the table that holds those that stand; its record says why,
    // in whose words, and that it was their own act.
    expect((await assignmentRows(t, subs.time)).map((a) => a.reviewerId)).toEqual([ids.r1]);
    const said = new Date(NOW.getTime() + 2 * HOUR);
    expect(await releaseRows(t, subs.time)).toMatchObject([
      { reviewerId: ids.r4, reason: "time", note, releasedByPersonId: ids.r4, releasedAt: said },
    ]);
    // Their draft went with it: nothing of theirs is left on the proposal.
    expect((await reviewRows(t, subs.time)).map((r) => r.reviewerId)).toEqual([]);
    // No conflict is recorded for a reviewer who has no time.
    expect(
      await t.db.select().from(conflicts).where(eq(conflicts.submissionId, subs.time)),
    ).toEqual([]);

    // What a stranger gets, everywhere: the proposal, the review, the list.
    for (const path of [`/api/submissions/${subs.time}`, `/api/submissions/${subs.time}/review`]) {
      expect((await call(t.public, "GET", path, { cookie: cookies.r4 })).status, path).toBe(404);
    }
    expect((await saveReview(t, { cookie: cookies.r4 }, subs.time, 0, false, EMPTY)).status).toBe(
      404,
    );
    expect((await decline(t, { cookie: cookies.r4 }, subs.time, { reason: "time" })).status).toBe(
      404,
    );
    const list = await myReviews(t, { cookie: cookies.r4 });
    expect(findLeaks(list.json, [subs.time, "A talk nobody has time for"])).toEqual([]);

    // The chairs who manage it see who said so, why, and their note; and can assign them again.
    const view = await section(w, cookies.chair, subs.time);
    expect(view.declined).toEqual([
      {
        personId: ids.r4,
        displayName: "Remy Reviewerfour",
        email: mail("r4"),
        reason: "time",
        note,
        at: said.toISOString(),
      },
    ]);
    expect(view.assigned.map((a) => a.personId)).toEqual([ids.r1]);
    expect(await offered(subs.time)).toContain(ids.r4);
    // The other reviewer of it learns nothing of that.
    const others = await Promise.all(
      [
        `/api/submissions/${subs.time}`,
        `/api/submissions/${subs.time}/review`,
        "/api/me/reviews",
      ].map(async (path) => (await call(t.public, "GET", path, { cookie: cookies.r1 })).json),
    );
    expect(findLeaks(others, [note, ids.r4, mail("r4"), "Remy Reviewerfour"])).toEqual([]);

    expect(await audited(t, w.conferenceId, firstAudit)).toEqual([
      {
        action: "assignment.released",
        actor: ids.r4,
        targetType: "submission",
        targetId: subs.time,
        details: { reviewerId: ids.r4, reason: "time", draftDiscarded: true },
      },
    ]);
  });

  it("with a conflict of interest, records the conflict: they are never offered that proposal again", async () => {
    const firstAudit = (await audited(t, w.conferenceId)).length;
    const res = await decline(t, { cookie: cookies.r4 }, subs.conflict, { reason: "conflict" });
    expect(res.status).toBe(204);
    expect(await assignmentRows(t, subs.conflict)).toEqual([]);
    expect(await releaseRows(t, subs.conflict)).toMatchObject([
      { reviewerId: ids.r4, reason: "conflict", note: null, releasedByPersonId: ids.r4 },
    ]);
    expect(
      await t.db.select().from(conflicts).where(eq(conflicts.submissionId, subs.conflict)),
    ).toMatchObject([
      {
        conferenceId: w.conferenceId,
        personId: ids.r4,
        otherPersonId: null,
        kind: "declared",
        declaredBy: "reviewer",
      },
    ]);
    // Not offered, and refused if asked for, with the answer every refusal of that kind gets.
    expect(await offered(subs.conflict)).not.toContain(ids.r4);
    const again = await assign(w, cookies.chair, subs.conflict, ids.r4);
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ error: "not_offered" });
    expect((await section(w, cookies.chair, subs.conflict)).declined).toMatchObject([
      { personId: ids.r4, reason: "conflict", note: null },
    ]);
    expect(await audited(t, w.conferenceId, firstAudit)).toEqual([
      {
        action: "assignment.released",
        actor: ids.r4,
        targetType: "submission",
        targetId: subs.conflict,
        details: { reviewerId: ids.r4, reason: "conflict", draftDiscarded: false },
      },
      {
        action: "conflict.declared",
        actor: ids.r4,
        targetType: "submission",
        targetId: subs.conflict,
        details: { personId: ids.r4, kind: "declared" },
      },
    ]);
  });

  it("outside what they can judge: released, with no conflict, and a chair may assign them again", async () => {
    const res = await decline(t, { cookie: cookies.r4 }, subs.expertise, {
      reason: "expertise",
      note: "   ",
    });
    expect(res.status).toBe(204);
    // A note of spaces is no note.
    expect(await releaseRows(t, subs.expertise)).toMatchObject([
      { reviewerId: ids.r4, reason: "expertise", note: null },
    ]);
    expect(await offered(subs.expertise)).toContain(ids.r4);
    expect((await assign(w, cookies.chair, subs.expertise, ids.r4)).status).toBe(204);
    // Assigned again, it is theirs again, and nothing is left of what they said before but
    // the record.
    expect((await readReview(t, { cookie: cookies.r4 }, subs.expertise)).json).toMatchObject({
      status: "not_started",
      canDecline: true,
    });
  });

  it("is not offered once their review is sent: they change it, or write to the chairs", async () => {
    const res = await decline(t, { cookie: cookies.r1 }, subs.main, { reason: "time" });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "review_sent" });
    expect((await assignmentRows(t, subs.main)).map((a) => a.reviewerId).sort()).toEqual(
      [ids.r1, ids.r2].sort(),
    );
    expect(await releaseRows(t, subs.main)).toEqual([]);
    expect((await readReview(t, { cookie: cookies.r1 }, subs.main)).json).toMatchObject({
      status: "sent",
      canDecline: false,
    });
  });
});

describe("what a chair can do once a review is sent", () => {
  it("a reviewer whose review is sent is not removed from the proposal; one with a draft is, and the draft goes", async () => {
    const before = await assignmentRows(t, subs.main);
    const res = await unassign(w, cookies.chair, subs.main, ids.r1);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "review_sent" });
    expect(await assignmentRows(t, subs.main)).toEqual(before);
    expect(await reviewRows(t, subs.main)).toHaveLength(2);

    // The second talk has their draft: removing them discards it, and the record says so.
    expect((await reviewRows(t, subs.second)).map((r) => r.status)).toEqual(["draft"]);
    const firstAudit = (await audited(t, w.conferenceId)).length;
    expect((await unassign(w, cookies.chair, subs.second, ids.r1)).status).toBe(204);
    expect(await reviewRows(t, subs.second)).toEqual([]);
    expect(await assignmentRows(t, subs.second)).toEqual([]);
    expect(await audited(t, w.conferenceId, firstAudit)).toEqual([
      {
        action: "assignment.released",
        actor: ids.chair,
        targetType: "submission",
        targetId: subs.second,
        details: { reviewerId: ids.r1, reason: "chair", draftDiscarded: true },
      },
    ]);
    // A chair's removal is nobody's statement: it is not listed among those who could not.
    expect((await section(w, cookies.chair, subs.second)).declined).toEqual([]);
    // Assigned again, they start from nothing.
    expect((await assign(w, cookies.chair, subs.second, ids.r1)).status).toBe(204);
    expect((await readReview(t, { cookie: cookies.r1 }, subs.second)).json).toMatchObject({
      status: "not_started",
      version: 0,
    });
  });

  it("removing a reviewer's role keeps their sent reviews and those assignments, and releases the rest", async () => {
    // Reviewer four: one review sent (the talk that loses a reviewer), a draft and nothing.
    const kept = text("a sent review that outlives its reviewer's role");
    expect(
      (await saveReview(t, { cookie: cookies.r4 }, subs.removal, 0, true, complete(kept))).status,
    ).toBe(200);
    expect(
      (
        await saveReview(t, { cookie: cookies.r4 }, subs.expertise, 0, false, {
          ...EMPTY,
          comments: text("a draft that goes with the role"),
        })
      ).status,
    ).toBe(200);
    expect((await assign(w, cookies.chair, subs.time, ids.r4)).status).toBe(204);
    const theirs = async () =>
      (await t.db.select().from(assignments).where(eq(assignments.reviewerId, ids.r4))).map(
        (a) => a.submissionId,
      );
    expect((await theirs()).sort()).toEqual([subs.removal, subs.expertise, subs.time].sort());
    const page = await call(t.public, "GET", at(w, "/people"), { cookie: cookies.chair });
    expect(
      page.json.reviewers.find((r: { personId: string }) => r.personId === ids.r4),
    ).toMatchObject({ assigned: 3, sent: 1 });

    // The confirmation said two numbers: with either wrong, nothing is removed.
    const remove = (body: unknown) =>
      call(t.public, "DELETE", at(w, `/people/${ids.r4}/roles/reviewer`), {
        cookie: cookies.chair,
        body,
      });
    for (const body of [
      { assignments: 3 },
      { assignments: 3, reviews: 0 },
      { assignments: 3, reviews: 2 },
      { assignments: 2, reviews: 1 },
    ]) {
      const res = await remove(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.json).toEqual({ error: "stale", assignments: 3, reviews: 1 });
    }
    expect(await theirs()).toHaveLength(3);

    const firstAudit = (await audited(t, w.conferenceId)).length;
    expect((await remove({ assignments: 3, reviews: 1 })).status).toBe(204);
    // The sent review and its assignment stay; the others are released, the draft discarded.
    expect(await theirs()).toEqual([subs.removal]);
    expect(
      (await t.db.select().from(reviews).where(eq(reviews.reviewerId, ids.r4))).map((r) => [
        r.submissionId,
        r.status,
      ]),
    ).toEqual([[subs.removal, "sent"]]);
    expect(
      (
        await t.db
          .select()
          .from(assignmentReleases)
          .where(eq(assignmentReleases.reviewerId, ids.r4))
      )
        .filter((r) => r.reason === "role_removed")
        .map((r) => r.submissionId)
        .sort(),
    ).toEqual([subs.expertise, subs.time].sort());
    const rows = await audited(t, w.conferenceId, firstAudit);
    expect(rows.filter((r) => r.action === "assignment.released")).toHaveLength(2);
    expect(rows.find((r) => r.action === "role.removed")?.details).toEqual({
      role: "reviewer",
      pools: [POOL_A],
      assignments: 2,
      reviewsKept: 1,
    });
    expect(
      rows
        .filter((r) => r.action === "assignment.released")
        .map((r) => [r.targetId, (r.details as { draftDiscarded: boolean }).draftDiscarded])
        .sort(),
    ).toEqual(
      [
        [subs.expertise, true],
        [subs.time, false],
      ].sort(),
    );

    // No longer a reviewer: they read nothing, not even the proposal they reviewed.
    for (const path of [
      `/api/submissions/${subs.removal}`,
      `/api/submissions/${subs.removal}/review`,
    ]) {
      expect((await call(t.public, "GET", path, { cookie: cookies.r4 })).status, path).toBe(404);
    }
    expect((await myReviews(t, { cookie: cookies.r4 })).json).toEqual({ conferences: [] });
    expect(
      (await saveReview(t, { cookie: cookies.r4 }, subs.removal, 1, true, complete("After.")))
        .status,
    ).toBe(404);
    // The chairs still read the review, under its reviewer, who no longer counts as one.
    const view = await section(w, cookies.chair, subs.removal);
    expect(view.assigned).toMatchObject([
      { personId: ids.r4, blocked: true, review: { comments: kept } },
    ]);
    // And it still cannot be taken off the proposal.
    expect((await unassign(w, cookies.chair, subs.removal, ids.r4)).status).toBe(409);
  });

  it("lists the proposals still waiting for reviews after those still short of reviewers, page by page", async () => {
    // The third talk has its three reviewers and no review; send all three.
    expect((await assignmentRows(t, subs.third)).length).toBe(NEEDED_A);
    for (const who of ["r1", "r2", "r3"] as const) {
      const res = await saveReview(
        t,
        { cookie: cookies[who] },
        subs.third,
        0,
        true,
        complete(text(`${who} on the third talk`)),
      );
      expect(res.status, who).toBe(200);
    }
    // A talk with its reviewers and one review of three.
    for (const who of ["r2", "r3"] as const) {
      expect((await assign(w, cookies.chair, subs.second, ids[who])).status, who).toBe(204);
    }
    expect(
      (await saveReview(t, { cookie: cookies.r2 }, subs.second, 0, true, complete("One of three.")))
        .status,
    ).toBe(200);

    type Item = { id: string; short: boolean; sent: number };
    type Pool = {
      key: string;
      short: number;
      waiting: number;
      items: Item[];
      nextCursor: string | null;
    };
    const first = await call(t.public, "GET", at(w, "/assignments?limit=200"), {
      cookie: cookies.chair,
    });
    const pool = first.json.pools.find((p: Pool) => p.key === POOL_A) as Pool;
    const rank = (x: Item) => (x.short ? 0 : x.sent < NEEDED_A ? 1 : 2);
    expect(pool.items.map(rank)).toEqual([...pool.items.map(rank)].sort());
    expect(pool.items.find((x) => x.id === subs.third)).toMatchObject({ short: false, sent: 3 });
    expect(pool.items.find((x) => x.id === subs.second)).toMatchObject({ short: false, sent: 1 });
    expect(pool.items.at(-1)?.id).toBe(subs.third);
    expect(pool.waiting).toBe(pool.items.filter((x) => rank(x) === 1).length);
    expect(pool.waiting).toBeGreaterThanOrEqual(1);
    expect(pool.short).toBe(pool.items.filter((x) => x.short).length);

    // One at a time, the pages give the same list in the same order, across all three parts.
    const paged: string[] = [];
    let cursor: string | null = "";
    const letters = new Set<string>();
    while (cursor !== null) {
      const res = await call(
        t.public,
        "GET",
        at(w, `/assignments/pools/${POOL_A}?limit=1&cursor=${encodeURIComponent(cursor)}`),
        { cookie: cookies.chair },
      );
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      paged.push(...res.json.items.map((x: Item) => x.id));
      cursor = res.json.nextCursor;
      if (cursor) letters.add(cursor[0] ?? "");
    }
    expect(paged).toEqual(pool.items.map((x) => x.id));
    // Each part of the list has its own letter, sealed with the position.
    expect([...letters].sort()).toEqual(["f", "s", "w"].filter((l) => letters.has(l)));
    expect(letters.has("w")).toBe(true);
  });
});

describe("sent reviews stay valid when the settings change", () => {
  /** A talk by the stranger, reviewed by reviewer one: scores 2 to 5, a note, a recommendation. */
  let talk: string;
  const comments = words(40, "ink");
  const fit = CRITERIA_A[0] ?? "";
  const clarity = CRITERIA_A[2] ?? "";
  const one = (path: string, code: string, n: number) => [
    { path, code, params: { n }, message: expect.any(String) },
  ];

  beforeAll(async () => {
    // A conference of its own, so that nothing but this talk's review weighs on the settings.
    const g = await world(t, "review-guard");
    await grantRole(t.db, { conferenceId: g.conferenceId, personId: ids.chair, role: "chair" });
    await grantRole(t.db, {
      conferenceId: g.conferenceId,
      personId: ids.authorChair,
      role: "chair",
    });
    for (const who of ["r1", "r2"] as const) await reviewer(g, mail(who), [POOL_A]);
    await reviewer(g, mail("other"), [POOL_B]);
    talk = await proposal(g, cookies.stranger, "A talk whose review is sent");
    const own = await proposal(g, cookies.authorChair, "A chair's talk, reviewed");
    const piece = await proposal(g, cookies.stranger, "A performance with a draft", "performance");
    await closeCall(g);
    expect((await assign(g, cookies.chair, talk, ids.r1)).status).toBe(204);
    expect((await assign(g, cookies.chair, own, ids.r2)).status).toBe(204);
    expect((await assign(g, cookies.chair, piece, ids.other)).status).toBe(204);
    expect((await movePhase(g, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
    guard = g;
    ownTalk = own;
    performance = piece;
    const sent = await saveReview(t, { cookie: cookies.r1 }, talk, 0, true, {
      scores: Object.fromEntries(CRITERIA_A.map((key, i) => [key, 2 + i])),
      comments,
      chairNote: "Between us.",
      recommendation: "reject",
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
  }, 120_000);
  let guard: World;
  let ownTalk: string;
  let performance: string;

  const at2 = (rest: string) => `reviewPools.${POOL_A}.${rest}`;

  it("a scale cannot leave a score already given outside it, and can still be widened or reworded", async () => {
    // The review gives 2 for the first criterion and 4 for the third.
    const cases: [string, (config: ConferenceConfig) => void, unknown[]][] = [
      [
        "smallest above a score",
        (c) => {
          criterionIn(c, POOL_A, fit).min = 3;
        },
        one(at2(`criteria.${fit}.min`), "reviews_below_scale", 1),
      ],
      [
        "largest below a score",
        (c) => {
          criterionIn(c, POOL_A, clarity).max = 3;
        },
        one(at2(`criteria.${clarity}.max`), "reviews_above_scale", 1),
      ],
      [
        "both ends up to the score itself",
        (c) => {
          criterionIn(c, POOL_A, fit).min = 2;
          criterionIn(c, POOL_A, clarity).max = 4;
        },
        [],
      ],
      [
        "wider, relabelled and described",
        (c) => {
          const criterion = criterionIn(c, POOL_A, fit);
          criterion.min = 0;
          criterion.max = 10;
          criterion.label = { en: "Fit, said another way" };
          criterion.description = { en: "0 is off the theme, 10 at its heart." };
        },
        [],
      ],
    ];
    for (const [what, change, issues] of cases) {
      const review = await reviewOf(guard, cookies.chair, change);
      expect(review.issues, what).toEqual(issues);
      expect(review.canSave, what).toBe(issues.length === 0);
    }
  });

  it("a limit on the comments cannot leave a sent review outside it", async () => {
    const limit = (minWords: number | undefined, maxWords: number | undefined) =>
      reviewOf(guard, cookies.chair, (c) => {
        const { comments: field } = poolIn(c, POOL_A).form;
        if (minWords === undefined) delete field.minWords;
        else field.minWords = minWords;
        if (maxWords === undefined) delete field.maxWords;
        else field.maxWords = maxWords;
      });
    // The comments have 40 words.
    expect((await limit(41, undefined)).issues).toEqual(
      one(at2("form.comments.minWords"), "reviews_too_short", 1),
    );
    expect((await limit(undefined, 39)).issues).toEqual(
      one(at2("form.comments.maxWords"), "reviews_too_long", 1),
    );
    for (const [min, max] of [
      [40, 40],
      [1, undefined],
      [undefined, 5000],
    ] as const) {
      expect(await limit(min, max), `${min} ${max}`).toMatchObject({ issues: [], canSave: true });
    }
  });

  it("the note and the recommendation cannot be taken off a form that has answers to them", async () => {
    const off = (part: "chairNote" | "recommendation") =>
      reviewOf(guard, cookies.chair, (c) => {
        poolIn(c, POOL_A).form[part].enabled = false;
      });
    expect((await off("chairNote")).issues).toEqual(
      one(at2("form.chairNote.enabled"), "reviews_have_note", 1),
    );
    expect((await off("recommendation")).issues).toEqual(
      one(at2("form.recommendation.enabled"), "reviews_have_recommendation", 1),
    );
    // The other committee has no review that was sent: its form is free to change.
    const other = await reviewOf(guard, cookies.chair, (c) => {
      const form = poolIn(c, POOL_B).form;
      form.chairNote.enabled = false;
      form.recommendation.enabled = false;
      form.comments.maxWords = 3;
      for (const criterion of poolIn(c, POOL_B).criteria) criterion.max = 2;
    });
    expect(other).toMatchObject({ issues: [], canSave: true });
  });

  it("a criterion that has scores stays, and so does the pool that reviews a format with sent reviews", async () => {
    const removed = await reviewOf(guard, cookies.chair, (c) => {
      const pool = poolIn(c, POOL_A);
      pool.criteria = pool.criteria.filter((x) => x.key !== fit);
    });
    expect(removed.issues).toEqual(one(at2("criteria"), "reviews_have_scores", 1));
    const moved = await reviewOf(guard, cookies.chair, (c) => {
      const type = c.submissionTypes.find((x) => x.key === "talk");
      if (type) type.reviewPool = POOL_B;
    });
    // (Moving it would also show the authors of an anonymized review: both are said.)
    expect(moved.issues).toContainEqual({
      path: "submissionTypes.talk.reviewPool",
      code: "reviews_sent",
      params: { n: 1 },
      message: expect.any(String),
    });
    expect(moved.canSave).toBe(false);
  });

  it("the save refuses what the review of the changes refuses, at the same value, and stores nothing", async () => {
    const { config, token } = await stored(guard, cookies.chair);
    criterionIn(config, POOL_A, clarity).max = 3;
    poolIn(config, POOL_A).form.chairNote.enabled = false;
    const res = await saveConfig(guard, cookies.chair, config, token);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      error: "reviews_above_scale",
      issues: [
        {
          path: at2(`criteria.${clarity}.max`),
          code: "reviews_above_scale",
          params: { n: 1 },
          message: expect.any(String),
        },
        {
          path: at2("form.chairNote.enabled"),
          code: "reviews_have_note",
          params: { n: 1 },
          message: expect.any(String),
        },
      ],
    });
    expect((await stored(guard, cookies.chair)).token).toBe(token);
    // What the answer says of the reviews is how many: never a word or a score of one.
    expect(findLeaks(res.json, [comments, "Between us.", "reject"])).toEqual([]);
  });

  it("drafts never block: the scale narrows under a draft, which then has to fit the form to be sent", async () => {
    const merit = CRITERIA_B[0] ?? "";
    const draft = await saveReview(t, { cookie: cookies.other }, performance, 0, false, {
      scores: Object.fromEntries(CRITERIA_B.map((key) => [key, 5])),
      comments: words(30, "paper"),
      chairNote: "A note in a draft.",
      recommendation: "accept",
    });
    expect(draft.status).toBe(200);
    const { config, token } = await stored(guard, cookies.chair);
    criterionIn(config, POOL_B, merit).max = 4;
    poolIn(config, POOL_B).form.chairNote.enabled = false;
    poolIn(config, POOL_B).form.comments.maxWords = 20;
    const saved = await saveConfig(guard, cookies.chair, config, token);
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    // The draft is still theirs, as they left it. Sent as it is, it is refused field by field.
    const mine = await readReview(t, { cookie: cookies.other }, performance);
    expect(mine.json).toMatchObject({
      status: "draft",
      version: 1,
      chairNote: "A note in a draft.",
    });
    const sent = await saveReview(t, { cookie: cookies.other }, performance, 1, true, {
      scores: mine.json.scores,
      comments: mine.json.comments,
      chairNote: mine.json.chairNote,
      recommendation: mine.json.recommendation,
    });
    expect(sent.status).toBe(422);
    expect(sent.json.issues).toEqual([
      { path: `scores.${merit}`, code: "out_of_range", params: { min: 1, max: 4 } },
      { path: "chairNote", code: "not_on_form" },
      { path: "comments", code: "too_many_words", params: { max: 20, count: 30 } },
    ]);
    // Fitted to the form as it is now, it is sent.
    const fitted = await saveReview(t, { cookie: cookies.other }, performance, 1, true, {
      scores: { ...mine.json.scores, [merit]: 4 },
      comments: words(20, "paper"),
      chairNote: "",
      recommendation: "accept",
    });
    expect(fitted.status, JSON.stringify(fitted.json)).toBe(200);
    // And from then on it holds the form where it is.
    const wider = await reviewOf(guard, cookies.chair, (c) => {
      poolIn(c, POOL_B).form.comments.maxWords = 19;
    });
    expect(wider.issues).toEqual(
      one(`reviewPools.${POOL_B}.form.comments.maxWords`, "reviews_too_long", 1),
    );
  });

  it("a chair learns nothing of the reviews of their own proposal from what the settings refuse", async () => {
    // The author-chair's own talk is reviewed by this committee, and the conference is in
    // review. Whatever narrows the committee's form is refused to them from then on, whether or
    // not a review of their talk exists and whatever one holds: the answer is made without
    // their talk's reviews, from the phase and from the talk having been submitted.
    const hidden = (path: string) => ({
      path,
      code: "reviews_hidden",
      message: expect.any(String),
    });
    const asAuthor = (change: (c: ConferenceConfig) => void) =>
      reviewOf(guard, cookies.authorChair, change);
    expect(await reviewRows(t, ownTalk)).toEqual([]);

    // What narrows nothing is the author-chair's to change, like any chair's.
    const free = await asAuthor((c) => {
      criterionIn(c, POOL_A, fit).label = { en: "Fit, reworded by the author" };
      criterionIn(c, POOL_A, fit).max = 9;
      poolIn(c, POOL_A).guidelines = { en: "New guidelines." };
      // The other committee reviews nothing of theirs: its form is theirs to narrow.
      poolIn(c, POOL_B).form.comments.maxWords = 400;
    });
    expect(free).toMatchObject({ issues: [], canSave: true });

    // A largest score of 4, a smallest of 2, a word limit, the note taken off: each refused.
    const second = CRITERIA_A[1] ?? "";
    const probes: [string, (c: ConferenceConfig) => void, string][] = [
      [
        "a largest score lowered",
        (c) => {
          criterionIn(c, POOL_A, second).max = 4;
        },
        at2(`criteria.${second}.max`),
      ],
      [
        "a smallest score raised",
        (c) => {
          criterionIn(c, POOL_A, second).min = 2;
        },
        at2(`criteria.${second}.min`),
      ],
      [
        "a most number of words",
        (c) => {
          poolIn(c, POOL_A).form.comments.maxWords = 5000;
        },
        at2("form.comments.maxWords"),
      ],
      [
        "the note taken off",
        (c) => {
          poolIn(c, POOL_A).form.chairNote.enabled = false;
        },
        at2("form.chairNote.enabled"),
      ],
      [
        "the recommendation taken off",
        (c) => {
          poolIn(c, POOL_A).form.recommendation.enabled = false;
        },
        at2("form.recommendation.enabled"),
      ],
    ];
    const answers = async () =>
      Promise.all(probes.map(async ([, change]) => (await asAuthor(change)).issues));
    /**
     * The answers in every state the talk and the conference can be in afterwards: as it is,
     * withdrawn, back in a draft, and with the conference moved back out of review. If any of
     * them depended on whether a review exists, it would differ between the three times this is
     * asked: with no review, with one, and with another one.
     *
     * In the first three the conference is in review, and the answers are the refusals. In the
     * last it is not, and nothing is refused for their talk's sake, whether or not a review of it
     * was sent while it was: the rule looks at the phase the conference is in now (spec 02,
     * §1.9 names this case).
     */
    const inEveryState = async () => {
      const out = [await answers()];
      for (const status of ["withdrawn", "draft"] as const) {
        await t.db.update(submissions).set({ status }).where(eq(submissions.id, ownTalk));
        out.push(await answers());
      }
      await t.db
        .update(submissions)
        .set({ status: "submitted" })
        .where(eq(submissions.id, ownTalk));
      const back = await movePhase(guard, cookies.chair, "cfp_open", "reviewing", true);
      expect(back.status, JSON.stringify(back.json)).toBe(200);
      out.push(await answers());
      expect((await movePhase(guard, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
      return out;
    };
    // Before any review of their talk exists.
    const before = await answers();
    const everywhere = await inEveryState();
    expect(everywhere.slice(0, 3)).toEqual([before, before, before]);
    for (const issues of everywhere[3] ?? [[]]) {
      expect(issues.filter((issue) => issue.code === "reviews_hidden")).toEqual([]);
    }
    for (const [i, [what, , path]] of probes.entries()) {
      // No number, and nothing of the review they may read (the other talk's) that the change
      // does not put outside the form.
      expect(
        before[i]?.filter((issue) => issue.code === "reviews_hidden"),
        what,
      ).toEqual([hidden(path)]);
      expect((await asAuthor(probes[i]?.[1] ?? (() => {}))).canSave, what).toBe(false);
    }

    // Reviewer two sends a review of it: all fives, and no note.
    const hiddenText = text("a review the author must not learn anything from");
    const sent = await saveReview(t, { cookie: cookies.r2 }, ownTalk, 0, true, {
      scores: Object.fromEntries(CRITERIA_A.map((key) => [key, 5])),
      comments: hiddenText,
      chairNote: "",
      recommendation: "accept",
    });
    expect(sent.status).toBe(200);
    // The answers are the same, to the letter: that a review was sent changes nothing, whatever
    // became of the talk since and whichever phase the conference is in.
    expect(await inEveryState()).toEqual(everywhere);
    // Nor does what it holds: now all ones, three words, a note and a rejection.
    await t.db
      .update(reviews)
      .set({
        scores: Object.fromEntries(CRITERIA_A.map((key) => [key, 1])),
        comments: "Short.",
        chairNote: "Now it has a note.",
        recommendation: "reject",
      })
      .where(eq(reviews.submissionId, ownTalk));
    expect(await inEveryState()).toEqual(everywhere);

    // A chair who may read it is told how many, by what they hold: now the ones are below 2.
    const full = await reviewOf(guard, cookies.chair, (c) => {
      criterionIn(c, POOL_A, second).min = 2;
    });
    expect(full.issues).toEqual(one(at2(`criteria.${second}.min`), "reviews_below_scale", 1));
    // And the save refuses the author as the review of the changes does.
    const { config, token } = await stored(guard, cookies.authorChair);
    poolIn(config, POOL_A).form.comments.maxWords = 5000;
    const res = await saveConfig(guard, cookies.authorChair, config, token);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("reviews_hidden");
    expect(findLeaks(res.json, [hiddenText, "Now it has a note."])).toEqual([]);
    expect((await stored(guard, cookies.authorChair)).token).toBe(token);
  });

  it("a review that was sent counts whatever became of its proposal since, for every chair", async () => {
    // Reviewer one gave the stranger's talk a 4 for the third criterion: a largest score of 3
    // would leave it outside. The author-chair's talk has ones, which stay inside.
    const probe = (c: ConferenceConfig) => {
      criterionIn(c, POOL_A, clarity).max = 3;
    };
    const path = at2(`criteria.${clarity}.max`);
    try {
      for (const status of ["submitted", "withdrawn", "draft"] as const) {
        await t.db.update(submissions).set({ status }).where(eq(submissions.id, talk));
        // No chair is shown a proposal that went back to a draft. Its review was sent all the
        // same: it is counted, with its number, and the change is nobody's dead end to hand on.
        const chairs = await reviewOf(guard, cookies.chair, probe);
        expect(chairs.issues, status).toEqual(one(path, "reviews_above_scale", 1));
        // The author-chair is told the same of that review, which is not kept from them, and
        // that their own talk's reviews are.
        const authors = await reviewOf(guard, cookies.authorChair, probe);
        expect(authors.issues, status).toEqual([
          ...one(path, "reviews_above_scale", 1),
          { path, code: "reviews_hidden", message: expect.any(String) },
        ]);
      }
    } finally {
      await t.db.update(submissions).set({ status: "submitted" }).where(eq(submissions.id, talk));
    }
  });

  it("one review counts once at each value it would be outside of, however many of its scores a change removes", async () => {
    // The sent reviews of this committee's talks, as the chair asking may read them all.
    const sent = [...(await reviewRows(t, talk)), ...(await reviewRows(t, ownTalk))].filter(
      (r) => r.status === "sent",
    );
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const [, second, third] = CRITERIA_A;
    const scoreOf = (r: (typeof sent)[number], key: string) =>
      (r.scores as Record<string, number>)[key];
    // Two criteria removed at once, and the first one's scale narrowed from below, in one
    // change: a review that scores both removed criteria is one review there, not two, and it
    // is counted again, once, where its score falls below the new smallest one.
    const res = await reviewOf(guard, cookies.chair, (c) => {
      const pool = poolIn(c, POOL_A);
      pool.criteria = pool.criteria.filter((x) => x.key !== second && x.key !== third);
      criterionIn(c, POOL_A, fit).min = 3;
    });
    const scored = sent.filter(
      (r) => scoreOf(r, second ?? "") !== undefined || scoreOf(r, third ?? "") !== undefined,
    );
    const below = sent.filter((r) => (scoreOf(r, fit) ?? 3) < 3);
    expect(scored.length).toBe(sent.length);
    expect(below.length).toBeGreaterThanOrEqual(1);
    // In the order of the form: the first criterion's scale, then the criteria that are gone.
    expect(res.issues).toEqual([
      ...one(at2(`criteria.${fit}.min`), "reviews_below_scale", below.length),
      ...one(at2("criteria"), "reviews_have_scores", scored.length),
    ]);
  });

  it("before the conference is in review the form is every chair's to narrow; from then on a chair with a proposal before the committee leaves that to another chair", async () => {
    const o = await world(t, "review-guard-open");
    for (const who of ["chair", "authorChair", "conflictedChair"] as const) {
      await grantRole(t.db, { conferenceId: o.conferenceId, personId: ids[who], role: "chair" });
    }
    // The author-chair's talk is submitted, and the conflicted chair has a conflict with it.
    // The other chair has begun a talk and never submitted it.
    const theirs = await proposal(
      o,
      cookies.authorChair,
      "A chair's own talk, while the call is open",
    );
    await t.db.insert(conflicts).values({
      conferenceId: o.conferenceId,
      personId: ids.conflictedChair,
      submissionId: theirs,
      kind: "declared",
      declaredBy: "chair",
    });
    const begun = await call(t.public, "POST", `/api/conferences/${o.slug}/submissions`, {
      cookie: cookies.chair,
      body: { typeKey: "talk", language: "en", participationMode: "in_person" },
    });
    expect(begun.status).toBe(201);
    const narrow = (c: ConferenceConfig) => {
      criterionIn(c, POOL_A, fit).max = 4;
      poolIn(c, POOL_A).form.comments.maxWords = 300;
      poolIn(c, POOL_A).form.recommendation.enabled = false;
    };
    const everyone = ["chair", "authorChair", "conflictedChair"] as const;
    const free = async (who: (typeof everyone)[number], when: string) =>
      expect(await reviewOf(o, cookies[who], narrow), `${who}, ${when}`).toMatchObject({
        issues: [],
        canSave: true,
      });
    // No review is written before the conference is in review: while the call is open, and
    // after it has closed, which is when chairs settle the form, it is every chair's to narrow.
    for (const who of everyone) await free(who, "while the call is open");
    await closeCall(o);
    for (const who of everyone) await free(who, "once the call has closed");

    // In review, a review of the talk can be written. Whether one was is not its author's to
    // know, nor the conflicted chair's: both are refused, without a number, although nobody
    // reviews it.
    expect((await movePhase(o, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
    const hiddenAt = [
      `criteria.${fit}.max`,
      "form.comments.maxWords",
      "form.recommendation.enabled",
    ].map((rest) => ({ path: at2(rest), code: "reviews_hidden", message: expect.any(String) }));
    for (const who of ["authorChair", "conflictedChair"] as const) {
      const refused = await reviewOf(o, cookies[who], narrow);
      expect(refused.canSave, who).toBe(false);
      expect(refused.issues, who).toEqual(hiddenAt);
      // What narrows nothing, and the other committee's form, are still theirs.
      expect(
        await reviewOf(o, cookies[who], (c) => {
          criterionIn(c, POOL_A, fit).max = 9;
          poolIn(c, POOL_B).form.recommendation.enabled = false;
        }),
        who,
      ).toMatchObject({ issues: [], canSave: true });
    }
    // A chair whose own work there was never submitted is refused nothing, and makes the change.
    await free("chair", "in review");

    // Where every chair is kept from a review of the committee's, none of them can: the chairs
    // without a stake are gone, and the two who are left are both refused. A chair with no
    // proposal there has to be invited (the refusal says so on the screen).
    await t.db
      .delete(conferenceRoles)
      .where(
        and(
          eq(conferenceRoles.conferenceId, o.conferenceId),
          eq(conferenceRoles.personId, ids.chair),
        ),
      );
    for (const who of ["authorChair", "conflictedChair"] as const) {
      expect((await reviewOf(o, cookies[who], narrow)).canSave, who).toBe(false);
    }
    await grantRole(t.db, { conferenceId: o.conferenceId, personId: ids.chair, role: "chair" });

    // Moved back out of review, nothing is refused for the talk's sake any more, whether or not
    // a review of it was sent meanwhile: the one case the guard leaves open (spec 02, §1.9).
    expect((await movePhase(o, cookies.chair, "cfp_open", "reviewing", true)).status).toBe(200);
    for (const who of everyone) await free(who, "moved back out of review");
  });

  it("the day reviews are due is set between the day the call closes and the day decisions are sent", async () => {
    const due = (iso: string | undefined) =>
      reviewOf(guard, cookies.chair, (c) => {
        if (iso === undefined) delete c.deadlines.reviewsDue;
        else c.deadlines.reviewsDue = iso;
      });
    const { config } = await stored(guard, cookies.chair);
    const close = Date.parse(config.deadlines.submissionsClose);
    const decisions = Date.parse(config.deadlines.notification);
    const between = new Date((close + decisions) / 2).toISOString();
    expect(await due(between)).toMatchObject({
      issues: [],
      canSave: true,
      changes: [{ path: "deadlines.reviewsDue", after: between }],
    });
    for (const bad of [close, close - HOUR, decisions, decisions + HOUR]) {
      const review = await due(new Date(bad).toISOString());
      expect(review.issues, new Date(bad).toISOString()).toEqual([
        { path: "deadlines.reviewsDue", code: "reviews_due_order", message: expect.any(String) },
      ]);
    }
  });
});

describe("a chair who also reviews", () => {
  const address = "review-chair-who-reviews@example.org";
  let b: World;
  let both: string;
  let bothId: string;
  /** Two talks assigned to them, and one of their own. */
  let theirs: string;
  let givenBack: string;
  let own: string;

  beforeAll(async () => {
    // A conference of its own: nothing here is counted by the tests of the others.
    b = await world(t, "review-both");
    both = await b.person(address, "Cass Chairreviewer");
    bothId = await b.id(address);
    for (const personId of [ids.chair, bothId]) {
      await grantRole(t.db, { conferenceId: b.conferenceId, personId, role: "chair" });
    }
    await reviewer(b, address, [POOL_A]);
    await reviewer(b, mail("r1"), [POOL_A]);
    theirs = await proposal(b, cookies.owner, "A talk a chair reviews");
    givenBack = await proposal(b, cookies.owner, "A talk a chair gives back");
    own = await proposal(b, both, "A talk by a chair who reviews");
    await closeCall(b);
    // Assigned like any reviewer, by another chair or by themselves, and never to their own.
    expect((await assign(b, cookies.chair, theirs, bothId)).status).toBe(204);
    expect((await assign(b, cookies.chair, theirs, ids.r1)).status).toBe(204);
    expect((await assign(b, both, givenBack, bothId)).status).toBe(204);
    expect((await assign(b, cookies.chair, own, bothId)).status).toBe(409);
    expect((await movePhase(b, cookies.chair, "reviewing", "cfp_open")).status).toBe(200);
  }, 120_000);

  const listed = async () => {
    const res = await myReviews(t, { cookie: both });
    expect(res.status).toBe(200);
    const here = (
      res.json.conferences as {
        conference: { slug: string };
        proposals: { submissionId: string; status: string }[];
      }[]
    ).find((k) => k.conference.slug === b.slug);
    return here?.proposals ?? [];
  };

  it("reads the proposal as a chair, and writes their review of it like any reviewer", async () => {
    const page = await call(t.public, "GET", `/api/submissions/${theirs}`, { cookie: both });
    expect(page.status).toBe(200);
    expect(page.json.view).toBe("chair");
    const first = await readReview(t, { cookie: both }, theirs);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      view: "own_review",
      status: "not_started",
      version: 0,
      open: true,
      canDecline: true,
    });
    // Their list holds what is assigned to them, and the main menu offers it.
    expect((await listed()).map((p) => p.submissionId).sort()).toEqual([theirs, givenBack].sort());
    expect((await call(t.public, "GET", "/api/me/menu", { cookie: both })).json).toEqual({
      reviews: true,
    });

    const draftText = text("a chair's own draft");
    const draft = await saveReview(t, { cookie: both }, theirs, 0, false, {
      ...EMPTY,
      comments: draftText,
    });
    expect(draft.status, JSON.stringify(draft.json)).toBe(200);
    // A draft is its reviewer's own, a chair's too: the other chair is shown no sign of it.
    const beforeSent = await section(b, cookies.chair, theirs);
    expect(beforeSent.assigned.find((a) => a.personId === bothId)?.review).toBeNull();
    expect(findLeaks(beforeSent, [draftText])).toEqual([]);

    const sentText = text("a chair's own review");
    const sent = await saveReview(t, { cookie: both }, theirs, 1, true, complete(sentText));
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(sent.json).toMatchObject({ status: "sent", version: 2, canDecline: false });
    const afterSent = await section(b, cookies.chair, theirs);
    expect(afterSent.assigned.find((a) => a.personId === bothId)?.review).toMatchObject({
      comments: sentText,
      recommendation: "accept",
    });
    expect((await listed()).find((p) => p.submissionId === theirs)?.status).toBe("sent");
    // Once sent it stays theirs to review, as anyone's does.
    expect((await decline(t, { cookie: both }, theirs, { reason: "time" })).status).toBe(409);
    expect((await unassign(b, cookies.chair, theirs, bothId)).json).toMatchObject({
      error: "review_sent",
    });
  });

  it("says they cannot review one: with a conflict, it is no longer theirs to read as a chair either", async () => {
    const note = text("a chair's note on giving it back");
    const res = await decline(t, { cookie: both }, givenBack, { reason: "conflict", note });
    expect(res.status, JSON.stringify(res.json)).toBe(204);
    expect((await readReview(t, { cookie: both }, givenBack)).status).toBe(404);
    expect(
      (await call(t.public, "GET", `/api/submissions/${givenBack}`, { cookie: both })).status,
    ).toBe(404);
    expect((await listed()).map((p) => p.submissionId)).toEqual([theirs]);
    // The other chair reads who gave it back, why, and what they wrote.
    expect((await section(b, cookies.chair, givenBack)).declined).toMatchObject([
      { personId: bothId, reason: "conflict", note, at: expect.any(String) },
    ]);
  });

  it("has agents that get nothing of any review, their own included, whatever their tier", async () => {
    const tokens = await Promise.all(
      (["M", "C"] as const).map(async (tier) => ({
        tier,
        app: tier === "M" ? t.public : t.internal,
        token: (
          await createApiToken(t.db, {
            personId: bothId,
            conferenceId: b.conferenceId,
            tier,
            name: `chair who reviews ${tier}`,
          })
        ).token,
      })),
    );
    for (const { tier, app, token } of tokens) {
      const read = await call(app, "GET", `/api/submissions/${theirs}/review`, { token });
      expect(read.status, tier).toBe(404);
      const write = await call(app, "PUT", `/api/submissions/${theirs}/review`, {
        token,
        body: { version: 2, send: true, ...complete("An agent's words.") },
      });
      expect(write.status, tier).toBe(403);
      expect(write.json, tier).toEqual({ error: "agents_read_only" });
      expect((await call(app, "GET", "/api/me/reviews", { token })).status, tier).toBe(401);
      // The Reviewers section, where the chair reads sent reviews, is not an agent's either.
      const reviewersOf = await call(app, "GET", at(b, `/assignments/submissions/${theirs}`), {
        token,
      });
      expect(reviewersOf.status, tier).toBe(403);
      // What an agent is given of the proposal holds no word of a review.
      const given = await call(app, "GET", `/api/submissions/${theirs}`, { token });
      expect(
        findLeaks(
          given.json,
          secrets.filter((s) => s.startsWith("REVIEWTEXT")),
        ),
        tier,
      ).toEqual([]);
    }
  });

  it("is never the reviewer of their own proposal, whatever the assignments table holds", async () => {
    // No route makes this row: a chair is never offered for their own proposal.
    await t.db.insert(assignments).values({
      conferenceId: b.conferenceId,
      submissionId: own,
      reviewerId: bothId,
      assignedByPersonId: ids.chair,
    });
    try {
      expect((await readReview(t, { cookie: both }, own)).status).toBe(404);
      const write = await saveReview(t, { cookie: both }, own, 0, false, EMPTY);
      expect(write.status).toBe(404);
      expect((await decline(t, { cookie: both }, own, { reason: "time" })).status).toBe(404);
      expect((await listed()).map((p) => p.submissionId)).toEqual([theirs]);
      expect(await reviewRows(t, own)).toEqual([]);
      expect(await assignmentRows(t, own)).toHaveLength(1);
    } finally {
      await t.db.delete(assignments).where(eq(assignments.submissionId, own));
    }
  });
});

describe("what the database itself holds to", () => {
  it("one review for a reviewer and a proposal, a draft or sent, and sent only with the time it was sent", async () => {
    const row = {
      conferenceId: w.conferenceId,
      submissionId: subs.performance,
      reviewerId: ids.other,
    };
    await t.db.insert(reviews).values(row);
    await expect(t.db.insert(reviews).values(row)).rejects.toThrow();
    const again = { ...row, reviewerId: ids.r3 };
    for (const bad of [
      { status: "released" },
      { status: "sent" },
      { status: "draft", sentAt: NOW },
      { recommendation: "maybe" },
    ]) {
      await expect(
        t.db.insert(reviews).values({ ...again, ...bad }),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }
    await t.db.insert(reviews).values({ ...again, status: "sent", sentAt: NOW });
    await t.db
      .delete(reviews)
      .where(and(eq(reviews.submissionId, subs.performance), eq(reviews.reviewerId, ids.r3)));
    await t.db
      .delete(reviews)
      .where(and(eq(reviews.submissionId, subs.performance), eq(reviews.reviewerId, ids.other)));
  });

  it("a review goes with its proposal and its conference, and a reviewer is not deleted from under one", async () => {
    // A proposal's deletion: an owner deleting a draft never fails on a review, and nothing is
    // left of a proposal that is gone.
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
    const email = mail("ghost");
    await w.person(email, "Gus Ghostreviewer");
    const ghost = await w.id(email);
    await t.db.insert(reviews).values([
      { conferenceId: w.conferenceId, submissionId: draft.id, reviewerId: ghost },
      {
        conferenceId: w.conferenceId,
        submissionId: draft.id,
        reviewerId: ids.r3,
        status: "sent",
        sentAt: NOW,
      },
    ]);
    // A person's deletion: refused while a review of theirs stands, a draft included. A review
    // is someone's judgement in their words: it does not vanish, or become nobody's, because
    // a row of people was deleted.
    await expect(t.db.delete(people).where(eq(people.id, ghost))).rejects.toThrow();
    expect(await reviewRows(t, draft.id)).toHaveLength(2);
    await t.db.delete(submissions).where(eq(submissions.id, draft.id));
    expect(await reviewRows(t, draft.id)).toEqual([]);
    // With the proposal gone, so are its reviews, and nothing holds the person any more.
    await t.db.delete(people).where(eq(people.id, ghost));

    // A conference's deletion takes its reviews with everything else of it.
    const gone = await world(t, "review-gone");
    const [sub] = await t.db
      .insert(submissions)
      .values({
        conferenceId: gone.conferenceId,
        ownerPersonId: ids.stranger,
        typeKey: "talk",
        language: "en",
        title: "",
        abstract: "",
        status: "draft",
      })
      .returning({ id: submissions.id });
    if (!sub) throw new Error("no proposal");
    await t.db
      .insert(reviews)
      .values({ conferenceId: gone.conferenceId, submissionId: sub.id, reviewerId: ids.r3 });
    await t.db.delete(conferences).where(eq(conferences.id, gone.conferenceId));
    expect(await reviewRows(t, sub.id)).toEqual([]);
  });
});

describe("the audit log", () => {
  it("has a row for every review saved, sent and changed, with ids and numbers and never a word of one", async () => {
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(or(like(auditLog.action, "review.%"), like(auditLog.action, "conflict.%")));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.targetType).toBe("submission");
      expect(row.actorKind).toBe("human");
      expect(Object.keys(row.details as object).sort()).toEqual(
        row.action === "conflict.declared" ? ["kind", "personId"] : ["reviewId", "version"],
      );
    }
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set(["review.draft_saved", "review.sent", "review.changed", "conflict.declared"]),
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
 * (TEST_DATABASE_URL, as for assignments.test.ts and settings-locks.test.ts), requests really
 * do run at once. Run this file on its own:
 *
 *   docker run --rm -d --name elochair-reviews -e POSTGRES_PASSWORD=reviews \
 *     -p 127.0.0.1:55435:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:reviews@127.0.0.1:55435/postgres \
 *     npx vitest run apps/server/src/reviews.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "on Postgres, requests made at the same moment",
  () => {
    let pg: TestApp;
    let p: World;
    const run = Date.now();
    let chair: string;
    let owner: string;
    const address = (who: string) => `review-pg-${run}-${who}@example.org`;
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
    /** A reviewer of the first pool, signed in, with a proposal of their own to review. */
    async function pair(n: string) {
      const email = address(`reviewer-${n}`);
      const cookie = await p.person(email, `Reviewer ${n} Postgres`);
      const id = await reviewer(p, email, [POOL_A]);
      return { cookie, id, email };
    }
    /** A new submitted talk, as the table holds one (the call has closed), with its reviewers. */
    async function talkFor(reviewerIds: string[], title: string) {
      const [row] = await pg.db
        .insert(submissions)
        .values({
          conferenceId: p.conferenceId,
          ownerPersonId: await p.id(address("owner")),
          typeKey: "talk",
          language: "en",
          title,
          abstract: words(260),
          status: "submitted",
          submittedAt: NOW,
        })
        .returning({ id: submissions.id });
      if (!row) throw new Error("no talk");
      for (const reviewerId of reviewerIds) {
        const res = await assign(p, chair, row.id, reviewerId);
        expect(res.status, JSON.stringify(res.json)).toBe(204);
      }
      return row.id;
    }
    const roleOf = async (id: string) =>
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
    const removing = (id: string, assigned: number, sent: number) =>
      call(pg.public, "DELETE", at(p, `/people/${id}/roles/reviewer`), {
        cookie: chair,
        body: { assignments: assigned, reviews: sent },
      });
    const sentReview = (id: string, score = 4) =>
      complete(`A review sent at the same moment as something else (${id.slice(0, 8)}).`, {
        scores: Object.fromEntries(CRITERIA_A.map((key) => [key, score])),
      });

    beforeAll(async () => {
      pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
      lifted(pg);
      // A call of its own each run: the database may still hold an earlier run's rows.
      p = await world(pg, `review-pg-${run}`);
      chair = await p.person(address("chair"), "Chair Postgres");
      await grantRole(pg.db, {
        conferenceId: p.conferenceId,
        personId: await p.id(address("chair")),
        role: "chair",
      });
      owner = await p.person(address("owner"), "Owner Postgres");
      expect(owner).toBeTruthy();
      await closeCall(p);
      expect((await movePhase(p, chair, "reviewing", "cfp_open")).status).toBe(200);
    }, 240_000);
    afterAll(() => pg?.close());

    it("a review sent while the chair removes the reviewer's role: sent and kept with its assignment, or not sent at all", async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 16; round++) {
        const r = await pair(`role-${round}`);
        const talk = await talkFor([r.id], `A talk whose reviewer is removed ${round}`);
        const [sent, removed] = await Promise.all([
          saveReview(pg, { cookie: r.cookie }, talk, 0, true, sentReview(talk)),
          removing(r.id, 1, 0),
        ]);
        outcomes.add(`${sent.status}/${removed.status}`);
        const rows = await reviewRows(pg, talk);
        const assigned = await assignmentRows(pg, talk);
        if (sent.status === 200) {
          // The review went first. The removal then found a review it had not been told of, and
          // removed nothing (the confirmation named none): the role, the assignment and the
          // review all stand.
          expect(removed.status, `round ${round}`).toBe(409);
          expect(removed.json, `round ${round}`).toEqual({
            error: "stale",
            assignments: 1,
            reviews: 1,
          });
          expect(
            rows.map((x) => x.status),
            `round ${round}`,
          ).toEqual(["sent"]);
          expect(assigned, `round ${round}`).toHaveLength(1);
          expect(await roleOf(r.id), `round ${round}`).toBe(true);
          // Told the numbers as they are, the removal keeps the review and its assignment.
          expect((await removing(r.id, 1, 1)).status, `round ${round}`).toBe(204);
          expect(await reviewRows(pg, talk), `round ${round}`).toHaveLength(1);
          expect(await assignmentRows(pg, talk), `round ${round}`).toHaveLength(1);
        } else {
          // The removal went first: there is no reviewer left to send anything.
          expect(removed.status, `round ${round}`).toBe(204);
          expect(sent.status, `round ${round}`).toBe(404);
          expect(rows, `round ${round}`).toEqual([]);
          expect(assigned, `round ${round}`).toEqual([]);
        }
        expect(await roleOf(r.id), `round ${round}`).toBe(false);
      }
      // Never a review left without its assignment, and never an answer that is neither.
      expect([...outcomes].filter((o) => !["200/409", "404/204"].includes(o))).toEqual([]);
    }, 240_000);

    it("a review waits for a role's removal under way, and then finds no reviewer", async () => {
      const r = await pair("waits-for-removal");
      const talk = await talkFor([r.id], "A talk whose reviewer is being removed");
      // The removal as it stands after its lock and its writes, before it commits.
      const removal = hold(async (tx) => {
        await lockRoles(tx, p.conferenceId, "exclusive");
        await tx
          .delete(assignments)
          .where(and(eq(assignments.submissionId, talk), eq(assignments.reviewerId, r.id)));
        await tx
          .delete(conferenceRoles)
          .where(
            and(
              eq(conferenceRoles.conferenceId, p.conferenceId),
              eq(conferenceRoles.personId, r.id),
              eq(conferenceRoles.role, "reviewer"),
            ),
          );
      });
      await removal.ready;
      const sending = saveReview(pg, { cookie: r.cookie }, talk, 0, true, sentReview(talk));
      try {
        expect(await within(sending, 500)).toBe("waiting");
        expect(await reviewRows(pg, talk)).toEqual([]);
      } finally {
        await removal.release();
      }
      const sent = await sending;
      expect(sent.status).toBe(404);
      expect(await reviewRows(pg, talk)).toEqual([]);
    }, 60_000);

    it("a role's removal waits for a review being sent, and then keeps it with its assignment", async () => {
      const r = await pair("removal-waits");
      const talk = await talkFor([r.id], "A talk whose review is on its way");
      // The review as it stands after its locks and its write, before it commits.
      const sending = hold(async (tx) => {
        await tx.select().from(submissions).where(eq(submissions.id, talk)).for("no key update");
        await lockRoles(tx, p.conferenceId, "shared");
        await shareConference(tx, p.conferenceId);
        await tx.insert(reviews).values({
          conferenceId: p.conferenceId,
          submissionId: talk,
          reviewerId: r.id,
          status: "sent",
          sentAt: NOW,
          ...sentReview(talk),
        });
      });
      await sending.ready;
      // Told what the page showed a moment ago: one proposal, no review sent.
      const removal = removing(r.id, 1, 0);
      try {
        expect(await within(removal, 500)).toBe("waiting");
        expect(await roleOf(r.id)).toBe(true);
      } finally {
        await sending.release();
      }
      const removed = await removal;
      // It sees the review that was sent meanwhile, and removes nothing it was not told of.
      expect(removed.status).toBe(409);
      expect(removed.json).toEqual({ error: "stale", assignments: 1, reviews: 1 });
      expect(await assignmentRows(pg, talk)).toHaveLength(1);
      expect((await removing(r.id, 1, 1)).status).toBe(204);
      expect(await assignmentRows(pg, talk)).toHaveLength(1);
      expect((await reviewRows(pg, talk)).map((x) => x.status)).toEqual(["sent"]);
    }, 60_000);

    it("a review sent while the chair removes the reviewer from the proposal: one of the two happens", async () => {
      const outcomes = new Set<string>();
      for (let round = 0; round < 12; round++) {
        const r = await pair(`removed-${round}`);
        const talk = await talkFor([r.id], `A talk that loses its reviewer ${round}`);
        const [sent, removed] = await Promise.all([
          saveReview(pg, { cookie: r.cookie }, talk, 0, true, sentReview(talk)),
          unassign(p, chair, talk, r.id),
        ]);
        outcomes.add(`${sent.status}/${removed.status}`);
        const rows = await reviewRows(pg, talk);
        const assigned = await assignmentRows(pg, talk);
        if (sent.status === 200) {
          expect(removed.status, `round ${round}`).toBe(409);
          expect(removed.json, `round ${round}`).toEqual({ error: "review_sent" });
          expect(
            rows.map((x) => x.status),
            `round ${round}`,
          ).toEqual(["sent"]);
          expect(assigned, `round ${round}`).toHaveLength(1);
        } else {
          expect([sent.status, removed.status], `round ${round}`).toEqual([404, 204]);
          expect(rows, `round ${round}`).toEqual([]);
          expect(assigned, `round ${round}`).toEqual([]);
        }
      }
      expect([...outcomes].filter((o) => !["200/409", "404/204"].includes(o))).toEqual([]);
    }, 240_000);

    it("a review sent while a settings save narrows a scale: the save sees it, or the review meets the new scale", async () => {
      const r = await pair("scale");
      const fit = CRITERIA_A[0] ?? "";
      const outcomes = new Set<string>();
      for (let round = 0; round < 12; round++) {
        const talk = await talkFor([r.id], `A talk scored at the top ${round}`);
        // The scale is 1 to 5 again; the review gives a 5; the save would make 4 the largest.
        const { config, token } = await stored(p, chair);
        criterionIn(config, POOL_A, fit).max = 4;
        const [sent, saved] = await Promise.all([
          saveReview(pg, { cookie: r.cookie }, talk, 0, true, sentReview(talk, 5)),
          saveConfig(p, chair, config, token),
        ]);
        outcomes.add(`${sent.status}/${saved.status}`);
        const now = await stored(p, chair);
        const max = criterionIn(now.config, POOL_A, fit).max;
        if (saved.status === 200) {
          // The save went first: the review was checked against the scale it left, and refused.
          expect(sent.status, `round ${round}`).toBe(422);
          expect(sent.json.issues, `round ${round}`).toContainEqual({
            path: `scores.${fit}`,
            code: "out_of_range",
            params: { min: 1, max: 4 },
          });
          expect(max, `round ${round}`).toBe(4);
          expect(await reviewRows(pg, talk), `round ${round}`).toEqual([]);
          // Back to 5 for the next round: nothing was sent, so nothing holds it at 4.
          criterionIn(now.config, POOL_A, fit).max = 5;
          expect((await saveConfig(p, chair, now.config, now.token)).status).toBe(200);
        } else {
          // The review went first: the save saw it, and narrowed nothing.
          expect(sent.status, `round ${round}`).toBe(200);
          expect(saved.status, `round ${round}`).toBe(409);
          expect(saved.json.error, `round ${round}`).toBe("reviews_above_scale");
          expect(max, `round ${round}`).toBe(5);
        }
        // Whichever went first: no review that was sent is outside the scale that is stored.
        for (const row of await pg.db
          .select()
          .from(reviews)
          .where(and(eq(reviews.conferenceId, p.conferenceId), eq(reviews.status, "sent")))) {
          expect((row.scores as Record<string, number>)[fit], `round ${round}`).toBeLessThanOrEqual(
            max,
          );
        }
      }
      expect([...outcomes].filter((o) => !["422/200", "200/409"].includes(o))).toEqual([]);
    }, 240_000);

    it("a review waits for a settings save under way, and a save for a review being sent", async () => {
      const r = await pair("save-waits");
      const talk = await talkFor([r.id], "A talk and a save that wait for each other");
      const saving = hold((tx) => lockConference(tx, p.conferenceId));
      await saving.ready;
      const sending = saveReview(pg, { cookie: r.cookie }, talk, 0, false, {
        ...EMPTY,
        comments: "A draft that waits.",
      });
      try {
        // A draft too: every write of a review shares the conference's row.
        expect(await within(sending, 500)).toBe("waiting");
        expect(await reviewRows(pg, talk)).toEqual([]);
      } finally {
        await saving.release();
      }
      expect((await sending).status).toBe(200);

      // The other way round: a review that is sent and not yet committed makes the save wait,
      // and the save then counts it.
      const fit = CRITERIA_A[0] ?? "";
      const other = await talkFor([r.id], "A talk whose review the save must see");
      const held = hold(async (tx) => {
        await tx.select().from(submissions).where(eq(submissions.id, other)).for("no key update");
        await lockRoles(tx, p.conferenceId, "shared");
        await shareConference(tx, p.conferenceId);
        await tx.insert(reviews).values({
          conferenceId: p.conferenceId,
          submissionId: other,
          reviewerId: r.id,
          status: "sent",
          sentAt: NOW,
          ...sentReview(other, 5),
        });
      });
      await held.ready;
      const { config, token } = await stored(p, chair);
      criterionIn(config, POOL_A, fit).max = 4;
      const save = saveConfig(p, chair, config, token);
      try {
        expect(await within(save, 700)).toBe("waiting");
      } finally {
        await held.release();
      }
      const saved = await save;
      expect(saved.status).toBe(409);
      expect(saved.json.error).toBe("reviews_above_scale");
    }, 60_000);

    it("two saves of one review at the same moment: one is saved, the other is told it is out of date", async () => {
      const r = await pair("twice");
      const talk = await talkFor([r.id], "A talk reviewed in two tabs");
      let version = 0;
      for (let round = 0; round < 10; round++) {
        // The first round has no review yet: two tabs both begin one. Later rounds change it.
        const send = round >= 5;
        const results = await Promise.all(
          ["one tab", "another tab", "a third"].map((tab) =>
            saveReview(pg, { cookie: r.cookie }, talk, version, send, {
              ...sentReview(talk),
              comments: `Round ${round}, from ${tab}.`,
            }),
          ),
        );
        expect(results.map((x) => x.status).sort(), `round ${round}`).toEqual([200, 409, 409]);
        const won = results.find((x) => x.status === 200);
        for (const lost of results.filter((x) => x.status === 409)) {
          // Each loser is told the version there is now: the winner's, whoever asked first.
          expect(lost.json, `round ${round}`).toEqual({ error: "stale", version: version + 1 });
        }
        version += 1;
        const rows = await reviewRows(pg, talk);
        expect(rows, `round ${round}`).toHaveLength(1);
        expect(rows[0], `round ${round}`).toMatchObject({
          version,
          comments: won?.json.comments,
          status: send ? "sent" : "draft",
        });
      }
    }, 120_000);

    it("a reviewer who says they cannot review it while a chair removes them: one release, one record", async () => {
      for (let round = 0; round < 8; round++) {
        const r = await pair(`cannot-${round}`);
        const talk = await talkFor([r.id], `A talk given back ${round}`);
        const [said, removed] = await Promise.all([
          decline(pg, { cookie: r.cookie }, talk, { reason: "time", note: "No time." }),
          unassign(p, chair, talk, r.id),
        ]);
        expect([said.status, removed.status].sort(), `round ${round}`).toEqual([204, 404]);
        expect(await assignmentRows(pg, talk), `round ${round}`).toEqual([]);
        const records = await releaseRows(pg, talk);
        expect(records, `round ${round}`).toHaveLength(1);
        expect(records[0]?.reason, `round ${round}`).toBe(said.status === 204 ? "time" : "chair");
      }
    }, 120_000);

    it("reviews, removals, assignments and saves all at once all finish: nobody waits on the one waiting for them", async () => {
      const reviewers = await Promise.all(Array.from({ length: 6 }, (_, i) => pair(`busy-${i}`)));
      const talks: string[] = [];
      for (let i = 0; i < 6; i++) {
        talks.push(
          await talkFor(
            [reviewers[i]?.id ?? "", reviewers[(i + 1) % 6]?.id ?? ""],
            `A busy talk ${i}`,
          ),
        );
      }
      const host = async (name: string) => {
        const { config, token } = await stored(p, chair);
        config.host = name;
        return saveConfig(p, chair, config, token);
      };
      const all = await within(
        Promise.all([
          host("Universidad Inventada del Norte"),
          ...talks.map((talk, i) =>
            saveReview(pg, { cookie: reviewers[i]?.cookie }, talk, 0, true, sentReview(talk)),
          ),
          ...talks.map((talk, i) =>
            saveReview(pg, { cookie: reviewers[(i + 1) % 6]?.cookie }, talk, 0, false, {
              ...EMPTY,
              comments: "A draft among many.",
            }),
          ),
          host("Universidad Inventada del Este"),
          removing(reviewers[0]?.id ?? "", 2, 0),
          removing(reviewers[3]?.id ?? "", 2, 0),
          ...talks.slice(0, 3).map((talk, i) => unassign(p, chair, talk, reviewers[i]?.id ?? "")),
          ...talks
            .slice(3)
            .map((talk, i) =>
              decline(pg, { cookie: reviewers[(i + 4) % 6]?.cookie }, talk, { reason: "time" }),
            ),
          host("Universidad Inventada del Oeste"),
        ]),
        60_000,
      );
      if (all === "waiting") throw new Error("still waiting after a minute: a deadlock");
      // Each is answered as a request of its kind is: never with an error, which is how a
      // deadlock that the database broke would end one of them.
      expect(
        all.map((x) => x.status).filter((x) => ![200, 204, 404, 409, 422].includes(x)),
      ).toEqual([]);
      // And what is left is whole: every sent review has its assignment, and every draft too.
      const left = await pg.db
        .select()
        .from(reviews)
        .where(eq(reviews.conferenceId, p.conferenceId));
      for (const row of left.filter((x) => talks.includes(x.submissionId))) {
        const mine = (await assignmentRows(pg, row.submissionId)).filter(
          (a) => a.reviewerId === row.reviewerId,
        );
        expect(mine, `${row.status} ${row.submissionId}`).toHaveLength(1);
      }
    }, 120_000);
  },
);
