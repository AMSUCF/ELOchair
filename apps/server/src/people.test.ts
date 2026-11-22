import { findLeaks } from "@elochair/policy/testing";
import { ROLE_INVITATIONS } from "@elochair/schema";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import {
  assignments,
  auditLog,
  conferenceRoles,
  conferences,
  conflicts,
  contributions,
  outbox,
  people,
  reviewerProfiles,
  roleInvitationSends,
  roleInvitations,
  submissions,
} from "./db/schema";
import { fixtureCall, type SandboxSummary, seedSandbox, seedTestCall } from "./fixtures";
import type { MemoryTransport } from "./mail";
import { RateLimiter } from "./ratelimit";
import {
  createApiToken,
  getConference,
  grantRole,
  loadPersonViewer,
  lockConference,
  saveConference,
} from "./repo";
import { Refusal } from "./routes/common";
import { hashToken } from "./secrets";
import {
  cancelRoleInvitation,
  inviteToRole,
  removeRole,
  resendRoleInvitation,
} from "./services/people";
import { call, makeTestApp, ORIGIN, personId, signIn, type TestApp } from "./testkit";

/*
 * People and invitations (spec 03, §1.2): who may see and change who holds a role; inviting an
 * address to a role, with its limits; answering by the emailed link, which gives the role to the
 * invited address and to nobody else; removing a role; and what none of it may reveal.
 */

const NOW = new Date("2027-02-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SLUG = "people-call";
const OTHER = "people-other";
const DRAFT = "people-draft";
/** The fixture call's review pools, whatever they are called. */
const POOLS = fixtureCall.reviewPools.map((p) => p.key);
const [POOL_A, POOL_B] = POOLS as [string, string];

let t: TestApp;
let conferenceId: string;
let otherId: string;
let draftId: string;
/** Sessions of the people set up for every test here. */
const cookies = {} as Record<
  "chair" | "admin" | "reviewer" | "track" | "stranger" | "elsewhere",
  string
>;
/** One of them by name; anyone else ("public") has no session. */
const cookieOf = (who: string): string | undefined =>
  (cookies as Record<string, string | undefined>)[who];
/** Markers that must never appear in the audit log: every address and every name used here. */
const secrets: string[] = [];

const at = (rest = "", slug = SLUG) => `/api/conferences/${slug}/people${rest}`;
type Who = { cookie?: string; token?: string };

async function profile(cookie: string, displayName: string, more: Record<string, unknown> = {}) {
  secrets.push(displayName);
  const res = await call(t.public, "PUT", "/api/me/profile", {
    cookie,
    body: {
      displayName,
      affiliation: null,
      country: null,
      languages: ["en"],
      pronouns: null,
      orcid: null,
      bios: {},
      ...more,
    },
  });
  expect(res.status).toBe(200);
}
/** Sign someone in; with a name, give them a profile. */
async function person(email: string, name?: string) {
  secrets.push(email);
  const cookie = await signIn(t, email);
  if (name) await profile(cookie, name);
  return cookie;
}

type InviteBody = {
  email: string;
  role: "reviewer" | "chair";
  pools?: string[];
  lang?: string;
  name?: string;
};
const invite = (who: Who, body: InviteBody | Record<string, unknown>, slug = SLUG) => {
  if (typeof body.email === "string") secrets.push(body.email);
  if (typeof body.name === "string") secrets.push(body.name);
  return call(t.public, "POST", at("/invitations", slug), {
    ...who,
    body: { lang: "en", ...body },
  });
};
const reviewer = (email: string, more: Partial<InviteBody> = {}): InviteBody => ({
  email,
  role: "reviewer",
  pools: [POOL_A],
  ...more,
});
const listed = async (cookie: string, slug = SLUG) => {
  const res = await call(t.public, "GET", at("", slug), { cookie });
  expect(res.status).toBe(200);
  return res.json as {
    chairs: { personId: string; displayName: string | null; email: string; you: boolean }[];
    reviewers: {
      personId: string;
      displayName: string | null;
      email: string;
      pools: string[];
      assigned: number;
      maxLoad: number | null;
      languages: string[];
    }[];
    trackChairs: { personId: string; email: string; tracks: string[] }[];
    invitations: {
      id: string;
      role: string;
      pools: string[];
      email: string;
      name: string | null;
      lang: string;
      state: string;
      sentAt: string;
      expiresAt: string;
      answeredAt: string | null;
    }[];
  };
};
const invitationOf = async (cookie: string, email: string, slug = SLUG) =>
  (await listed(cookie, slug)).invitations.filter((i) => i.email === email);
const resend = (who: Who, id: string, slug = SLUG) =>
  call(t.public, "POST", at(`/invitations/${id}/resend`, slug), { ...who, body: {} });
const cancel = (who: Who, id: string, slug = SLUG) =>
  call(t.public, "POST", at(`/invitations/${id}/cancel`, slug), { ...who, body: {} });
const remove = (who: Who, id: string, role: string, body: unknown = {}, slug = SLUG) =>
  call(t.public, "DELETE", at(`/${id}/roles/${role}`, slug), { ...who, body });

const mailbox = () => t.deps.mail as MemoryTransport;
/** Every message delivered to an address so far (flushing the outbox first). */
async function mailTo(email: string) {
  await call(t.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return mailbox().sent.filter((m) => m.to === email);
}
const tokenIn = (text: string) => /#token=(role_[A-Za-z0-9_-]+)/.exec(text)?.[1];
/** The link token of the latest role invitation email to an address. */
async function roleToken(email: string): Promise<string> {
  const token = (await mailTo(email))
    .map((m) => tokenIn(m.text))
    .filter(Boolean)
    .at(-1);
  if (!token) throw new Error(`no role invitation token for ${email}`);
  return token;
}
const info = (token: string, who: Who = {}) =>
  call(t.public, "POST", "/api/role-invitations/info", { ...who, body: { token } });
const answer = (body: Record<string, unknown>, who: Who = {}) =>
  call(t.public, "POST", "/api/role-invitations/answer", { ...who, body });
/** Accept as a reviewer who says the least a reviewer must. */
const accept = (token: string, more: Record<string, unknown> = {}, who: Who = {}) =>
  answer({ token, answer: "accept", displayName: "Given Name", languages: ["en"], ...more }, who);

const rolesOf = async (email: string, conference = conferenceId) => {
  const [p] = await t.db.select().from(people).where(eq(people.email, email));
  if (!p) return [];
  const rows = await t.db
    .select()
    .from(conferenceRoles)
    .where(and(eq(conferenceRoles.personId, p.id), eq(conferenceRoles.conferenceId, conference)));
  return rows
    .map((r) => ({ role: r.role, scope: r.scope }))
    .sort((a, b) => (a.role < b.role ? -1 : 1));
};
const auditRows = (action: string) =>
  t.db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(auditLog.id);
const peopleAudit = async () =>
  (
    await t.db.select().from(auditLog).where(like(auditLog.action, "role%")).orderBy(auditLog.id)
  ).map((r) => r.action);
const DEAD = { status: 400, json: { error: "invalid_or_expired" } };

beforeAll(async () => {
  t = await makeTestApp();
  ({ conferenceId } = await seedTestCall(t.db, { slug: SLUG, now: NOW }));
  ({ conferenceId: otherId } = await seedTestCall(t.db, { slug: OTHER, now: NOW }));
  ({ conferenceId: draftId } = await seedTestCall(t.db, { slug: DRAFT, now: NOW }));
  await t.db.update(conferences).set({ phase: "draft" }).where(eq(conferences.id, draftId));
  // Many people sign in, write and follow links from one address here; the limits on that
  // have their own tests (auth.test.ts, flows-invitations.test.ts, and one below).
  t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerEmail = new RateLimiter(100_000, 60_000);
  t.deps.limits.invitationLinksPerIp = new RateLimiter(100_000, 60_000);

  cookies.chair = await person("people-chair@example.org", "Cora Chairperson");
  cookies.admin = await person("people-admin@example.org", "Adam Administrator");
  cookies.reviewer = await person("people-reviewer@example.org", "Rhea Reviewerson");
  cookies.track = await person("people-track@example.org", "Tariq Trackchair");
  cookies.stranger = await person("people-stranger@example.org", "Stella Stranger");
  cookies.elsewhere = await person("people-elsewhere@example.org", "Elsa Elsewhere");
  const grant = async (email: string, conference: string, role: string, scope: string[] = []) =>
    grantRole(t.db, {
      conferenceId: conference,
      personId: await personId(t, email),
      role: role as "chair",
      scope,
    });
  await grant("people-chair@example.org", conferenceId, "chair");
  await grant("people-chair@example.org", otherId, "chair");
  await grant("people-chair@example.org", draftId, "chair");
  await grant("people-admin@example.org", conferenceId, "admin");
  await grant("people-reviewer@example.org", conferenceId, "reviewer", [POOL_A]);
  await grant("people-track@example.org", conferenceId, "track_chair");
  await grant("people-elsewhere@example.org", otherId, "chair");
}, 120_000);
afterAll(() => t.close());

describe("who may manage a conference's people", () => {
  let agentM: string;
  let agentC: string;
  let waitingId: string;
  let reviewerId: string;
  const target = "people-guarded@example.org";

  /** Every People route, aimed at an invitation that is waiting and a reviewer who is there. */
  const routes = (slug = SLUG): [string, string, unknown][] => [
    ["GET", at("", slug), undefined],
    [
      "POST",
      at("/invitations", slug),
      { email: "people-refused@example.org", role: "chair", lang: "en" },
    ],
    ["POST", at(`/invitations/${waitingId}/resend`, slug), {}],
    ["POST", at(`/invitations/${waitingId}/cancel`, slug), {}],
    ["DELETE", at(`/${reviewerId}/roles/reviewer`, slug), { assignments: 0 }],
  ];

  beforeAll(async () => {
    const chairId = await personId(t, "people-chair@example.org");
    agentM = (await createApiToken(t.db, { personId: chairId, conferenceId, tier: "M", name: "m" }))
      .token;
    agentC = (await createApiToken(t.db, { personId: chairId, conferenceId, tier: "C", name: "c" }))
      .token;
    const sent = await invite({ cookie: cookies.chair }, reviewer(target, { name: "Gus Guarded" }));
    expect(sent.status).toBe(201);
    waitingId = sent.json.id;
    reviewerId = await personId(t, "people-reviewer@example.org");
  });

  it("refuses a reviewer, a track chair, a stranger, another conference's chair and the public, on every route", async () => {
    const before = await peopleAudit();
    const mailBefore = (await t.db.select().from(outbox)).length;
    for (const who of ["reviewer", "track", "stranger", "elsewhere", "public"]) {
      for (const [method, path, body] of routes()) {
        const res = await call(t.public, method, path, { cookie: cookieOf(who), body });
        expect(res.status, `${who} ${method} ${path}`).toBe(403);
        expect(res.json, `${who} ${method} ${path}`).toEqual({ error: "forbidden" });
      }
    }
    // Nothing happened: the invitation waits, the reviewer reviews, nobody was written to.
    const [inv] = await invitationOf(cookies.chair, target);
    expect(inv).toMatchObject({ id: waitingId, state: "waiting", sentAt: NOW.toISOString() });
    expect(await rolesOf("people-reviewer@example.org")).toEqual([
      { role: "reviewer", scope: [POOL_A] },
    ]);
    expect(
      await t.db.select().from(people).where(eq(people.email, "people-refused@example.org")),
    ).toEqual([]);
    expect(await peopleAudit()).toEqual(before);
    expect((await t.db.select().from(outbox)).length).toBe(mailBefore);
  });

  it("refuses a chair's agents, whatever their tier and on either listener", async () => {
    const before = await peopleAudit();
    for (const [method, path, body] of routes()) {
      const m = await call(t.public, method, path, { token: agentM, body });
      expect(m.status, `tier M ${method} ${path}`).toBe(403);
      expect(m.json).toEqual({ error: "forbidden" });
      const c = await call(t.internal, method, path, { token: agentC, body });
      expect(c.status, `tier C ${method} ${path}`).toBe(403);
      expect(c.json).toEqual({ error: "forbidden" });
      // A content-tier token never gets as far as a route on the public listener.
      const onPublic = await call(t.public, method, path, { token: agentC, body });
      expect(onPublic.status).toBe(403);
    }
    expect(await peopleAudit()).toEqual(before);
    expect((await invitationOf(cookies.chair, target))[0]?.state).toBe("waiting");
  });

  it("keeps a draft conference a secret from those who cannot see it", async () => {
    for (const who of ["reviewer", "track", "stranger", "elsewhere", "public"]) {
      for (const [method, path, body] of routes(DRAFT)) {
        const res = await call(t.public, method, path, { cookie: cookieOf(who), body });
        expect(res.status, `${who} ${method} ${path}`).toBe(404);
        expect(res.json).toEqual({ error: "not_found" });
      }
    }
    // Its chair manages its people as anywhere else; that chair's agent still may not.
    expect((await listed(cookies.chair, DRAFT)).chairs.map((c) => c.email)).toEqual([
      "people-chair@example.org",
    ]);
    const agent = await createApiToken(t.db, {
      personId: await personId(t, "people-chair@example.org"),
      conferenceId: draftId,
      tier: "M",
      name: "draft",
    });
    for (const [method, path, body] of routes(DRAFT)) {
      const res = await call(t.public, method, path, { token: agent.token, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("lets a chair, an admin and a site admin see the page, each as themselves", async () => {
    const asChair = await listed(cookies.chair);
    expect(asChair.chairs).toEqual([
      {
        personId: await personId(t, "people-admin@example.org"),
        displayName: "Adam Administrator",
        email: "people-admin@example.org",
        you: false,
      },
      {
        personId: await personId(t, "people-chair@example.org"),
        displayName: "Cora Chairperson",
        email: "people-chair@example.org",
        you: true,
      },
    ]);
    expect(asChair.reviewers).toEqual([
      {
        personId: reviewerId,
        displayName: "Rhea Reviewerson",
        email: "people-reviewer@example.org",
        pools: [POOL_A],
        assigned: 0,
        // Given the role on the server: nothing was ever said about languages or load.
        maxLoad: null,
        languages: [],
      },
    ]);
    expect(asChair.trackChairs.map((x) => x.email)).toEqual(["people-track@example.org"]);
    expect((await listed(cookies.admin)).chairs.map((c) => c.you)).toEqual([true, false]);

    // A site admin holds no role at the conference: they see the page, and are not on it.
    const site = await person("people-site-admin@example.org", "Sid Siteadmin");
    expect((await call(t.public, "GET", at(), { cookie: site })).status).toBe(403);
    await t.db
      .update(people)
      .set({ siteAdmin: true })
      .where(eq(people.email, "people-site-admin@example.org"));
    const asSite = await listed(site);
    expect(asSite.chairs.map((c) => [c.email, c.you])).toEqual([
      ["people-admin@example.org", false],
      ["people-chair@example.org", false],
    ]);
    expect(findLeaks(asSite, ["people-site-admin@example.org", "Sid Siteadmin"])).toEqual([]);
  });
});

describe("inviting someone", () => {
  it("sends one address an invitation with a link, in the language chosen, and lists it as typed", async () => {
    const email = "people-first@example.org";
    const sent = await invite(
      { cookie: cookies.chair },
      {
        email: "People-First@Example.org ",
        role: "reviewer",
        pools: [POOL_B, POOL_A],
        lang: "es",
        name: "Fia First",
      },
    );
    // A stray space is not an address: the form trims it, the server refuses it.
    expect(sent.status).toBe(400);
    const ok = await invite(
      { cookie: cookies.chair },
      {
        email: "People-First@Example.org",
        role: "reviewer",
        pools: [POOL_B, POOL_A],
        lang: "es",
        name: "Fia First",
      },
    );
    expect(ok.status).toBe(201);
    expect(Object.keys(ok.json)).toEqual(["id"]);

    const mail = await mailTo(email);
    expect(mail).toHaveLength(1);
    const token = tokenIn(mail[0]?.text ?? "");
    expect(mail[0]?.subject).toBe("Convocatoria de prueba: invitación para revisar propuestas");
    expect(mail[0]?.text).toContain(`${ORIGIN}/es/role-invitation#token=${token}`);
    // The committees by the conference's own names, in its order; and no person at all: not
    // the chair who invited, not the name that chair typed.
    const names = fixtureCall.reviewPools.map((p) => p.name.es).join(", ");
    expect(mail[0]?.text).toContain(`(${names})`);
    expect(`${mail[0]?.subject}\n${mail[0]?.text}`).not.toMatch(/Fia|First|Cora|Chairperson/);

    expect(await invitationOf(cookies.chair, email)).toEqual([
      {
        id: ok.json.id,
        role: "reviewer",
        pools: [POOL_B, POOL_A],
        email,
        name: "Fia First",
        lang: "es",
        state: "waiting",
        sentAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
        answeredAt: null,
      },
    ]);
    // The link is stored as a hash only, and no role is given by inviting.
    const [row] = await t.db
      .select()
      .from(roleInvitations)
      .where(eq(roleInvitations.id, ok.json.id));
    expect(row?.tokenHash).toBe(hashToken(token ?? ""));
    expect(row?.invitedByPersonId).toBe(await personId(t, "people-chair@example.org"));
    expect(await rolesOf(email)).toEqual([]);
    // What the chair typed is on the invitation, and never in the person's profile.
    const [p] = await t.db.select().from(people).where(eq(people.email, email));
    expect(p).toMatchObject({ displayName: null, affiliation: null });
  });

  it("refuses what is not an invitation to a reviewer's or a chair's role", async () => {
    const bad: [Record<string, unknown>, number][] = [
      [{ email: "not an address", role: "chair" }, 400],
      [{ email: "people-bad@example.org", role: "reviewer" }, 400], // no pool
      [{ email: "people-bad@example.org", role: "reviewer", pools: [] }, 400],
      [{ email: "people-bad@example.org", role: "reviewer", pools: [POOL_A, POOL_A] }, 400],
      [{ email: "people-bad@example.org", role: "chair", pools: [POOL_A] }, 400],
      [{ email: "people-bad@example.org", role: "track_chair" }, 400],
      [{ email: "people-bad@example.org", role: "admin" }, 400],
      [{ email: "people-bad@example.org", role: "chair", lang: "fr" }, 400],
      [{ email: "people-bad@example.org", role: "chair", name: "Two\nlines" }, 400],
      [{ email: "people-bad@example.org", role: "chair", name: "Hid\u202Eden" }, 400],
      // Nothing but these five values: no person, no token, no expiry of the caller's choosing.
      [{ email: "people-bad@example.org", role: "chair", personId: "x" }, 400],
      [{ email: "people-bad@example.org", role: "chair", expiresAt: "2099-01-01T00:00:00Z" }, 400],
      [{ email: "people-bad@example.org", role: "chair", scope: [POOL_A] }, 400],
    ];
    for (const [body, status] of bad) {
      const res = await invite({ cookie: cookies.chair }, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
    // A pool the conference does not have.
    const unknown = await invite(
      { cookie: cookies.chair },
      reviewer("people-bad@example.org", { pools: [POOL_A, "no_such_pool"] }),
    );
    expect(unknown.status).toBe(422);
    expect(unknown.json).toEqual({
      error: "invalid",
      issues: [{ path: "pools", code: "unknown_pool" }],
    });
    expect(
      await t.db.select().from(people).where(eq(people.email, "people-bad@example.org")),
    ).toEqual([]);
    expect(await mailTo("people-bad@example.org")).toEqual([]);
  });

  it("refuses a second invitation while one is waiting, and one to someone who holds the role", async () => {
    const email = "people-twice@example.org";
    expect((await invite({ cookie: cookies.chair }, reviewer(email))).status).toBe(201);
    // The same address, however it is written, by this chair or another, for any pools.
    for (const [who, typed] of [
      ["chair", email],
      ["admin", "PEOPLE-TWICE@example.org"],
    ] as const) {
      const again = await invite({ cookie: cookieOf(who) }, reviewer(typed, { pools: [POOL_B] }));
      expect(again.status).toBe(409);
      expect(again.json).toEqual({ error: "already_invited" });
    }
    // The other role is another invitation; so is the same role at another conference.
    expect((await invite({ cookie: cookies.chair }, { email, role: "chair" })).status).toBe(201);
    expect((await invite({ cookie: cookies.chair }, reviewer(email), OTHER)).status).toBe(201);
    expect(await mailTo(email)).toHaveLength(3);

    // Someone who holds the role already: a reviewer as a reviewer, a chair or an admin as a chair.
    for (const [address, role] of [
      ["people-reviewer@example.org", "reviewer"],
      ["people-chair@example.org", "chair"],
      ["people-admin@example.org", "chair"],
    ] as const) {
      const res = await invite(
        { cookie: cookies.chair },
        role === "reviewer" ? reviewer(address, { pools: [POOL_B] }) : { email: address, role },
      );
      expect(res.status, address).toBe(409);
      expect(res.json, address).toEqual({ error: "already_has_role" });
      expect(await mailTo(address), address).toEqual(
        (await mailTo(address)).filter((m) => !/role-invitation/.test(m.text)),
      );
    }
    // Holding one role is no bar to the other: a reviewer can be invited to be a chair.
    expect(
      (
        await invite(
          { cookie: cookies.chair },
          { email: "people-reviewer@example.org", role: "chair" },
        )
      ).status,
    ).toBe(201);
  });

  it("answers the same for any address that does not hold the role here, whatever else it is", async () => {
    // An address with no account, one with an account, a site admin, a chair of another
    // conference: a chair inviting them learns nothing about any of that.
    await person("people-has-account@example.org", "Hattie Hasaccount");
    const answers = [];
    for (const email of [
      "people-no-account@example.org",
      "people-has-account@example.org",
      "people-site-admin@example.org",
      "people-elsewhere@example.org",
    ]) {
      const res = await invite({ cookie: cookies.chair }, { email, role: "chair" });
      answers.push({ status: res.status, keys: Object.keys(res.json) });
    }
    expect(answers).toEqual(Array.from({ length: 4 }, () => ({ status: 201, keys: ["id"] })));
  });
});

describe("the limits on invitations", () => {
  it("an address gets at most three a day, from all conferences and chairs, cancelled or not", async () => {
    const email = "people-victim@example.org";
    const statuses: number[] = [];
    // Invited and cancelled, twice: the cancelled invitations still count.
    for (let i = 0; i < 2; i++) {
      const sent = await invite({ cookie: cookies.chair }, reviewer(email));
      statuses.push(sent.status);
      expect((await cancel({ cookie: cookies.chair }, sent.json.id)).status).toBe(204);
    }
    // The third from another conference's chair; the fourth is refused, whoever asks, wherever.
    statuses.push(
      (await invite({ cookie: cookies.elsewhere }, { email, role: "chair" }, OTHER)).status,
    );
    statuses.push((await invite({ cookie: cookies.chair }, { email, role: "chair" })).status);
    statuses.push(
      (await invite({ cookie: cookies.admin }, reviewer("PEOPLE-VICTIM@example.org"))).status,
    );
    statuses.push((await invite({ cookie: cookies.elsewhere }, reviewer(email), OTHER)).status);
    expect(statuses).toEqual([201, 201, 201, 429, 429, 429]);
    expect((await mailTo(email)).filter((m) => /role-invitation/.test(m.text))).toHaveLength(3);

    // The refusals are audited, outside the transaction that was rolled back, with IDs only.
    const victim = await personId(t, email);
    const rows = (await auditRows("role_invitation.rate_limited")).filter(
      (r) => (r.details as { personId?: string }).personId === victim,
    );
    expect(rows.map((r) => [r.conferenceId, r.details])).toEqual([
      [conferenceId, { limit: "per_recipient", kind: "invite", personId: victim }],
      [conferenceId, { limit: "per_recipient", kind: "invite", personId: victim }],
      [otherId, { limit: "per_recipient", kind: "invite", personId: victim }],
    ]);
    expect(findLeaks(rows, [email])).toEqual([]);
    // The ledger holds the three, and nothing took one away.
    const sends = await t.db
      .select()
      .from(roleInvitationSends)
      .where(eq(roleInvitationSends.recipientPersonId, victim));
    expect(sends.map((x) => x.kind)).toEqual(["invite", "invite", "invite"]);

    // A day later the address can be invited again.
    t.setNow(new Date(NOW.getTime() + 25 * HOUR));
    try {
      const again = await signIn(t, "people-chair@example.org");
      expect((await invite({ cookie: again }, reviewer(email))).status).toBe(201);
    } finally {
      t.setNow(NOW);
    }
  });

  it("a chair sends at most 200 a day, at all conferences together", async () => {
    expect(ROLE_INVITATIONS.perInviterPerDay).toBe(200);
    const busy = await person("people-busy@example.org", "Bea Busychair");
    const busyId = await personId(t, "people-busy@example.org");
    await grantRole(t.db, { conferenceId, personId: busyId, role: "chair" });
    await grantRole(t.db, { conferenceId: otherId, personId: busyId, role: "chair" });
    // 198 already sent today, as the ledger has them; two more are sent here.
    const someone = await personId(t, "people-stranger@example.org");
    await t.db.insert(roleInvitationSends).values(
      Array.from({ length: 198 }, (_, i) => ({
        inviterPersonId: busyId,
        recipientPersonId: someone,
        conferenceId: i % 2 ? conferenceId : otherId,
        kind: "invite",
        // All within the last few minutes.
        sentAt: new Date(NOW.getTime() - (i + 1) * 1000),
      })),
    );
    expect(
      (await invite({ cookie: busy }, { email: "people-busy-199@example.org", role: "chair" }))
        .status,
    ).toBe(201);
    expect(
      (
        await invite(
          { cookie: busy },
          { email: "people-busy-200@example.org", role: "chair" },
          OTHER,
        )
      ).status,
    ).toBe(201);
    const refused = await invite(
      { cookie: busy },
      { email: "people-busy-201@example.org", role: "chair" },
    );
    expect(refused.status).toBe(429);
    expect(refused.json).toEqual({ error: "rate_limited" });
    // Sending one again is another email: refused too, although an hour has not even passed.
    const [sent] = await invitationOf(busy, "people-busy-199@example.org");
    t.setNow(new Date(NOW.getTime() + 61 * 60_000));
    try {
      const again = await signIn(t, "people-busy@example.org");
      expect((await resend({ cookie: again }, sent?.id ?? "")).status).toBe(429);
    } finally {
      t.setNow(NOW);
    }
    const rows = (await auditRows("role_invitation.rate_limited")).filter(
      (r) => r.actorPersonId === busyId,
    );
    // The address refused was never invited, so no person row was made for it: no id either.
    expect(rows.map((r) => r.details)).toEqual([
      { limit: "per_inviter", kind: "invite" },
      {
        limit: "per_inviter",
        kind: "resend",
        personId: await personId(t, "people-busy-199@example.org"),
      },
    ]);
    expect(
      await t.db.select().from(people).where(eq(people.email, "people-busy-201@example.org")),
    ).toEqual([]);
    // Another chair's budget is their own.
    expect(
      (
        await invite(
          { cookie: cookies.chair },
          { email: "people-busy-201@example.org", role: "chair" },
        )
      ).status,
    ).toBe(201);
  });

  it("an invitation is sent again at most once an hour, and each time counts for the address", async () => {
    const email = "people-resent@example.org";
    const sent = await invite({ cookie: cookies.chair }, reviewer(email));
    const id = sent.json.id as string;
    const first = await roleToken(email);
    expect((await resend({ cookie: cookies.chair }, id)).status).toBe(429); // within the hour
    const statuses: number[] = [];
    const tokens = [first];
    try {
      for (let hour = 1; hour <= 3; hour++) {
        t.setNow(new Date(NOW.getTime() + hour * 61 * 60_000));
        const res = await resend({ cookie: cookies.chair }, id);
        statuses.push(res.status);
        if (res.status === 204) tokens.push(await roleToken(email));
      }
      // The invitation and two resends make three emails to the address that day.
      expect(statuses).toEqual([204, 204, 429]);
      const target = await personId(t, email);
      const sends = await t.db
        .select()
        .from(roleInvitationSends)
        .where(eq(roleInvitationSends.recipientPersonId, target));
      expect(sends.map((x) => x.kind).sort()).toEqual(["invite", "resend", "resend"]);
      const rows = (await auditRows("role_invitation.rate_limited")).filter(
        (r) => r.targetId === id,
      );
      expect(rows.map((r) => r.details)).toEqual([
        { limit: "per_invitation_hourly", kind: "resend", personId: target },
        { limit: "per_recipient", kind: "resend", personId: target },
      ]);

      // Each resend is a new link, good for 30 days from then; the earlier links are dead.
      expect(new Set(tokens).size).toBe(3);
      const [inv] = await invitationOf(cookies.chair, email);
      const last = NOW.getTime() + 2 * 61 * 60_000;
      expect(inv).toMatchObject({
        id,
        state: "waiting",
        sentAt: new Date(last).toISOString(),
        expiresAt: new Date(last + 30 * DAY).toISOString(),
      });
      expect(await info(tokens[0] ?? "")).toMatchObject(DEAD);
      expect(await info(tokens[1] ?? "")).toMatchObject(DEAD);
      expect(await accept(tokens[0] ?? "")).toMatchObject(DEAD);
      expect(await rolesOf(email)).toEqual([]);
      expect((await info(tokens[2] ?? "")).status).toBe(200);
    } finally {
      t.setNow(NOW);
    }
  });

  it("the links share the per-address limit of every invitation link, refused with 429", async () => {
    const saved = t.deps.limits.invitationLinksPerIp;
    t.deps.limits.invitationLinksPerIp = new RateLimiter(2, 60_000);
    const before = (await auditRows("invitation.rate_limited")).length;
    try {
      const token = "role_doesnotexist_doesnotexist";
      expect((await info(token)).status).toBe(400);
      // A proposal invitation's link counts toward the same limit.
      const proposal = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
      expect(proposal.status).toBe(400);
      expect((await info(token)).status).toBe(429);
      expect((await answer({ token, answer: "decline" })).status).toBe(429);
      const rows = await auditRows("invitation.rate_limited");
      expect(rows.slice(before).map((r) => r.details)).toEqual([
        { limit: "invitation_links_per_ip", endpoint: "role_info" },
      ]);
    } finally {
      t.deps.limits.invitationLinksPerIp = saved;
    }
  });
});

describe("the invitation's link", () => {
  it("shows the conference, the role, the committees and the address, to anyone who has it", async () => {
    const email = "people-info@example.org";
    await invite(
      { cookie: cookies.chair },
      reviewer(email, { pools: [POOL_B, POOL_A], name: "Typed Infoname", lang: "pt" }),
    );
    const token = await roleToken(email);
    const expected = {
      view: "role_invitation",
      conference: { slug: SLUG, title: fixtureCall.title },
      role: "reviewer",
      pools: fixtureCall.reviewPools.map((p) => ({ key: p.key, name: p.name })),
      email,
      lang: "pt",
      expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      nameNeeded: true,
    };
    const open = await info(token);
    expect(open.status).toBe(200);
    expect(open.json).toEqual(expected);
    // Whoever looks, signed in or not, sees the same; nobody sees the name the chair typed.
    for (const who of ["stranger", "chair", "reviewer"]) {
      expect((await info(token, { cookie: cookieOf(who) })).json, who).toEqual(expected);
    }
    expect(findLeaks(open.json, ["Typed Infoname", await personId(t, email)])).toEqual([]);
    // Looking uses nothing up.
    expect((await info(token)).status).toBe(200);

    // A chair's invitation has no committees.
    await invite({ cookie: cookies.chair }, { email, role: "chair" });
    expect((await info(await roleToken(email))).json).toMatchObject({ role: "chair", pools: [] });
  });

  it("gives the role to the invited address when someone else opens the link and accepts", async () => {
    const email = "people-bound@example.org";
    await invite({ cookie: cookies.chair }, reviewer(email, { name: "Typed Boundname" }));
    const token = await roleToken(email);
    const before = await rolesOf("people-stranger@example.org");
    // The stranger is signed in, holds the forwarded link, and accepts it.
    const res = await accept(
      token,
      { displayName: "Bo Bound", languages: ["es", "en"], maxLoad: 5 },
      { cookie: cookies.stranger },
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ answer: "accepted" });
    // Nobody is signed in by accepting.
    expect(res.headers.get("set-cookie")).toBeNull();

    // The role is the invited address's. The person who opened the link has what they had.
    expect(await rolesOf(email)).toEqual([{ role: "reviewer", scope: [POOL_A] }]);
    expect(await rolesOf("people-stranger@example.org")).toEqual(before);
    expect(await rolesOf("people-stranger@example.org", otherId)).toEqual([]);
    const strangerSees = await call(t.public, "GET", "/api/me", { cookie: cookies.stranger });
    expect(strangerSees.json.roles).toEqual([]);
    expect((await call(t.public, "GET", at(), { cookie: cookies.stranger })).status).toBe(403);

    const invitee = await personId(t, email);
    const [prof] = await t.db
      .select()
      .from(reviewerProfiles)
      .where(eq(reviewerProfiles.personId, invitee));
    expect(prof).toMatchObject({
      conferenceId,
      pools: [POOL_A],
      languages: ["es", "en"],
      maxLoad: 5,
      expertise: [],
    });
    // The name given on the page is the invitee's; the name the chair typed went nowhere.
    const [p] = await t.db.select().from(people).where(eq(people.id, invitee));
    expect(p?.displayName).toBe("Bo Bound");
    secrets.push("Bo Bound");
    // The audit rows name the invitee as the one who accepted, not whoever held the link.
    const [accepted] = (await auditRows("role_invitation.accepted")).filter(
      (r) => (r.details as { personId: string }).personId === invitee,
    );
    expect(accepted).toMatchObject({
      actorKind: "human",
      actorPersonId: invitee,
      conferenceId,
      targetType: "role_invitation",
      details: { personId: invitee, role: "reviewer", pools: [POOL_A] },
    });

    // The chairs see a reviewer, by profile, under that pool; the invitation is off the list.
    const page = await listed(cookies.chair);
    expect(page.reviewers.find((r) => r.email === email)).toEqual({
      personId: invitee,
      displayName: "Bo Bound",
      email,
      pools: [POOL_A],
      assigned: 0,
      maxLoad: 5,
      languages: ["es", "en"],
    });
    expect(page.invitations.filter((i) => i.email === email)).toEqual([]);
    // And the address signs in to what it was given.
    const me = await call(t.public, "GET", "/api/me", { cookie: await signIn(t, email) });
    expect(me.json.roles).toEqual([{ conference: SLUG, role: "reviewer", scope: [POOL_A] }]);
  });

  it("cannot be turned toward another person, role or pool by what the request says", async () => {
    const email = "people-strict@example.org";
    await invite({ cookie: cookies.chair }, reviewer(email));
    const token = await roleToken(email);
    const stranger = await personId(t, "people-stranger@example.org");
    for (const extra of [
      { email: "people-stranger@example.org" },
      { personId: stranger },
      { role: "chair" },
      { pools: [POOL_A, POOL_B] },
      { scope: [] },
      { conference: OTHER },
      { conferenceId: otherId },
    ]) {
      const res = await accept(token, extra, { cookie: cookies.stranger });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.json.error).toBe("invalid");
    }
    // What a reviewer offers has its bounds.
    for (const bad of [
      { maxLoad: 0 },
      { maxLoad: 31 },
      { maxLoad: 2.5 },
      { maxLoad: "8" },
      { languages: [] },
      { languages: ["fr"] },
      { languages: ["en", "en"] },
      { displayName: "Hid\u202Eden" },
    ]) {
      expect((await accept(token, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await rolesOf(email)).toEqual([]);
    expect(await rolesOf("people-stranger@example.org")).toEqual([]);
    // The link was not used up by any of that.
    expect((await info(token)).status).toBe(200);

    // A proposal invitation's link is no role invitation, and the other way round.
    const owner = await person("people-owner@example.org", "Olga Ownerson");
    const draft = await call(t.public, "POST", `/api/conferences/${SLUG}/submissions`, {
      cookie: owner,
      body: { typeKey: "talk", language: "en", participationMode: "in_person" },
    });
    await call(t.public, "POST", `/api/submissions/${draft.json.id}/contributors`, {
      cookie: owner,
      body: {
        version: draft.json.version,
        email: "people-coauthor@example.org",
        role: "coauthor",
        lang: "en",
      },
    });
    const proposalMail = (await mailTo("people-coauthor@example.org")).at(-1)?.text ?? "";
    const proposalToken = /#token=(inv_[A-Za-z0-9_-]+)/.exec(proposalMail)?.[1] ?? "";
    expect(proposalToken).not.toBe("");
    expect(await info(proposalToken)).toMatchObject(DEAD);
    expect(await accept(proposalToken)).toMatchObject(DEAD);
    const crossed = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token, answer: "decline" },
    });
    expect(crossed).toMatchObject(DEAD);
    expect((await invitationOf(cookies.chair, email))[0]?.state).toBe("waiting");
  });

  it("needs the invitee's own name while their profile has none, and a reviewer's languages", async () => {
    const email = "people-noname@example.org";
    await invite({ cookie: cookies.chair }, reviewer(email, { name: "Nina Typedname" }));
    const token = await roleToken(email);
    const nothing = await answer({ token, answer: "accept" });
    expect(nothing.status).toBe(422);
    expect(nothing.json).toEqual({
      error: "invalid",
      issues: [
        { path: "displayName", code: "required" },
        { path: "languages", code: "required" },
      ],
    });
    const nameless = await answer({ token, answer: "accept", languages: ["pt"] });
    expect(nameless.json.issues).toEqual([{ path: "displayName", code: "required" }]);
    // Nothing was given or recorded: the invitation waits.
    expect(await rolesOf(email)).toEqual([]);
    expect((await invitationOf(cookies.chair, email))[0]?.state).toBe("waiting");

    // Without a number, a reviewer takes eight at most.
    const yes = await answer({
      token,
      answer: "accept",
      languages: ["pt"],
      displayName: "Nina Real",
    });
    expect(yes.json).toEqual({ answer: "accepted" });
    secrets.push("Nina Real");
    const pid = await personId(t, email);
    const [p] = await t.db.select().from(people).where(eq(people.id, pid));
    expect(p?.displayName).toBe("Nina Real");
    const [prof] = await t.db
      .select()
      .from(reviewerProfiles)
      .where(eq(reviewerProfiles.personId, pid));
    expect(prof).toMatchObject({ languages: ["pt"], maxLoad: 8 });
    const named = (await auditRows("person.profile_updated")).filter((r) => r.targetId === pid);
    expect(named.map((r) => r.details)).toEqual([
      { changed: ["displayName"], via: "role_invitation" },
    ]);

    // Someone with a name needs none, and theirs is left alone whatever is sent.
    const known = "people-named@example.org";
    await person(known, "Ned Namedalready");
    await invite(
      { cookie: cookies.chair },
      { email: known, role: "chair", name: "Wrong Typedname" },
    );
    const chairToken = await roleToken(known);
    expect((await info(chairToken)).json.nameNeeded).toBe(false);
    const asChair = await answer({
      token: chairToken,
      answer: "accept",
      displayName: "Another Name",
    });
    expect(asChair.json).toEqual({ answer: "accepted" });
    const [k] = await t.db.select().from(people).where(eq(people.email, known));
    expect(k?.displayName).toBe("Ned Namedalready");
    expect(await rolesOf(known)).toEqual([{ role: "chair", scope: [] }]);
    // A chair has no reviewer's profile.
    expect(
      await t.db
        .select()
        .from(reviewerProfiles)
        .where(eq(reviewerProfiles.personId, k?.id ?? "")),
    ).toEqual([]);
    // The new chair manages the conference's people, from their own sign-in.
    const cookie = await signIn(t, known);
    expect((await listed(cookie)).chairs.find((c) => c.you)?.email).toBe(known);
  });

  it("gives nothing for a link that was used, cancelled, has expired or never existed: one answer", async () => {
    const dead: Record<string, string> = {};
    const mk = async (what: string, body: InviteBody) => {
      const sent = await invite({ cookie: cookies.chair }, body);
      expect(sent.status, what).toBe(201);
      return { id: sent.json.id as string, token: await roleToken(body.email) };
    };
    // Accepted, and declined.
    const used = await mk("used", reviewer("people-dead-used@example.org"));
    expect((await accept(used.token)).json).toEqual({ answer: "accepted" });
    dead.used = used.token;
    const declined = await mk("declined", reviewer("people-dead-declined@example.org"));
    expect((await answer({ token: declined.token, answer: "decline" })).json).toEqual({
      answer: "declined",
    });
    dead.declined = declined.token;
    // Cancelled by a chair: its link stops working.
    const cancelled = await mk("cancelled", {
      email: "people-dead-cancelled@example.org",
      role: "chair",
    });
    expect((await cancel({ cookie: cookies.admin }, cancelled.id)).status).toBe(204);
    dead.cancelled = cancelled.token;
    const expired = await mk("expired", {
      email: "people-dead-expired@example.org",
      role: "chair",
    });
    dead.never = "role_ThisTokenWasNeverIssuedToAnyoneAtAll00000000";

    const counts = async () => ({
      roles: (await t.db.select().from(conferenceRoles)).length,
      profiles: (await t.db.select().from(reviewerProfiles)).length,
      audit: (await peopleAudit()).length,
      // Invitations queued: the chair signs in below, which is mail of another kind.
      mail: (await t.db.select().from(outbox).where(eq(outbox.kind, "role_invitation"))).length,
    });
    const before = await counts();
    const answers: unknown[] = [];
    const tryAll = async (token: string) => {
      answers.push(await info(token));
      answers.push(await accept(token));
      answers.push(
        await answer(
          { token, answer: "accept", displayName: "X Y", languages: ["en"] },
          { cookie: cookies.stranger },
        ),
      );
      answers.push(await answer({ token, answer: "decline" }));
    };
    for (const token of Object.values(dead)) await tryAll(token);
    // Thirty days to the second after it was sent, the link has expired.
    t.setNow(new Date(NOW.getTime() + 30 * DAY));
    try {
      await tryAll(expired.token);
      const chair = await signIn(t, "people-chair@example.org");
      expect((await invitationOf(chair, "people-dead-expired@example.org"))[0]?.state).toBe(
        "expired",
      );
    } finally {
      t.setNow(NOW);
    }
    // One second earlier it worked.
    t.setNow(new Date(NOW.getTime() + 30 * DAY - 1000));
    try {
      expect((await info(expired.token)).status).toBe(200);
    } finally {
      t.setNow(NOW);
    }
    expect(answers).toHaveLength(20);
    for (const a of answers) {
      expect(a).toMatchObject(DEAD);
      // Nothing says which it was.
      expect(Object.keys((a as { json: object }).json)).toEqual(["error"]);
    }
    // Accepting twice gave the role once; none of the rest gave or recorded anything.
    expect(await counts()).toEqual(before);
    expect(await rolesOf("people-dead-used@example.org")).toEqual([
      { role: "reviewer", scope: [POOL_A] },
    ]);
    for (const email of [
      "people-dead-declined@example.org",
      "people-dead-cancelled@example.org",
      "people-dead-expired@example.org",
    ]) {
      expect(await rolesOf(email), email).toEqual([]);
    }
  });

  it("declining needs nothing, tells nobody by email, and shows on the People page", async () => {
    const email = "people-declines@example.org";
    const sent = await invite(
      { cookie: cookies.chair },
      reviewer(email, { name: "Dee Typedname" }),
    );
    const token = await roleToken(email);
    await mailTo("people-chair@example.org");
    const mailBefore = mailbox().sent.length;
    const outboxBefore = (await t.db.select().from(outbox)).length;
    const res = await answer({ token, answer: "decline" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ answer: "declined" });
    expect(res.headers.get("set-cookie")).toBeNull();
    // Nobody is emailed about an answer: the page is where chairs see it.
    await mailTo("people-chair@example.org");
    expect(mailbox().sent.length).toBe(mailBefore);
    expect((await t.db.select().from(outbox)).length).toBe(outboxBefore);
    expect(await invitationOf(cookies.chair, email)).toEqual([
      expect.objectContaining({
        id: sent.json.id,
        state: "declined",
        name: "Dee Typedname",
        answeredAt: NOW.toISOString(),
      }),
    ]);
    expect(await rolesOf(email)).toEqual([]);
    const [p] = await t.db.select().from(people).where(eq(people.email, email));
    expect(p?.displayName).toBeNull();
    // Declined is not waiting: the address can be invited again, and the old row can go.
    expect((await resend({ cookie: cookies.chair }, sent.json.id)).status).toBe(409);
    expect((await invite({ cookie: cookies.chair }, reviewer(email))).status).toBe(201);
    expect((await cancel({ cookie: cookies.chair }, sent.json.id)).status).toBe(204);
    expect((await invitationOf(cookies.chair, email)).map((i) => i.state)).toEqual(["waiting"]);
    // Taken off the list once: a second tap does and records nothing more.
    expect((await cancel({ cookie: cookies.admin }, sent.json.id)).status).toBe(204);
    const off = (await auditRows("role_invitation.cancelled")).filter(
      (r) => r.targetId === sent.json.id,
    );
    expect(off.map((r) => (r.details as { state: string }).state)).toEqual(["declined"]);
    const [kept] = await t.db
      .select()
      .from(roleInvitations)
      .where(eq(roleInvitations.id, sent.json.id));
    // The row is kept, with the answer that was given.
    expect(kept).toMatchObject({ answer: "declined" });
    expect(kept?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("adds a reviewer's pools to the ones they have", async () => {
    // Invited for one pool; given the role for the other on the server before answering.
    const email = "people-adds@example.org";
    await invite({ cookie: cookies.chair }, reviewer(email, { pools: [POOL_A] }));
    const pid = await personId(t, email);
    await grantRole(t.db, { conferenceId, personId: pid, role: "reviewer", scope: [POOL_B] });
    expect((await accept(await roleToken(email), { languages: ["es"], maxLoad: 3 })).json).toEqual({
      answer: "accepted",
    });
    expect(await rolesOf(email)).toEqual([{ role: "reviewer", scope: [POOL_A, POOL_B] }]);
    const [prof] = await t.db
      .select()
      .from(reviewerProfiles)
      .where(eq(reviewerProfiles.personId, pid));
    expect(prof).toMatchObject({ pools: [POOL_A, POOL_B], languages: ["es"], maxLoad: 3 });

    // With a profile already: its pools are kept, what the person now says replaces the rest.
    const two = "people-adds-two@example.org";
    await invite({ cookie: cookies.chair }, reviewer(two, { pools: [POOL_B] }));
    const twoId = await personId(t, two);
    await grantRole(t.db, { conferenceId, personId: twoId, role: "reviewer", scope: [POOL_A] });
    await t.db.insert(reviewerProfiles).values({
      conferenceId,
      personId: twoId,
      pools: [POOL_A],
      expertise: ["netart"],
      languages: ["pt"],
      maxLoad: 12,
    });
    expect((await accept(await roleToken(two), { languages: ["en"], maxLoad: 4 })).status).toBe(
      200,
    );
    expect(await rolesOf(two)).toEqual([{ role: "reviewer", scope: [POOL_A, POOL_B] }]);
    const [profTwo] = await t.db
      .select()
      .from(reviewerProfiles)
      .where(eq(reviewerProfiles.personId, twoId));
    expect(profTwo).toMatchObject({
      pools: [POOL_A, POOL_B],
      expertise: ["netart"],
      languages: ["en"],
      maxLoad: 4,
    });

    // A role without a scope is every pool already: accepting never narrows it.
    const all = "people-adds-all@example.org";
    await invite({ cookie: cookies.chair }, reviewer(all, { pools: [POOL_B] }));
    const allId = await personId(t, all);
    await grantRole(t.db, { conferenceId, personId: allId, role: "reviewer", scope: [] });
    expect((await accept(await roleToken(all))).status).toBe(200);
    expect(await rolesOf(all)).toEqual([{ role: "reviewer", scope: [] }]);
    const [profAll] = await t.db
      .select()
      .from(reviewerProfiles)
      .where(eq(reviewerProfiles.personId, allId));
    expect(profAll?.pools).toEqual(POOLS);
    // The same at another conference is another role.
    expect(await rolesOf(email, otherId)).toEqual([]);
  });

  it("never gives a reviewer's role without a pool: a pool the conference no longer has is not given", async () => {
    // A conference of its own, whose configuration loses a pool after the invitations go out.
    const slug = "people-pools";
    const { conferenceId: id } = await seedTestCall(t.db, { slug, now: NOW });
    await grantRole(t.db, {
      conferenceId: id,
      personId: await personId(t, "people-chair@example.org"),
      role: "chair",
    });
    await invite(
      { cookie: cookies.chair },
      reviewer("people-pool-both@example.org", { pools: [POOL_A, POOL_B] }),
      slug,
    );
    const gone = await invite(
      { cookie: cookies.chair },
      reviewer("people-pool-gone@example.org", { pools: [POOL_B] }),
      slug,
    );
    const stored = await getConference(t.db, slug);
    if (!stored) throw new Error("no conference");
    await saveConference(t.db, {
      ...stored.config,
      reviewPools: stored.config.reviewPools.filter((p) => p.key !== POOL_B),
      submissionTypes: stored.config.submissionTypes.map((x) => ({ ...x, reviewPool: POOL_A })),
    });
    // Both pools invited, one left: the role is for that one.
    const both = await roleToken("people-pool-both@example.org");
    expect((await info(both)).json.pools.map((p: { key: string }) => p.key)).toEqual([POOL_A]);
    expect((await accept(both)).status).toBe(200);
    expect(await rolesOf("people-pool-both@example.org", id)).toEqual([
      { role: "reviewer", scope: [POOL_A] },
    ]);
    // Only the pool that is gone: the link gives nothing, and cannot be sent again.
    const none = await roleToken("people-pool-gone@example.org");
    expect(await info(none)).toMatchObject(DEAD);
    expect(await accept(none)).toMatchObject(DEAD);
    // What the link does not show takes no answer at all, not even a refusal.
    expect(await answer({ token: none, answer: "decline" })).toMatchObject(DEAD);
    expect(await rolesOf("people-pool-gone@example.org", id)).toEqual([]);
    t.setNow(new Date(NOW.getTime() + 2 * HOUR));
    try {
      const chair = await signIn(t, "people-chair@example.org");
      // Sending it again says why not; the chair cancels it and invites again.
      const again = await resend({ cookie: chair }, gone.json.id, slug);
      expect(again.status).toBe(409);
      expect(again.json).toEqual({ error: "pools_gone" });
      expect((await invitationOf(chair, "people-pool-gone@example.org", slug))[0]?.state).toBe(
        "waiting",
      );
      expect((await cancel({ cookie: chair }, gone.json.id, slug)).status).toBe(204);
      expect(await invitationOf(chair, "people-pool-gone@example.org", slug)).toEqual([]);
    } finally {
      t.setNow(NOW);
    }
  });

  it("refuses agents, which can neither read an invitation nor answer one", async () => {
    const email = "people-agents@example.org";
    await invite({ cookie: cookies.chair }, { email, role: "chair" });
    const token = await roleToken(email);
    const chairId = await personId(t, "people-chair@example.org");
    const m = await createApiToken(t.db, {
      personId: chairId,
      conferenceId,
      tier: "M",
      name: "m2",
    });
    const c = await createApiToken(t.db, {
      personId: chairId,
      conferenceId,
      tier: "C",
      name: "c2",
    });
    const read = await info(token, { token: m.token });
    expect(read.status).toBe(403);
    expect(read.json).toEqual({ error: "agents_read_only" });
    const onInternal = await call(t.internal, "POST", "/api/role-invitations/answer", {
      token: c.token,
      body: { token, answer: "accept", displayName: "Agent Made" },
    });
    expect(onInternal.status).toBe(403);
    expect(onInternal.json).toEqual({ error: "agents_read_only" });
    const declineByAgent = await answer({ token, answer: "decline" }, { token: m.token });
    expect(declineByAgent.status).toBe(403);
    // Nothing happened: the invitation waits, and the link still works for a person.
    expect(await rolesOf(email)).toEqual([]);
    expect((await invitationOf(cookies.chair, email))[0]?.state).toBe("waiting");
    expect((await info(token)).status).toBe(200);
  });
});

describe("what an invitation reveals", () => {
  it("is shown as typed, identically for an address with an account and one without", async () => {
    const has = "people-blind-has@example.org";
    const none = "people-blind-none@example.org";
    const markers = [
      "BLIND-NAME Zelda Zamora",
      "BLIND-AFFILIATION Instituto Inventado",
      "BLIND-PRONOUNS",
      "BLIND-BIO a made-up life",
      "0000-0002-1825-0097",
    ];
    const cookie = await person(has);
    await profile(cookie, markers[0] ?? "", {
      affiliation: markers[1],
      pronouns: markers[2],
      bios: { en: markers[3] },
      orcid: markers[4],
      country: "CO",
      languages: ["pt"],
    });
    expect(await t.db.select().from(people).where(eq(people.email, none))).toEqual([]);

    const typed = { role: "reviewer", pools: [POOL_A], lang: "es", name: "Typed Person" } as const;
    const sent = [];
    for (const email of [has, none]) {
      const res = await invite({ cookie: cookies.chair }, { email, ...typed });
      sent.push({ status: res.status, keys: Object.keys(res.json) });
    }
    expect(sent).toEqual([
      { status: 201, keys: ["id"] },
      { status: 201, keys: ["id"] },
    ]);

    /** The two rows, without what names them: everything else must be the same. */
    const pair = async () => {
      const page = await listed(cookies.chair);
      expect(findLeaks(page, markers)).toEqual([]);
      const rows = [has, none].map((email) => page.invitations.find((i) => i.email === email));
      return rows.map((row) => ({ ...row, id: null, email: null }));
    };
    let [a, b] = await pair();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ name: "Typed Person", state: "waiting", lang: "es" });

    // The emails are the same but for the link.
    const mails = await Promise.all([has, none].map(async (email) => (await mailTo(email)).at(-1)));
    const plain = (m: { subject: string; text: string } | undefined) =>
      `${m?.subject}\n${m?.text.replace(/#token=\S+/, "#token=…")}`;
    expect(plain(mails[0])).toBe(plain(mails[1]));
    expect(findLeaks(mails, [...markers, "Typed Person", "Cora"])).toEqual([]);

    // Declined, and expired: still as typed, still the same.
    for (const email of [has, none]) {
      expect((await answer({ token: await roleToken(email), answer: "decline" })).status).toBe(200);
    }
    [a, b] = await pair();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ name: "Typed Person", state: "declined" });

    const again = [];
    for (const email of [has, none]) {
      const res = await invite(
        { cookie: cookies.chair },
        { email, ...typed, role: "chair", pools: [] },
      );
      again.push(res.status);
    }
    expect(again).toEqual([201, 201]);
    t.setNow(new Date(NOW.getTime() + 31 * DAY));
    try {
      const chair = await signIn(t, "people-chair@example.org");
      const page = await listed(chair);
      expect(findLeaks(page.invitations, markers)).toEqual([]);
      const rows = [has, none].map((email) =>
        page.invitations
          .filter((i) => i.email === email)
          .map((row) => ({ ...row, id: null, email: null })),
      );
      expect(rows[0]).toEqual(rows[1]);
      expect(rows[0]?.map((r) => r.state).sort()).toEqual(["declined", "expired"]);
    } finally {
      t.setNow(NOW);
    }
  });

  it("the page never holds a link's token or its hash, and the stored mail loses the token once sent", async () => {
    const email = "people-token@example.org";
    const sent = await invite({ cookie: cookies.chair }, reviewer(email));
    const token = await roleToken(email); // delivered, so the inbox has it
    const page = await call(t.public, "GET", at(), { cookie: cookies.chair });
    expect(findLeaks(page.json, [token, hashToken(token), "role_"])).toEqual([]);
    expect(findLeaks(sent.json, [token, hashToken(token)])).toEqual([]);
    t.setNow(new Date(NOW.getTime() + 61 * 60_000));
    try {
      const chair = await signIn(t, "people-chair@example.org");
      expect((await resend({ cookie: chair }, sent.json.id)).status).toBe(204);
      const second = await roleToken(email);
      const stored = await t.db.select().from(outbox).where(eq(outbox.toEmail, email));
      expect(stored).toHaveLength(2);
      for (const row of stored) {
        expect(row.kind).toBe("role_invitation");
        expect(row.sentAt).not.toBeNull();
        expect(row.bodyText).toContain("/en/role-invitation#token=[redacted]");
        expect(row.subject).not.toContain("token");
      }
      expect(findLeaks(stored, [token, second])).toEqual([]);
      // The database holds no working link: only the hash of the one in the latest email.
      const rows = await t.db
        .select()
        .from(roleInvitations)
        .where(eq(roleInvitations.id, sent.json.id));
      expect(rows.map((r) => r.tokenHash)).toEqual([hashToken(second)]);
      expect(findLeaks(rows, [token, second])).toEqual([]);
    } finally {
      t.setNow(NOW);
    }
  });
});

describe("cancelling an invitation", () => {
  it("stops its link, takes it off the list, and is recorded once", async () => {
    const email = "people-cancelled@example.org";
    const sent = await invite(
      { cookie: cookies.chair },
      reviewer(email, { pools: [POOL_A, POOL_B] }),
    );
    const id = sent.json.id as string;
    const token = await roleToken(email);
    const mailBefore = (await mailTo(email)).length;
    expect((await cancel({ cookie: cookies.admin }, id)).status).toBe(204);
    // A second tap, or another chair's: nothing more to do.
    expect((await cancel({ cookie: cookies.chair }, id)).status).toBe(204);
    expect(await invitationOf(cookies.chair, email)).toEqual([]);
    expect(await info(token)).toMatchObject(DEAD);
    expect(await accept(token)).toMatchObject(DEAD);
    expect(await rolesOf(email)).toEqual([]);
    // The invitee is not told, and the row is kept.
    expect((await mailTo(email)).length).toBe(mailBefore);
    const [row] = await t.db.select().from(roleInvitations).where(eq(roleInvitations.id, id));
    expect(row?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    const rows = (await auditRows("role_invitation.cancelled")).filter((r) => r.targetId === id);
    expect(rows.map((r) => [r.actorPersonId, r.details])).toEqual([
      [
        await personId(t, "people-admin@example.org"),
        {
          personId: await personId(t, email),
          role: "reviewer",
          pools: [POOL_A, POOL_B],
          state: "waiting",
        },
      ],
    ]);
    // It cannot be sent again; the address can be invited afresh.
    expect((await resend({ cookie: cookies.chair }, id)).status).toBe(409);
    expect((await invite({ cookie: cookies.chair }, reviewer(email))).status).toBe(201);
  });

  it("an invitation's id written in capitals is the same invitation", async () => {
    const email = "people-capitals@example.org";
    const sent = await invite({ cookie: cookies.chair }, { email, role: "chair" });
    const id = sent.json.id as string;
    expect(id.toUpperCase()).not.toBe(id);
    expect((await cancel({ cookie: cookies.chair }, id.toUpperCase())).status).toBe(204);
    expect(await invitationOf(cookies.chair, email)).toEqual([]);
    // Recorded once, under the id the database has.
    expect(
      (await auditRows("role_invitation.cancelled")).filter((r) => r.targetId === id),
    ).toHaveLength(1);
    expect(
      (await auditRows("role_invitation.cancelled")).filter((r) => r.targetId === id.toUpperCase()),
    ).toEqual([]);
  });

  it("is for this conference's invitations that nobody accepted", async () => {
    const email = "people-cancel-other@example.org";
    const elsewhere = await invite({ cookie: cookies.chair }, reviewer(email), OTHER);
    // Another conference's invitation does not exist here, for its own chair either.
    for (const act of [cancel, resend]) {
      const res = await act({ cookie: cookies.chair }, elsewhere.json.id);
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: "not_found" });
    }
    expect(
      (await cancel({ cookie: cookies.chair }, "00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
    expect((await cancel({ cookie: cookies.chair }, "not-an-id")).status).toBe(404);
    expect((await invitationOf(cookies.chair, email, OTHER))[0]?.state).toBe("waiting");

    // An accepted invitation gave a role: that is removed, not cancelled.
    const here = await invite({ cookie: cookies.chair }, reviewer(email));
    expect((await accept(await roleToken(email))).status).toBe(200);
    const res = await cancel({ cookie: cookies.chair }, here.json.id);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "already_answered" });
    expect((await resend({ cookie: cookies.chair }, here.json.id)).status).toBe(409);
    expect(await rolesOf(email)).toEqual([{ role: "reviewer", scope: [POOL_A] }]);
  });

  it("an expired invitation can be sent again, unless the address was invited or given the role since", async () => {
    const email = "people-revived@example.org";
    const old = await invite({ cookie: cookies.chair }, reviewer(email));
    t.setNow(new Date(NOW.getTime() + 31 * DAY));
    try {
      const chair = await signIn(t, "people-chair@example.org");
      expect((await invitationOf(chair, email))[0]?.state).toBe("expired");
      // Expired is not waiting: a new invitation may go out, and then the old one stays dead.
      const fresh = await invite({ cookie: chair }, reviewer(email));
      expect(fresh.status).toBe(201);
      const refused = await resend({ cookie: chair }, old.json.id);
      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ error: "already_invited" });
      // With the new one cancelled, the old one can be sent again and works for 30 days more.
      expect((await cancel({ cookie: chair }, fresh.json.id)).status).toBe(204);
      expect((await resend({ cookie: chair }, old.json.id)).status).toBe(204);
      const [inv] = await invitationOf(chair, email);
      expect(inv).toMatchObject({
        id: old.json.id,
        state: "waiting",
        expiresAt: new Date(NOW.getTime() + 61 * DAY).toISOString(),
      });
      expect((await accept(await roleToken(email))).status).toBe(200);
    } finally {
      t.setNow(NOW);
    }
    // Given the role on the server while an invitation waits: sending it again is refused.
    const held = "people-revived-held@example.org";
    const waiting = await invite({ cookie: cookies.chair }, { email: held, role: "chair" });
    await grantRole(t.db, { conferenceId, personId: await personId(t, held), role: "admin" });
    t.setNow(new Date(NOW.getTime() + 2 * HOUR));
    try {
      const chair = await signIn(t, "people-chair@example.org");
      const res = await resend({ cookie: chair }, waiting.json.id);
      expect(res.status).toBe(409);
      expect(res.json).toEqual({ error: "already_has_role" });
    } finally {
      t.setNow(NOW);
    }
  });
});

describe("removing a role", () => {
  let s: SandboxSummary;
  let chair: string;
  let chairId: string;
  const slug = "sandbox";
  const assignmentsOf = async (reviewerId: string) =>
    t.db.select().from(assignments).where(eq(assignments.reviewerId, reviewerId));

  beforeAll(async () => {
    s = await seedSandbox(t.db, { submissions: 60 });
    chair = await signIn(t, s.chairEmail);
    chairId = await personId(t, s.chairEmail);
  }, 120_000);

  it("the page lists chairs, reviewers by pool with their proposals, and existing track chairs", async () => {
    const page = await listed(chair, slug);
    expect(page.chairs.map((c) => [c.email, c.you])).toEqual([
      [s.adminEmail, false],
      [s.chairEmail, true],
    ]);
    expect(page.reviewers).toHaveLength(s.reviewerEmails.length);
    expect(page.trackChairs.map((x) => x.email).sort()).toEqual([...s.trackChairEmails].sort());
    for (const x of page.trackChairs) expect(x.tracks).toHaveLength(1);
    // This chair wrote nothing and has no conflict: every assignment is counted.
    const all = await t.db
      .select()
      .from(assignments)
      .where(eq(assignments.conferenceId, s.conferenceId));
    expect(page.reviewers.reduce((n, r) => n + r.assigned, 0)).toBe(all.length);
    expect(all.length).toBe(s.assignmentCount);
    for (const r of page.reviewers.slice(0, 5)) {
      expect(r.assigned, r.email).toBe(all.filter((a) => a.reviewerId === r.personId).length);
      expect(r.pools).toHaveLength(1);
      expect(r.maxLoad).toBe(12);
    }
    // No review is counted or named anywhere: there are none yet.
    expect(JSON.stringify(page)).not.toMatch(/review(s|ed|Count)\b/i);
  });

  it("removing a reviewer deletes their assignments and their reviewer profile, and nothing else", async () => {
    const page = await listed(chair, slug);
    const victim = page.reviewers.find((r) => r.assigned >= 2);
    if (!victim) throw new Error("no reviewer with assignments in the sandbox");
    const mine = await assignmentsOf(victim.personId);
    expect(mine).toHaveLength(victim.assigned);
    const snapshot = async () => ({
      assignments: (await t.db.select().from(assignments)).length,
      roles: (await t.db.select().from(conferenceRoles)).length,
      profiles: (await t.db.select().from(reviewerProfiles)).length,
      people: (await t.db.select().from(people)).length,
      conflicts: (await t.db.select().from(conflicts)).length,
      submissions: (await t.db.select().from(submissions)).length,
      contributions: (await t.db.select().from(contributions)).length,
    });
    const before = await snapshot();
    const conflictsBefore = await t.db
      .select()
      .from(conflicts)
      .where(eq(conflicts.personId, victim.personId));
    // The same person reviews at another conference too: none of that is this conference's.
    await grantRole(t.db, {
      conferenceId,
      personId: victim.personId,
      role: "reviewer",
      scope: [POOL_A],
    });
    await t.db
      .insert(reviewerProfiles)
      .values({ conferenceId, personId: victim.personId, pools: [POOL_A], languages: ["en"] });

    // The confirmation said how many proposals lose this reviewer: without that number, or
    // with one that is no longer true, nothing is removed.
    for (const body of [{}, { assignments: victim.assigned + 1 }, { assignments: 0 }]) {
      const res = await remove({ cookie: chair }, victim.personId, "reviewer", body, slug);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.json).toEqual({ error: "stale", assignments: victim.assigned });
    }
    expect((await assignmentsOf(victim.personId)).length).toBe(victim.assigned);
    expect(await rolesOf(victim.email, s.conferenceId)).toHaveLength(1);

    const res = await remove(
      { cookie: chair },
      victim.personId,
      "reviewer",
      { assignments: victim.assigned },
      slug,
    );
    expect(res.status).toBe(204);
    const after = await snapshot();
    expect(after).toEqual({
      ...before,
      assignments: before.assignments - victim.assigned,
      // The role and the profile granted above at the other conference are still there.
      roles: before.roles - 1 + 1,
      profiles: before.profiles - 1 + 1,
    });
    expect(await rolesOf(victim.email, s.conferenceId)).toEqual([]);
    expect(await rolesOf(victim.email, conferenceId)).toEqual([
      { role: "reviewer", scope: [POOL_A] },
    ]);
    expect(
      await t.db
        .select()
        .from(reviewerProfiles)
        .where(
          and(
            eq(reviewerProfiles.personId, victim.personId),
            eq(reviewerProfiles.conferenceId, s.conferenceId),
          ),
        ),
    ).toEqual([]);
    expect(await assignmentsOf(victim.personId)).toEqual([]);
    // Their conflicts stay: they are facts about people, not about the role.
    expect(
      await t.db.select().from(conflicts).where(eq(conflicts.personId, victim.personId)),
    ).toEqual(conflictsBefore);
    // Every other reviewer has what they had.
    const now = await listed(chair, slug);
    expect(now.reviewers.find((r) => r.personId === victim.personId)).toBeUndefined();
    for (const r of page.reviewers.filter((x) => x.personId !== victim.personId)) {
      expect(
        now.reviewers.find((x) => x.personId === r.personId),
        r.email,
      ).toEqual(r);
    }
    const [row] = (await auditRows("role.removed")).filter((r) => r.targetId === victim.personId);
    expect(row).toMatchObject({
      actorKind: "human",
      actorPersonId: chairId,
      conferenceId: s.conferenceId,
      targetType: "person",
      details: { role: "reviewer", pools: victim.pools, assignments: victim.assigned },
    });
    // The reviewer sees none of the proposals any more.
    const cookie = await signIn(t, victim.email);
    const list = await call(t.public, "GET", `/api/conferences/${slug}/submissions?limit=500`, {
      cookie,
    });
    expect(list.json.items.filter((x: { view: string }) => x.view === "reviewer")).toEqual([]);
    // Removing them again finds nobody.
    expect(
      (await remove({ cookie: chair }, victim.personId, "reviewer", { assignments: 0 }, slug))
        .status,
    ).toBe(404);
  });

  it("a chair who is an author never learns from the counts who reviews their own proposal", async () => {
    // An author who is no reviewer becomes a chair. Their own proposal has reviewers.
    const all = await t.db
      .select()
      .from(assignments)
      .where(eq(assignments.conferenceId, s.conferenceId));
    const subs = await t.db
      .select()
      .from(submissions)
      .where(eq(submissions.conferenceId, s.conferenceId));
    const owners = await t.db
      .select()
      .from(people)
      .where(
        inArray(
          people.id,
          subs.map((x) => x.ownerPersonId),
        ),
      );
    const own = subs.find(
      (x) =>
        all.some((a) => a.submissionId === x.id) &&
        !owners.find((p) => p.id === x.ownerPersonId)?.email.startsWith("reviewer-"),
    );
    if (!own) throw new Error("no assigned proposal by an author who is no reviewer");
    const author = owners.find((p) => p.id === own.ownerPersonId);
    if (!author) throw new Error("no author");
    await grantRole(t.db, { conferenceId: s.conferenceId, personId: author.id, role: "chair" });
    const authorCookie = await signIn(t, author.email);
    const theirs = new Set(
      (await t.db.select().from(contributions).where(eq(contributions.personId, author.id))).map(
        (c) => c.submissionId,
      ),
    );
    const hidden = all.filter((a) => theirs.has(a.submissionId));
    expect(hidden.length).toBeGreaterThan(0);

    const asAuthor = await listed(authorCookie, slug);
    const asChair = await listed(chair, slug);
    for (const r of asChair.reviewers) {
      const mine = hidden.filter((a) => a.reviewerId === r.personId).length;
      expect(asAuthor.reviewers.find((x) => x.personId === r.personId)?.assigned, r.email).toBe(
        r.assigned - mine,
      );
    }
    // The author-chair's page is the same as it would be if nobody reviewed their proposals.
    const reviewerOfOwn = asChair.reviewers.find((r) =>
      hidden.some((a) => a.reviewerId === r.personId),
    );
    if (!reviewerOfOwn) throw new Error("no reviewer of the author's proposal");
    const shown =
      asAuthor.reviewers.find((x) => x.personId === reviewerOfOwn.personId)?.assigned ?? -1;
    expect(shown).toBeLessThan(reviewerOfOwn.assigned);

    // Removing that reviewer: the author-chair confirms the number their page showed, and the
    // refusal of any other number says only that number. Every assignment goes all the same.
    const wrong = await remove(
      { cookie: authorCookie },
      reviewerOfOwn.personId,
      "reviewer",
      { assignments: reviewerOfOwn.assigned },
      slug,
    );
    expect(wrong.status).toBe(409);
    expect(wrong.json).toEqual({ error: "stale", assignments: shown });
    const ok = await remove(
      { cookie: authorCookie },
      reviewerOfOwn.personId,
      "reviewer",
      { assignments: shown },
      slug,
    );
    expect(ok.status).toBe(204);
    expect(await assignmentsOf(reviewerOfOwn.personId)).toEqual([]);
    const [row] = (await auditRows("role.removed")).filter(
      (r) => r.targetId === reviewerOfOwn.personId,
    );
    expect(row?.details).toMatchObject({ role: "reviewer", assignments: reviewerOfOwn.assigned });
  });

  it("a chair cannot remove their own chair role, so a conference keeps a chair", async () => {
    const res = await remove({ cookie: chair }, chairId, "chair", {}, slug);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "own_role" });
    expect(await rolesOf(s.chairEmail, s.conferenceId)).toEqual([{ role: "chair", scope: [] }]);
    // An admin is a chair: the same for them, by the same route.
    const admin = await signIn(t, s.adminEmail);
    const adminId = await personId(t, s.adminEmail);
    expect((await remove({ cookie: admin }, adminId, "chair", {}, slug)).json).toEqual({
      error: "own_role",
    });
    expect(
      (await auditRows("role.removed")).filter(
        (r) => r.targetId === chairId || r.targetId === adminId,
      ),
    ).toEqual([]);

    // A chair's own role as a reviewer is theirs to give up.
    await grantRole(t.db, {
      conferenceId: s.conferenceId,
      personId: chairId,
      role: "reviewer",
      scope: ["scientific"],
    });
    expect(
      (await remove({ cookie: chair }, chairId, "reviewer", { assignments: 0 }, slug)).status,
    ).toBe(204);
    expect(await rolesOf(s.chairEmail, s.conferenceId)).toEqual([{ role: "chair", scope: [] }]);
  });

  it("a chair removes another chair, who loses the conference at once: both rows of one who is chair and admin", async () => {
    const adminId = await personId(t, s.adminEmail);
    const admin = await signIn(t, s.adminEmail);
    // The admin is given the chair role as well: still one chair on the page.
    await grantRole(t.db, { conferenceId: s.conferenceId, personId: adminId, role: "chair" });
    expect((await listed(chair, slug)).chairs.filter((c) => c.personId === adminId)).toHaveLength(
      1,
    );
    const token = await createApiToken(t.db, {
      personId: adminId,
      conferenceId: s.conferenceId,
      tier: "M",
      name: "admin's agent",
    });
    expect(
      (await call(t.public, "GET", `/api/conferences/${slug}/overview`, { token: token.token }))
        .status,
    ).toBe(200);

    expect((await remove({ cookie: chair }, adminId, "chair", {}, slug)).status).toBe(204);
    expect(await rolesOf(s.adminEmail, s.conferenceId)).toEqual([]);
    const [row] = (await auditRows("role.removed")).filter((r) => r.targetId === adminId);
    expect(row?.details).toEqual({ role: "chair", removed: ["admin", "chair"] });
    // Their session and their agent's token are worth nothing here from the next request on.
    expect((await call(t.public, "GET", at("", slug), { cookie: admin })).status).toBe(403);
    expect((await remove({ cookie: admin }, chairId, "chair", {}, slug)).status).toBe(403);
    expect(
      (await call(t.public, "GET", `/api/conferences/${slug}/settings`, { cookie: admin })).status,
    ).toBe(403);
    expect(
      (await call(t.public, "GET", `/api/conferences/${slug}/overview`, { token: token.token }))
        .status,
    ).toBe(403);
    expect(await rolesOf(s.chairEmail, s.conferenceId)).toEqual([{ role: "chair", scope: [] }]);
  });

  it("an id written in capitals names the same person to every check", async () => {
    // Filed by an independent review of this change: the database reads an id in capitals as
    // the same id, and the checks made here on it compared text. A chair's own id in capitals
    // got past "not your own role", and a reviewer's got past the count of their assignments.
    const own = await remove({ cookie: chair }, chairId.toUpperCase(), "chair", {}, slug);
    expect(chairId.toUpperCase()).not.toBe(chairId);
    expect(own.status).toBe(409);
    expect(own.json).toEqual({ error: "own_role" });
    expect(await rolesOf(s.chairEmail, s.conferenceId)).toEqual([{ role: "chair", scope: [] }]);
    expect((await listed(chair, slug)).chairs.find((c) => c.you)?.email).toBe(s.chairEmail);

    const r = (await listed(chair, slug)).reviewers.find((x) => x.assigned >= 1);
    if (!r) throw new Error("no reviewer with assignments left in the sandbox");
    const upper = r.personId.toUpperCase();
    const unchecked = await remove({ cookie: chair }, upper, "reviewer", { assignments: 0 }, slug);
    expect(unchecked.status).toBe(409);
    expect(unchecked.json).toEqual({ error: "stale", assignments: r.assigned });
    expect(await assignmentsOf(r.personId)).toHaveLength(r.assigned);
    const ok = await remove(
      { cookie: chair },
      upper,
      "reviewer",
      { assignments: r.assigned },
      slug,
    );
    expect(ok.status).toBe(204);
    expect(await assignmentsOf(r.personId)).toEqual([]);
    // The audit row names the person by the id the database has, not as it was typed.
    const rows = await auditRows("role.removed");
    expect(rows.filter((x) => x.targetId === upper)).toEqual([]);
    expect(rows.filter((x) => x.targetId === r.personId).map((x) => x.details)).toEqual([
      { role: "reviewer", pools: r.pools, assignments: r.assigned },
    ]);
  });

  it("a chair removed while their request was on its way changes nothing", async () => {
    // The route checks who is asking before the transaction begins. Here the chair is removed
    // between the two: each change reads them again inside its transaction, and refuses.
    const email = "people-gone@example.org";
    const gone = await person(email, "Gail Gonechair");
    const goneId = await personId(t, email);
    await grantRole(t.db, { conferenceId, personId: goneId, role: "chair" });
    const waiting = await invite({ cookie: gone }, reviewer("people-gone-invitee@example.org"));
    expect(waiting.status).toBe(201);
    const conference = await getConference(t.db, SLUG);
    // The chair as the route saw them: still a chair.
    const asSeen = await loadPersonViewer(t.db, goneId);
    if (!conference || !asSeen) throw new Error("no conference or no person");
    expect((await remove({ cookie: cookies.chair }, goneId, "chair")).status).toBe(204);

    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "done";
      } catch (err) {
        return err instanceof Refusal ? `${err.status} ${err.code}` : String(err);
      }
    };
    const before = await peopleAudit();
    const adminId = await personId(t, "people-admin@example.org");
    expect(
      await refused(() =>
        inviteToRole(t.deps, asSeen, conference, {
          email: "people-gone-second@example.org",
          role: "chair",
          pools: [],
          lang: "en",
        }),
      ),
    ).toBe("403 forbidden");
    expect(
      await refused(() => resendRoleInvitation(t.deps, asSeen, conference, waiting.json.id)),
    ).toBe("403 forbidden");
    expect(
      await refused(() => cancelRoleInvitation(t.deps, asSeen, conference, waiting.json.id)),
    ).toBe("403 forbidden");
    expect(
      await refused(() =>
        removeRole(t.deps, asSeen, conference, {
          personId: adminId,
          role: "chair",
        }),
      ),
    ).toBe("403 forbidden");
    // Nothing was sent, cancelled or removed, and nobody was written to.
    expect(await peopleAudit()).toEqual(before);
    expect(await mailTo("people-gone-second@example.org")).toEqual([]);
    expect(
      await t.db.select().from(people).where(eq(people.email, "people-gone-second@example.org")),
    ).toEqual([]);
    expect((await invitationOf(cookies.chair, "people-gone-invitee@example.org"))[0]?.state).toBe(
      "waiting",
    );
    expect(await rolesOf("people-admin@example.org")).toEqual([{ role: "admin", scope: [] }]);
    // The invitation they sent while a chair stays the conference's: it can still be accepted,
    // and the chairs who remain see it in their list and can cancel it.
    expect((await accept(await roleToken("people-gone-invitee@example.org"))).status).toBe(200);
  });

  it("two chairs removing each other at the same moment cannot both succeed", async () => {
    const a = await person("people-mutual-a@example.org", "Ada Mutual");
    const b = await person("people-mutual-b@example.org", "Ben Mutual");
    const aId = await personId(t, "people-mutual-a@example.org");
    const bId = await personId(t, "people-mutual-b@example.org");
    await grantRole(t.db, { conferenceId: draftId, personId: aId, role: "chair" });
    await grantRole(t.db, { conferenceId: draftId, personId: bId, role: "chair" });
    const results = await Promise.all([
      remove({ cookie: a }, bId, "chair", {}, DRAFT),
      remove({ cookie: b }, aId, "chair", {}, DRAFT),
    ]);
    // The second finds, under the lock, that it is no longer a chair.
    expect(results.map((r) => r.status).sort()).toEqual([204, 403]);
    const left = [
      ...(await rolesOf("people-mutual-a@example.org", draftId)),
      ...(await rolesOf("people-mutual-b@example.org", draftId)),
    ];
    expect(left).toEqual([{ role: "chair", scope: [] }]);
  });

  it("removes a track chair, which is all the page offers for that role", async () => {
    const email = s.trackChairEmails[0] as string;
    const id = await personId(t, email);
    const [held] = await rolesOf(email, s.conferenceId);
    expect((await remove({ cookie: chair }, id, "track_chair", {}, slug)).status).toBe(204);
    expect(await rolesOf(email, s.conferenceId)).toEqual([]);
    expect((await listed(chair, slug)).trackChairs.map((x) => x.email)).not.toContain(email);
    const [row] = (await auditRows("role.removed")).filter((r) => r.targetId === id);
    expect(row?.details).toEqual({ role: "track_chair", tracks: held?.scope });
    // Nobody can be invited to it, and nothing else of the kind can be removed.
    expect((await invite({ cookie: chair }, { email, role: "track_chair" }, slug)).status).toBe(
      400,
    );
  });

  it("finds nothing to remove for a role that is not held, a person who is not there, or a role there is not", async () => {
    const stranger = await personId(t, "people-stranger@example.org");
    const aReviewer = (await listed(chair, slug)).reviewers[0];
    const cases: [string, string, unknown][] = [
      [stranger, "chair", {}],
      [stranger, "reviewer", { assignments: 0 }],
      [aReviewer?.personId ?? "", "chair", {}],
      [aReviewer?.personId ?? "", "track_chair", {}],
      ["00000000-0000-4000-8000-000000000000", "reviewer", { assignments: 0 }],
      ["not-an-id", "reviewer", { assignments: 0 }],
      // `admin` is not a role of its own on the page, and a site admin holds no role here.
      [chairId, "admin", {}],
      [chairId, "site_admin", {}],
    ];
    for (const [id, role, body] of cases) {
      const res = await remove({ cookie: chair }, id, role, body, slug);
      expect(res.status, `${id} ${role}`).toBe(404);
      expect(res.json).toEqual({ error: "not_found" });
    }
    // A reviewer of this conference is not one of another: the other's chair finds nobody.
    const res = await remove({ cookie: cookies.chair }, aReviewer?.personId ?? "", "reviewer", {
      assignments: 0,
    });
    expect(res.status).toBe(404);
    // Nothing but the number the confirmation showed is taken.
    const strict = await remove(
      { cookie: chair },
      aReviewer?.personId ?? "",
      "reviewer",
      { assignments: 0, force: true },
      slug,
    );
    expect(strict.status).toBe(400);
  });
});

/*
 * RC-github---amsucf-elochair-43-001. A route checks who is asking before its transaction
 * begins. Here the caller's chair role is removed, by the real removal, at the moment the route
 * opens its transaction: after its own check, before anything it does. Every write that is
 * allowed because the caller chairs the conference reads the chair again in there, under the
 * roles lock, and is refused. The seam is the database handle the app was given: nothing in the
 * routes knows about it.
 */
describe("a chair removed between a route's check and its transaction", () => {
  const INFLIGHT = "people-inflight";
  let inflightId: string;
  let bystanderId: string;
  let n = 0;

  beforeAll(async () => {
    ({ conferenceId: inflightId } = await seedTestCall(t.db, { slug: INFLIGHT, now: NOW }));
    await grantRole(t.db, {
      conferenceId: inflightId,
      personId: await personId(t, "people-chair@example.org"),
      role: "chair",
    });
    await person("people-inflight-bystander@example.org", "Bea Bystander");
    bystanderId = await personId(t, "people-inflight-bystander@example.org");
    await grantRole(t.db, { conferenceId: inflightId, personId: bystanderId, role: "chair" });
  }, 120_000);

  /** A chair of the conference who is about to be removed, signed in. */
  async function victim() {
    n += 1;
    const email = `people-inflight-${n}@example.org`;
    const cookie = await person(email, `Vera Victim ${n}`);
    const id = await personId(t, email);
    await grantRole(t.db, { conferenceId: inflightId, personId: id, role: "chair" });
    return { cookie, id };
  }

  /**
   * Run `request` with the victim removed as a chair the moment the route opens its first
   * transaction. Returns what the route answered, and how many transactions it opened.
   */
  async function removedInBetween<T>(victimId: string, request: () => Promise<T>) {
    const real = t.deps.db;
    const conference = await getConference(real, INFLIGHT);
    const remover = await loadPersonViewer(real, await personId(t, "people-chair@example.org"));
    if (!conference || !remover) throw new Error("no conference or no remover");
    let opened = 0;
    t.deps.db = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "transaction") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          opened += 1;
          if (opened === 1) {
            await removeRole({ ...t.deps, db: real }, remover, conference, {
              personId: victimId,
              role: "chair",
            });
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    try {
      return { answer: await request(), opened };
    } finally {
      t.deps.db = real;
    }
  }

  /** Everything a refused request must leave as it was. */
  const stored = async () => {
    const settings = await call(t.public, "GET", `/api/conferences/${INFLIGHT}/settings`, {
      cookie: cookies.chair,
    });
    const page = await listed(cookies.chair, INFLIGHT);
    return {
      token: settings.json.token as string,
      phase: settings.json.phase as string,
      chairs: page.chairs.map((c) => c.personId).sort(),
      invitations: page.invitations.map((i) => [i.id, i.state, i.sentAt]),
      mail: (await t.db.select().from(outbox).where(eq(outbox.kind, "role_invitation"))).length,
    };
  };
  const audited = async () =>
    (
      await t.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.conferenceId, inflightId))
        .orderBy(auditLog.id)
    ).map((r) => [r.action, r.actorPersonId, r.targetId]);

  type Case = {
    what: string;
    /** What the victim asks for, as a chair, through the route. */
    request: (cookie: string) => Promise<{ status: number; json: { error?: string } }>;
  };
  const at2 = (rest: string) => `/api/conferences/${INFLIGHT}/${rest}`;
  let waitingId = "";
  const cases: Case[] = [
    {
      what: "saving the configuration",
      request: async (cookie) => {
        const got = await call(t.public, "GET", at2("settings"), { cookie });
        const config = structuredClone(got.json.config);
        config.host = "A host nobody was allowed to write";
        return call(t.public, "PUT", at2("config"), {
          cookie,
          ifMatch: got.json.token,
          body: config,
        });
      },
    },
    {
      what: "moving the phase",
      request: (cookie) =>
        call(t.public, "PUT", at2("phase"), {
          cookie,
          body: { phase: "reviewing", from: "cfp_open" },
        }),
    },
    {
      what: "moving the phase back, forced with a reason",
      request: (cookie) =>
        call(t.public, "PUT", at2("phase"), {
          cookie,
          body: { phase: "draft", from: "cfp_open", force: true, reason: "Not mine to move" },
        }),
    },
    {
      what: "inviting someone",
      request: (cookie) =>
        invite(
          { cookie },
          { email: "people-inflight-invitee@example.org", role: "chair" },
          INFLIGHT,
        ),
    },
    {
      what: "sending an invitation again",
      request: (cookie) => resend({ cookie }, waitingId, INFLIGHT),
    },
    {
      what: "cancelling an invitation",
      request: (cookie) => cancel({ cookie }, waitingId, INFLIGHT),
    },
    {
      what: "removing another chair",
      request: (cookie) => remove({ cookie }, bystanderId, "chair", {}, INFLIGHT),
    },
  ];

  it("is refused whatever they asked for, with nothing stored and nothing audited", async () => {
    const sent = await invite(
      { cookie: cookies.chair },
      reviewer("people-inflight-waiting@example.org"),
      INFLIGHT,
    );
    expect(sent.status).toBe(201);
    waitingId = sent.json.id;
    for (const { what, request } of cases) {
      const v = await victim();
      // Before the removal the same request is theirs to make: the route's own check passes.
      expect(
        (await listed(v.cookie, INFLIGHT)).chairs.map((c) => c.personId),
        what,
      ).toContain(v.id);
      const before = { stored: await stored(), audited: await audited() };
      const { answer, opened } = await removedInBetween(v.id, () => request(v.cookie));
      expect(answer.status, what).toBe(403);
      expect(answer.json, what).toEqual({ error: "forbidden" });
      // The route got as far as its transaction: that is where it was refused.
      expect(opened, what).toBeGreaterThanOrEqual(1);
      // All that happened is the removal: nothing of the request was stored or recorded.
      const chairId = await personId(t, "people-chair@example.org");
      expect(await audited(), what).toEqual([...before.audited, ["role.removed", chairId, v.id]]);
      expect(await stored(), what).toEqual({
        ...before.stored,
        chairs: before.stored.chairs.filter((id) => id !== v.id),
      });
    }
    expect(await mailTo("people-inflight-invitee@example.org")).toEqual([]);
    expect((await getConference(t.db, INFLIGHT))?.phase).toBe("cfp_open");
  });

  it("the same requests succeed for a chair who is not removed, through the same seam", async () => {
    // The seam alone refuses nothing: with nobody removed, each request does what it asks.
    const v = await victim();
    const real = t.deps.db;
    let opened = 0;
    t.deps.db = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "transaction") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (...args: unknown[]) => {
          opened += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    try {
      const statuses: Record<string, number> = {};
      for (const { what, request } of cases) {
        if (what.startsWith("moving the phase")) continue;
        statuses[what] = (await request(v.cookie)).status;
      }
      // (Sending again is within the hour: refused by its limit, after the chair was read.)
      expect(statuses).toEqual({
        "saving the configuration": 200,
        "inviting someone": 201,
        "sending an invitation again": 429,
        "cancelling an invitation": 204,
        "removing another chair": 204,
      });
      expect(opened).toBeGreaterThanOrEqual(5);
      // The phase last: there and back, which leaves the call open as the tests above found it.
      const there = await call(t.public, "PUT", at2("phase"), {
        cookie: v.cookie,
        body: { phase: "draft", from: "cfp_open" },
      });
      const back = await call(t.public, "PUT", at2("phase"), {
        cookie: v.cookie,
        body: { phase: "cfp_open", from: "draft" },
      });
      expect([there.status, back.status]).toEqual([200, 200]);
    } finally {
      t.deps.db = real;
    }
  });

  it("a site admin, who holds no role to remove, is read again like anyone and still passes", async () => {
    const email = "people-inflight-site-admin@example.org";
    const cookie = await person(email, "Sasha Siteadmin");
    await t.db.update(people).set({ siteAdmin: true }).where(eq(people.email, email));
    const moved = await call(t.public, "PUT", at2("phase"), {
      cookie,
      body: { phase: "draft", from: "cfp_open" },
    });
    expect(moved.status).toBe(200);
    // The flag is read inside the transaction too: taken away after the route's check and
    // before the transaction begins, the request is refused.
    const real = t.deps.db;
    let opened = 0;
    t.deps.db = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "transaction") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          opened += 1;
          if (opened === 1) {
            await real.update(people).set({ siteAdmin: false }).where(eq(people.email, email));
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    try {
      const refused = await call(t.public, "PUT", at2("phase"), {
        cookie,
        body: { phase: "cfp_open", from: "draft" },
      });
      expect(refused.status).toBe(403);
      expect((await getConference(real, INFLIGHT))?.phase).toBe("draft");
    } finally {
      t.deps.db = real;
    }
    // Put back by a chair, for whoever reads this conference next.
    const back = await call(t.public, "PUT", at2("phase"), {
      cookie: cookies.chair,
      body: { phase: "cfp_open", from: "draft" },
    });
    expect(back.status).toBe(200);
  });
});

describe("the audit log", () => {
  it("has one row for each invitation sent, sent again, cancelled, accepted and declined, and each role removed", async () => {
    const email = "people-audited@example.org";
    const start = (await t.db.select().from(auditLog)).length;
    const sent = await invite(
      { cookie: cookies.chair },
      reviewer(email, { pools: [POOL_A, POOL_B], name: "Audra Typedname" }),
    );
    const id = sent.json.id as string;
    t.setNow(new Date(NOW.getTime() + 61 * 60_000));
    let chair: string;
    try {
      chair = await signIn(t, "people-chair@example.org");
      expect((await resend({ cookie: chair }, id)).status).toBe(204);
      expect((await accept(await roleToken(email), { displayName: "Audra Real" })).status).toBe(
        200,
      );
      secrets.push("Audra Real");
      const pid = await personId(t, email);
      expect((await remove({ cookie: chair }, pid, "reviewer", { assignments: 0 })).status).toBe(
        204,
      );
      const second = await invite({ cookie: chair }, { email, role: "chair" });
      expect((await answer({ token: await roleToken(email), answer: "decline" })).status).toBe(200);
      // Another address, so that the first stays within its three emails a day.
      const other = "people-audited-two@example.org";
      const third = await invite({ cookie: chair }, { email: other, role: "chair" });
      expect(third.status).toBe(201);
      expect((await cancel({ cookie: chair }, third.json.id)).status).toBe(204);
      const otherRecord = { personId: await personId(t, other), role: "chair", pools: [] };

      const chairId = await personId(t, "people-chair@example.org");
      const rows = (await t.db.select().from(auditLog).orderBy(auditLog.id))
        .slice(start)
        .filter((r) => r.action.startsWith("role"));
      const reviewerRecord = { personId: pid, role: "reviewer", pools: [POOL_A, POOL_B] };
      const chairRecord = { personId: pid, role: "chair", pools: [] };
      expect(
        rows.map((r) => [r.action, r.actorPersonId, r.targetType, r.targetId, r.details]),
      ).toEqual([
        ["role_invitation.sent", chairId, "role_invitation", id, reviewerRecord],
        ["role_invitation.resent", chairId, "role_invitation", id, reviewerRecord],
        ["role_invitation.accepted", pid, "role_invitation", id, reviewerRecord],
        [
          "role.removed",
          chairId,
          "person",
          pid,
          { role: "reviewer", pools: [POOL_A, POOL_B], assignments: 0 },
        ],
        ["role_invitation.sent", chairId, "role_invitation", second.json.id, chairRecord],
        ["role_invitation.declined", pid, "role_invitation", second.json.id, chairRecord],
        ["role_invitation.sent", chairId, "role_invitation", third.json.id, otherRecord],
        [
          "role_invitation.cancelled",
          chairId,
          "role_invitation",
          third.json.id,
          { ...otherRecord, state: "waiting" },
        ],
      ]);
      for (const r of rows) expect(r.conferenceId).toBe(conferenceId);
    } finally {
      t.setNow(NOW);
    }
  });

  it("never holds an address, a name or a link's token written during these flows", async () => {
    const rows = await t.db.select().from(auditLog);
    expect(rows.length).toBeGreaterThan(60);
    const tokens = mailbox()
      .sent.map((m) => tokenIn(m.text))
      .filter((x): x is string => Boolean(x));
    expect(tokens.length).toBeGreaterThan(20);
    expect(
      findLeaks(rows, [
        ...secrets.filter((x) => x.length > 6),
        ...tokens,
        ...tokens.map(hashToken),
      ]),
    ).toEqual([]);
  });
});

/*
 * The in-memory database runs one transaction at a time. Against a real Postgres
 * (TEST_DATABASE_URL, as for settings-locks.test.ts), requests really do run at once. Run this
 * file on its own: mail waits in a table of that database, and two test files sharing it would
 * deliver each other's.
 *
 *   docker run --rm -d --name elochair-people -e POSTGRES_PASSWORD=people \
 *     -p 127.0.0.1:55433:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:people@127.0.0.1:55433/postgres \
 *     npx vitest run apps/server/src/people.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "on Postgres, requests made at the same moment",
  () => {
    let pg: TestApp;
    const run = Date.now();
    const slugA = `people-pg-a-${run}`;
    const slugB = `people-pg-b-${run}`;
    let idA: string;
    const chairs: string[] = [];
    const mail = (who: string) => `people-pg-${run}-${who}@example.org`;
    const pgInvite = (cookie: string, slug: string, body: Record<string, unknown>) =>
      call(pg.public, "POST", at("/invitations", slug), { cookie, body: { lang: "en", ...body } });
    const pgToken = async (email: string) => {
      await call(pg.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
      const text = (pg.deps.mail as MemoryTransport).sent
        .filter((m) => m.to === email)
        .at(-1)?.text;
      return tokenIn(text ?? "") ?? "";
    };

    beforeAll(async () => {
      pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
      pg.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
      pg.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
      pg.deps.limits.invitationLinksPerIp = new RateLimiter(100_000, 60_000);
      ({ conferenceId: idA } = await seedTestCall(pg.db, { slug: slugA, now: NOW }));
      const { conferenceId: idB } = await seedTestCall(pg.db, { slug: slugB, now: NOW });
      for (let i = 0; i < 6; i++) {
        const cookie = await signIn(pg, mail(`chair-${i}`));
        chairs.push(cookie);
        const id = await personId(pg, mail(`chair-${i}`));
        await grantRole(pg.db, { conferenceId: idA, personId: id, role: "chair" });
        await grantRole(pg.db, { conferenceId: idB, personId: id, role: "chair" });
      }
    }, 120_000);
    afterAll(() => pg?.close());

    it("six chairs inviting one address to one role: one invitation, one email", async () => {
      const email = mail("same");
      const results = await Promise.all(
        chairs.map((cookie) => pgInvite(cookie, slugA, { email, role: "chair" })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
      const rows = await pg.db
        .select()
        .from(roleInvitations)
        .where(eq(roleInvitations.invitedEmail, email));
      expect(rows).toHaveLength(1);
      expect(await pg.db.select().from(outbox).where(eq(outbox.toEmail, email))).toHaveLength(1);
    });

    it("four invitations to one address at once: three are sent, the day's limit holds", async () => {
      const email = mail("limited");
      const results = await Promise.all([
        pgInvite(chairs[0] as string, slugA, { email, role: "chair" }),
        pgInvite(chairs[1] as string, slugA, { email, role: "reviewer", pools: [POOL_A] }),
        pgInvite(chairs[2] as string, slugB, { email, role: "chair" }),
        pgInvite(chairs[3] as string, slugB, { email, role: "reviewer", pools: [POOL_A] }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 429]);
      const [p] = await pg.db.select().from(people).where(eq(people.email, email));
      const sends = await pg.db
        .select()
        .from(roleInvitationSends)
        .where(eq(roleInvitationSends.recipientPersonId, p?.id ?? ""));
      expect(sends).toHaveLength(3);
    });

    it("one link answered five times at once gives the role once", async () => {
      const email = mail("accepts");
      expect(
        (await pgInvite(chairs[0] as string, slugA, { email, role: "reviewer", pools: [POOL_A] }))
          .status,
      ).toBe(201);
      const token = await pgToken(email);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(pg.public, "POST", "/api/role-invitations/answer", {
            body: { token, answer: "accept", displayName: "Pat Postgres", languages: ["en"] },
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400]);
      const [p] = await pg.db.select().from(people).where(eq(people.email, email));
      expect(
        await pg.db
          .select()
          .from(conferenceRoles)
          .where(eq(conferenceRoles.personId, p?.id ?? "")),
      ).toHaveLength(1);
      const accepted = (
        await pg.db.select().from(auditLog).where(eq(auditLog.action, "role_invitation.accepted"))
      ).filter((r) => (r.details as { personId: string }).personId === p?.id);
      expect(accepted).toHaveLength(1);
    });

    it("a chair removed while their invitation waits for a lock: it was sent before the removal, not after", async () => {
      // The invitation is made to wait inside its transaction, on the lock that counts the
      // chair's emails of the day, which this test holds. Another chair removes them meanwhile.
      // The removal has to wait for the invitation, which was begun by someone who was a chair.
      const inviterId = await personId(pg, mail("chair-3"));
      await grantRole(pg.db, { conferenceId: idA, personId: inviterId, role: "chair" });
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = pg.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`role_invitations:inviter:${inviterId}`}::text, 0))`,
        );
        locked();
        await held;
      });
      await isLocked;
      const invited = pgInvite(chairs[3] as string, slugA, { email: mail("late"), role: "chair" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const removed = call(pg.public, "DELETE", at(`/${inviterId}/roles/chair`, slugA), {
        cookie: chairs[0],
        body: {},
      });
      // Neither is done: the invitation waits for the test, the removal for the invitation.
      const first = await Promise.race([
        invited.then(() => "invited"),
        removed.then(() => "removed"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 500)),
      ]);
      expect(first).toBe("waiting");
      release();
      await holder;
      expect((await invited).status).toBe(201);
      expect((await removed).status).toBe(204);
      const rows = (await pg.db.select().from(auditLog).orderBy(auditLog.id)).filter(
        (r) =>
          (r.action === "role_invitation.sent" && r.actorPersonId === inviterId) ||
          (r.action === "role.removed" && r.targetId === inviterId),
      );
      expect(rows.map((r) => r.action).slice(-2)).toEqual(["role_invitation.sent", "role.removed"]);
    });

    it("two chairs removing each other at once: one is removed, and the conference keeps a chair", async () => {
      const a = await personId(pg, mail("chair-4"));
      const b = await personId(pg, mail("chair-5"));
      for (let round = 0; round < 5; round++) {
        await grantRole(pg.db, { conferenceId: idA, personId: a, role: "chair" });
        await grantRole(pg.db, { conferenceId: idA, personId: b, role: "chair" });
        const results = await Promise.all([
          call(pg.public, "DELETE", at(`/${b}/roles/chair`, slugA), {
            cookie: chairs[4],
            body: {},
          }),
          call(pg.public, "DELETE", at(`/${a}/roles/chair`, slugA), {
            cookie: chairs[5],
            body: {},
          }),
        ]);
        expect(results.map((r) => r.status).sort(), `round ${round}`).toEqual([204, 403]);
        const left = await pg.db
          .select()
          .from(conferenceRoles)
          .where(
            and(eq(conferenceRoles.conferenceId, idA), inArray(conferenceRoles.personId, [a, b])),
          );
        expect(left, `round ${round}`).toHaveLength(1);
      }
    });

    /*
     * RC-github---amsucf-elochair-43-001: a chair's removal against the two writes that are a
     * chair's and are not on the People page, the configuration save and the phase move. The
     * rule: once the removal has committed, nothing that person began as a chair commits
     * afterwards. Each is first made to happen in a known order, by holding a lock the first of
     * the two needs; then they are let loose on each other.
     */
    describe("a chair's removal, against a configuration save and a phase move", () => {
      const slugC = `people-pg-c-${run}`;
      let idC: string;
      let remover: string;
      let victim: string;
      let victimId: string;
      const within = <T>(p: Promise<T>, ms: number): Promise<T | "waiting"> =>
        Promise.race([p, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);
      /** Hold locks in a transaction of its own until `release()`. */
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
      const conf = (rest: string) => `/api/conferences/${slugC}/${rest}`;
      const again = () =>
        grantRole(pg.db, { conferenceId: idC, personId: victimId, role: "chair" });
      const removing = () =>
        call(pg.public, "DELETE", at(`/${victimId}/roles/chair`, slugC), {
          cookie: remover,
          body: {},
        });
      const state = async () => {
        const got = await call(pg.public, "GET", conf("settings"), { cookie: remover });
        return { token: got.json.token as string, phase: got.json.phase as string };
      };
      /** The last audit row of an action in this conference, by its id: the order things ran in. */
      const lastAudit = async (action: string) =>
        (
          await pg.db
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(and(eq(auditLog.conferenceId, idC), eq(auditLog.action, action)))
            .orderBy(auditLog.id)
        ).at(-1)?.id ?? 0;

      type Write = {
        what: string;
        audited: string;
        /** The request, made ready while the victim is still a chair, to send when told. */
        ready: (label: string) => Promise<() => Promise<{ status: number }>>;
      };
      const writes: Write[] = [
        {
          what: "a configuration save",
          audited: "conference.config_updated",
          ready: async (label) => {
            const got = await call(pg.public, "GET", conf("settings"), { cookie: victim });
            const config = structuredClone(got.json.config);
            config.host = `Universidad Inventada ${label}`;
            return () =>
              call(pg.public, "PUT", conf("config"), {
                cookie: victim,
                ifMatch: got.json.token,
                body: config,
              });
          },
        },
        {
          what: "a phase move",
          audited: "conference.phase_changed",
          ready: async () => {
            const { phase } = await state();
            const to = phase === "cfp_open" ? "draft" : "cfp_open";
            return () =>
              call(pg.public, "PUT", conf("phase"), {
                cookie: victim,
                body: { phase: to, from: phase },
              });
          },
        },
      ];

      beforeAll(async () => {
        ({ conferenceId: idC } = await seedTestCall(pg.db, { slug: slugC, now: NOW }));
        remover = chairs[0] as string;
        await grantRole(pg.db, {
          conferenceId: idC,
          personId: await personId(pg, mail("chair-0")),
          role: "chair",
        });
        victim = await signIn(pg, mail("victim"));
        victimId = await personId(pg, mail("victim"));
      }, 120_000);

      for (const write of writes) {
        it(`${write.what} begun first commits, and the removal waits for it`, async () => {
          for (let i = 0; i < 4; i++) {
            await again();
            const before = await state();
            const send = await write.ready(`A${i}`);
            // The write is stopped at the conference's row, which this test holds: it has
            // been let through as a chair's and has not committed.
            const holder = hold((tx) => lockConference(tx, idC));
            await holder.ready;
            const writing = send();
            let released = false;
            try {
              expect(await within(writing, 300), `round ${i}: the write`).toBe("waiting");
              const removal = removing();
              // The removal cannot commit before it: it waits for the roles lock.
              expect(await within(removal, 500), `round ${i}: the removal`).toBe("waiting");
              await holder.release();
              released = true;
              expect((await writing).status, `round ${i}`).toBe(200);
              expect((await removal).status, `round ${i}`).toBe(204);
            } finally {
              if (!released) await holder.release();
            }
            // Stored, and recorded before the removal was.
            const after = await state();
            expect(after, `round ${i}`).not.toEqual(before);
            expect(await lastAudit(write.audited), `round ${i}`).toBeLessThan(
              await lastAudit("role.removed"),
            );
          }
        }, 120_000);

        it(`${write.what} begun while the removal is under way is refused once it commits`, async () => {
          for (let i = 0; i < 4; i++) {
            await again();
            const before = await state();
            const recorded = await lastAudit(write.audited);
            const send = await write.ready(`B${i}`);
            // The removal is stopped at the role's row, which this test holds: it has the
            // roles lock and has not committed, so the victim still reads as a chair.
            const holder = hold((tx) =>
              tx
                .select()
                .from(conferenceRoles)
                .where(
                  and(
                    eq(conferenceRoles.conferenceId, idC),
                    eq(conferenceRoles.personId, victimId),
                  ),
                )
                .for("update"),
            );
            await holder.ready;
            const removal = removing();
            let released = false;
            try {
              expect(await within(removal, 300), `round ${i}: the removal`).toBe("waiting");
              const writing = send();
              // The route's own check lets it in; inside, it waits for the removal.
              expect(await within(writing, 500), `round ${i}: the write`).toBe("waiting");
              await holder.release();
              released = true;
              expect((await removal).status, `round ${i}`).toBe(204);
              const refused = await writing;
              expect(refused.status, `round ${i}`).toBe(403);
            } finally {
              if (!released) await holder.release();
            }
            // Nothing of it was stored or recorded.
            expect(await state(), `round ${i}`).toEqual(before);
            expect(await lastAudit(write.audited), `round ${i}`).toBe(recorded);
          }
        }, 120_000);

        it(`${write.what} and the removal let loose on each other: never the write after the removal, never a deadlock`, async () => {
          const outcomes: Record<string, number> = {};
          for (let i = 0; i < 30; i++) {
            await again();
            const before = await state();
            const recorded = await lastAudit(write.audited);
            const send = await write.ready(`C${i}`);
            // Now one first, now the other, a moment apart or none.
            const pause = () => new Promise((r) => setTimeout(r, i % 3));
            const both =
              i % 2 === 0
                ? (async () => {
                    const w = send();
                    await pause();
                    return [await w, await removing()] as const;
                  })()
                : (async () => {
                    const r = removing();
                    await pause();
                    const w = send();
                    return [await w, await r] as const;
                  })();
            const done = await within(both, 20_000);
            if (done === "waiting") throw new Error(`round ${i}: still waiting: a deadlock`);
            const [written, removed] = done;
            expect(removed.status, `round ${i}`).toBe(204);
            expect([200, 403], `round ${i}`).toContain(written.status);
            outcomes[String(written.status)] = (outcomes[String(written.status)] ?? 0) + 1;
            if (written.status === 200) {
              // It committed as a chair's: before the removal did.
              expect(await lastAudit(write.audited), `round ${i}`).toBeGreaterThan(recorded);
              expect(await lastAudit(write.audited), `round ${i}`).toBeLessThan(
                await lastAudit("role.removed"),
              );
            } else {
              expect(await state(), `round ${i}`).toEqual(before);
              expect(await lastAudit(write.audited), `round ${i}`).toBe(recorded);
            }
          }
          // Both things happened among the thirty: the race was a race.
          expect(Object.keys(outcomes).sort(), JSON.stringify(outcomes)).toEqual(["200", "403"]);
        }, 120_000);
      }

      it("saves, phase moves, writes to a proposal, invitations, answers and removals all at once: everything finishes", async () => {
        // One lock order everywhere (services/roles.ts): whatever runs beside whatever, nothing
        // waits for the one that waits for it. A deadlock would end a request with an error.
        const slugD = `people-pg-d-${run}`;
        const { conferenceId: idD } = await seedTestCall(pg.db, { slug: slugD, now: NOW });
        const on = (rest: string) => `/api/conferences/${slugD}/${rest}`;
        // Two chairs who stay, and four who are removed while they are at work.
        const stay: { cookie: string; id: string }[] = [];
        const go: { cookie: string; id: string }[] = [];
        for (let i = 0; i <= 5; i++) {
          const id = await personId(pg, mail(`chair-${i}`));
          (i === 0 || i === 5 ? stay : go).push({ cookie: chairs[i] as string, id });
        }
        for (const chair of stay) {
          await grantRole(pg.db, { conferenceId: idD, personId: chair.id, role: "chair" });
        }
        const owner = await signIn(pg, mail("d-owner"));
        const draft = await call(pg.public, "POST", on("submissions"), {
          cookie: owner,
          body: { typeKey: "talk", language: "en", participationMode: "in_person" },
        });
        expect(draft.status).toBe(201);
        const moving = (cookie: string, to: string) =>
          call(pg.public, "PUT", on("phase"), { cookie, body: { phase: to } });

        for (let round = 0; round < 5; round++) {
          for (const chair of go) {
            await grantRole(pg.db, { conferenceId: idD, personId: chair.id, role: "chair" });
          }
          // The call is open at the start of each round: a proposal can be written to.
          await moving(remover, "cfp_open");
          const current = await call(pg.public, "GET", `/api/submissions/${draft.json.id}`, {
            cookie: owner,
          });
          // Invitations waiting for an answer.
          const tokens: string[] = [];
          const waiting: string[] = [];
          for (let i = 0; i < 8; i++) {
            const email = mail(`d-invitee-${round}-${i}`);
            const sent = await pgInvite(remover, slugD, {
              email,
              role: "reviewer",
              pools: [POOL_A],
            });
            expect(sent.status, `round ${round}`).toBe(201);
            waiting.push(sent.json.id);
            tokens.push(await pgToken(email));
          }
          const settings = await call(pg.public, "GET", on("settings"), { cookie: remover });
          const saving = (cookie: string, host: string) => {
            const config = structuredClone(settings.json.config);
            config.host = host;
            return call(pg.public, "PUT", on("config"), {
              cookie,
              ifMatch: settings.json.token,
              body: config,
            });
          };
          const requests: Promise<{ status: number }>[] = [];
          // Answers by link: six accepted or declined, two cancelled by a chair meanwhile.
          for (const [i, token] of tokens.entries()) {
            requests.push(
              i < 6
                ? call(pg.public, "POST", "/api/role-invitations/answer", {
                    body: {
                      token,
                      answer: i % 3 === 2 ? "decline" : "accept",
                      displayName: "Dee Postgres",
                      languages: ["en"],
                    },
                  })
                : call(pg.public, "POST", at(`/invitations/${waiting[i]}/cancel`, slugD), {
                    cookie: remover,
                    body: {},
                  }),
            );
          }
          // The chairs who stay save, move the phase and invite, several times over.
          for (const [i, chair] of stay.entries()) {
            for (let n = 0; n < 3; n++) {
              requests.push(
                saving(chair.cookie, `Universidad Inventada ${round}.${i}.${n}`),
                moving(chair.cookie, (i + n) % 2 ? "draft" : "cfp_open"),
                pgInvite(chair.cookie, slugD, {
                  email: mail(`d-late-${round}-${i}-${n}`),
                  role: "chair",
                }),
              );
            }
          }
          // The chairs who go do the same, and are removed while they do; a proposal is edited.
          for (const [i, chair] of go.entries()) {
            requests.push(
              saving(chair.cookie, `Universidad Inventada de Paso ${round}.${i}`),
              moving(chair.cookie, i % 2 ? "draft" : "cfp_open"),
              pgInvite(chair.cookie, slugD, { email: mail(`d-gone-${round}-${i}`), role: "chair" }),
              call(pg.public, "DELETE", at(`/${chair.id}/roles/chair`, slugD), {
                cookie: remover,
                body: {},
              }),
              call(pg.public, "PATCH", `/api/submissions/${draft.json.id}`, {
                cookie: owner,
                body: { version: current.json.version, title: `A busy talk ${round}.${i}` },
              }),
            );
          }
          const all = await within(Promise.all(requests), 30_000);
          if (all === "waiting") throw new Error(`round ${round}: still waiting: a deadlock`);
          expect(all, `round ${round}`).toHaveLength(8 + 18 + 20);
          // Each was done, or refused for a reason of its own (removed meanwhile, a stale version
          // or token, a closed call). A deadlock would end one with an error (500) instead.
          expect(
            all.map((r) => r.status).filter((x) => x >= 500),
            `round ${round}`,
          ).toEqual([]);
          // The answers by link were all taken, and the chairs who stay did get things done.
          expect(
            all.slice(0, 6).map((r) => r.status),
            `round ${round}`,
          ).toEqual([200, 200, 200, 200, 200, 200]);
          expect(
            all.slice(8, 26).filter((r) => r.status === 200 || r.status === 201).length,
            `round ${round}`,
          ).toBeGreaterThan(6);
          // The chairs who were removed are removed, and those who stay are still there.
          const left = await pg.db
            .select()
            .from(conferenceRoles)
            .where(and(eq(conferenceRoles.conferenceId, idD), eq(conferenceRoles.role, "chair")));
          expect(left.map((r) => r.personId).sort(), `round ${round}`).toEqual(
            stay.map((x) => x.id).sort(),
          );
        }
      }, 120_000);
    });
  },
);
