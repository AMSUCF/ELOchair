import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Tier } from "@elochair/policy";
import { ConferenceConfig, ConferencePhase, ConferenceRole, conferences } from "@elochair/schema";
import { eq } from "drizzle-orm";
import { audit } from "./audit";
import { type Db, openDatabase } from "./db/client";
import { apiTokens, people } from "./db/schema";
import { type Env, loadEnv } from "./env";
import { seedSandbox } from "./fixtures";
import {
  createApiToken,
  createConferenceIfMissing,
  findOrCreatePerson,
  getConference,
  grantRole,
  movePhase,
  type PhaseMoveResult,
  revokeApiToken,
  saveConference,
} from "./repo";

const HELP = `ELOchair command line. Usage: npm run cli -- <command> [options]

  migrate                                   apply database migrations
  seed [--sandbox] [--force]                add the ELO 2026 and ELO 2027 configurations if
                                            missing; --force replaces them and resets their
                                            phases (development only: refused in production);
                                            --sandbox also loads synthetic test data
  import-config <file.json> [--phase P [--force --reason TEXT]] [--slug S] [--window OPEN/CLOSE]
                                            create or replace a conference from a JSON config;
                                            an existing conference's phase moves forward only
                                            unless forced with a reason; --slug and --window
                                            (ISO times) make a dry-run copy
  set-phase <slug> <phase> [--force --reason TEXT]
                                            move a conference to a phase (forward only unless
                                            forced with a reason)
  export-config <slug>                      print a conference's configuration as JSON
  site-admin <email>                        make someone a site administrator
  grant <email> <slug> <role> [--scope a,b] roles: ${ConferenceRole.options.join(", ")}
  create-token <email> <slug> --tier M|C --name NAME [--days N]
                                            agent token for a chair (printed once)
  list-tokens <slug>                        list agent tokens (never the secrets)
  revoke-token <token-id>                   revoke an agent token

Uses DATABASE_URL, or the development PGlite database in .data/pglite (stop the dev server first).`;

/** What a command needs from its surroundings; tests pass an in-memory database. */
export type CliContext = {
  db: Db;
  env: Pick<Env, "NODE_ENV">;
  migrate: () => Promise<void>;
  /** Who ran the command, for the audit log. */
  user?: string;
  now?: () => Date;
  out?: Pick<Console, "log" | "error" | "table">;
};

/** A refusal or usage error: printed, and the command exits with status 1. */
class CliFailure extends Error {}
function fail(message: string): never {
  throw new CliFailure(message);
}

function phaseArg(value: string): ConferencePhase {
  const parsed = ConferencePhase.safeParse(value);
  if (!parsed.success)
    fail(`unknown phase "${value}"; phases: ${ConferencePhase.options.join(", ")}`);
  return parsed.data;
}

/** Why a phase move was refused, in words. */
function phaseRefusal(slug: string, to: string, result: Exclude<PhaseMoveResult, { ok: true }>) {
  if (result.code === "not_found") return `no conference "${slug}"`;
  if (result.code === "stale") return `${slug} changed phase meanwhile; run the command again`;
  return `${slug} is in ${result.from}: moving it to ${to} is not a forward move and needs --force and --reason`;
}

function parseCli(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      sandbox: { type: "boolean" },
      force: { type: "boolean" },
      phase: { type: "string" },
      slug: { type: "string" },
      window: { type: "string" },
      reason: { type: "string" },
      scope: { type: "string" },
      tier: { type: "string" },
      name: { type: "string" },
      days: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...args] = positionals;
  return { command, args, values, help: !command || Boolean(values.help) };
}

/** Run one command line (without the program name). Returns the exit status. */
export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const parsed = parseCli(argv);
  if (parsed.help) {
    (ctx.out ?? console).log(HELP);
    return parsed.command ? 0 : 1;
  }
  return runCommand(parsed, ctx);
}

async function runCommand(
  { command, args, values }: ReturnType<typeof parseCli>,
  ctx: CliContext,
): Promise<number> {
  const out = ctx.out ?? console;
  const now = ctx.now ?? (() => new Date());
  const by = ctx.user ?? "unknown";
  const { db } = ctx;
  const arg = (i: number, name: string) => args[i] ?? fail(`missing <${name}>\n\n${HELP}`);
  const conferenceOrFail = async (slug: string) =>
    (await getConference(db, slug)) ?? fail(`no conference "${slug}"`);
  const forced = Boolean(values.force);
  const reason = values.reason?.trim() || undefined;

  /** Audit a phase move made by the CLI (inside the move's transaction). */
  const auditPhaseChange = (
    tx: Db,
    conferenceId: string,
    move: { from: string; to: string; forced: boolean; reason?: string },
  ) =>
    audit(tx, "system", {
      action: "conference.phase_changed",
      conferenceId,
      targetType: "conference",
      targetId: conferenceId,
      details: {
        from: move.from,
        to: move.to,
        forced: move.forced,
        by,
        ...(move.reason ? { reason: move.reason } : {}),
      },
    });

  try {
    switch (command) {
      case "migrate":
        await ctx.migrate();
        out.log("migrations applied");
        break;
      case "seed": {
        // --force overwrites the real configurations with the built-in placeholders and resets
        // their phases: a development reset, never something to run against a live conference.
        if (values.force && ctx.env.NODE_ENV === "production") {
          fail(
            "seed --force is for development only: it would replace live configurations and phases. In production use import-config and set-phase.",
          );
        }
        await ctx.migrate();
        for (const [config, phase] of [
          [conferences.elo2026, "archived"],
          [conferences.elo2027, "draft"],
        ] as const) {
          const existing = await getConference(db, config.slug);
          if (existing && !values.force) {
            out.log(`${config.slug} already exists; left unchanged (use --force to replace it)`);
            continue;
          }
          if (!existing) {
            const created = await createConferenceIfMissing(db, config, phase);
            if (!created) continue;
            await audit(db, "system", {
              action: "conference.created",
              conferenceId: created.id,
              targetType: "conference",
              targetId: created.id,
              details: { slug: created.slug, phase: created.phase, source: "seed" },
            });
            out.log(`added ${created.slug} (phase ${created.phase})`);
            continue;
          }
          const seedReason = reason ?? "seed --force";
          const saved = await db.transaction(async (txRaw) => {
            const tx = txRaw as unknown as Db;
            if (existing.phase !== phase) {
              const moved = await movePhase(tx, existing.id, {
                to: phase,
                force: true,
                reason: seedReason,
                now: now(),
              });
              if (!moved.ok) fail(phaseRefusal(config.slug, phase, moved));
              await auditPhaseChange(tx, existing.id, {
                from: moved.from,
                to: phase,
                forced: true,
                reason: seedReason,
              });
            }
            const replaced = await saveConference(tx, config);
            await audit(tx, "system", {
              action: "conference.config_replaced",
              conferenceId: replaced.id,
              targetType: "conference",
              targetId: replaced.id,
              details: { slug: replaced.slug, phase: replaced.phase, source: "seed" },
            });
            return replaced;
          });
          out.log(`replaced ${saved.slug} (phase ${existing.phase} → ${saved.phase})`);
        }
        if (values.sandbox) {
          if (await getConference(db, "sandbox")) {
            out.log("sandbox already exists; left unchanged");
            break;
          }
          const s = await seedSandbox(db);
          out.log(
            `sandbox: ${s.submissionCount} synthetic submissions, ${s.assignmentCount} assignments\n` +
              `  sign in as ${s.chairEmail} (chair), ${s.adminEmail} (admin), or ${s.reviewerEmails[0]} (reviewer)`,
          );
        }
        break;
      }
      case "import-config": {
        const json = JSON.parse(await readFile(arg(0, "file.json"), "utf8"));
        if (values.slug) json.slug = values.slug;
        if (values.window) {
          const [open, close] = values.window.split("/");
          if (
            !open ||
            !close ||
            Number.isNaN(Date.parse(open)) ||
            Number.isNaN(Date.parse(close))
          ) {
            fail(
              "--window must be OPEN/CLOSE as ISO times, e.g. 2026-12-01T00:00:00-05:00/2026-12-15T23:59:00-05:00",
            );
          }
          json.deadlines = { ...json.deadlines, submissionsOpen: open, submissionsClose: close };
        }
        const config = ConferenceConfig.parse(json);
        const phase = values.phase === undefined ? undefined : phaseArg(values.phase);
        const saved = await db.transaction(async (txRaw) => {
          const tx = txRaw as unknown as Db;
          const existing = await getConference(tx, config.slug);
          // A new conference starts in the phase given. An existing one moves like set-phase:
          // forward only unless forced with a reason, checked and audited before the import.
          let moved: { from: string; to: string } | null = null;
          if (existing && phase && phase !== existing.phase) {
            const result = await movePhase(tx, existing.id, {
              to: phase,
              force: forced,
              reason,
              now: now(),
            });
            if (!result.ok) fail(phaseRefusal(config.slug, phase, result));
            moved = { from: result.from, to: phase };
            await auditPhaseChange(tx, existing.id, { ...moved, forced, reason });
          }
          const row = await saveConference(tx, config, existing ? undefined : phase);
          await audit(tx, "system", {
            action: "conference.config_imported",
            conferenceId: row.id,
            targetType: "conference",
            targetId: row.id,
            details: {
              slug: row.slug,
              phase: row.phase,
              created: !existing,
              ...(moved ? { from: moved.from } : {}),
              by,
            },
          });
          return row;
        });
        out.log(`saved ${saved.slug} (phase ${saved.phase})`);
        break;
      }
      case "set-phase": {
        const k = await conferenceOrFail(arg(0, "slug"));
        const phase = phaseArg(arg(1, "phase"));
        const from = await db.transaction(async (txRaw) => {
          const tx = txRaw as unknown as Db;
          const moved = await movePhase(tx, k.id, { to: phase, force: forced, reason, now: now() });
          if (!moved.ok) fail(phaseRefusal(k.slug, phase, moved));
          await auditPhaseChange(tx, k.id, { from: moved.from, to: phase, forced, reason });
          return moved.from;
        });
        out.log(`${k.slug}: ${from} → ${phase}`);
        break;
      }
      case "export-config": {
        const k = await conferenceOrFail(arg(0, "slug"));
        out.log(JSON.stringify(k.config, null, 2));
        break;
      }
      case "site-admin": {
        const p = await findOrCreatePerson(db, arg(0, "email"));
        await db.update(people).set({ siteAdmin: true }).where(eq(people.id, p.id));
        await audit(db, "system", {
          action: "person.site_admin_granted",
          targetType: "person",
          targetId: p.id,
        });
        out.log(`${p.email} is now a site administrator`);
        break;
      }
      case "grant": {
        const p = await findOrCreatePerson(db, arg(0, "email"));
        const k = await conferenceOrFail(arg(1, "slug"));
        const role = ConferenceRole.parse(arg(2, "role"));
        const scope = values.scope?.split(",").filter(Boolean) ?? [];
        await grantRole(db, { conferenceId: k.id, personId: p.id, role, scope });
        await audit(db, "system", {
          action: "role.granted",
          conferenceId: k.id,
          targetType: "person",
          targetId: p.id,
          details: { role, scope },
        });
        out.log(
          `${p.email} is ${role} of ${k.slug}${scope.length ? ` (${scope.join(", ")})` : ""}`,
        );
        break;
      }
      case "create-token": {
        const p = await findOrCreatePerson(db, arg(0, "email"));
        const k = await conferenceOrFail(arg(1, "slug"));
        const tier = values.tier?.toUpperCase();
        if (tier !== "M" && tier !== "C")
          fail("--tier must be M (cloud-safe metadata) or C (local models only)");
        const name =
          values.name ?? fail("--name is required, e.g. --name 'Claude Code on my laptop'");
        const days = values.days ? Number(values.days) : 90;
        const created = await createApiToken(db, {
          personId: p.id,
          conferenceId: k.id,
          tier: tier as Tier,
          name,
          expiresAt: new Date(now().getTime() + days * 86_400_000),
        });
        await audit(db, "system", {
          action: "agent_token.created",
          conferenceId: k.id,
          targetType: "api_token",
          targetId: created.id,
          details: { tier, name, ownerId: p.id, days },
        });
        out.log(
          `token ${created.id} (tier ${tier}, expires in ${days} days). Shown once:\n\n${created.token}\n`,
        );
        if (tier === "C")
          out.log(
            "Tier C works only on the internal listener (local models). Never give it to a cloud agent.",
          );
        break;
      }
      case "list-tokens": {
        const k = await conferenceOrFail(arg(0, "slug"));
        const rows = await db
          .select({
            id: apiTokens.id,
            tier: apiTokens.tier,
            name: apiTokens.name,
            owner: people.email,
            expiresAt: apiTokens.expiresAt,
            revokedAt: apiTokens.revokedAt,
            lastUsedAt: apiTokens.lastUsedAt,
          })
          .from(apiTokens)
          .innerJoin(people, eq(people.id, apiTokens.personId))
          .where(eq(apiTokens.conferenceId, k.id));
        out.table(rows);
        break;
      }
      case "revoke-token": {
        const ok = await revokeApiToken(db, arg(0, "token-id"));
        if (!ok) fail("no such token, or it was already revoked");
        await audit(db, "system", {
          action: "agent_token.revoked",
          targetType: "api_token",
          targetId: args[0],
        });
        out.log("revoked");
        break;
      }
      default:
        fail(`unknown command "${command}"\n\n${HELP}`);
    }
  } catch (err) {
    if (err instanceof CliFailure) {
      out.error(err.message);
      return 1;
    }
    throw err;
  }
  return 0;
}

/** Run as a program (tsx src/cli.ts, or node dist/cli.js), not when a test imports it. */
const isMain = (() => {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.help) {
    console.log(HELP);
    process.exitCode = parsed.command ? 0 : 1;
  } else {
    const env = loadEnv();
    const database = openDatabase({
      url: env.DATABASE_URL,
      dataDir: env.DATA_DIR ?? (env.DATABASE_URL ? undefined : ".data/pglite"),
      migrationsDir: env.MIGRATIONS_DIR,
    });
    try {
      process.exitCode = await runCommand(parsed, {
        db: database.db,
        env,
        migrate: database.migrate,
        user: process.env.USER,
      });
    } finally {
      await database.close();
    }
  }
}
