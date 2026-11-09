import { projectSelf } from "@elochair/policy";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { audit } from "../audit";
import {
  endSession,
  linkEmail,
  requestMagicLink,
  SESSION_COOKIE,
  verifyCode,
  verifyMagicLink,
} from "../auth";
import type { AppEnv } from "../context";
import { deliverPending } from "../mail";
import { getPerson, normalizeEmail } from "../repo";

const RequestLink = z.object({
  email: z.email(),
  lang: z.enum(["en", "es", "pt"]).default("en"),
});
const Token = z.object({ token: z.string().min(20).max(200) });
const Code = z.object({ email: z.email(), code: z.string().min(8).max(20) });

/** Set the session cookie and answer with the signed-in person. */
async function signedIn(
  c: Context<AppEnv>,
  result: { personId: string; sessionToken: string; expiresAt: Date },
  method: "link" | "code",
) {
  const deps = c.get("deps");
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
    details: { method },
  });
  const person = await getPerson(deps.db, result.personId);
  return c.json({ person: person && projectSelf(viewer, person) });
}

type Outcome = "allowed" | "refused_first" | "refused";

/**
 * Audits the first refusal in each limiter window (spec 02 §2.1: every 429 is audited), without
 * the IP or the address: the row says which limit, nothing about who.
 */
async function rateLimited(c: Context<AppEnv>, outcome: Outcome, limit: string) {
  if (outcome === "refused_first") {
    await audit(c.get("deps").db, c.get("viewer"), {
      action: "auth.rate_limited",
      details: { limit },
    });
  }
  return c.json({ error: "rate_limited" }, 429);
}

export const authRoutes = new Hono<AppEnv>()
  .post("/request-link", async (c) => {
    const deps = c.get("deps");
    const body = RequestLink.parse(await c.req.json());
    const email = normalizeEmail(body.email);
    // The answer never depends on whether an account exists, so this cannot enumerate people.
    // Check the IP first: a request refused for its IP must not use up the address's budget.
    const perIp = deps.limits.linkPerIp.attempt(c.get("clientIp"));
    if (perIp !== "allowed") return rateLimited(c, perIp, "link_per_ip");
    const perEmail = deps.limits.linkPerEmail.attempt(email);
    if (perEmail !== "allowed") return rateLimited(c, perEmail, "link_per_email");
    await requestMagicLink(deps.db, {
      email,
      lang: body.lang,
      appOrigin: new URL(deps.env.APP_ORIGIN).origin,
      now: deps.now(),
      secret: deps.env.SECRET_KEY,
    });
    deliverPending(deps.db, deps.mail, { now: deps.now }).catch((err) =>
      console.error("mail delivery failed", err),
    );
    return c.json({ ok: true }, 202);
  })
  .post("/link-info", async (c) => {
    // Lets the verify page show which address a link is for before anything is used up.
    const deps = c.get("deps");
    const { token } = Token.parse(await c.req.json());
    const email = await linkEmail(deps.db, token, deps.now());
    return email ? c.json({ email }) : c.json({ error: "invalid_or_expired" }, 400);
  })
  .post("/verify", async (c) => {
    const deps = c.get("deps");
    const { token } = Token.parse(await c.req.json());
    const result = await verifyMagicLink(deps.db, {
      token,
      now: deps.now(),
      userAgent: c.req.header("user-agent"),
    });
    if (!result) return c.json({ error: "invalid_or_expired" }, 400);
    return signedIn(c, result, "link");
  })
  .post("/verify-code", async (c) => {
    const deps = c.get("deps");
    const body = Code.parse(await c.req.json());
    // Limited per IP only. Per address, brute force is already bounded by the five attempts on
    // each code and by how many codes can be requested, and a per-address limit would let any
    // IP block someone else's sign-in.
    const perIp = deps.limits.codePerIp.attempt(c.get("clientIp"));
    if (perIp !== "allowed") return rateLimited(c, perIp, "code_per_ip");
    const result = await verifyCode(deps.db, {
      email: normalizeEmail(body.email),
      code: body.code,
      now: deps.now(),
      secret: deps.env.SECRET_KEY,
      userAgent: c.req.header("user-agent"),
    });
    if (!result) return c.json({ error: "invalid_or_expired" }, 400);
    return signedIn(c, result, "code");
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(c.get("deps").db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });
