import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conferences as configs, isForwardPhaseMove } from "@elochair/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliContext, runCli } from "./cli";
import { auditLog, conferences } from "./db/schema";
import { seedOpenCall } from "./fixtures";
import { getConference, grantRole, saveConference } from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Conference phases move forward only, unless forced with a reason, and every move is audited
 * with from, to and reason: through the API (under a row lock), set-phase, import-config and
 * seed --force.
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
    const { conferenceId } = await seedOpenCall(t.db, { slug, now: new Date("2027-02-01") });
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
    await writeFile(path, JSON.stringify({ ...configs.elo2027, slug: "brand-new" }));
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
});
