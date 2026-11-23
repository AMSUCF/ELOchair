import {
  DecisionInput,
  DecisionsPoolQuery,
  DecisionsQuery,
  SendDecisionsInput,
} from "@elochair/schema";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../context";
import { cursorsFor } from "../cursor";
import { AssignmentsCursorRefused } from "../services/assignments";
import {
  authorDecision,
  decisionsPage,
  proposalDecision,
  recordDecision,
  sendConfirmation,
  sendDecisions,
  takeBackDecision,
} from "../services/decisions";
import { idParam, Refusal, writer } from "./common";
import { chairInPerson } from "./conferences";

/** A page of the Decisions list; a cursor that does not open reads as any malformed input. */
async function page(c: Context<AppEnv>, limit: number, only?: { pool: string; cursor?: string }) {
  const { viewer, k } = await chairInPerson(c);
  const { db, env } = c.get("deps");
  try {
    const cursors = cursorsFor(env.SECRET_KEY);
    const view = await decisionsPage(db, viewer, k, { limit, cursors, only });
    if (!view) throw new Refusal(403, "forbidden");
    return view;
  } catch (err) {
    if (err instanceof AssignmentsCursorRefused) {
      throw new Refusal(400, "invalid", {
        issues: [{ path: "cursor", message: "not a cursor from a previous page" }],
      });
    }
    throw err;
  }
}

/**
 * Decisions (spec 03, §1.6), mounted at /api/conferences/:slug/decisions. Every route is for a
 * chair of that conference, in person (chairInPerson): 404 for a draft conference the caller
 * cannot see, 403 for everyone else, an agent included, whatever its tier.
 *
 * The routes about one proposal are for a chair who is given that proposal as a chair. For any
 * other (their own, one they have a conflict with, a draft, another conference's, none at all)
 * the answer is one and the same: 404 `not_found`. The routes that change something count
 * toward the person's write limit (writer).
 */
export const decisionRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { limit } = DecisionsQuery.parse(c.req.query());
    return c.json(await page(c, limit));
  })
  .get("/pools/:pool", async (c) => {
    const { limit, cursor } = DecisionsPoolQuery.parse(c.req.query());
    const view = await page(c, limit, { pool: c.req.param("pool"), cursor: cursor || undefined });
    const [pool] = view.pools;
    // A pool the conference does not have.
    if (!pool) throw new Refusal(404, "not_found");
    return c.json(pool);
  })
  // What sending would do now: the numbers the confirmation says, and the token a send names.
  .get("/send", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const view = await sendConfirmation(c.get("deps").db, viewer, k);
    if (!view) throw new Refusal(403, "forbidden");
    return c.json(view);
  })
  .post("/send", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    const input = SendDecisionsInput.parse(await c.req.json());
    return c.json(await sendDecisions(c.get("deps"), viewer, k, input));
  })
  .get("/submissions/:id", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const view = await proposalDecision(c.get("deps").db, viewer, k, idParam(c.req.param("id")));
    if (!view) throw new Refusal(404, "not_found");
    return c.json(view);
  })
  .put("/submissions/:id", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    const input = DecisionInput.parse(await c.req.json());
    await recordDecision(c.get("deps"), viewer, k, {
      submissionId: idParam(c.req.param("id")),
      outcome: input.outcome,
    });
    return c.body(null, 204);
  })
  .delete("/submissions/:id", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    await takeBackDecision(c.get("deps"), viewer, k, { submissionId: idParam(c.req.param("id")) });
    return c.body(null, 204);
  });

/**
 * The decision about a proposal as its own people read it, mounted at /api/submissions beside
 * the proposal's own routes: for its owner and its confirmed co-authors, in person, once the
 * decisions were sent (spec 03, §1.6). Until then, and for anyone else (someone invited who
 * has not confirmed, a reviewer, a chair, a stranger, the public, an agent of either tier),
 * the answer is the one a missing proposal gets: 404 `not_found`.
 */
export const authorDecisionRoutes = new Hono<AppEnv>().get("/:id/decision", async (c) => {
  const view = await authorDecision(c.get("deps").db, c.get("viewer"), idParam(c.req.param("id")));
  if (!view) throw new Refusal(404, "not_found");
  return c.json(view);
});
