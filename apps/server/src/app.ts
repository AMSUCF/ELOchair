import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PUBLIC, type Viewer } from "@elochair/policy";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { audit } from "./audit";
import { SESSION_COOKIE, sessionViewer, tokenViewer } from "./auth";
import type { AppEnv, Deps, Exposure } from "./context";
import { authRoutes } from "./routes/auth";
import { conferenceRoutes } from "./routes/conferences";
import { meRoutes } from "./routes/me";
import { testRoutes } from "./routes/testing";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function clientIp(c: Parameters<MiddlewareHandler<AppEnv>>[0], trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // app.request() in tests has no socket
  }
}

/**
 * Who is asking. Bearer tokens are agents; the session cookie is a person (public listener only).
 * Tier C (content) tokens are refused on the public listener: that is the technical half of
 * "content stays local". The internal listener is bound to loopback / the private network.
 */
function resolveViewer(deps: Deps, exposure: Exposure): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("deps", deps);
    c.set("exposure", exposure);
    c.set("clientIp", clientIp(c, deps.env.TRUST_PROXY));
    const now = deps.now();
    const auth = c.req.header("authorization");
    let viewer: Viewer = PUBLIC;

    if (auth?.startsWith("Bearer ")) {
      const agent = await tokenViewer(deps.db, auth.slice("Bearer ".length).trim(), now);
      if (!agent) return c.json({ error: "invalid_token" }, 401);
      if (agent.tier === "C" && exposure === "public") {
        await audit(deps.db, agent, {
          action: "agent.refused_tier_c_on_public",
          conferenceId: agent.conferenceId,
          details: { method: c.req.method, path: c.req.path },
        });
        return c.json(
          {
            error: "tier_c_internal_only",
            message:
              "Content-tier (C) tokens only work on the internal listener, for local models. Use a tier M token here.",
          },
          403,
        );
      }
      viewer = agent;
    } else if (exposure === "public") {
      const session = getCookie(c, SESSION_COOKIE);
      if (session) viewer = (await sessionViewer(deps.db, session, now)) ?? PUBLIC;
    } else {
      return c.json(
        { error: "token_required", message: "The internal listener only serves agents." },
        401,
      );
    }
    c.set("viewer", viewer);
    await next();
  };
}

/** Cookie-authenticated writes must come from the app's own origin and be JSON. */
function csrf(deps: Deps): MiddlewareHandler<AppEnv> {
  const allowed = new URL(deps.env.APP_ORIGIN).origin;
  return async (c, next) => {
    if (MUTATING.has(c.req.method) && c.get("viewer").kind !== "agent") {
      if (c.req.header("origin") !== allowed) return c.json({ error: "bad_origin" }, 403);
      if (!c.req.header("content-type")?.startsWith("application/json")) {
        return c.json({ error: "json_required" }, 415);
      }
    }
    await next();
  };
}

/** Every agent request is recorded: who, which token and tier, what, and the outcome. */
function auditAgents(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const viewer = c.get("viewer");
    if (viewer?.kind === "agent") {
      await audit(c.get("deps").db, viewer, {
        action: "agent.request",
        conferenceId: viewer.conferenceId,
        details: { method: c.req.method, path: c.req.path, status: c.res.status },
      });
    }
  };
}

export function createApp(deps: Deps, exposure: Exposure) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "invalid",
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400,
      );
    }
    if (err instanceof SyntaxError) return c.json({ error: "invalid_json" }, 400);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, exposure }));

  app.use("/api/*", resolveViewer(deps, exposure), csrf(deps), auditAgents());
  app.route("/api/auth", authRoutes);
  app.route("/api/me", meRoutes);
  app.route("/api/conferences", conferenceRoutes);
  if (deps.env.ENABLE_TEST_ENDPOINTS) app.route("/api/_test", testRoutes);
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  const dist = deps.env.WEB_DIST;
  if (exposure === "public" && dist) {
    app.use(
      "/assets/*",
      serveStatic({
        root: dist,
        onFound: (_p, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.use("*", serveStatic({ root: dist }));
    // Single-page app: unknown paths get index.html so client-side routes work on refresh.
    let indexHtml: string | undefined;
    app.get("*", async (c) => {
      indexHtml ??= await readFile(join(dist, "index.html"), "utf8");
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }
  return app;
}
