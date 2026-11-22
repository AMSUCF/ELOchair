import { Hono } from "hono";
import type { AppEnv } from "../context";
import { deliverPending, MemoryTransport } from "../mail";
import { runNotifications } from "../services/notifications";

/**
 * Mounted only when NODE_ENV=test and ENABLE_TEST_ENDPOINTS=1 (enforced in env.ts).
 * - `/outbox/latest` reads what was actually delivered: stored copies of sign-in mail are
 *   redacted after sending. With `kind` it is the latest email of that kind to the address
 *   (`magic_link` for the sign-in email), whatever else was sent there since.
 * - `/notifications/run` runs the job that makes the emails of the review phase, now, so that
 *   a test need not wait for the server's timer. It answers what the run did.
 */
export const testRoutes = new Hono<AppEnv>()
  .get("/outbox/latest", async (c) => {
    const to = c.req.query("to")?.toLowerCase();
    if (!to) return c.json({ error: "missing_to" }, 400);
    const { db, mail, now } = c.get("deps");
    if (!(mail instanceof MemoryTransport))
      return c.json({ error: "memory_transport_required" }, 400);
    await deliverPending(db, mail, { now });
    const m = mail.latestTo(to, c.req.query("kind"));
    return m ? c.json({ subject: m.subject, text: m.text }) : c.json({ error: "not_found" }, 404);
  })
  .get("/notifications/run", async (c) => c.json(await runNotifications(c.get("deps"))));
