import { conferences } from "@elochair/schema";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { openDatabase } from "./db/client";
import { makeDeps } from "./deps";
import { loadEnv } from "./env";
import { seedChairReviews, seedOpenCall, seedPhaseRoom, seedSandbox } from "./fixtures";
import { deliverPending } from "./mail";
import { createConferenceIfMissing, getConference } from "./repo";

const env = loadEnv();
const dataDir = env.DATA_DIR ?? (env.DATABASE_URL ? undefined : ".data/pglite");
const database = openDatabase({
  url: env.DATABASE_URL,
  dataDir,
  migrationsDir: env.MIGRATIONS_DIR,
});
if (env.MIGRATE_ON_START || !env.DATABASE_URL) await database.migrate();

if (env.SEED_ON_START) {
  await createConferenceIfMissing(database.db, conferences.elo2026, "archived");
  await createConferenceIfMissing(database.db, conferences.elo2027, "draft");
  if (!(await getConference(database.db, "sandbox"))) await seedSandbox(database.db);
  // The sandbox stays in review, where its reviewers write. A phase is moved in this one.
  if (!(await getConference(database.db, "phase-room"))) {
    await seedPhaseRoom(database.db, { chairEmails: ["chair@example.org"] });
  }
  // A chair may also review: a small conference where the sandbox's chair does.
  if (!(await getConference(database.db, "chair-reviews"))) {
    await seedChairReviews(database.db, { chairEmail: "chair@example.org" });
  }
  await seedOpenCall(database.db, {
    now: new Date(),
    chairEmails: ["chair@example.org", "admin@example.org"],
  });
  console.log(
    "seeded elo2026, elo2027, the synthetic sandbox, an empty conference in review (phase-room), a small one whose chair also reviews (chair-reviews) and an open test call (elo2027-open); sign in as chair@example.org",
  );
}

const deps = makeDeps(database.db, env);
const publicServer = serve({
  fetch: createApp(deps, "public").fetch,
  hostname: env.PUBLIC_HOST,
  port: env.PUBLIC_PORT,
});
const internalServer = serve({
  fetch: createApp(deps, "internal").fetch,
  hostname: env.INTERNAL_HOST,
  port: env.INTERNAL_PORT,
});
console.log(`ELOchair public listener   http://${env.PUBLIC_HOST}:${env.PUBLIC_PORT}`);
console.log(
  `ELOchair internal listener http://${env.INTERNAL_HOST}:${env.INTERNAL_PORT} (tier C agents only)`,
);

const mailTimer = setInterval(() => {
  deliverPending(deps.db, deps.mail).catch((err) => console.error("mail delivery failed", err));
}, 30_000);

async function shutdown() {
  clearInterval(mailTimer);
  publicServer.close();
  internalServer.close();
  await database.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
