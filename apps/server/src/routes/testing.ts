import { Hono } from "hono";
import type { AppEnv } from "../context";
import { deliverPending, MemoryTransport } from "../mail";

/**
 * Mounted only when NODE_ENV=test and ENABLE_TEST_ENDPOINTS=1 (enforced in env.ts).
 * Reads what was actually delivered: stored copies of sign-in mail are redacted after sending.
 */
export const testRoutes = new Hono<AppEnv>().get("/outbox/latest", async (c) => {
  const to = c.req.query("to")?.toLowerCase();
  if (!to) return c.json({ error: "missing_to" }, 400);
  const { db, mail, now } = c.get("deps");
  if (!(mail instanceof MemoryTransport))
    return c.json({ error: "memory_transport_required" }, 400);
  await deliverPending(db, mail, { now });
  const m = mail.latestTo(to);
  return m ? c.json({ subject: m.subject, text: m.text }) : c.json({ error: "not_found" }, 404);
});
