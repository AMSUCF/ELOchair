import type { ConferenceRole, RoleGrant } from "@elochair/schema";

/** Data tiers for agent tokens. M = metadata (cloud-safe). C = content (local models only). */
export type Tier = "M" | "C";

export type PersonViewer = {
  kind: "person";
  personId: string;
  siteAdmin: boolean;
  grants: RoleGrant[];
};

/**
 * An agent acting for a chair, through a token scoped to one conference. Agents never get more
 * than their owner, and only owners who chair the token's conference can use agents at all.
 */
export type AgentViewer = {
  kind: "agent";
  tokenId: string;
  tier: Tier;
  conferenceId: string;
  owner: PersonViewer;
};

export type Viewer = { kind: "public" } | PersonViewer | AgentViewer;

export const PUBLIC: Viewer = { kind: "public" };

export function hasRole(
  viewer: PersonViewer,
  conferenceId: string,
  roles: readonly ConferenceRole[],
): RoleGrant | undefined {
  return viewer.grants.find((g) => g.conferenceId === conferenceId && roles.includes(g.role));
}

/** Site admins and conference admins/chairs: the people allowed to run a conference. */
export function isConferenceChair(viewer: PersonViewer, conferenceId: string): boolean {
  return viewer.siteAdmin || hasRole(viewer, conferenceId, ["admin", "chair"]) !== undefined;
}

export function isConferenceAdmin(viewer: PersonViewer, conferenceId: string): boolean {
  return viewer.siteAdmin || hasRole(viewer, conferenceId, ["admin"]) !== undefined;
}

/** The person whose permissions apply, or null for the public. */
export function actingPerson(viewer: Viewer): PersonViewer | null {
  if (viewer.kind === "public") return null;
  return viewer.kind === "agent" ? viewer.owner : viewer;
}
