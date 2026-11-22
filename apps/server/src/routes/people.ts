import { projectPeople } from "@elochair/policy";
import {
  InvitationTokenInput,
  RemovableRole,
  RoleInvitationAnswerInput,
  RoleInvitationInput,
  RoleRemovalInput,
} from "@elochair/schema";
import { Hono } from "hono";
import type { AppEnv } from "../context";
import {
  answerRoleInvitation,
  cancelRoleInvitation,
  inviteToRole,
  loadPeopleRecord,
  removeRole,
  resendRoleInvitation,
  roleInvitationInfo,
} from "../services/people";
import { idParam, Refusal, writer } from "./common";
import { chairInPerson } from "./conferences";
import { guardLinkRoute } from "./invitations";

/**
 * People and invitations (spec 03, §1.2), mounted at /api/conferences/:slug/people. Every route
 * is for a chair of that conference, in person (chairInPerson): 404 for a draft conference the
 * caller cannot see, 403 for everyone else, an agent included, whatever its tier. The routes
 * that change something also count toward the person's write limit (writer).
 */
export const peopleRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const { db, now } = c.get("deps");
    const view = projectPeople(viewer, await loadPeopleRecord(db, k), now());
    if (!view) throw new Refusal(403, "forbidden");
    return c.json(view);
  })
  .post("/invitations", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    const input = RoleInvitationInput.parse(await c.req.json());
    return c.json(await inviteToRole(c.get("deps"), viewer, k, input), 201);
  })
  .post("/invitations/:id/resend", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    await resendRoleInvitation(c.get("deps"), viewer, k, idParam(c.req.param("id")));
    return c.body(null, 204);
  })
  .post("/invitations/:id/cancel", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    await cancelRoleInvitation(c.get("deps"), viewer, k, idParam(c.req.param("id")));
    return c.body(null, 204);
  })
  .delete("/:personId/roles/:role", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    writer(c);
    const role = RemovableRole.safeParse(c.req.param("role"));
    if (!role.success) throw new Refusal(404, "not_found");
    const { assignments, reviews } = RoleRemovalInput.parse(await c.req.json());
    await removeRole(c.get("deps"), viewer, k, {
      personId: idParam(c.req.param("personId")),
      role: role.data,
      assignments,
      reviews,
    });
    return c.body(null, 204);
  });

/**
 * Answering from the invitation email, mounted at /api/role-invitations. The link's token is
 * all that is asked for: no account is needed, and none is opened. Agents are refused, and the
 * per-IP limit is the one the links of proposal invitations have.
 */
export const roleInvitationRoutes = new Hono<AppEnv>()
  .post("/info", async (c) => {
    await guardLinkRoute(c, "role_info");
    const { token } = InvitationTokenInput.parse(await c.req.json());
    const view = await roleInvitationInfo(c.get("deps"), c.get("viewer"), token);
    if (!view) throw new Refusal(400, "invalid_or_expired");
    return c.json(view);
  })
  .post("/answer", async (c) => {
    await guardLinkRoute(c, "role_answer");
    const input = RoleInvitationAnswerInput.parse(await c.req.json());
    const answer = await answerRoleInvitation(c.get("deps"), c.get("viewer"), input);
    return c.json({ answer });
  });
