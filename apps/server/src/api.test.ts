import { findLeaks } from "@elochair/policy/testing";
import { conferences } from "@elochair/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignments, auditLog, contributions, people, submissions } from "./db/schema";
import { type SandboxSummary, seedSandbox } from "./fixtures";
import { createApiToken, revokeApiToken, saveConference } from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

let t: TestApp;
let s: SandboxSummary;
let chairCookie: string;
let adminCookie: string;
let tokenM: string;
let tokenC: string;
let everything: { names: string[]; emails: string[]; bios: string[]; content: string[] };

beforeAll(async () => {
  t = await makeTestApp();
  await saveConference(t.db, conferences.elo2026, "archived");
  await saveConference(t.db, conferences.elo2027, "draft");
  s = await seedSandbox(t.db);
  chairCookie = await signIn(t, s.chairEmail);
  adminCookie = await signIn(t, s.adminEmail);
  const chairId = await personId(t, s.chairEmail);
  tokenM = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "M",
      name: "cloud agent",
    })
  ).token;
  tokenC = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "C",
      name: "local model",
    })
  ).token;

  const ps = await t.db.select().from(people);
  const subs = await t.db.select().from(submissions);
  everything = {
    names: ps.map((p) => p.displayName).filter((x): x is string => !!x && x.includes(" ")),
    emails: ps.map((p) => p.email),
    bios: ps.flatMap((p) => Object.values((p.bios ?? {}) as Record<string, string>)),
    content: subs.flatMap((x) => [x.title, x.abstract]),
  };
}, 120_000);
afterAll(() => t.close());

const subsPath = () => `/api/conferences/${s.slug}/submissions`;

describe("submission visibility over HTTP", () => {
  it("chairs see every submission in full", async () => {
    const res = await call(t.public, "GET", subsPath(), { cookie: chairCookie });
    expect(res.json.submissions).toHaveLength(s.submissionCount);
    expect(new Set(res.json.submissions.map((x: { view: string }) => x.view))).toEqual(
      new Set(["chair"]),
    );
  });

  it("the public sees nothing before publication", async () => {
    const res = await call(t.public, "GET", subsPath());
    expect(res.status).toBe(200);
    expect(res.json.submissions).toEqual([]);
  });

  it("a reviewer sees exactly their assignments, blinded per type", async () => {
    const email = s.reviewerEmails[0] as string;
    const id = await personId(t, email);
    const assigned = await t.db.select().from(assignments).where(eq(assignments.reviewerId, id));
    const cookie = await signIn(t, email);
    const res = await call(t.public, "GET", subsPath(), { cookie });
    const asReviewer = res.json.submissions.filter((x: { view: string }) => x.view === "reviewer");
    const ids = asReviewer.map((x: { id: string }) => x.id).sort();
    expect(ids).toEqual(assigned.map((a) => a.submissionId).sort());
    // This reviewer also submitted work: they see their own as a submitter, nothing else.
    const own = await t.db.select().from(contributions).where(eq(contributions.personId, id));
    const others = res.json.submissions.filter((x: { view: string }) => x.view !== "reviewer");
    expect(others.map((x: { view: string }) => x.view)).toEqual(own.map(() => "submitter"));
    for (const sub of asReviewer) {
      const forbidden =
        sub.blindMode === "double"
          ? [...everything.names, ...everything.emails, ...everything.bios]
          : everything.emails;
      expect(findLeaks(sub, forbidden)).toEqual([]);
    }
  });
});

describe("agent tiers", () => {
  it("tier M works on the public listener and returns no names, contact details or text", async () => {
    const res = await call(t.public, "GET", subsPath(), { token: tokenM });
    expect(res.status).toBe(200);
    expect(res.json.submissions).toHaveLength(s.submissionCount);
    expect(res.json.submissions[0].view).toBe("metadata");
    expect(
      findLeaks(res.json, [
        ...everything.names,
        ...everything.emails,
        ...everything.bios,
        ...everything.content,
      ]),
    ).toEqual([]);
  });

  it("tier C is refused on the public listener, and the refusal is audited", async () => {
    const res = await call(t.public, "GET", subsPath(), { token: tokenC });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("tier_c_internal_only");
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "agent.refused_tier_c_on_public"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("tier C works on the internal listener with the chair's full view", async () => {
    const res = await call(t.internal, "GET", subsPath(), { token: tokenC });
    expect(res.status).toBe(200);
    expect(res.json.submissions[0].view).toBe("chair");
  });

  it("the internal listener serves only agents", async () => {
    expect((await call(t.internal, "GET", subsPath(), { cookie: chairCookie })).status).toBe(401);
  });

  it("every agent request is in the audit log with token and tier", async () => {
    await call(t.public, "GET", `/api/conferences/${s.slug}/cap-report`, { token: tokenM });
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, "agent.request"));
    const last = rows.at(-1);
    expect(last?.actorKind).toBe("agent_m");
    expect(last?.tokenId).toBeTruthy();
    expect(last?.details).toMatchObject({
      method: "GET",
      path: `/api/conferences/${s.slug}/cap-report`,
      status: 200,
    });
    await expect(t.db.execute(sql`delete from audit_log`)).rejects.toThrow();
  });

  it("agents cannot reconfigure a conference, and revoked tokens stop working", async () => {
    const put = await call(t.public, "PUT", `/api/conferences/${s.slug}/config`, {
      token: tokenM,
      body: {},
    });
    expect(put.status).toBe(403);
    const chairId = await personId(t, s.chairEmail);
    const temp = await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "M",
      name: "temp",
    });
    await revokeApiToken(t.db, temp.id);
    expect((await call(t.public, "GET", subsPath(), { token: temp.token })).status).toBe(401);
  });

  it("only chairs can be issued agent tokens", async () => {
    const reviewerId = await personId(t, s.reviewerEmails[1] as string);
    await expect(
      createApiToken(t.db, {
        personId: reviewerId,
        conferenceId: s.conferenceId,
        tier: "M",
        name: "x",
      }),
    ).rejects.toThrow(/chairs/);
  });

  it("a tier M agent gets the presenter-cap report (IDs and counts only)", async () => {
    const res = await call(t.public, "GET", `/api/conferences/${s.slug}/cap-report`, {
      token: tokenM,
    });
    expect(res.json.max).toBe(2);
    expect(res.json.over.map((o: { personId: string }) => o.personId).sort()).toEqual(
      s.overCapPersonIds,
    );
    expect(findLeaks(res.json, [...everything.names, ...everything.emails])).toEqual([]);
  });
});

describe("conference configuration", () => {
  it("lists published conferences publicly and drafts only to their chairs", async () => {
    const pub = await call(t.public, "GET", "/api/conferences");
    expect(pub.json.conferences.map((k: { slug: string }) => k.slug)).toEqual([
      "elo2026",
      "sandbox",
    ]);
    expect((await call(t.public, "GET", "/api/conferences/elo2027")).status).toBe(404);
  });

  it("serves the public CFP configuration", async () => {
    const res = await call(t.public, "GET", "/api/conferences/elo2026");
    expect(res.json.config.submissionTypes.map((x: { key: string }) => x.key)).toContain(
      "exhibition",
    );
  });

  it("lets admins update the configuration, validates it, and audits the change", async () => {
    const path = `/api/conferences/${s.slug}/config`;
    const current = (
      await call(t.public, "GET", `/api/conferences/${s.slug}`, { cookie: adminCookie })
    ).json.config;
    const updated = { ...current, contactEmail: "sandbox@example.org" };
    const ok = await call(t.public, "PUT", path, { cookie: adminCookie, body: updated });
    expect(ok.status).toBe(200);
    expect(ok.json.config.contactEmail).toBe("sandbox@example.org");
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "conference.config_updated"));
    expect(rows.at(-1)?.details).toEqual({ changed: ["contactEmail"] });

    const bad = await call(t.public, "PUT", path, {
      cookie: adminCookie,
      body: {
        ...current,
        submissionTypes: [{ ...current.submissionTypes[0], reviewPool: "nope" }],
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.issues.map((i: { path: string }) => i.path)).toContain(
      "submissionTypes.0.reviewPool",
    );
  });

  it("refuses configuration changes from chairs who are not admins", async () => {
    const current = (await call(t.public, "GET", `/api/conferences/${s.slug}`)).json.config;
    const res = await call(t.public, "PUT", `/api/conferences/${s.slug}/config`, {
      cookie: chairCookie,
      body: current,
    });
    expect(res.status).toBe(403);
  });
});

describe("review fixes: cap report and draft conferences", () => {
  it("refuses draft statuses and hides draft conferences from non-chairs", async () => {
    const bad = await call(
      t.public,
      "GET",
      `/api/conferences/${s.slug}/cap-report?statuses=draft`,
      { cookie: chairCookie },
    );
    expect(bad.status).toBe(400);
    const reviewerCookie = await signIn(t, s.reviewerEmails[2] as string);
    expect(
      (
        await call(t.public, "GET", "/api/conferences/elo2027/cap-report", {
          cookie: reviewerCookie,
        })
      ).status,
    ).toBe(404);
    const put = await call(t.public, "PUT", "/api/conferences/elo2027/config", {
      cookie: reviewerCookie,
      body: {},
    });
    expect(put.status).toBe(404);
  });

  it("leaves a chair's own submissions out of their cap report", async () => {
    // A talk counts toward the cap, so it appears in the report until the chair co-authors it.
    const [talk] = await t.db
      .select()
      .from(submissions)
      .where(eq(submissions.typeKey, "talk"))
      .limit(1);
    const reportIds = async () =>
      (
        await call(t.public, "GET", `/api/conferences/${s.slug}/cap-report`, {
          cookie: chairCookie,
        })
      ).json.counts.flatMap((x: { submissionIds: string[] }) => x.submissionIds);
    expect(await reportIds()).toContain(talk!.id);
    const chairId = await personId(t, s.chairEmail);
    await t.db
      .insert(contributions)
      .values({ submissionId: talk!.id, personId: chairId, role: "coauthor", position: 99 });
    expect(await reportIds()).not.toContain(talk!.id);
    await t.db.delete(contributions).where(eq(contributions.personId, chairId));
  });

  it("gives a chair's tier M agent the same cap report as the chair, published work included", async () => {
    const talks = await t.db
      .select()
      .from(submissions)
      .where(eq(submissions.typeKey, "talk"))
      .limit(5);
    await t.db
      .update(submissions)
      .set({ status: "published" })
      .where(
        inArray(
          submissions.id,
          talks.map((x) => x.id),
        ),
      );
    const path = `/api/conferences/${s.slug}/cap-report?statuses=submitted,published`;
    const asChair = await call(t.public, "GET", path, { cookie: chairCookie });
    const asAgent = await call(t.public, "GET", path, { token: tokenM });
    expect(asAgent.json.counts).toEqual(asChair.json.counts);
    expect(
      asAgent.json.counts.flatMap((x: { submissionIds: string[] }) => x.submissionIds),
    ).toContain(talks[0]!.id);
    await t.db
      .update(submissions)
      .set({ status: "submitted" })
      .where(
        inArray(
          submissions.id,
          talks.map((x) => x.id),
        ),
      );
  });
});
