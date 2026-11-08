import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { Tier } from "@elochair/policy";
import { ConferenceRole, conferences } from "@elochair/schema";
import { eq } from "drizzle-orm";
import { audit } from "./audit";
import { openDatabase } from "./db/client";
import { apiTokens, people } from "./db/schema";
import { loadEnv } from "./env";
import { seedSandbox } from "./fixtures";
import {
  createApiToken,
  findOrCreatePerson,
  getConference,
  grantRole,
  revokeApiToken,
  saveConference,
} from "./repo";

const HELP = `ELOchair command line. Usage: npm run cli -- <command> [options]

  migrate                                   apply database migrations
  seed [--sandbox]                          load the ELO 2026 and ELO 2027 configurations;
                                            --sandbox also loads synthetic test data
  import-config <file.json> [--phase P]     create or replace a conference from a JSON config
  export-config <slug>                      print a conference's configuration as JSON
  site-admin <email>                        make someone a site administrator
  grant <email> <slug> <role> [--scope a,b] roles: ${ConferenceRole.options.join(", ")}
  create-token <email> <slug> --tier M|C --name NAME [--days N]
                                            agent token for a chair (printed once)
  list-tokens <slug>                        list agent tokens (never the secrets)
  revoke-token <token-id>                   revoke an agent token

Uses DATABASE_URL, or the development PGlite database in .data/pglite (stop the dev server first).`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    sandbox: { type: "boolean" },
    phase: { type: "string" },
    scope: { type: "string" },
    tier: { type: "string" },
    name: { type: "string" },
    days: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const [command, ...args] = positionals;
if (!command || values.help) {
  console.log(HELP);
  process.exit(command ? 0 : 1);
}

const env = loadEnv();
const database = openDatabase({
  url: env.DATABASE_URL,
  dataDir: env.DATA_DIR ?? (env.DATABASE_URL ? undefined : ".data/pglite"),
  migrationsDir: env.MIGRATIONS_DIR,
});
const { db } = database;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const arg = (i: number, name: string) => args[i] ?? fail(`missing <${name}>\n\n${HELP}`);
async function conferenceOrFail(slug: string) {
  return (await getConference(db, slug)) ?? fail(`no conference "${slug}"`);
}

try {
  switch (command) {
    case "migrate":
      await database.migrate();
      console.log("migrations applied");
      break;
    case "seed": {
      await database.migrate();
      await saveConference(db, conferences.elo2026, "archived");
      await saveConference(db, conferences.elo2027, "draft");
      console.log("loaded elo2026 (archived) and elo2027 (draft placeholder)");
      if (values.sandbox) {
        const s = await seedSandbox(db);
        console.log(
          `sandbox: ${s.submissionCount} synthetic submissions, ${s.assignmentCount} assignments\n` +
            `  sign in as ${s.chairEmail} (chair), ${s.adminEmail} (admin), or ${s.reviewerEmails[0]} (reviewer)`,
        );
      }
      break;
    }
    case "import-config": {
      const json = JSON.parse(await readFile(arg(0, "file.json"), "utf8"));
      const saved = await saveConference(db, json, values.phase);
      await audit(db, "system", { action: "conference.config_imported", conferenceId: saved.id });
      console.log(`saved ${saved.slug} (phase ${saved.phase})`);
      break;
    }
    case "export-config": {
      const k = await conferenceOrFail(arg(0, "slug"));
      console.log(JSON.stringify(k.config, null, 2));
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
      console.log(`${p.email} is now a site administrator`);
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
      console.log(
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
        expiresAt: new Date(Date.now() + days * 86_400_000),
      });
      await audit(db, "system", {
        action: "agent_token.created",
        conferenceId: k.id,
        targetType: "api_token",
        targetId: created.id,
        details: { tier, name, ownerId: p.id, days },
      });
      console.log(
        `token ${created.id} (tier ${tier}, expires in ${days} days). Shown once:\n\n${created.token}\n`,
      );
      if (tier === "C")
        console.log(
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
      console.table(rows);
      break;
    }
    case "revoke-token": {
      const ok = await revokeApiToken(db, arg(0, "token-id"));
      if (!ok) fail("no such token");
      await audit(db, "system", {
        action: "agent_token.revoked",
        targetType: "api_token",
        targetId: args[0],
      });
      console.log("revoked");
      break;
    }
    default:
      fail(`unknown command "${command}"\n\n${HELP}`);
  }
} finally {
  await database.close();
}
