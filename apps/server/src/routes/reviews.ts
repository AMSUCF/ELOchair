import { DeclineReviewInput, ReviewInput } from "@elochair/schema";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { declineReview, readOwnReview, saveReview } from "../services/reviews";
import { idParam, Refusal, writer } from "./common";

/**
 * A reviewer's own review of a proposal (spec 03, §1.4), mounted at /api/submissions beside the
 * proposal's own routes. Every route is for the proposal's reviewer (isReviewerOf in
 * packages/policy), in person: a chair who also reviews and is assigned to it is one. For
 * anyone else the answer is the one a missing proposal gets, 404 `not_found`: a stranger, the
 * proposal's own people, a chair who is not assigned to it, a reviewer who was released, and an
 * agent that reads. An agent that writes is refused as every agent's write is (403
 * `agents_read_only`), whatever its tier; the public must sign in (401).
 *
 * The two that change something count toward the person's write limit (writer), and are
 * refused with 409 `not_reviewing` unless the conference is in `reviewing`.
 */
export const reviewRoutes = new Hono<AppEnv>()
  .get("/:id/review", async (c) => {
    const view = await readOwnReview(c.get("deps").db, c.get("viewer"), idParam(c.req.param("id")));
    if (!view) throw new Refusal(404, "not_found");
    return c.json(view);
  })
  .put("/:id/review", async (c) => {
    const viewer = writer(c);
    const input = ReviewInput.parse(await c.req.json());
    return c.json(await saveReview(c.get("deps"), viewer, idParam(c.req.param("id")), input));
  })
  .post("/:id/review/decline", async (c) => {
    const viewer = writer(c);
    const input = DeclineReviewInput.parse(await c.req.json());
    await declineReview(c.get("deps"), viewer, idParam(c.req.param("id")), input);
    return c.body(null, 204);
  });
