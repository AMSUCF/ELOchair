import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { outbox } from "../db/schema";

/** Mounted only when NODE_ENV=test and ENABLE_TEST_ENDPOINTS=1 (enforced in env.ts). */
export const testRoutes = new Hono<AppEnv>().get("/outbox/latest", async (c) => {
  const to = c.req.query("to")?.toLowerCase();
  if (!to) return c.json({ error: "missing_to" }, 400);
  const [m] = await c
    .get("deps")
    .db.select()
    .from(outbox)
    .where(eq(outbox.toEmail, to))
    .orderBy(desc(outbox.createdAt))
    .limit(1);
  return m ? c.json({ subject: m.subject, text: m.bodyText }) : c.json({ error: "not_found" }, 404);
});
