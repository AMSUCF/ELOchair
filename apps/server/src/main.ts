import { conferences } from "@elochair/schema";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { openDatabase } from "./db/client";
import { makeDeps } from "./deps";
import { loadEnv } from "./env";
import {
  seedChairReviews,
  seedDecisionsRoom,
  seedOpenCall,
  seedPhaseRoom,
  seedSandbox,
} from "./fixtures";
import { deliverPending } from "./mail";
import { createConferenceIfMissing, getConference, markReviewBegun } from "./repo";
import { runNotifications } from "./services/notifications";

const env = loadEnv();
const dataDir = env.DATA_DIR ?? (env.DATABASE_URL ? undefined : ".data/pglite");
const database = openDatabase({
  url: env.DATABASE_URL,
  dataDir,
  migrationsDir: env.MIGRATIONS_DIR,
});
if (env.MIGRATE_ON_START || !env.DATABASE_URL) await database.migrate();
// A conference that is in review, or past it, and was never marked as having been (it got
// there before the mark existed, or under an earlier version of the app) is marked now, before
// any request is served: the guard on the review form's settings decides by the mark.
await markReviewBegun(database.db, new Date());

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
  // Decisions are recorded and sent in a conference of their own, past its review.
  if (!(await getConference(database.db, "decisions-room"))) {
    await seedDecisionsRoom(database.db, { chairEmail: "chair@example.org" });
  }
  await seedOpenCall(database.db, {
    now: new Date(),
    chairEmails: ["chair@example.org", "admin@example.org"],
  });
  console.log(
    "seeded elo2026, elo2027, the synthetic sandbox, an empty conference in review (phase-room), a small one whose chair also reviews (chair-reviews), a small one whose decisions are being made (decisions-room) and an open test call (elo2027-open); sign in as chair@example.org",
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

// Every half minute: first the emails of the review phase are made of what has happened (spec
// 03, §1.7: decided by each person's choice, and safe to run as often as one likes), then
// whatever is in the outbox is delivered. A failure of the first does not hold up the second.
const mailTimer = setInterval(() => {
  runNotifications(deps)
    .catch((err) => console.error("notifications failed", err))
    .then(() => deliverPending(deps.db, deps.mail))
    .catch((err) => console.error("mail delivery failed", err));
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
