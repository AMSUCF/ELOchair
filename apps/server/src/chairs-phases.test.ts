import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFERENCE_PHASES,
  conferences as configs,
  isForwardPhaseMove,
  reviewersCanRead,
} from "@elochair/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliContext, runCli } from "./cli";
import { auditLog, conferences, people } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import {
  createApiToken,
  createConferenceIfMissing,
  getConference,
  grantRole,
  markReviewBegun,
  saveConference,
} from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Conference phases move forward only, unless forced with a reason, and every move is audited
 * with from, to and reason: through the API (under a row lock), set-phase, import-config and
 * seed --force. Through the API a chair moves the phase, as an admin does (they are one group);
 * nobody else, and no agent.
 */

let t: TestApp;
let adminCookie: string;
let dir: string;
const lines: string[] = [];

const ctx = (overrides: Partial<CliContext> = {}): CliContext => ({
  db: t.db,
  env: { NODE_ENV: "development" },
  migrate: async () => {},
  user: "tester",
  now: () => new Date("2027-03-04T05:06:07Z"),
  out: {
    log: (...a: unknown[]) => lines.push(a.join(" ")),
    error: (...a: unknown[]) => lines.push(a.join(" ")),
    table: () => {},
  },
  ...overrides,
});
const cli = (args: string[], overrides: Partial<CliContext> = {}) => runCli(args, ctx(overrides));

async function phaseOf(slug: string) {
  return (await getConference(t.db, slug))?.phase;
}

async function phaseAudit(slug: string) {
  const k = await getConference(t.db, slug);
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.conferenceId, k!.id), eq(auditLog.action, "conference.phase_changed")))
    .orderBy(asc(auditLog.id));
}

/** A conference config file, as export-config prints it. */
async function configFile(slug: string, title: string) {
  const k = await getConference(t.db, slug);
  const path = join(dir, `${slug}-${title.length}.json`);
  await writeFile(path, JSON.stringify({ ...k!.config, title: { en: title } }));
  return path;
}

beforeAll(async () => {
  t = await makeTestApp();
  dir = await mkdtemp(join(tmpdir(), "elochair-phases-"));
  adminCookie = await signIn(t, "phase-admin@example.org");
  for (const slug of ["race-a", "race-b", "race-c", "clock", "cli-set", "cli-import"]) {
    const { conferenceId } = await seedTestCall(t.db, { slug, now: new Date("2027-02-01") });
    await grantRole(t.db, {
      conferenceId,
      personId: await personId(t, "phase-admin@example.org"),
      role: "admin",
    });
  }
}, 120_000);
afterAll(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

describe("who may move the phase through the API", () => {
  const SLUG = "who-moves";
  const move = (who: { cookie?: string; token?: string }, body: Record<string, unknown>) =>
    call(t.public, "PUT", `/api/conferences/${SLUG}/phase`, { ...who, body });
  const cookies: Record<string, string> = {};
  let agentToken: string;

  beforeAll(async () => {
    const { conferenceId } = await seedTestCall(t.db, { slug: SLUG, now: new Date("2027-02-01") });
    const roles = { chair: "chair", track: "track_chair", reviewer: "reviewer" } as const;
    for (const [who, role] of Object.entries(roles)) {
      cookies[who] = await signIn(t, `phase-${who}@example.org`);
      await grantRole(t.db, {
        conferenceId,
        personId: await personId(t, `phase-${who}@example.org`),
        role,
      });
    }
    // Signed in, with no role at this conference; and the admin of the other conferences here.
    cookies.stranger = await signIn(t, "phase-stranger@example.org");
    cookies.elsewhere = adminCookie;
    // An agent of the chair who may move it: phase moves are human-only all the same.
    agentToken = (
      await createApiToken(t.db, {
        personId: await personId(t, "phase-chair@example.org"),
        conferenceId,
        tier: "M",
        name: "phase test",
      })
    ).token;
  }, 120_000);

  it("refuses a track chair, a reviewer, anyone without a role here, the public and an agent", async () => {
    for (const who of ["track", "reviewer", "stranger", "elsewhere", "public"]) {
      const forward = await move({ cookie: cookies[who] }, { phase: "reviewing" });
      expect(forward.status, who).toBe(403);
      expect(forward.json.error, who).toBe("forbidden");
      // Forcing it with a reason changes nothing about who may.
      const forced = await move(
        { cookie: cookies[who] },
        { phase: "draft", force: true, reason: "Not mine to move" },
      );
      expect(forced.status, who).toBe(403);
    }
    expect((await move({ token: agentToken }, { phase: "reviewing" })).status).toBe(403);
    expect(await phaseOf(SLUG)).toBe("cfp_open");
    expect(await phaseAudit(SLUG)).toEqual([]);
  });

  it("lets a chair move it forward, and back only with a reason; each move is audited", async () => {
    const forward = await move({ cookie: cookies.chair }, { phase: "reviewing" });
    expect(forward.status).toBe(200);
    expect(forward.json).toEqual({ slug: SLUG, phase: "reviewing" });
    expect(await phaseOf(SLUG)).toBe("reviewing");

    // Back: refused bare, refused when only forced, and nothing moves.
    const bare = await move({ cookie: cookies.chair }, { phase: "cfp_open" });
    expect(bare.status).toBe(409);
    expect(bare.json).toEqual({ error: "phase_backwards", from: "reviewing", to: "cfp_open" });
    const unexplained = await move({ cookie: cookies.chair }, { phase: "cfp_open", force: true });
    expect(unexplained.status).toBe(409);
    expect(await phaseOf(SLUG)).toBe("reviewing");

    const back = await move(
      { cookie: cookies.chair },
      { phase: "cfp_open", force: true, reason: "Two proposals arrived by email" },
    );
    expect(back.status).toBe(200);
    expect(await phaseOf(SLUG)).toBe("cfp_open");

    const rows = await phaseAudit(SLUG);
    expect(rows.map((r) => r.actorKind)).toEqual(["human", "human"]);
    const chairId = await personId(t, "phase-chair@example.org");
    expect(rows.map((r) => r.actorPersonId)).toEqual([chairId, chairId]);
    expect(rows.map((r) => r.details)).toEqual([
      { from: "cfp_open", to: "reviewing", forced: false },
      {
        from: "reviewing",
        to: "cfp_open",
        forced: true,
        reason: "Two proposals arrived by email",
      },
    ]);
  });

  it("lets a site admin move it, with no role at the conference", async () => {
    const cookie = await signIn(t, "phase-site-admin@example.org");
    expect((await move({ cookie }, { phase: "reviewing" })).status).toBe(403);
    await t.db
      .update(people)
      .set({ siteAdmin: true })
      .where(eq(people.id, await personId(t, "phase-site-admin@example.org")));
    expect((await move({ cookie }, { phase: "reviewing" })).status).toBe(200);
    const back = await move(
      { cookie },
      { phase: "cfp_open", force: true, reason: "Reopened by the site admin" },
    );
    expect(back.status).toBe(200);
    expect(await phaseOf(SLUG)).toBe("cfp_open");
  });

  it("keeps a draft conference a secret from those who cannot move it", async () => {
    // cfp_open to draft is the one backward move that needs no reason.
    expect((await move({ cookie: cookies.chair }, { phase: "draft" })).status).toBe(200);
    for (const who of ["track", "reviewer", "stranger", "public"]) {
      expect((await move({ cookie: cookies[who] }, { phase: "cfp_open" })).status, who).toBe(404);
    }
    expect(await phaseOf(SLUG)).toBe("draft");
    expect((await move({ cookie: cookies.chair }, { phase: "cfp_open" })).status).toBe(200);
  });

  it("moves only from the phase the person saw, when the request names it", async () => {
    // A page that still showed "In review" asks for the next step; the conference is in cfp_open.
    const forward = await move({ cookie: cookies.chair }, { phase: "deciding", from: "reviewing" });
    expect(forward.status).toBe(409);
    expect(forward.json).toEqual({ error: "stale", from: "cfp_open", to: "deciding" });
    // Forcing it with a reason does not turn one step back into a jump from somewhere else.
    const back = await move(
      { cookie: cookies.chair },
      { phase: "cfp_open", from: "confirming", force: true, reason: "One step back, I thought" },
    );
    expect(back.status).toBe(409);
    expect(back.json).toEqual({ error: "stale", from: "cfp_open", to: "cfp_open" });
    expect(await phaseOf(SLUG)).toBe("cfp_open");

    // From the phase it is in, the same requests move it, there and back.
    const before = (await phaseAudit(SLUG)).length;
    expect(
      (await move({ cookie: cookies.chair }, { phase: "reviewing", from: "cfp_open" })).status,
    ).toBe(200);
    const returned = await move(
      { cookie: cookies.chair },
      { phase: "cfp_open", from: "reviewing", force: true, reason: "Putting it back" },
    );
    expect(returned.status).toBe(200);
    expect(await phaseOf(SLUG)).toBe("cfp_open");
    // Only the two moves that happened were audited.
    expect((await phaseAudit(SLUG)).length).toBe(before + 2);
  });
});

describe("PUT /api/conferences/:slug/phase", () => {
  it("checks concurrent moves against the phase each one finds, never a stale read", async () => {
    for (const slug of ["race-a", "race-b", "race-c"]) {
      // cfp_open → reviewing and cfp_open → draft are each fine alone. Together, whichever runs
      // second must see the first: reviewing → draft is a backward move nobody forced.
      const moves = await Promise.all(
        ["reviewing", "draft", "deciding"].map((phase) =>
          call(t.public, "PUT", `/api/conferences/${slug}/phase`, {
            cookie: adminCookie,
            body: { phase },
          }),
        ),
      );
      for (const m of moves) expect([200, 409]).toContain(m.status);
      const rows = await phaseAudit(slug);
      expect(rows).toHaveLength(moves.filter((m) => m.status === 200).length);
      let phase = "cfp_open";
      for (const row of rows) {
        const d = row.details as { from: string; to: string; forced: boolean };
        expect(d.from).toBe(phase);
        expect(isForwardPhaseMove(d.from, d.to)).toBe(true);
        phase = d.to;
      }
      expect(await phaseOf(slug)).toBe(phase);
      for (const refused of moves.filter((m) => m.status === 409)) {
        expect(refused.json.error).toBe("phase_backwards");
      }
    }
  });

  it("stamps updatedAt with the server clock it was given", async () => {
    t.setNow(new Date("2027-02-03T04:05:06Z"));
    const res = await call(t.public, "PUT", "/api/conferences/clock/phase", {
      cookie: adminCookie,
      body: { phase: "reviewing" },
    });
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(conferences).where(eq(conferences.slug, "clock"));
    expect(row?.updatedAt.toISOString()).toBe("2027-02-03T04:05:06.000Z");
    const refused = await call(t.public, "PUT", "/api/conferences/clock/phase", {
      cookie: adminCookie,
      body: { phase: "cfp_open", force: true, reason: "   " },
    });
    expect(refused.status).toBe(400); // a blank reason is no reason
  });
});

describe("CLI set-phase", () => {
  it("moves forward, refuses backward moves without --force and --reason, and audits", async () => {
    expect(await cli(["set-phase", "cli-set", "reviewing"])).toBe(0);
    expect(await cli(["set-phase", "cli-set", "cfp_open"])).toBe(1);
    expect(await cli(["set-phase", "cli-set", "cfp_open", "--force"])).toBe(1);
    expect(await cli(["set-phase", "cli-set", "cfp_open", "--force", "--reason", "  "])).toBe(1);
    expect(await phaseOf("cli-set")).toBe("reviewing");
    expect(
      await cli(["set-phase", "cli-set", "cfp_open", "--force", "--reason", "Dry run reopened"]),
    ).toBe(0);
    expect(await phaseOf("cli-set")).toBe("cfp_open");
    expect(await cli(["set-phase", "cli-set", "bogus"])).toBe(1);
    expect((await phaseAudit("cli-set")).map((r) => r.details)).toEqual([
      { from: "cfp_open", to: "reviewing", forced: false, by: "tester" },
      { from: "reviewing", to: "cfp_open", forced: true, by: "tester", reason: "Dry run reopened" },
    ]);
  });
});

describe("CLI import-config --phase", () => {
  it("creates a new conference in the phase given", async () => {
    const path = join(dir, "brand-new.json");
    await writeFile(path, JSON.stringify({ ...fixtureCall, slug: "brand-new" }));
    expect(await cli(["import-config", path, "--phase", "cfp_open"])).toBe(0);
    expect(await phaseOf("brand-new")).toBe("cfp_open");
    expect(await phaseAudit("brand-new")).toEqual([]);
  });

  it("moves an existing conference forward only, unless forced with a reason", async () => {
    expect(await cli(["set-phase", "cli-import", "reviewing"])).toBe(0);
    const before = await getConference(t.db, "cli-import");

    // Backward: refused, and nothing is imported.
    const refusedFile = await configFile("cli-import", "Refused import");
    expect(await cli(["import-config", refusedFile, "--phase", "cfp_open"])).toBe(1);
    expect(await cli(["import-config", refusedFile, "--phase", "draft", "--force"])).toBe(1);
    expect(lines.at(-1)).toMatch(/needs --force and --reason/);
    const unchanged = await getConference(t.db, "cli-import");
    expect(unchanged?.phase).toBe("reviewing");
    expect(unchanged?.config).toEqual(before?.config);

    // Forward: allowed and audited with from and to.
    const forward = await configFile("cli-import", "Forward import");
    expect(await cli(["import-config", forward, "--phase", "deciding"])).toBe(0);
    expect(await phaseOf("cli-import")).toBe("deciding");

    // Without --phase the phase stays as it is.
    expect(await cli(["import-config", forward])).toBe(0);
    expect(await phaseOf("cli-import")).toBe("deciding");

    // Backward with --force and --reason: allowed, and the reason is audited.
    const forced = await configFile("cli-import", "Forced import");
    expect(
      await cli([
        "import-config",
        forced,
        "--phase",
        "cfp_open",
        "--force",
        "--reason",
        "Call reopened by the committee",
      ]),
    ).toBe(0);
    const after = await getConference(t.db, "cli-import");
    expect(after?.phase).toBe("cfp_open");
    expect(after?.config.title).toEqual({ en: "Forced import" });

    const moves = (await phaseAudit("cli-import")).map((r) => r.details);
    expect(moves.slice(-2)).toEqual([
      { from: "reviewing", to: "deciding", forced: false, by: "tester" },
      {
        from: "deciding",
        to: "cfp_open",
        forced: true,
        by: "tester",
        reason: "Call reopened by the committee",
      },
    ]);
    const imports = await t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.conferenceId, after!.id),
          eq(auditLog.action, "conference.config_imported"),
        ),
      )
      .orderBy(asc(auditLog.id));
    expect(imports.map((r) => r.details)).toEqual([
      { slug: "cli-import", phase: "deciding", created: false, from: "reviewing", by: "tester" },
      { slug: "cli-import", phase: "deciding", created: false, by: "tester" },
      { slug: "cli-import", phase: "cfp_open", created: false, from: "deciding", by: "tester" },
    ]);
  });
});

describe("CLI import-config over a stored config that no longer parses (#5)", () => {
  it("replaces it, with or without --phase", async () => {
    await saveConference(t.db, { ...fixtureCall, slug: "legacy" }, "cfp_open");
    // Stored under an older schema: a type key longer than today's limit of 64 characters.
    const legacy = structuredClone({ ...fixtureCall, slug: "legacy" });
    legacy.submissionTypes[0]!.key = "t".repeat(70);
    await t.db.update(conferences).set({ config: legacy }).where(eq(conferences.slug, "legacy"));
    await expect(getConference(t.db, "legacy")).rejects.toThrow();

    const fixed = join(dir, "legacy-fixed.json");
    await writeFile(fixed, JSON.stringify({ ...fixtureCall, slug: "legacy" }));
    expect(await cli(["import-config", fixed])).toBe(0);
    const repaired = await getConference(t.db, "legacy");
    expect(repaired?.config.submissionTypes[0]?.key).toBe(fixtureCall.submissionTypes[0]?.key);
    expect(repaired?.phase).toBe("cfp_open");

    // And with a phase move, which is checked against the stored phase as usual.
    await t.db.update(conferences).set({ config: legacy }).where(eq(conferences.slug, "legacy"));
    expect(await cli(["import-config", fixed, "--phase", "reviewing"])).toBe(0);
    expect((await getConference(t.db, "legacy"))?.phase).toBe("reviewing");
    await t.db.update(conferences).set({ config: legacy }).where(eq(conferences.slug, "legacy"));
    expect(await cli(["import-config", fixed, "--phase", "cfp_open"])).toBe(1);
    expect(lines.at(-1)).toMatch(/needs --force and --reason/);
  });
});

// `seed` installs the built-in conferences, so these tests are about ELO 2026 and ELO 2027
// themselves: that they are there, in which phase. Nothing here depends on what they say.
describe("CLI seed --force", () => {
  it("is refused in production, where it would overwrite live conferences", async () => {
    await saveConference(t.db, configs.elo2027, "draft");
    expect(await cli(["set-phase", "elo2027", "reviewing"])).toBe(0);
    expect(await cli(["seed", "--force"], { env: { NODE_ENV: "production" } })).toBe(1);
    expect(await phaseOf("elo2027")).toBe("reviewing");
  });

  it("resets the development conferences and audits each phase move", async () => {
    expect(await cli(["seed", "--force"])).toBe(0);
    expect(await phaseOf("elo2027")).toBe("draft");
    expect(await phaseOf("elo2026")).toBe("archived");
    expect((await phaseAudit("elo2027")).map((r) => r.details).at(-1)).toEqual({
      from: "reviewing",
      to: "draft",
      forced: true,
      by: "tester",
      reason: "seed --force",
    });
    // elo2026 was created by this seed, not moved: no phase change to audit.
    expect(await phaseAudit("elo2026")).toEqual([]);
    // Without --force, existing conferences are left alone.
    expect(await cli(["set-phase", "elo2027", "cfp_open"])).toBe(0);
    expect(await cli(["seed"])).toBe(0);
    expect(await phaseOf("elo2027")).toBe("cfp_open");
  });

  it("leaves alone, or with --force replaces, a stored config that no longer parses (#5)", async () => {
    const legacy = structuredClone(configs.elo2027);
    legacy.submissionTypes[0]!.key = "t".repeat(70);
    await t.db.update(conferences).set({ config: legacy }).where(eq(conferences.slug, "elo2027"));
    expect(await cli(["seed"])).toBe(0);
    const [kept] = await t.db.select().from(conferences).where(eq(conferences.slug, "elo2027"));
    expect(kept?.config).toEqual(legacy);
    expect(await cli(["seed", "--force"])).toBe(0);
    const replaced = await getConference(t.db, "elo2027");
    expect(replaced?.config.submissionTypes[0]?.key).toBe(configs.elo2027.submissionTypes[0]?.key);
    expect(replaced?.phase).toBe("draft");
  });
});

/*
 * The mark that review has begun (`conferences.review_began_at`): set the first time a
 * conference is found in a phase in which its reviewers can read, by everything that gives a
 * conference a phase, and never cleared. The guard on the review form's settings decides by it
 * (reviews.test.ts), so that a conference forced back out of review is still one whose reviews
 * may have been sent.
 */
describe("the mark that review has begun", () => {
  const markOf = async (slug: string) => {
    const [row] = await t.db.select().from(conferences).where(eq(conferences.slug, slug));
    return row?.reviewBeganAt?.toISOString() ?? null;
  };
  /** A conference of its own for one test, in `cfp_open`, which the admin of these tests runs. */
  const fresh = async (slug: string) => {
    const { conferenceId } = await seedTestCall(t.db, { slug, now: new Date("2027-02-01") });
    await grantRole(t.db, {
      conferenceId,
      personId: await personId(t, "phase-admin@example.org"),
      role: "admin",
    });
    return conferenceId;
  };
  const move = (slug: string, body: Record<string, unknown>) =>
    call(t.public, "PUT", `/api/conferences/${slug}/phase`, { cookie: adminCookie, body });
  const back = { force: true, reason: "A test steps back" };

  it("is empty until the conference is in review, and set the moment it is", async () => {
    await fresh("mark-api");
    expect(await markOf("mark-api")).toBeNull();
    // Between the two phases before review it stays empty, in either direction.
    expect((await move("mark-api", { phase: "draft" })).status).toBe(200);
    expect((await move("mark-api", { phase: "cfp_open" })).status).toBe(200);
    expect(await markOf("mark-api")).toBeNull();
    t.setNow(new Date("2027-02-10T10:00:00Z"));
    expect((await move("mark-api", { phase: "reviewing" })).status).toBe(200);
    expect(await markOf("mark-api")).toBe("2027-02-10T10:00:00.000Z");
    expect((await getConference(t.db, "mark-api"))?.reviewBeganAt).toBe("2027-02-10T10:00:00.000Z");
    // It is the server's own: no answer about the conference carries it, by name or by value.
    for (const path of ["", "/settings", "/overview", "/submissions", "/people", "/assignments"]) {
      const res = await call(t.public, "GET", `/api/conferences/mark-api${path}`, {
        cookie: adminCookie,
      });
      expect(res.status, path).toBe(200);
      expect(JSON.stringify(res.json), path).not.toMatch(
        /reviewBeganAt|review_began_at|2027-02-10T10:00:00/,
      );
    }
  });

  it("is never cleared and never moved: a forced step back keeps it, and so does every later move", async () => {
    const first = await markOf("mark-api");
    expect(first).not.toBeNull();
    t.setNow(new Date("2027-02-11T10:00:00Z"));
    expect((await move("mark-api", { phase: "cfp_open", ...back })).status).toBe(200);
    expect(await phaseOf("mark-api")).toBe("cfp_open");
    expect(await markOf("mark-api")).toBe(first);
    t.setNow(new Date("2027-02-12T10:00:00Z"));
    expect((await move("mark-api", { phase: "draft" })).status).toBe(200);
    expect((await move("mark-api", { phase: "cfp_open" })).status).toBe(200);
    expect((await move("mark-api", { phase: "reviewing" })).status).toBe(200);
    expect((await move("mark-api", { phase: "deciding" })).status).toBe(200);
    expect(await markOf("mark-api")).toBe(first);
    // A move that is refused writes nothing.
    expect((await move("mark-api", { phase: "cfp_open" })).status).toBe(409);
    expect(await markOf("mark-api")).toBe(first);
  });

  it("is set on the way out for a conference that was in review before anything marked it", async () => {
    // As an earlier version of the app leaves a row: in review, and no mark.
    for (const [slug, to] of [
      ["mark-legacy-back", { phase: "cfp_open", ...back }],
      ["mark-legacy-on", { phase: "deciding" }],
    ] as const) {
      await fresh(slug);
      await t.db
        .update(conferences)
        .set({ phase: "reviewing", reviewBeganAt: null })
        .where(eq(conferences.slug, slug));
      expect(await markOf(slug)).toBeNull();
      t.setNow(new Date("2027-02-13T10:00:00Z"));
      expect((await move(slug, to)).status, slug).toBe(200);
      expect(await markOf(slug), slug).toBe("2027-02-13T10:00:00.000Z");
    }
  });

  it("is set by the CLI's moves as by the API's: set-phase, and import-config with a phase", async () => {
    await fresh("mark-cli");
    expect(await cli(["set-phase", "mark-cli", "reviewing"])).toBe(0);
    // The CLI's clock in these tests.
    expect(await markOf("mark-cli")).toBe("2027-03-04T05:06:07.000Z");
    expect(
      await cli(["set-phase", "mark-cli", "cfp_open", "--force", "--reason", "Stepped back"]),
    ).toBe(0);
    expect(await markOf("mark-cli")).toBe("2027-03-04T05:06:07.000Z");

    await fresh("mark-import");
    const moved = await configFile("mark-import", "Imported into review");
    expect(await cli(["import-config", moved, "--phase", "reviewing"])).toBe(0);
    expect(await phaseOf("mark-import")).toBe("reviewing");
    expect(await markOf("mark-import")).toBe("2027-03-04T05:06:07.000Z");
    // An import without a phase changes neither the phase nor the mark.
    await fresh("mark-import-plain");
    expect(await cli(["import-config", await configFile("mark-import-plain", "Plain")])).toBe(0);
    expect(await markOf("mark-import-plain")).toBeNull();
  });

  it("is set for a conference created in review or past it, and for no other", async () => {
    for (const phase of CONFERENCE_PHASES) {
      // A slug takes no underscore.
      const name = phase.replace("_", "-");
      // Through the CLI, as a new conference is imported.
      const imported = join(dir, `mark-new-${name}.json`);
      await writeFile(imported, JSON.stringify({ ...fixtureCall, slug: `mark-new-${name}` }));
      expect(await cli(["import-config", imported, "--phase", phase])).toBe(0);
      expect((await markOf(`mark-new-${name}`)) !== null, `imported in ${phase}`).toBe(
        reviewersCanRead(phase),
      );
      // And as the seeds create one.
      const made = await createConferenceIfMissing(
        t.db,
        { ...fixtureCall, slug: `mark-made-${name}` },
        phase,
      );
      expect(made?.reviewBeganAt !== null, `created in ${phase}`).toBe(reviewersCanRead(phase));
      const saved = await saveConference(
        t.db,
        { ...fixtureCall, slug: `mark-saved-${name}` },
        phase,
      );
      expect(saved.reviewBeganAt !== null, `saved in ${phase}`).toBe(reviewersCanRead(phase));
    }
  });

  it("is kept in step when a phase is written over an existing conference, and left alone when none is", async () => {
    await fresh("mark-over");
    // Put into review: marked. Its configuration saved again, without a phase: as it was.
    const into = await saveConference(t.db, { ...fixtureCall, slug: "mark-over" }, "reviewing");
    expect(into.reviewBeganAt).not.toBeNull();
    const again = await saveConference(t.db, { ...fixtureCall, slug: "mark-over" });
    expect(again).toMatchObject({ phase: "reviewing", reviewBeganAt: into.reviewBeganAt });
    // Written back out of review: the mark stays.
    const out = await saveConference(t.db, { ...fixtureCall, slug: "mark-over" }, "cfp_open");
    expect(out).toMatchObject({ phase: "cfp_open", reviewBeganAt: into.reviewBeganAt });
    // A row that was in review without a mark gets one when its phase is written over.
    await t.db
      .update(conferences)
      .set({ phase: "deciding", reviewBeganAt: null })
      .where(eq(conferences.slug, "mark-over"));
    const legacy = await saveConference(t.db, { ...fixtureCall, slug: "mark-over" }, "cfp_open");
    expect(legacy.phase).toBe("cfp_open");
    expect(legacy.reviewBeganAt).not.toBeNull();
    // And one that never was in review stays without.
    await fresh("mark-never");
    const never = await saveConference(t.db, { ...fixtureCall, slug: "mark-never" }, "draft");
    expect(never.reviewBeganAt).toBeNull();
  });

  it("is given at the start of the server to every conference found in review without it, once", async () => {
    await fresh("mark-start-in");
    await fresh("mark-start-out");
    await t.db
      .update(conferences)
      .set({ phase: "confirming", reviewBeganAt: null })
      .where(eq(conferences.slug, "mark-start-in"));
    const others = await t.db.select().from(conferences);
    const waiting = others.filter((k) => reviewersCanRead(k.phase) && k.reviewBeganAt === null);
    const marked = new Map(others.map((k) => [k.slug, k.reviewBeganAt?.toISOString() ?? null]));
    expect(waiting.map((k) => k.slug)).toContain("mark-start-in");
    expect(await markReviewBegun(t.db, new Date("2027-02-14T10:00:00Z"))).toBe(waiting.length);
    expect(await markOf("mark-start-in")).toBe("2027-02-14T10:00:00.000Z");
    // Not one that is not in review; and no mark that was there is touched.
    expect(await markOf("mark-start-out")).toBeNull();
    for (const [slug, was] of marked) {
      if (was !== null) expect(await markOf(slug), slug).toBe(was);
    }
    // A second start finds nothing left to mark.
    expect(await markReviewBegun(t.db, new Date("2027-02-15T10:00:00Z"))).toBe(0);
    expect(await markOf("mark-start-in")).toBe("2027-02-14T10:00:00.000Z");
  });
});

/*
 * The same writers on a real Postgres, where the one statement written by hand (the upsert of
 * saveConference) runs as it does in production. Run this file on its own:
 *
 *   TEST_DATABASE_URL=postgres://postgres:reviews@127.0.0.1:55435/postgres \
 *     bunx vitest run apps/server/src/chairs-phases.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "the mark that review has begun, on Postgres",
  () => {
    let pg: TestApp;
    const run = Date.now();
    const slug = (name: string) => `mark-pg-${run}-${name}`;
    const row = async (name: string) =>
      (
        await pg.db
          .select()
          .from(conferences)
          .where(eq(conferences.slug, slug(name)))
      )[0];

    beforeAll(async () => {
      pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
    }, 120_000);
    afterAll(() => pg.close());

    it("is set, kept and never moved by saveConference, createConferenceIfMissing, movePhase and the start of the server", async () => {
      const a = { ...fixtureCall, slug: slug("a") };
      expect((await saveConference(pg.db, a, "cfp_open")).reviewBeganAt).toBeNull();
      const into = await saveConference(pg.db, a, "reviewing");
      expect(into).toMatchObject({ phase: "reviewing" });
      expect(into.reviewBeganAt).not.toBeNull();
      // Saved again without a phase, and then written back out of review: the mark as it was.
      expect(await saveConference(pg.db, a)).toMatchObject({
        phase: "reviewing",
        reviewBeganAt: into.reviewBeganAt,
      });
      expect(await saveConference(pg.db, a, "cfp_open")).toMatchObject({
        phase: "cfp_open",
        reviewBeganAt: into.reviewBeganAt,
      });
      // A row in review without a mark, as an earlier version leaves one: marked on the way out.
      await pg.db
        .update(conferences)
        .set({ phase: "deciding", reviewBeganAt: null })
        .where(eq(conferences.slug, a.slug));
      const legacy = await saveConference(pg.db, a, "cfp_open");
      expect(legacy.phase).toBe("cfp_open");
      expect(legacy.reviewBeganAt).not.toBeNull();
      // Never in review: no mark, whatever is written over its phase.
      const b = { ...fixtureCall, slug: slug("b") };
      await saveConference(pg.db, b, "draft");
      expect((await saveConference(pg.db, b, "cfp_open")).reviewBeganAt).toBeNull();
      // Created in a review phase: marked from its first moment.
      const created = await createConferenceIfMissing(
        pg.db,
        { ...fixtureCall, slug: slug("c") },
        "archived",
      );
      expect(created?.reviewBeganAt).not.toBeNull();

      // In review behind the app's back: the start of the server marks it, once.
      const d = await saveConference(pg.db, { ...fixtureCall, slug: slug("d") }, "cfp_open");
      await pg.db.update(conferences).set({ phase: "confirming" }).where(eq(conferences.id, d.id));
      expect((await row("d"))?.reviewBeganAt).toBeNull();
      expect(await markReviewBegun(pg.db, new Date("2027-01-01T00:00:00Z"))).toBeGreaterThanOrEqual(
        1,
      );
      expect((await row("d"))?.reviewBeganAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      expect(await markReviewBegun(pg.db, new Date("2028-01-01T00:00:00Z"))).toBe(0);
      // And a forced move back, through the CLI, leaves it as it is.
      expect(
        await runCli(["set-phase", d.slug, "cfp_open", "--force", "--reason", "Stepped back"], {
          ...ctx(),
          db: pg.db,
        }),
      ).toBe(0);
      expect(await row("d")).toMatchObject({ phase: "cfp_open" });
      expect((await row("d"))?.reviewBeganAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });
  },
);
