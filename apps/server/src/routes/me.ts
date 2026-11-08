import { projectSelf } from "@elochair/policy";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { getPerson, listConferences } from "../repo";

export const meRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const viewer = c.get("viewer");
  const { db } = c.get("deps");
  if (viewer.kind === "public") return c.json({ error: "unauthenticated" }, 401);

  const slugs = new Map((await listConferences(db)).map((k) => [k.id, k.slug]));
  if (viewer.kind === "agent") {
    return c.json({
      kind: "agent",
      tier: viewer.tier,
      conference: slugs.get(viewer.conferenceId) ?? null,
      ownerId: viewer.owner.personId,
    });
  }
  const person = await getPerson(db, viewer.personId);
  return c.json({
    kind: "person",
    person: person && projectSelf(viewer, person),
    siteAdmin: viewer.siteAdmin,
    roles: viewer.grants.map((g) => ({
      conference: slugs.get(g.conferenceId) ?? null,
      role: g.role,
      scope: g.scope,
    })),
  });
});
