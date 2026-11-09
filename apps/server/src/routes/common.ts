import type { PersonViewer } from "@elochair/policy";
import type { Context } from "hono";
import { type AuditEntry, audit } from "../audit";
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

/**
 * 429 `rate_limited`, which is audited. Thrown inside a transaction, an audit row written there
 * would roll back with everything else, so whoever runs the transaction (mutateSubmission)
 * writes `entry` after the rollback. `entry` holds IDs and enumerations only.
 */
export class RateLimited extends Refusal {
  constructor(readonly entry: AuditEntry) {
    super(429, "rate_limited");
  }
}

export function refuse(c: Context<AppEnv>, r: Refusal) {
  return c.json({ error: r.code, ...r.extra }, r.status);
}

/**
 * The signed-in person, or a refusal: agents may never write (403 agents_read_only), and the
 * public must sign in (401). Also applies the per-person write rate limit; the first refusal in
 * each window is audited.
 */
export function writer(c: Context<AppEnv>): PersonViewer {
  const viewer = c.get("viewer");
  if (viewer.kind === "agent") throw new Refusal(403, "agents_read_only");
  if (viewer.kind !== "person") throw new Refusal(401, "unauthenticated");
  const deps = c.get("deps");
  const outcome = deps.limits.writesPerPerson.attempt(viewer.personId);
  if (outcome !== "allowed") {
    if (outcome === "refused_first") {
      // writer() is synchronous for its callers, so the row is written without waiting for it.
      audit(deps.db, viewer, {
        action: "person.rate_limited",
        details: { limit: "writes_per_person", method: c.req.method, route: c.req.routePath },
      }).catch((err) => console.error("audit of a rate-limit refusal failed", err));
    }
    throw new Refusal(429, "rate_limited");
  }
  return viewer;
}

export function person(c: Context<AppEnv>): PersonViewer {
  const viewer = c.get("viewer");
  if (viewer.kind !== "person") throw new Refusal(401, "unauthenticated");
  return viewer;
}
