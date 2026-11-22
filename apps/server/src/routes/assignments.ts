import { projectProposalReviewers } from "@elochair/policy";
import { AssignmentsPoolQuery, AssignmentsQuery, AssignReviewerInput } from "@elochair/schema";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../context";
import { cursorsFor } from "../cursor";
import {
  AssignmentsCursorRefused,
  assignmentsPage,
  assignReviewer,
  loadReviewersRecord,
  releaseReviewer,
} from "../services/assignments";
import { idParam, Refusal, writer } from "./common";
import { chairInPerson } from "./conferences";

/** A page of the Assignments list; a cursor that does not open reads as any malformed input. */
async function page(c: Context<AppEnv>, limit: number, only?: { pool: string; cursor?: string }) {
  const { viewer, k } = await chairInPerson(c);
  const { db, now, env } = c.get("deps");
  try {
    const cursors = cursorsFor(env.SECRET_KEY);
    const view = await assignmentsPage(db, viewer, k, { now: now(), limit, cursors, only });
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
 * Assignments (spec 03, §1.3), mounted at /api/conferences/:slug/assignments. Every route is
 * for a chair of that conference, in person (chairInPerson): 404 for a draft conference the
 * caller cannot see, 403 for everyone else, an agent included, whatever its tier.
 *
 * The routes about one proposal are for a chair who is given that proposal as a chair. For any
 * other (their own, one they have a conflict with, a draft, another conference's, none at all)
 * the answer is one and the same: 404 `not_found`. The two that change something also count
 * toward the person's write limit (writer).
 */
export const assignmentRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { limit } = AssignmentsQuery.parse(c.req.query());
    return c.json(await page(c, limit));
  })
  .get("/pools/:pool", async (c) => {
    const { limit, cursor } = AssignmentsPoolQuery.parse(c.req.query());
    const view = await page(c, limit, { pool: c.req.param("pool"), cursor: cursor || undefined });
    const [pool] = view.pools;
    // A pool the conference does not have.
    if (!pool) throw new Refusal(404, "not_found");
    return c.json(pool);
  })
  .get("/submissions/:id", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const { db, now } = c.get("deps");
    const view = projectProposalReviewers(
      viewer,
      await loadReviewersRecord(db, k),
      idParam(c.req.param("id")),
      now(),
    );
    if (!view) throw new Refusal(404, "not_found");
    return c.json(view);
  })
  .post("/submissions/:id/reviewers", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    const input = AssignReviewerInput.parse(await c.req.json());
    await assignReviewer(c.get("deps"), viewer, k, {
      submissionId: idParam(c.req.param("id")),
      // As the database writes ids, like the one in the address: who is on the proposal and
      // who has a conflict with it are found by comparing with it.
      reviewerId: input.reviewerId.toLowerCase(),
      confirmedFull: input.confirmedFull === true,
    });
    return c.body(null, 204);
  })
  .delete("/submissions/:id/reviewers/:reviewerId", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    await releaseReviewer(c.get("deps"), viewer, k, {
      submissionId: idParam(c.req.param("id")),
      reviewerId: idParam(c.req.param("reviewerId")),
    });
    return c.body(null, 204);
  });
