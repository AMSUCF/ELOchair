import {
  type ConferenceConfig,
  type ConferenceRole,
  type InvitableRole,
  type LocalizedText,
  type Person,
  type RoleInvitation,
  roleInvitationState,
} from "@elochair/schema";
import { type SubmissionContext, submissionAccess } from "./access";
import { isConferenceChair, type PersonViewer, type Viewer } from "./viewer";

/*
 * Who holds a role at a conference, and who has been invited to one (spec 03, §1.2).
 *
 * Two rules decide everything here:
 * - A person who holds a role is shown by their profile: their name and their address.
 * - An invitation that has not been accepted is shown only as the chair typed it (the address,
 *   and the name the chair typed, if any), never from the invited person's profile. It reads the
 *   same whether or not that address has an account, and whatever that account holds.
 *
 * The page is for the conference's chairs, in person. An agent gets nothing, whatever its tier.
 */

/** A person may see and change who holds a role: a chair of that conference, in person. */
export function canManagePeople(viewer: Viewer, conferenceId: string): viewer is PersonViewer {
  return viewer.kind === "person" && isConferenceChair(viewer, conferenceId);
}

/** Everything needed to say who holds a role at a conference and who has been invited. */
export type PeopleRecord = {
  conferenceId: string;
  /** The conference's review pool keys, in the order of its configuration. */
  poolKeys: string[];
  /** Every role held at the conference. */
  grants: { personId: string; role: ConferenceRole; scope: string[] }[];
  /** What each reviewer said on accepting. A reviewer given the role on the server has none. */
  reviewerProfiles: { personId: string; languages: string[]; maxLoad: number }[];
  /** Person records. Only those of role holders are ever read. */
  people: Map<string, Person>;
  /** The conference's role invitations, in any state. */
  invitations: RoleInvitation[];
  /** The conference's submissions with their assignments, to count each reviewer's proposals. */
  submissions: SubmissionContext[];
};

/** A role holder, from their profile. The name is null while they have not set one. */
export type RoleHolder = { personId: string; displayName: string | null; email: string };

export type PeopleChair = RoleHolder & {
  /** The person looking: a chair cannot remove their own role. */
  you: boolean;
};

export type PeopleReviewer = RoleHolder & {
  /**
   * The review pools the person reviews for: the scope of their role, in the configuration's
   * order. A role without a scope (only the server's `grant` command gives one) is every pool.
   * A key that is no longer a pool of the conference is kept, so that nobody is hidden.
   */
  pools: string[];
  /**
   * Proposals assigned to them, among those the person looking manages as a chair. A chair's
   * own proposals and those they have a conflict with are left out: who reviews those is not
   * theirs to learn, and a count would give it away.
   */
  assigned: number;
  /** What they said on accepting; null and empty when they were given the role on the server. */
  maxLoad: number | null;
  languages: string[];
};

export type PeopleTrackChair = RoleHolder & { tracks: string[] };

/** An invitation nobody accepted, as the chair typed it. Nothing here is from a profile. */
export type PeopleInvitation = {
  id: string;
  role: InvitableRole;
  pools: string[];
  email: string;
  name: string | null;
  lang: RoleInvitation["lang"];
  state: "waiting" | "expired" | "declined";
  sentAt: string;
  expiresAt: string;
  answeredAt: string | null;
};

export type PeopleView = {
  view: "people";
  chairs: PeopleChair[];
  reviewers: PeopleReviewer[];
  trackChairs: PeopleTrackChair[];
  invitations: PeopleInvitation[];
};

/** A reviewer's pools as the People page shows them (see PeopleReviewer.pools). */
export function reviewerPools(scope: readonly string[], poolKeys: readonly string[]): string[] {
  if (scope.length === 0) return [...poolKeys];
  return [
    ...poolKeys.filter((k) => scope.includes(k)),
    ...scope.filter((k) => !poolKeys.includes(k)),
  ];
}

/**
 * How many proposals are assigned to a reviewer, as one chair may know it: counted over the
 * submissions that chair manages as a chair (submissionAccess), and no others.
 */
export function assignedCount(
  viewer: PersonViewer,
  reviewerId: string,
  submissions: readonly SubmissionContext[],
): number {
  let n = 0;
  for (const s of submissions) {
    if (!s.assignments.some((a) => a.reviewerId === reviewerId)) continue;
    if (submissionAccess(viewer, s) === "chair") n += 1;
  }
  return n;
}

const byName = <T extends RoleHolder>(list: T[]): T[] =>
  [...list].sort(
    (a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? "", "en") ||
      a.email.localeCompare(b.email, "en") ||
      a.personId.localeCompare(b.personId, "en"),
  );

/**
 * The People page, for a chair of the conference in person; null for everyone else.
 * `now` decides which waiting invitations have expired.
 */
export function projectPeople(viewer: Viewer, rec: PeopleRecord, now: Date): PeopleView | null {
  if (!canManagePeople(viewer, rec.conferenceId)) return null;
  const holder = (personId: string): RoleHolder => {
    const p = rec.people.get(personId);
    return { personId, displayName: p?.displayName ?? null, email: p?.email ?? "" };
  };
  const holding = (roles: readonly ConferenceRole[]) => [
    ...new Set(rec.grants.filter((g) => roles.includes(g.role)).map((g) => g.personId)),
  ];
  const scopeOf = (personId: string, role: ConferenceRole) =>
    rec.grants.find((g) => g.personId === personId && g.role === role)?.scope ?? [];
  const profiles = new Map(rec.reviewerProfiles.map((p) => [p.personId, p]));

  const invitations: PeopleInvitation[] = [];
  for (const inv of rec.invitations) {
    if (inv.conferenceId !== rec.conferenceId) continue;
    const state = roleInvitationState(inv, now);
    // Accepted: the person is listed as a role holder. Cancelled: the chairs took it away.
    if (state === "accepted" || state === "cancelled") continue;
    invitations.push({
      id: inv.id,
      role: inv.role,
      pools: [...inv.pools],
      email: inv.invitedEmail,
      name: inv.invitedName,
      lang: inv.lang,
      state,
      sentAt: inv.sentAt,
      expiresAt: inv.expiresAt,
      answeredAt: inv.answeredAt,
    });
  }
  // Newest first, then by address and role: by what the invitation itself holds, never by
  // anything of a profile, and the same order every time.
  invitations.sort(
    (a, b) =>
      b.sentAt.localeCompare(a.sentAt) ||
      a.email.localeCompare(b.email, "en") ||
      a.role.localeCompare(b.role, "en") ||
      a.id.localeCompare(b.id, "en"),
  );

  return {
    view: "people",
    // `admin` means nothing more than `chair`: both are shown as chairs, each person once.
    chairs: byName(
      holding(["chair", "admin"]).map((id) => ({ ...holder(id), you: id === viewer.personId })),
    ),
    reviewers: byName(
      holding(["reviewer"]).map((id) => {
        const profile = profiles.get(id);
        return {
          ...holder(id),
          pools: reviewerPools(scopeOf(id, "reviewer"), rec.poolKeys),
          assigned: assignedCount(viewer, id, rec.submissions),
          maxLoad: profile?.maxLoad ?? null,
          languages: [...(profile?.languages ?? [])],
        };
      }),
    ),
    trackChairs: byName(
      holding(["track_chair"]).map((id) => ({
        ...holder(id),
        tracks: [...scopeOf(id, "track_chair")],
      })),
    ),
    invitations,
  };
}

/** What the invitation page shows whoever holds the link. Nothing a chair typed but the address. */
export type RoleInvitationView = {
  view: "role_invitation";
  conference: { slug: string; title: LocalizedText };
  role: InvitableRole;
  /** The review pools a reviewer is invited to, as the conference names them. */
  pools: { key: string; name: LocalizedText }[];
  /** The address the invitation was sent to: the role goes to it, whoever opens the link. */
  email: string;
  lang: RoleInvitation["lang"];
  expiresAt: string;
  /** Accepting needs a name in the invitee's own words: their profile has none yet. */
  nameNeeded: boolean;
};

/**
 * The review pools of an invitation that the conference still has, in its configuration's
 * order. Accepting gives the reviewer's role for these and no others: never for none, which on
 * a role would mean every pool.
 */
export function invitedPools(
  inv: Pick<RoleInvitation, "pools">,
  config: Pick<ConferenceConfig, "reviewPools">,
): { key: string; name: LocalizedText }[] {
  return config.reviewPools
    .filter((p) => inv.pools.includes(p.key))
    .map((p) => ({ key: p.key, name: { ...p.name } }));
}

/**
 * An invitation as the holder of its link sees it, while it can still be answered; null once
 * it is answered, cancelled or expired, when a reviewer's pools are all gone from the
 * conference, and for agents, who never read or answer invitations. The name the chair typed
 * for the invitee is not shown: it is for the chairs only.
 */
export function projectRoleInvitation(
  viewer: Viewer,
  inv: RoleInvitation,
  conference: { slug: string; config: ConferenceConfig },
  invitee: Pick<Person, "displayName"> | undefined,
  now: Date,
): RoleInvitationView | null {
  if (viewer.kind === "agent") return null;
  if (roleInvitationState(inv, now) !== "waiting") return null;
  const pools = invitedPools(inv, conference.config);
  if (inv.role === "reviewer" && pools.length === 0) return null;
  return {
    view: "role_invitation",
    conference: { slug: conference.slug, title: { ...conference.config.title } },
    role: inv.role,
    pools: inv.role === "reviewer" ? pools : [],
    email: inv.invitedEmail,
    lang: inv.lang,
    expiresAt: inv.expiresAt,
    nameNeeded: !invitee?.displayName?.trim(),
  };
}
