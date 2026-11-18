import { findLeaks } from "@elochair/policy/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agreementAcks,
  auditLog,
  contributions,
  invitationSends,
  outbox,
  people,
} from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import type { MemoryTransport } from "./mail";
import { RateLimiter } from "./ratelimit";
import { createApiToken, grantRole } from "./repo";
import { call, makeTestApp, ORIGIN, personId, signIn, type TestApp } from "./testkit";

/*
 * Review fixes, round 3: invitation limits and their audit, answering invitations (agents,
 * withdrawn work, names), contributor order, unknown fields, and what mail carries.
 */

let t: TestApp;
let slug: string;
let conferenceId: string;
const NOW = new Date("2027-02-01T12:00:00Z");
const words = (n: number, w = "verse") => Array.from({ length: n }, () => w).join(" ");
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
/** Markers that must never appear in the audit log. */
const secrets: string[] = [];

type Sub = { id: string; version: number };

async function person(email: string, name: string | null, languages = ["en"]) {
  const cookie = await signIn(t, email);
  if (name !== null) {
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
    secrets.push(name);
  }
  secrets.push(email);
  return cookie;
}

async function draft(cookie: string, typeKey = "talk"): Promise<Sub> {
  const res = await call(t.public, "POST", `/api/conferences/${slug}/submissions`, {
    cookie,
    body: { typeKey, language: "en", participationMode: "in_person" },
  });
  expect(res.status).toBe(201);
  return res.json;
}

async function fill(cookie: string, s: Sub, title: string): Promise<Sub> {
  secrets.push(title);
  const res = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
    cookie,
    body: { version: s.version, title, abstract: words(260) },
  });
  expect(res.status).toBe(200);
  return res.json;
}

const invite = (
  cookie: string,
  s: Sub,
  email: string,
  more: { name?: string; lang?: "en" | "es" | "pt"; role?: string } = {},
) =>
  call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
    cookie,
    body: {
      version: s.version,
      email,
      role: more.role ?? "coauthor",
      lang: more.lang ?? "en",
      ...(more.name ? { name: more.name } : {}),
    },
  });

async function submitted(cookie: string, s: Sub): Promise<Sub> {
  const res = await call(t.public, "POST", `/api/submissions/${s.id}/submit`, {
    cookie,
    body: { version: s.version, acceptedAgreements: AGREEMENTS },
  });
  expect(res.status).toBe(200);
  return res.json.submission;
}

const mailbox = () => t.deps.mail as MemoryTransport;
/** Every message delivered to an address so far (flushing the outbox first). */
async function mailTo(email: string) {
  await call(t.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return mailbox().sent.filter((m) => m.to === email);
}
/** The link token of the latest invitation email to an address. */
async function inviteToken(email: string): Promise<string> {
  const tokenIn = (text: string) => /#token=(inv_[A-Za-z0-9_-]+)/.exec(text)?.[1];
  const token = (await mailTo(email))
    .map((m) => tokenIn(m.text))
    .filter(Boolean)
    .at(-1);
  if (!token) throw new Error(`no invitation token for ${email}`);
  return token;
}
const auditRows = (action: string) =>
  t.db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(auditLog.id);
const get = (cookie: string, s: Sub) =>
  call(t.public, "GET", `/api/submissions/${s.id}`, { cookie });

beforeAll(async () => {
  t = await makeTestApp();
  ({ slug, conferenceId } = await seedTestCall(t.db, { now: NOW }));
  // These flows write a lot from one account, and sign many people in from one address; the
  // per-minute write limit has its own test here, and the sign-in limits theirs in auth.test.ts.
  t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
}, 120_000);
afterAll(() => t.close());

describe("invitation limits count every email sent (#1 #14 #21)", () => {
  it("removing the invitee or deleting the draft never gives an address's budget back", async () => {
    const owner = await person("loop-owner@example.org", "Lou Looper");
    let s = await draft(owner);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const inv = await invite(owner, s, "victim@example.org", { name: "Vic Tim" });
      statuses.push(inv.status);
      const victim = await personId(t, "victim@example.org");
      const removed = await call(
        t.public,
        "DELETE",
        `/api/submissions/${s.id}/contributors/${victim}`,
        { cookie: owner, body: { version: inv.json.version } },
      );
      expect(removed.status).toBe(200);
      s = removed.json;
    }
    // Two more, each on a draft that is then deleted (which cascades to its contributions).
    for (let i = 0; i < 2; i++) {
      const d = await draft(owner);
      const inv = await invite(owner, d, "victim@example.org");
      statuses.push(inv.status);
      const del = await call(t.public, "DELETE", `/api/submissions/${d.id}`, {
        cookie: owner,
        body: { version: inv.json.version },
      });
      expect(del.status).toBe(204);
    }
    // The sixth email of the day to that address is refused, from this owner or any other.
    statuses.push((await invite(owner, s, "victim@example.org")).status);
    const other = await person("loop-other@example.org", "Otto Other");
    statuses.push((await invite(other, await draft(other), "VICTIM@Example.org")).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
    const invitations = (await mailTo("victim@example.org")).filter((m) =>
      /confirm your participation/.test(m.subject),
    );
    expect(invitations).toHaveLength(5);

    // The refusals are audited (outside the rolled-back transaction), with IDs only.
    const victim = await personId(t, "victim@example.org");
    const rows = await auditRows("contributor.invite_rate_limited");
    expect(rows.filter((r) => r.targetId === s.id)).toHaveLength(1);
    expect(rows.map((r) => r.details)).toContainEqual({
      limit: "per_recipient",
      personId: victim,
    });
    expect(findLeaks(rows, ["victim@example.org"])).toEqual([]);

    // A day later the address can be invited again.
    t.setNow(new Date(NOW.getTime() + 25 * 60 * 60 * 1000));
    try {
      const again = await signIn(t, "loop-owner@example.org");
      expect((await invite(again, s, "victim@example.org")).status).toBe(201);
    } finally {
      t.setNow(NOW);
    }
  });

  it("an owner may send 20 invitations a day, however many they remove", async () => {
    const owner = await person("busy-owner@example.org", "Bea Busy");
    let s = await draft(owner);
    for (let i = 0; i < 20; i++) {
      const email = `busy-${i}@example.org`;
      const inv = await invite(owner, s, email);
      expect(inv.status).toBe(201);
      const removed = await call(
        t.public,
        "DELETE",
        `/api/submissions/${s.id}/contributors/${await personId(t, email)}`,
        { cookie: owner, body: { version: inv.json.version } },
      );
      s = removed.json;
    }
    const refused = await invite(owner, s, "busy-20@example.org");
    expect(refused.status).toBe(429);
    expect(refused.json).toEqual({ error: "rate_limited" });
    const rows = (await auditRows("contributor.invite_rate_limited")).filter(
      (r) => r.targetId === s.id,
    );
    // busy-20 was never invited, so no person row was created for it: no personId either.
    expect(rows.map((r) => r.details)).toEqual([{ limit: "per_owner" }]);
    expect(await t.db.select().from(people).where(eq(people.email, "busy-20@example.org"))).toEqual(
      [],
    );
  });

  it("resends count toward the daily limits, and every resend refusal is audited", async () => {
    const owner = await person("resend-owner@example.org", "Rae Resender");
    const s = await draft(owner);
    const inv = await invite(owner, s, "resent@example.org");
    expect(inv.status).toBe(201);
    const target = await personId(t, "resent@example.org");
    const resend = () =>
      call(t.public, "POST", `/api/submissions/${s.id}/contributors/${target}/resend`, {
        cookie: owner,
        body: { version: inv.json.version },
      });
    expect((await resend()).status).toBe(429); // once an hour per invitation
    const statuses: number[] = [];
    try {
      for (let hour = 1; hour <= 5; hour++) {
        t.setNow(new Date(NOW.getTime() + hour * 61 * 60 * 1000));
        statuses.push((await resend()).status);
      }
    } finally {
      t.setNow(NOW);
    }
    // The invitation plus four resends make five emails to the address that day.
    expect(statuses).toEqual([204, 204, 204, 204, 429]);
    const sends = await t.db
      .select()
      .from(invitationSends)
      .where(eq(invitationSends.recipientPersonId, target));
    expect(sends.map((x) => x.kind).sort()).toEqual([
      "invite",
      "resend",
      "resend",
      "resend",
      "resend",
    ]);
    const rows = (await auditRows("contributor.resend_rate_limited")).filter(
      (r) => r.targetId === s.id,
    );
    expect(rows.map((r) => r.details)).toEqual([
      { personId: target, limit: "per_invitation_hourly" },
      { personId: target, limit: "per_recipient" },
    ]);
  });
});

describe("other limits are audited too (#9 #17 #25)", () => {
  it("the per-person write limit: refused with 429, audited once per window", async () => {
    const cookie = await person("hasty@example.org", "Hal Hasty");
    const s = await draft(cookie);
    const pid = await personId(t, "hasty@example.org");
    const saved = t.deps.limits.writesPerPerson;
    t.deps.limits.writesPerPerson = new RateLimiter(2, 60_000);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
          cookie,
          body: { version: s.version + i, title: `Try ${i}` },
        });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 429, 429, 429]);
      await vi.waitFor(async () => {
        const rows = (await auditRows("person.rate_limited")).filter(
          (r) => r.actorPersonId === pid,
        );
        expect(rows.map((r) => r.details)).toEqual([
          { limit: "writes_per_person", method: "PATCH", route: "/api/submissions/:id" },
        ]);
      });
    } finally {
      t.deps.limits.writesPerPerson = saved;
    }
  });

  it("the per-IP limit on invitation links: refused with 429, audited once per window", async () => {
    const saved = t.deps.limits.invitationLinksPerIp;
    t.deps.limits.invitationLinksPerIp = new RateLimiter(1, 60_000);
    const before = (await auditRows("invitation.rate_limited")).length;
    try {
      const token = "inv_doesnotexist_doesnotexist";
      const first = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
      expect(first.status).toBe(400);
      const second = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
      expect(second.status).toBe(429);
      const third = await call(t.public, "POST", "/api/invitations/answer", {
        body: { token, answer: "decline" },
      });
      expect(third.status).toBe(429);
      const rows = await auditRows("invitation.rate_limited");
      expect(rows.slice(before).map((r) => [r.actorKind, r.details])).toEqual([
        ["system", { limit: "invitation_links_per_ip", endpoint: "info" }],
      ]);
    } finally {
      t.deps.limits.invitationLinksPerIp = saved;
    }
  });
});

describe("answering invitations", () => {
  it("agents can neither read nor answer invitations by link (#4)", async () => {
    const chair = await person("inv-chair@example.org", "Cha Irwoman");
    const chairId = await personId(t, "inv-chair@example.org");
    await grantRole(t.db, { conferenceId, personId: chairId, role: "chair" });
    const s = await fill(chair, await draft(chair), "AGENT-TITLE-MARKER for the agents test");
    await invite(chair, s, "agent-target@example.org", { name: "Ag Target" });
    const token = await inviteToken("agent-target@example.org");
    const m = await createApiToken(t.db, { personId: chairId, conferenceId, tier: "M", name: "m" });
    const c = await createApiToken(t.db, { personId: chairId, conferenceId, tier: "C", name: "c" });

    const info = await call(t.public, "POST", "/api/invitations/info", {
      token: m.token,
      body: { token },
    });
    expect(info.status).toBe(403);
    expect(info.json).toEqual({ error: "agents_read_only" });
    const answer = await call(t.internal, "POST", "/api/invitations/answer", {
      token: c.token,
      body: { token, answer: "confirm", acceptedAgreements: AGREEMENTS, displayName: "X" },
    });
    expect(answer.status).toBe(403);
    expect(answer.json).toEqual({ error: "agents_read_only" });
    const inApp = await call(t.internal, "POST", `/api/me/invitations/${s.id}/answer`, {
      token: c.token,
      body: { answer: "decline" },
    });
    expect(inApp.status).toBe(403);

    // Nothing happened: the invitation is still pending and nobody consented to anything.
    const target = await personId(t, "agent-target@example.org");
    const [row] = await t.db
      .select()
      .from(contributions)
      .where(and(eq(contributions.submissionId, s.id), eq(contributions.personId, target)));
    expect(row?.status).toBe("invited");
    expect(
      await t.db.select().from(agreementAcks).where(eq(agreementAcks.personId, target)),
    ).toEqual([]);
    const stillValid = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
    expect(stillValid.status).toBe(200);
  });

  it("missing and not-yours both answer 404; already_answered is for your own row (#12)", async () => {
    const owner = await person("probe-owner@example.org", "Pro Beowner");
    let s = await draft(owner);
    const inv = await invite(owner, s, "probe-invitee@example.org");
    s = inv.json;
    const removedInv = await invite(owner, s, "probe-removed@example.org");
    const removedId = await personId(t, "probe-removed@example.org");
    await call(t.public, "DELETE", `/api/submissions/${s.id}/contributors/${removedId}`, {
      cookie: owner,
      body: { version: removedInv.json.version },
    });
    const answer = (cookie: string, id = s.id) =>
      call(t.public, "POST", `/api/me/invitations/${id}/answer`, {
        cookie,
        body: { answer: "decline" },
      });

    const stranger = await signIn(t, "probe-stranger@example.org");
    const removed = await signIn(t, "probe-removed@example.org");
    expect(await answer(stranger)).toMatchObject({ status: 404, json: { error: "not_found" } });
    expect(await answer(removed)).toMatchObject({ status: 404, json: { error: "not_found" } });
    expect(await answer(stranger, "00000000-0000-4000-8000-000000000000")).toMatchObject({
      status: 404,
      json: { error: "not_found" },
    });
    expect(await answer(owner)).toMatchObject({ status: 409, json: { error: "already_answered" } });
    const invitee = await signIn(t, "probe-invitee@example.org");
    expect((await answer(invitee)).json).toEqual({ answer: "declined" });
    expect(await answer(invitee)).toMatchObject({
      status: 409,
      json: { error: "already_answered" },
    });
  });

  it("confirming needs a name in the invitee's own words; the typed name never reaches the profile (#15 #54 #2 #58)", async () => {
    const owner = await person("name-owner@example.org", "Nat Owner");
    let s = await fill(owner, await draft(owner), "Names matter");
    const inv = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: {
        version: s.version,
        email: "noname@example.org",
        role: "coauthor",
        name: "Nina Typed",
        affiliation: "Typed Org",
        lang: "en",
      },
    });
    expect(inv.status).toBe(201);
    s = await submitted(owner, inv.json);
    const token = await inviteToken("noname@example.org");

    const info = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
    expect(info.json).toMatchObject({ nameNeeded: true, invitedName: "Nina Typed" });
    const confirm = (more: Record<string, unknown>) =>
      call(t.public, "POST", "/api/invitations/answer", {
        body: { token, answer: "confirm", acceptedAgreements: AGREEMENTS, ...more },
      });
    const nameless = await confirm({});
    expect(nameless.status).toBe(422);
    expect(nameless.json).toEqual({
      error: "invalid",
      issues: [{ path: "displayName", code: "required" }],
    });
    // Nothing was recorded: still invited, no consent stored.
    const pid = await personId(t, "noname@example.org");
    expect(await t.db.select().from(agreementAcks).where(eq(agreementAcks.personId, pid))).toEqual(
      [],
    );
    expect((await confirm({ displayName: "Nina Real" })).json).toEqual({ answer: "confirmed" });
    const [row] = await t.db.select().from(people).where(eq(people.id, pid));
    expect(row).toMatchObject({ displayName: "Nina Real", affiliation: null });
    // Submitted work stays valid: the confirmed co-author has a name.
    const check = await call(t.public, "GET", `/api/submissions/${s.id}/check`, { cookie: owner });
    expect(check.json.issues).toEqual([]);

    // In the app too, and a name equal to what the owner typed is the invitee's choice.
    const inv2 = await invite(owner, (await get(owner, s)).json, "noname2@example.org", {
      name: "Typed Two",
    });
    expect(inv2.status).toBe(201);
    const invitee = await signIn(t, "noname2@example.org");
    const inApp = (more: Record<string, unknown>) =>
      call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
        cookie: invitee,
        body: { answer: "confirm", acceptedAgreements: AGREEMENTS, ...more },
      });
    expect((await inApp({})).json.issues).toEqual([{ path: "displayName", code: "required" }]);
    expect((await inApp({ displayName: "Typed Two" })).json).toEqual({ answer: "confirmed" });
    const [row2] = await t.db.select().from(people).where(eq(people.email, "noname2@example.org"));
    expect(row2?.displayName).toBe("Typed Two");

    // Someone with a profile name needs none, and their profile is left alone.
    await person("named@example.org", "Ned Named");
    const inv3 = await invite(owner, (await get(owner, s)).json, "named@example.org", {
      name: "Wrong Name",
    });
    expect(inv3.status).toBe(201);
    const token3 = await inviteToken("named@example.org");
    const info3 = await call(t.public, "POST", "/api/invitations/info", {
      body: { token: token3 },
    });
    expect(info3.json.nameNeeded).toBe(false);
    const yes = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token: token3, answer: "confirm", acceptedAgreements: AGREEMENTS },
    });
    expect(yes.json).toEqual({ answer: "confirmed" });
    const [row3] = await t.db.select().from(people).where(eq(people.email, "named@example.org"));
    expect(row3?.displayName).toBe("Ned Named");
  });

  it("after withdrawal, invitees can still decline and co-authors leave; nobody can confirm (#5 #18 #26 #55)", async () => {
    const owner = await person("wd-owner@example.org", "Wanda Owner");
    let s = await fill(owner, await draft(owner), "CALL 555-0100 NOW to claim your prize");
    s = (await invite(owner, s, "wd-invitee@example.org", { name: "Pat Pending", lang: "pt" }))
      .json;
    s = (await invite(owner, s, "wd-app@example.org", { name: "App Pending" })).json;
    s = (await invite(owner, s, "wd-coauthor@example.org", { name: "Co Author" })).json;
    const coauthor = await person("wd-coauthor@example.org", "Cora Author");
    expect(
      (
        await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
          cookie: coauthor,
          body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
        })
      ).json,
    ).toEqual({ answer: "confirmed" });
    s = await submitted(owner, (await get(owner, s)).json);
    const wd = await call(t.public, "POST", `/api/submissions/${s.id}/withdraw`, {
      cookie: owner,
      body: { version: s.version },
    });
    expect(wd.json.status).toBe("withdrawn");

    // Withdrawal mail (#6 #24): people still invited get no owner-written text, in the
    // invitation's language; confirmed contributors and the contact address get the title.
    const toInvitee = (await mailTo("wd-invitee@example.org")).at(-1);
    expect(toInvitee?.subject).toMatch(/foi retirada uma proposta/);
    expect(`${toInvitee?.subject} ${toInvitee?.text}`).not.toMatch(/555-0100|prize/);
    expect((await mailTo("wd-coauthor@example.org")).at(-1)?.text).toMatch(/555-0100/);
    expect((await mailTo(fixtureCall.contactEmail)).at(-1)?.text).toMatch(/555-0100/);

    // By link, while the call is open: the withdrawn work cannot be confirmed, only declined.
    const token = await inviteToken("wd-invitee@example.org");
    const info = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
    expect(info.json).toMatchObject({ status: "withdrawn", conference: { callOpen: true } });
    const confirm = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token, answer: "confirm", acceptedAgreements: AGREEMENTS, displayName: "Pat" },
    });
    expect(confirm).toMatchObject({ status: 409, json: { error: "call_closed" } });
    const decline = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token, answer: "decline" },
    });
    expect(decline.json).toEqual({ answer: "declined" });

    // In the app, even after the close (when invitation links have expired).
    t.setNow(new Date("2027-03-10T12:00:00Z"));
    try {
      const app = await signIn(t, "wd-app@example.org");
      expect(
        (await call(t.public, "GET", "/api/me/invitations", { cookie: app })).json.items,
      ).toEqual([
        expect.objectContaining({ submission: expect.objectContaining({ status: "withdrawn" }) }),
      ]);
      const inApp = await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
        cookie: app,
        body: { answer: "decline" },
      });
      expect(inApp.json).toEqual({ answer: "declined" });
      expect((await get(app, s)).status).toBe(404); // C7: the decliner sees nothing afterwards
      expect(
        (await call(t.public, "GET", "/api/me/invitations", { cookie: app })).json.items,
      ).toEqual([]);

      const cora = await signIn(t, "wd-coauthor@example.org");
      const left = await call(t.public, "POST", `/api/submissions/${s.id}/leave`, {
        cookie: cora,
        body: {},
      });
      expect(left.status).toBe(204);
      expect((await get(cora, s)).status).toBe(404);
    } finally {
      t.setNow(NOW);
    }
  });
});

describe("contributor order is relative to the people the owner sees (#16 #41)", () => {
  const order = async (cookie: string, s: Sub, ids: Map<string, string>) => {
    const res = await get(cookie, s);
    const names = new Map([...ids].map(([k, v]) => [v, k]));
    return {
      version: res.json.version as number,
      order: (res.json.contributors as { personId: string }[]).map((c) => names.get(c.personId)),
    };
  };
  const decline = async (email: string) => {
    const token = await inviteToken(email);
    const res = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token, answer: "decline" },
    });
    expect(res.json).toEqual({ answer: "declined" });
  };
  const move = (cookie: string, s: Sub, who: string, position: number) =>
    call(t.public, "PATCH", `/api/submissions/${s.id}/contributors/${who}`, {
      cookie,
      body: { version: s.version, position },
    });

  it("moving the owner down past a declined person swaps with the next live one", async () => {
    const owner = await person("order1-owner@example.org", "Ord Owner");
    let s = await draft(owner);
    s = (await invite(owner, s, "order1-a@example.org", { name: "A" })).json;
    s = (await invite(owner, s, "order1-b@example.org", { name: "B" })).json;
    await decline("order1-a@example.org"); // owner(0), A declined(1), B(2)
    const ids = new Map([
      ["owner", await personId(t, "order1-owner@example.org")],
      ["B", await personId(t, "order1-b@example.org")],
    ]);
    const before = await order(owner, s, ids);
    expect(before.order).toEqual(["owner", "B"]);
    const moved = await move(owner, { id: s.id, version: before.version }, ids.get("owner")!, 1);
    expect(moved.status).toBe(200);
    expect((await order(owner, s, ids)).order).toEqual(["B", "owner"]);
  });

  it("moving someone down past a declined person lands after the next live one", async () => {
    const owner = await person("order2-owner@example.org", "Ord Owner Two");
    let s = await draft(owner);
    s = (await invite(owner, s, "order2-b@example.org", { name: "B" })).json;
    s = (await invite(owner, s, "order2-a@example.org", { name: "A" })).json;
    s = (await invite(owner, s, "order2-c@example.org", { name: "C" })).json;
    await decline("order2-a@example.org"); // Owner(0), B(1), A declined(2), C(3)
    const ids = new Map([
      ["owner", await personId(t, "order2-owner@example.org")],
      ["B", await personId(t, "order2-b@example.org")],
      ["C", await personId(t, "order2-c@example.org")],
    ]);
    const before = await order(owner, s, ids);
    expect(before.order).toEqual(["owner", "B", "C"]);
    const down = await move(owner, { id: s.id, version: before.version }, ids.get("B")!, 2);
    expect(down.status).toBe(200);
    const after = await order(owner, s, ids);
    expect(after.order).toEqual(["owner", "C", "B"]);
    // And back up again.
    await move(owner, { id: s.id, version: after.version }, ids.get("B")!, 1);
    expect((await order(owner, s, ids)).order).toEqual(["owner", "B", "C"]);
  });
});

describe("field keys come from the format (#8 #52)", () => {
  it("refuses keys the format does not define, in drafts and in submitted work", async () => {
    const owner = await person("fields-owner@example.org", "Fi Elds");
    let s = await draft(owner, "workshop");
    const patch = (body: Record<string, unknown>) =>
      call(t.public, "PATCH", `/api/submissions/${s.id}`, {
        cookie: owner,
        body: { version: s.version, ...body },
      });
    const unknown = await patch({ fields: { maria_rodriguez_unal: "x", needs: "a projector" } });
    expect(unknown.status).toBe(422);
    expect(unknown.json.issues).toEqual([
      { path: "fields.maria_rodriguez_unal", code: "unknown_field" },
    ]);
    const known = await patch({
      fields: { needs: "a projector" },
      title: "A workshop",
      abstract: words(260),
    });
    expect(known.status).toBe(200);
    s = await submitted(owner, known.json);
    const later = await patch({ fields: { needs: "two projectors", extra_key: "y" } });
    expect(later.status).toBe(422);
    expect(later.json.issues).toEqual([{ path: "fields.extra_key", code: "unknown_field" }]);
    expect((await get(owner, s)).json.fields).toEqual({ needs: "a projector" });
  });

  it("a draft that changes format keeps only the fields its new format defines", async () => {
    const owner = await person("fields-owner2@example.org", "Fi Elds Two");
    let s = await draft(owner, "workshop");
    s = (
      await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
        cookie: owner,
        body: { version: s.version, fields: { needs: "chairs" } },
      })
    ).json;
    const changed = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: s.version, typeKey: "talk" },
    });
    expect(changed.status).toBe(200);
    expect(changed.json.fields).toEqual({});
    const [row] = (await auditRows("submission.updated"))
      .filter((r) => r.targetId === s.id)
      .slice(-1);
    expect(row?.details).toEqual({ changed: ["fields", "typeKey"] });
  });
});

describe("what mail carries", () => {
  it("the stored copy of an invitation loses its link token once sent (#13 #22)", async () => {
    const owner = await person("tok-owner@example.org", "Tok Owner");
    const s = await draft(owner);
    const inv = await invite(owner, s, "tok@example.org");
    const token = await inviteToken("tok@example.org"); // delivered, so the inbox has it
    t.setNow(new Date(NOW.getTime() + 61 * 60 * 1000));
    try {
      const again = await signIn(t, "tok-owner@example.org");
      const resent = await call(
        t.public,
        "POST",
        `/api/submissions/${s.id}/contributors/${await personId(t, "tok@example.org")}/resend`,
        { cookie: again, body: { version: inv.json.version } },
      );
      expect(resent.status).toBe(204);
      const token2 = await inviteToken("tok@example.org");
      const stored = await t.db.select().from(outbox).where(eq(outbox.toEmail, "tok@example.org"));
      expect(stored).toHaveLength(2);
      for (const row of stored) {
        expect(row.sentAt).not.toBeNull();
        expect(row.bodyText).toContain("#token=[redacted]");
        expect(row.bodyText).not.toMatch(/inv_/);
      }
      expect(findLeaks(stored, [token, token2])).toEqual([]);
    } finally {
      t.setNow(NOW);
    }
  });

  it("an owner's display name loses bare domains and email addresses in invitations (#23 #59)", async () => {
    // Bidi and zero-width characters are refused at input (OneLine); sanitizeName strips them
    // again for names saved before that rule (see mail.test.ts).
    const bidi = await call(t.public, "PUT", "/api/me/profile", {
      cookie: await signIn(t, "phish-bidi@example.org"),
      body: {
        displayName: "Ana Pérez \u202Emoc.evil",
        affiliation: null,
        country: null,
        languages: ["en"],
        pronouns: null,
        orcid: null,
        bios: {},
      },
    });
    expect(bidi.status).toBe(400);
    const owner = await person(
      "phish-owner@example.org",
      "Ana Pérez verify at elo-signin.com or help@evil.example now",
    );
    const s = await draft(owner);
    await invite(owner, s, "phish-target@example.org");
    const text = (await mailTo("phish-target@example.org")).at(-1)?.text ?? "";
    expect(text).toMatch(/^Ana Pérez verify at or now has listed you/);
    expect(text).not.toMatch(/elo-signin|evil\.example|@|\u202E/);
  });

  it("the receipt's deadline is written in each recipient's language (#27)", async () => {
    const owner = await person("deadline-owner@example.org", "Dea Dline", ["es"]);
    let s = await fill(owner, await draft(owner), "Plazos");
    s = (await invite(owner, s, "deadline-pt@example.org", { name: "Pê", lang: "pt" })).json;
    const pt = await person("deadline-pt@example.org", "Paula Prazo", ["pt"]);
    await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
      cookie: pt,
      body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
    });
    await submitted(owner, (await get(owner, s)).json);
    // The call closes 30 days after NOW: 2027-03-03 12:00 UTC, 7:00 in Bogotá.
    const es = (await mailTo("deadline-owner@example.org")).at(-1)?.text;
    expect(es).toContain("hasta el 3 de marzo de 2027");
    expect(es).toContain("(America/Bogota)");
    expect(es).not.toMatch(/March/);
    const ptText = (await mailTo("deadline-pt@example.org")).at(-1)?.text;
    expect(ptText).toContain("até 3 de março de 2027");
    expect(ptText).not.toMatch(/March/);
  });

  it("the owner's notices name an invitee invited by address alone by that address (#1)", async () => {
    const owner = await person("addr-owner@example.org", "Olga Owner", ["es"]);
    let s = await fill(owner, await draft(owner), "Sin nombres");
    const [byLink, decliner, inApp] = [
      "bruno@example.net",
      "carla@example.net",
      "dora@example.net",
    ];
    secrets.push(byLink, decliner, inApp);
    for (const email of [byLink, decliner, inApp]) {
      const res = await invite(owner, s, email); // no name: the form does not require one
      expect(res.status).toBe(201);
      s = res.json;
    }
    const answer = async (email: string, body: Record<string, unknown>) =>
      call(t.public, "POST", "/api/invitations/answer", {
        body: { token: await inviteToken(email), ...body },
      });
    expect(
      (
        await answer(byLink, {
          answer: "confirm",
          acceptedAgreements: AGREEMENTS,
          displayName: "Bruno Real",
        })
      ).json,
    ).toEqual({ answer: "confirmed" });
    expect((await answer(decliner, { answer: "decline" })).json).toEqual({ answer: "declined" });
    const dora = await signIn(t, inApp);
    expect(
      (
        await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
          cookie: dora,
          body: { answer: "confirm", acceptedAgreements: AGREEMENTS, displayName: "Dora Real" },
        })
      ).json,
    ).toEqual({ answer: "confirmed" });
    const left = await call(t.public, "POST", `/api/submissions/${s.id}/leave`, {
      cookie: dora,
      body: {},
    });
    expect(left.status).toBe(204);

    const notices = (await mailTo("addr-owner@example.org")).filter((m) =>
      /confirmó|rechazó|dejó/.test(m.subject),
    );
    expect(notices.map((m) => m.subject)).toEqual([
      `Convocatoria de prueba: ${byLink} confirmó su participación en tu propuesta`,
      `Convocatoria de prueba: ${decliner} rechazó participar en tu propuesta`,
      `Convocatoria de prueba: ${inApp} confirmó su participación en tu propuesta`,
      `Convocatoria de prueba: ${inApp} dejó tu propuesta`,
    ]);
    for (const m of notices) {
      expect(m.text).toContain(`${ORIGIN}/es/s/${s.id}`);
      expect(m.text).not.toMatch(/^—/);
    }
  });

  it("receipts and withdrawal notices show the title as written, with the proposal's link (#2)", async () => {
    const title = "Poems with p5.js and three.js — Big Data: Bitsy.org @ ELO 2027";
    const owner = await person("title-owner@example.org", "Tia Title");
    let s = await fill(owner, await draft(owner), title);
    s = (await invite(owner, s, "title-coauthor@example.org", { name: "Cy" })).json;
    const coauthor = await person("title-coauthor@example.org", "Cy Coauthor", ["pt"]);
    await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
      cookie: coauthor,
      body: { answer: "confirm", acceptedAgreements: AGREEMENTS },
    });
    s = await submitted(owner, (await get(owner, s)).json);
    for (const [to, lang] of [
      ["title-owner@example.org", "en"],
      ["title-coauthor@example.org", "pt"],
    ] as const) {
      const receipt = (await mailTo(to)).at(-1)?.text ?? "";
      expect(receipt).toContain(title);
      expect(receipt).toContain(`${ORIGIN}/${lang}/s/${s.id}`);
    }
    const wd = await call(t.public, "POST", `/api/submissions/${s.id}/withdraw`, {
      cookie: owner,
      body: { version: s.version },
    });
    expect(wd.json.status).toBe("withdrawn");
    const contact = (await mailTo(fixtureCall.contactEmail)).at(-1)?.text ?? "";
    expect(contact).toContain(title);
    expect(contact).toContain(`${ORIGIN}/en/s/${s.id}`);
    const toCoauthor = (await mailTo("title-coauthor@example.org")).at(-1)?.text ?? "";
    expect(toCoauthor).toMatch(/foi retirada/);
    expect(toCoauthor).toContain(title);
    expect(toCoauthor).toContain(`${ORIGIN}/pt/s/${s.id}`);
  });
});

describe("the audit log", () => {
  it("never holds names, emails or titles written during these flows", async () => {
    const rows = await t.db.select().from(auditLog);
    expect(rows.length).toBeGreaterThan(20);
    expect(
      findLeaks(
        rows,
        secrets.filter((x) => x.length > 6),
      ),
    ).toEqual([]);
  });
});
