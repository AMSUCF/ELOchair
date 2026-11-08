import type { PersonViewer } from "@elochair/policy";
import type { Context } from "hono";
import type { AppEnv } from "../context";

/** A deliberate refusal with a stable error code; thrown inside transactions to roll back. */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function refuse(c: Context<AppEnv>, r: Refusal) {
  return c.json({ error: r.code, ...r.extra }, r.status);
}

/**
 * The signed-in person, or a refusal: agents may never write (403 agents_read_only), and the
 * public must sign in (401). Also applies the per-person write rate limit.
 */
export function writer(c: Context<AppEnv>): PersonViewer {
  const viewer = c.get("viewer");
  if (viewer.kind === "agent") throw new Refusal(403, "agents_read_only");
  if (viewer.kind !== "person") throw new Refusal(401, "unauthenticated");
  if (!c.get("deps").limits.writesPerPerson.hit(viewer.personId)) {
    throw new Refusal(429, "rate_limited");
  }
  return viewer;
}

export function person(c: Context<AppEnv>): PersonViewer {
  const viewer = c.get("viewer");
  if (viewer.kind !== "person") throw new Refusal(401, "unauthenticated");
  return viewer;
}
