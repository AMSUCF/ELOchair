import type { ConferenceConfig } from "@elochair/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import { contributions, submissions } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { RateLimiter } from "./ratelimit";
import { grantRole, lockConference, shareConference } from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * The lock protocol behind "submitted work stays valid" (spec 02, §1.9). A configuration save
 * holds the conference's row for update while it checks submitted work; every write to a
 * submission or its contributions shares that row before it reads or writes them. So the two
 * wait for each other, and a save never checks work that is changing under it.
 *
 * Since chairs can be removed (spec 03, §1.2), a change made as a chair also takes the
 * conference's roles lock and reads the chair again, before the conference's row: the one lock
 * order is written in services/roles.ts and in spec 02, §1.9, and checked here route by route.
 *
 * The in-memory database runs one transaction at a time, so nothing can be made to wait there.
 * The first part checks what can be seen without waiting: what a save decides after a write has
 * committed, and that each write path takes its locks, in order, before anything else. The
 * second part runs only against a real Postgres (TEST_DATABASE_URL) and shows the waiting:
 *
 *   docker run --rm -d --name elochair-locks -e POSTGRES_PASSWORD=locks \
 *     -p 127.0.0.1:55432:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:locks@127.0.0.1:55432/postgres \
 *     npx vitest run apps/server/src/settings-locks.test.ts
 */

const NOW = new Date("2027-02-01T12:00:00Z");
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
const words = (n: number) => Array.from({ length: n }, () => "verse").join(" ");
const at = (slug: string, rest: string) => `/api/conferences/${slug}/${rest}`;

type Sub = { id: string; version: number };
type World = {
  t: TestApp;
  slug: string;
  conferenceId: string;
  chair: string;
  /** Sign someone in; with a name, give them a profile. */
  person: (email: string, name?: string) => Promise<string>;
};

async function world(slug: string, databaseUrl?: string): Promise<World> {
  const t = await makeTestApp({}, { databaseUrl });
  const { conferenceId } = await seedTestCall(t.db, { slug, now: NOW });
  // Many people sign in and write from one address here; the limits have their own tests.
  t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
  const person = async (email: string, name?: string) => {
    const cookie = await signIn(t, email);
    if (name) {
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
  const chair = await person(`chair-${slug}@example.org`, "Zed Chairperson");
  await grantRole(t.db, {
    conferenceId,
    personId: await personId(t, `chair-${slug}@example.org`),
    role: "chair",
  });
  return { t, slug, conferenceId, chair, person };
}

/** A talk with its owner as lead: a draft, filled in. */
async function talk(w: World, owner: string, title: string): Promise<Sub> {
  const created = await call(w.t.public, "POST", at(w.slug, "submissions"), {
    cookie: owner,
    body: { typeKey: "talk", language: "en", participationMode: "in_person" },
  });
  expect(created.status).toBe(201);
  const filled = await call(w.t.public, "PATCH", `/api/submissions/${created.json.id}`, {
    cookie: owner,
    body: { version: created.json.version, title, abstract: words(260) },
  });
  expect(filled.status).toBe(200);
  return filled.json;
}

async function invite(w: World, owner: string, s: Sub, email: string): Promise<Sub> {
  const res = await call(w.t.public, "POST", `/api/submissions/${s.id}/contributors`, {
    cookie: owner,
    body: { version: s.version, email, role: "coauthor", lang: "en", name: "Nina Typed" },
  });
  expect(res.status).toBe(201);
  return res.json;
}

async function submit(w: World, owner: string, s: Sub): Promise<Sub> {
  const res = await call(w.t.public, "POST", `/api/submissions/${s.id}/submit`, {
    cookie: owner,
    body: { version: s.version, acceptedAgreements: AGREEMENTS },
  });
  expect(res.status).toBe(200);
  return res.json.submission;
}

const current = async (w: World, cookie: string, id: string): Promise<Sub> =>
  (await call(w.t.public, "GET", `/api/submissions/${id}`, { cookie })).json;

const answer = (w: World, cookie: string, id: string, body: Record<string, unknown>) =>
  call(w.t.public, "POST", `/api/me/invitations/${id}/answer`, { cookie, body });

/** The stored configuration with a talk needing at least `min` people, and its token. */
async function talkTeamMin(w: World, min: number) {
  const got = await call(w.t.public, "GET", at(w.slug, "settings"), { cookie: w.chair });
  expect(got.status).toBe(200);
  const config = structuredClone(got.json.config) as ConferenceConfig;
  const type = config.submissionTypes.find((x) => x.key === "talk");
  if (!type) throw new Error("the fixture call has no talk");
  type.team.min = min;
  return { config, token: got.json.token as string };
}

const saveConfig = (w: World, config: ConferenceConfig, token: string) =>
  call(w.t.public, "PUT", at(w.slug, "config"), { cookie: w.chair, ifMatch: token, body: config });

const statusOf = async (w: World, submissionId: string, email: string) => {
  const [row] = await w.t.db
    .select({ status: contributions.status })
    .from(contributions)
    .where(
      and(
        eq(contributions.submissionId, submissionId),
        eq(contributions.personId, await personId(w.t, email)),
      ),
    );
  return row?.status;
};

// Statements as the query builder writes them.
const LOCKS_SUBMISSION = /from "submissions" .* for update$/;
const SHARES_CONFERENCE = /from "conferences" .* for share$/;
const LOCKS_CONFERENCE = /from "conferences" .* for update$/;
const READS_TEAM = /from "contributions"/;
const WRITES_WORK = /^(insert into|update|delete from) "(submissions|contributions)"/;
const first = (sent: string[], re: RegExp) => sent.findIndex((q) => re.test(q));
// The conference's roles lock (services/roles.ts), shared to act as a chair or exclusive to
// change who holds a role; and the locks that count a day's invitations, which have no name.
const SHARES_ROLES = /pg_advisory_xact_lock_shared\(.*\) as roles_lock$/;
const LOCKS_ROLES = /pg_advisory_xact_lock\(.*\) as roles_lock$/;
const COUNTS_INVITATIONS = /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)$/;
const LOCKS_INVITATION = /from "role_invitations" .* for update$/;
const READS_ROLES = /from "conference_roles"/;
/**
 * What a chair's change, or an answer to an invitation, writes. Not a session's last use, and
 * not the delivery of mail (an update of the outbox), which runs after a request and may still
 * be running when the next one begins.
 */
const WRITES_AS_CHAIR =
  /^(insert into|update|delete from) "(conferences|people|role_invitations|role_invitation_sends|conference_roles|reviewer_profiles|assignments|audit_log)"|^insert into "outbox"/;

describe("a settings save and writes to submitted work", () => {
  let w: World;
  let owner: string;
  beforeAll(async () => {
    w = await world("locks-call");
    owner = await w.person("locks-owner@example.org", "Zora Ownerperson");
  }, 120_000);
  afterAll(() => w.t.close());

  it("counts an invitation answer that has committed: a decline can block the save", async () => {
    let s = await talk(w, owner, "A talk for two");
    s = await invite(w, owner, s, "locks-decliner@example.org");
    await submit(w, owner, s);
    // Two people are on it, one of them only invited: a talk may ask for two.
    const two = await talkTeamMin(w, 2);
    const before = await call(w.t.public, "POST", at(w.slug, "config/preview"), {
      cookie: w.chair,
      ifMatch: two.token,
      body: two.config,
    });
    expect(before.json).toMatchObject({ blocked: null, canSave: true });

    const invitee = await w.person("locks-decliner@example.org");
    expect((await answer(w, invitee, s.id, { answer: "decline" })).status).toBe(200);
    // Now the same save would leave a submitted talk with one person where two are needed.
    const refused = await saveConfig(w, two.config, two.token);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      error: "submitted_work_invalid",
      blocked: { count: 1, byCode: { team_size: 1 }, submissionIds: [s.id] },
    });
    const stored = await call(w.t.public, "GET", at(w.slug, "settings"), { cookie: w.chair });
    expect(stored.json.token).toBe(two.token);
  });

  it("an invitation answer locks the proposal, then shares the conference, before anything else", async () => {
    for (const [email, body] of [
      ["locks-no@example.org", { answer: "decline" }],
      [
        "locks-yes@example.org",
        { answer: "confirm", acceptedAgreements: AGREEMENTS, displayName: "Yara Yes" },
      ],
    ] as const) {
      let s = await talk(w, owner, `A talk answered by ${email}`);
      s = await invite(w, owner, s, email);
      const invitee = await w.person(email);
      const sent = await w.t.statements(async () => {
        expect((await answer(w, invitee, s.id, body)).status, email).toBe(200);
      });
      const lock = first(sent, LOCKS_SUBMISSION);
      const share = first(sent, SHARES_CONFERENCE);
      expect(lock, email).toBeGreaterThanOrEqual(0);
      expect(share, email).toBeGreaterThan(lock);
      // Who is on the proposal is read, and anything written, only under both.
      expect(first(sent, READS_TEAM), email).toBeGreaterThan(share);
      expect(first(sent, WRITES_WORK), email).toBeGreaterThan(share);
    }
  });

  it("an answer by the emailed link takes the same locks", async () => {
    let s = await talk(w, owner, "A talk answered by link");
    s = await invite(w, owner, s, "locks-link@example.org");
    const mail = await call(
      w.t.public,
      "GET",
      `/api/_test/outbox/latest?to=${encodeURIComponent("locks-link@example.org")}`,
    );
    const token = /#token=(inv_[A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1];
    if (!token) throw new Error("no invitation token in the email");
    const sent = await w.t.statements(async () => {
      const res = await call(w.t.public, "POST", "/api/invitations/answer", {
        body: { token, answer: "decline" },
      });
      expect(res.status).toBe(200);
    });
    const lock = first(sent, LOCKS_SUBMISSION);
    const share = first(sent, SHARES_CONFERENCE);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(share).toBeGreaterThan(lock);
    expect(first(sent, READS_TEAM)).toBeGreaterThan(share);
    expect(first(sent, WRITES_WORK)).toBeGreaterThan(share);
  });

  it("every route that writes a submission or its contributions shares the conference first", async () => {
    const coauthor = "locks-coauthor@example.org";
    const coauthorCookie = await w.person(coauthor, "Cora Coauthor");
    const removed = "locks-removed@example.org";
    await w.person(removed);
    let id = "";
    const v = async () => (await current(w, owner, id)).version;
    const sub = (rest = "") => `/api/submissions/${id}${rest}`;
    const person = (email: string) => personId(w.t, email);

    /** Each write route in turn: what it is, how it is called, and the status it answers. */
    const steps: [string, () => Promise<{ status: number; json: { id?: string } }>, number][] = [
      [
        "create",
        () =>
          call(w.t.public, "POST", at(w.slug, "submissions"), {
            cookie: owner,
            body: { typeKey: "talk", language: "en", participationMode: "in_person" },
          }),
        201,
      ],
      [
        "edit",
        async () =>
          call(w.t.public, "PATCH", sub(), {
            cookie: owner,
            body: { version: await v(), title: "Every route", abstract: words(260) },
          }),
        200,
      ],
      [
        "invite",
        async () =>
          call(w.t.public, "POST", sub("/contributors"), {
            cookie: owner,
            body: { version: await v(), email: coauthor, role: "coauthor", lang: "en" },
          }),
        201,
      ],
      [
        "confirm",
        () => answer(w, coauthorCookie, id, { answer: "confirm", acceptedAgreements: AGREEMENTS }),
        200,
      ],
      [
        "change a contributor",
        async () =>
          call(w.t.public, "PATCH", sub(`/contributors/${await person(coauthor)}`), {
            cookie: owner,
            body: { version: await v(), role: "presenter" },
          }),
        200,
      ],
      [
        "invite another",
        async () =>
          call(w.t.public, "POST", sub("/contributors"), {
            cookie: owner,
            body: { version: await v(), email: removed, role: "coauthor", lang: "en" },
          }),
        201,
      ],
      [
        "remove a contributor",
        async () =>
          call(w.t.public, "DELETE", sub(`/contributors/${await person(removed)}`), {
            cookie: owner,
            body: { version: await v() },
          }),
        200,
      ],
      [
        "submit",
        async () =>
          call(w.t.public, "POST", sub("/submit"), {
            cookie: owner,
            body: { version: await v(), acceptedAgreements: AGREEMENTS },
          }),
        200,
      ],
      [
        "take back",
        async () =>
          call(w.t.public, "POST", sub("/unsubmit"), {
            cookie: owner,
            body: { version: await v() },
          }),
        200,
      ],
      [
        "leave",
        () => call(w.t.public, "POST", sub("/leave"), { cookie: coauthorCookie, body: {} }),
        204,
      ],
      [
        "submit again",
        async () =>
          call(w.t.public, "POST", sub("/submit"), {
            cookie: owner,
            body: { version: await v(), acceptedAgreements: AGREEMENTS },
          }),
        200,
      ],
      [
        "withdraw",
        async () =>
          call(w.t.public, "POST", sub("/withdraw"), {
            cookie: owner,
            body: { version: await v() },
          }),
        200,
      ],
    ];
    for (const [what, run, status] of steps) {
      let answered = { status: 0, json: {} as { id?: string } };
      const sent = await w.t.statements(async () => {
        answered = await run();
      });
      expect(answered.status, what).toBe(status);
      if (what === "create") id = answered.json.id ?? "";
      const write = first(sent, WRITES_WORK);
      const share = first(sent, SHARES_CONFERENCE);
      // Each of these routes does write; none writes before it holds the conference's row.
      expect(write, what).toBeGreaterThanOrEqual(0);
      expect(share, what).toBeGreaterThanOrEqual(0);
      expect(share, what).toBeLessThan(write);
      // All but creating (there is no row yet) lock the proposal first: one order everywhere.
      if (what !== "create") {
        const lock = first(sent, LOCKS_SUBMISSION);
        expect(lock, what).toBeGreaterThanOrEqual(0);
        expect(lock, what).toBeLessThan(share);
      }
    }

    // Deleting a draft is the last write route.
    const draft = await talk(w, owner, "A draft to delete");
    const sent = await w.t.statements(async () => {
      const res = await call(w.t.public, "DELETE", `/api/submissions/${draft.id}`, {
        cookie: owner,
        body: { version: draft.version },
      });
      expect(res.status).toBe(204);
    });
    expect(first(sent, SHARES_CONFERENCE)).toBeGreaterThan(first(sent, LOCKS_SUBMISSION));
    expect(first(sent, WRITES_WORK)).toBeGreaterThan(first(sent, SHARES_CONFERENCE));
  });

  it("a save locks no row but the conference's, after the roles lock, so the orders cannot cross", async () => {
    const got = await call(w.t.public, "GET", at(w.slug, "settings"), { cookie: w.chair });
    const config = structuredClone(got.json.config) as ConferenceConfig;
    config.host = "Universidad Inventada del Sur";
    const sent = await w.t.statements(async () => {
      expect((await saveConfig(w, config, got.json.token)).status).toBe(200);
    });
    expect(first(sent, LOCKS_CONFERENCE)).toBeGreaterThanOrEqual(0);
    expect(sent.filter((q) => / for (update|share)$/.test(q))).toHaveLength(1);
    // The roles lock, shared, comes first: it is no row's, and a write to a proposal never takes it.
    expect(first(sent, SHARES_ROLES)).toBeGreaterThanOrEqual(0);
    expect(first(sent, SHARES_ROLES)).toBeLessThan(first(sent, LOCKS_CONFERENCE));
    expect(sent.filter((q) => /pg_advisory/.test(q))).toHaveLength(1);
  });

  it("a new proposal is checked against the configuration in force, under the shared row", async () => {
    const sent = await w.t.statements(async () => {
      const res = await call(w.t.public, "POST", at(w.slug, "submissions"), {
        cookie: owner,
        body: { typeKey: "nosuchformat", language: "en", participationMode: "in_person" },
      });
      expect(res).toMatchObject({
        status: 422,
        json: { issues: [{ path: "typeKey", code: "unknown_type" }] },
      });
    });
    expect(first(sent, SHARES_CONFERENCE)).toBeGreaterThanOrEqual(0);
    expect(first(sent, WRITES_WORK)).toBe(-1);
  });
});

describe("what is done as a chair, and the locks it takes", () => {
  let w: World;
  const PEOPLE = (rest = "") => `/api/conferences/${w.slug}/people${rest}`;
  const pool = fixtureCall.reviewPools[0]?.key ?? "";
  const asChair = (method: string, path: string, body: unknown = {}) =>
    call(w.t.public, method, path, { cookie: w.chair, body });
  const tokenFor = async (email: string) => {
    const mail = await call(
      w.t.public,
      "GET",
      `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`,
    );
    const token = /#token=(role_[A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1];
    if (!token) throw new Error(`no role invitation token for ${email}`);
    return token;
  };
  beforeAll(async () => {
    w = await world("locks-chairs");
    w.t.deps.limits.invitationLinksPerIp = new RateLimiter(100_000, 60_000);
  }, 120_000);
  afterAll(() => w.t.close());

  /**
   * The one order (services/roles.ts): an invitation's row, the roles lock, the conference's
   * row, the locks that count the day's invitations. Each lock a request takes comes after
   * every earlier kind it takes, and nothing is written before the last of them.
   */
  function expectOrder(what: string, sent: string[], roles: RegExp | null) {
    const at = (re: RegExp) => first(sent, re);
    const invitation = at(LOCKS_INVITATION);
    const role = roles ? at(roles) : -1;
    const conference = Math.max(at(SHARES_CONFERENCE), at(LOCKS_CONFERENCE));
    const counting = at(COUNTS_INVITATIONS);
    const write = at(WRITES_AS_CHAIR);
    if (roles) expect(role, `${what}: the roles lock`).toBeGreaterThanOrEqual(0);
    else
      expect(
        sent.filter((q) => /roles_lock/.test(q)),
        what,
      ).toEqual([]);
    // One roles lock, in one mode: nothing takes it shared and then exclusive.
    expect(sent.filter((q) => /roles_lock/.test(q)).length, what).toBeLessThanOrEqual(1);
    const order = [invitation, role, conference, counting].filter((i) => i >= 0);
    expect(order, `${what}: the order of its locks`).toEqual([...order].sort((a, b) => a - b));
    expect(write, `${what}: writes`).toBeGreaterThanOrEqual(0);
    expect(write, `${what}: nothing written before its locks`).toBeGreaterThan(Math.max(...order));
    return { invitation, role, conference, counting, write };
  }

  it("every change made as a chair takes the roles lock, reads the chair again, and then goes on", async () => {
    const email = "locks-chairs-invitee@example.org";
    let invitationId = "";
    const colleague = "locks-chairs-colleague@example.org";
    await w.person(colleague, "Cleo Colleague");
    await grantRole(w.t.db, {
      conferenceId: w.conferenceId,
      personId: await personId(w.t, colleague),
      role: "chair",
    });
    const host = async () => {
      const got = await call(w.t.public, "GET", at(w.slug, "settings"), { cookie: w.chair });
      const config = structuredClone(got.json.config) as ConferenceConfig;
      config.host = "Universidad Inventada del Centro";
      return saveConfig(w, config, got.json.token);
    };
    /** Each change in turn: what it is, how it is asked for, its answer, and its roles lock. */
    const steps: [
      string,
      () => Promise<{ status: number; json: { id?: string } }>,
      number,
      RegExp,
    ][] = [
      ["save the configuration", host, 200, SHARES_ROLES],
      [
        "move the phase",
        () => asChair("PUT", at(w.slug, "phase"), { phase: "draft", from: "cfp_open" }),
        200,
        SHARES_ROLES,
      ],
      [
        "move the phase back",
        () => asChair("PUT", at(w.slug, "phase"), { phase: "cfp_open", from: "draft" }),
        200,
        SHARES_ROLES,
      ],
      [
        "invite",
        () =>
          asChair("POST", PEOPLE("/invitations"), {
            email,
            role: "reviewer",
            pools: [pool],
            lang: "en",
          }),
        201,
        SHARES_ROLES,
      ],
      [
        "send again",
        () => asChair("POST", PEOPLE(`/invitations/${invitationId}/resend`)),
        204,
        SHARES_ROLES,
      ],
      [
        "cancel",
        () => asChair("POST", PEOPLE(`/invitations/${invitationId}/cancel`)),
        204,
        SHARES_ROLES,
      ],
      [
        "remove a chair",
        async () => asChair("DELETE", PEOPLE(`/${await personId(w.t, colleague)}/roles/chair`)),
        204,
        LOCKS_ROLES,
      ],
    ];
    for (const [what, run, status, roles] of steps) {
      // An invitation is sent again an hour after it was sent, at the earliest.
      if (what === "send again") w.t.setNow(new Date(NOW.getTime() + 61 * 60 * 1000));
      let answered = { status: 0, json: {} as { id?: string } };
      const sent = await w.t.statements(async () => {
        answered = await run();
      });
      expect(answered.status, what).toBe(status);
      if (what === "invite") invitationId = answered.json.id ?? "";
      const order = expectOrder(what, sent, roles);
      // The chair's roles are read again after the lock and before anything is written: the
      // reading the route did for its own check, before the transaction, does not count.
      const reread = sent.findIndex((q, i) => i > order.role && READS_ROLES.test(q));
      expect(reread, `${what}: reads the chair again`).toBeGreaterThan(order.role);
      expect(reread, `${what}: before it writes`).toBeLessThan(order.write);
      // The conference's row, where it is taken, is taken after the chair was read again.
      if (order.conference >= 0) expect(order.conference, what).toBeGreaterThan(reread);
    }
    w.t.setNow(NOW);
  });

  it("an answer to an invitation: its row, then the roles lock only to accept, then the conference's row", async () => {
    for (const [email, body, roles] of [
      [
        "locks-chairs-accepts@example.org",
        { answer: "accept", displayName: "Ada Accepts", languages: ["en"] },
        LOCKS_ROLES,
      ],
      // Declining gives nobody a role: it has no business with the roles lock.
      ["locks-chairs-declines@example.org", { answer: "decline" }, null],
    ] as const) {
      const invited = await asChair("POST", PEOPLE("/invitations"), {
        email,
        role: "reviewer",
        pools: [pool],
        lang: "en",
      });
      expect(invited.status, email).toBe(201);
      const token = await tokenFor(email);
      const sent = await w.t.statements(async () => {
        const res = await call(w.t.public, "POST", "/api/role-invitations/answer", {
          body: { token, ...body },
        });
        expect(res.status, email).toBe(200);
      });
      const order = expectOrder(email, sent, roles);
      expect(order.invitation, email).toBeGreaterThanOrEqual(0);
      expect(first(sent, SHARES_CONFERENCE), email).toBeGreaterThan(order.invitation);
      if (roles) expect(order.role, email).toBeGreaterThan(order.invitation);
    }
  });

  it("a write to a proposal takes no roles lock: its order is the proposal's row, then the conference's", async () => {
    const owner = await w.person("locks-chairs-owner@example.org", "Olga Ownerperson");
    const sent = await w.t.statements(async () => {
      await talk(w, owner, "A talk that asks no chair");
    });
    expect(first(sent, WRITES_WORK)).toBeGreaterThanOrEqual(0);
    expect(sent.filter((q) => /roles_lock/.test(q))).toEqual([]);
  });
});

/** What a promise has done within `ms`: its value, or "waiting". */
const within = <T>(p: Promise<T>, ms: number): Promise<T | "waiting"> =>
  Promise.race([p, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);

describe.skipIf(!process.env.TEST_DATABASE_URL)("on Postgres, they wait for each other", () => {
  let w: World;
  let owner: string;
  beforeAll(async () => {
    // A call of its own each run: the database may still hold an earlier run's rows.
    w = await world(`locks-pg-${Date.now()}`, process.env.TEST_DATABASE_URL);
    owner = await w.person(`pg-owner-${w.slug}@example.org`, "Zora Ownerperson");
  }, 120_000);
  afterAll(() => w?.t.close());

  /**
   * Hold locks in a transaction of its own until `release()`. Always release, in a `finally`:
   * a transaction left open would keep every later test waiting.
   */
  function hold(lock: (tx: Db) => Promise<unknown>) {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let taken = () => {};
    const ready = new Promise<void>((r) => {
      taken = r;
    });
    const done = w.t.db.transaction(async (tx) => {
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

  it("while a save holds the conference, an answer, an edit and a new proposal all wait", async () => {
    const email = `pg-waits-${w.slug}@example.org`;
    let s = await talk(w, owner, "A talk that waits");
    s = await invite(w, owner, s, email);
    s = await submit(w, owner, s);
    const invitee = await w.person(email);

    const saving = hold((tx) => lockConference(tx, w.conferenceId));
    await saving.ready;
    const declining = answer(w, invitee, s.id, { answer: "decline" });
    const editing = call(w.t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: s.version, title: "A talk that waited" },
    });
    const creating = call(w.t.public, "POST", at(w.slug, "submissions"), {
      cookie: owner,
      body: { typeKey: "talk", language: "en", participationMode: "in_person" },
    });
    try {
      for (const [what, writing] of Object.entries({ declining, editing, creating })) {
        expect(await within(writing, 400), what).toBe("waiting");
      }
      // Nothing of theirs has happened: the save's check sees the proposal as it was.
      expect(await statusOf(w, s.id, email)).toBe("invited");
    } finally {
      await saving.release();
    }
    const [declined, edited, created] = await Promise.all([declining, editing, creating]);
    expect(created.status).toBe(201);
    // The answer and the edit were for one proposal: one went first, the other saw its version.
    expect(declined.status).toBe(200);
    expect([200, 409]).toContain(edited.status);
    expect(await statusOf(w, s.id, email)).toBe("declined");
  }, 60_000);

  it("a save waits for an answer in flight, then sees it: the decline blocks the save", async () => {
    const email = `pg-flight-${w.slug}@example.org`;
    let s = await talk(w, owner, "A talk in flight");
    s = await invite(w, owner, s, email);
    s = await submit(w, owner, s);
    const inviteeId = await personId(w.t, email);
    const two = await talkTeamMin(w, 2);

    // The answer, stopped after its write and before its commit, holding what it holds there.
    const answering = hold(async (tx) => {
      await tx.select().from(submissions).where(eq(submissions.id, s.id)).for("update");
      await shareConference(tx, w.conferenceId);
      await tx
        .update(contributions)
        .set({ status: "declined" })
        .where(and(eq(contributions.submissionId, s.id), eq(contributions.personId, inviteeId)));
    });
    await answering.ready;
    const saving = saveConfig(w, two.config, two.token);
    try {
      expect(await within(saving, 700)).toBe("waiting");
    } finally {
      await answering.release();
    }
    const saved = await saving;
    expect(saved.status).toBe(409);
    // This talk is among those the save would leave one person short (the talk of the test
    // above, whose invitee declined, is another).
    expect(saved.json.error).toBe("submitted_work_invalid");
    expect(saved.json.blocked.byCode.team_size).toBeGreaterThanOrEqual(1);
    expect(saved.json.blocked.submissionIds).toContain(s.id);
  }, 60_000);

  it("many writers and savers at once all finish: nobody waits on the one waiting for them", async () => {
    const subs: Sub[] = [];
    for (let i = 0; i < 4; i++) subs.push(await talk(w, owner, `A busy talk ${i}`));
    const emails = subs.map((_, i) => `pg-busy-${i}-${w.slug}@example.org`);
    for (const [i, s] of subs.entries()) subs[i] = await invite(w, owner, s, emails[i] ?? "");
    const invitees = await Promise.all(emails.map((e) => w.person(e)));
    const host = async (name: string) => {
      const got = await call(w.t.public, "GET", at(w.slug, "settings"), { cookie: w.chair });
      const config = structuredClone(got.json.config) as ConferenceConfig;
      config.host = name;
      return saveConfig(w, config, got.json.token);
    };
    const all = await within(
      Promise.all([
        host("Universidad Inventada del Norte"),
        ...subs.map((s, i) => answer(w, invitees[i] ?? "", s.id, { answer: "decline" })),
        host("Universidad Inventada del Este"),
        ...subs.map((s) =>
          call(w.t.public, "PATCH", `/api/submissions/${s.id}`, {
            cookie: owner,
            body: { version: s.version, title: "A busier talk" },
          }),
        ),
        host("Universidad Inventada del Oeste"),
      ]),
      30_000,
    );
    if (all === "waiting") throw new Error("still waiting after 30 seconds: a deadlock");
    // Saves answer 200, or 409 when another save got in first; writes 200, or 409 on a version.
    // A deadlock would end one of them with an error (500) instead.
    expect(all.map((r) => r.status).filter((x) => ![200, 409].includes(x))).toEqual([]);
  }, 60_000);
});
