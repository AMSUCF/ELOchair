import { projectSelf } from "@elochair/policy";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { audit } from "../audit";
import { endSession, requestMagicLink, SESSION_COOKIE, verifyMagicLink } from "../auth";
import type { AppEnv } from "../context";
import { deliverPending } from "../mail";
import { getPerson, normalizeEmail } from "../repo";

const RequestLink = z.object({
  email: z.email(),
  lang: z.enum(["en", "es", "pt"]).default("en"),
});
const Verify = z.object({ token: z.string().min(20).max(200) });

export const authRoutes = new Hono<AppEnv>()
  .post("/request-link", async (c) => {
    const deps = c.get("deps");
    const body = RequestLink.parse(await c.req.json());
    const email = normalizeEmail(body.email);
    // The answer never depends on whether an account exists, so this cannot enumerate people.
    const okIp = deps.limits.linkPerIp.hit(c.get("clientIp"));
    const okEmail = deps.limits.linkPerEmail.hit(email);
    if (!okIp || !okEmail) return c.json({ error: "rate_limited" }, 429);

    await requestMagicLink(deps.db, {
      email,
      lang: body.lang,
      appOrigin: new URL(deps.env.APP_ORIGIN).origin,
      now: deps.now(),
    });
    deliverPending(deps.db, deps.mail).catch((err) => console.error("mail delivery failed", err));
    return c.json({ ok: true }, 202);
  })
  .post("/verify", async (c) => {
    const deps = c.get("deps");
    const { token } = Verify.parse(await c.req.json());
    const result = await verifyMagicLink(deps.db, {
      token,
      now: deps.now(),
      userAgent: c.req.header("user-agent"),
    });
    if (!result) return c.json({ error: "invalid_or_expired" }, 400);
    setCookie(c, SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: deps.env.APP_ORIGIN.startsWith("https://"),
      sameSite: "Lax",
      path: "/",
      expires: result.expiresAt,
    });
    const viewer = {
      kind: "person" as const,
      personId: result.personId,
      siteAdmin: false,
      grants: [],
    };
    await audit(deps.db, viewer, {
      action: "auth.signed_in",
      targetType: "person",
      targetId: result.personId,
    });
    const person = await getPerson(deps.db, result.personId);
    return c.json({ person: person && projectSelf(viewer, person) });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(c.get("deps").db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });
