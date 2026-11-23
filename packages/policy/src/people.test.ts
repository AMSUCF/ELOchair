/**
 * The People page and the page of an invitation to a role (spec 03, §1.2). People, addresses and
 * typed names carry markers; each view is rendered and searched for what it must not hold.
 */
import {
  type Assignment,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  type Person,
  type RoleInvitation,
  roleInvitationState,
  type Submission,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SubmissionContext } from "./access";
import {
  assignedCount,
  canManagePeople,
  invitedPools,
  type PeopleRecord,
  projectPeople,
  projectRoleInvitation,
  reviewerPools,
} from "./people";
import { findLeaks } from "./testing";
import { type AgentViewer, type PersonViewer, PUBLIC, type Viewer } from "./viewer";

const CONFIG: ConferenceConfig = ConfigSchema.parse(conferences.elo2026);
const POOLS = CONFIG.reviewPools.map((p) => p.key);
const NOW = new Date("2031-03-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const RUNS = { numRuns: 300 };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONFERENCE = uuid(1);
const ELSEWHERE = uuid(2);

function person(n: number, more: Partial<Person> = {}): Person {
  return {
    id: uuid(n),
    email: `mark-email-${n}@example.org`,
    displayName: `MARK-NAME-${n}`,
    orcid: null,
    affiliation: `MARK-AFFILIATION-${n}`,
    country: "CO",
    languages: ["es"],
    bios: { en: `MARK-BIO-${n}` },
    pronouns: `MARK-PRONOUNS-${n}`,
    ...more,
  };
}

const viewer = (
  personId: string,
  grants: PersonViewer["grants"] = [],
  siteAdmin = false,
): PersonViewer => ({ kind: "person", personId, siteAdmin, grants });
const chairOf = (conferenceId: string, personId = uuid(10)) =>
  viewer(personId, [{ conferenceId, role: "chair", scope: [] }]);
const agentOf = (owner: PersonViewer, tier: "M" | "C", conferenceId = CONFERENCE): AgentViewer => ({
  kind: "agent",
  tokenId: uuid(99),
  tier,
  conferenceId,
  owner,
});

type State = "waiting" | "expired" | "declined" | "accepted" | "cancelled";

function invitation(n: number, state: State, more: Partial<RoleInvitation> = {}): RoleInvitation {
  return {
    id: uuid(1000 + n),
    conferenceId: CONFERENCE,
    personId: uuid(n),
    role: "reviewer",
    pools: [POOLS[0] as string],
    invitedEmail: `typed-${n}@example.org`,
    invitedName: `TYPED-NAME-${n}`,
    lang: "en",
    sentAt: at(-40 + (n % 7)),
    expiresAt: state === "expired" ? at(-1) : at(20),
    answer: state === "accepted" || state === "declined" ? state : null,
    answeredAt: state === "accepted" || state === "declined" ? at(-2) : null,
    cancelledAt: state === "cancelled" ? at(-3) : null,
    ...more,
  };
}

function record(more: Partial<PeopleRecord> = {}): PeopleRecord {
  return {
    conferenceId: CONFERENCE,
    poolKeys: POOLS,
    grants: [],
    reviewerProfiles: [],
    people: new Map(),
    invitations: [],
    submissions: [],
    sentReviews: [],
    ...more,
  };
}

/** A submitted proposal with these authors, reviewers and conflicted people. */
function submission(
  n: number,
  v: { authors?: string[]; reviewers?: string[]; conflicted?: string[]; status?: string } = {},
): SubmissionContext {
  const id = uuid(5000 + n);
  const s: Submission = {
    id,
    conferenceId: CONFERENCE,
    ownerPersonId: v.authors?.[0] ?? uuid(700),
    version: 1,
    typeKey: CONFIG.submissionTypes[0]?.key ?? "",
    trackKey: null,
    topicKeys: [],
    language: "en",
    title: "T",
    abstract: "A",
    fields: {},
    participationMode: null,
    status: (v.status ?? "submitted") as Submission["status"],
    createdAt: at(-30),
    updatedAt: at(-30),
    submittedAt: v.status === "draft" ? null : at(-29),
  };
  const contributions: Contribution[] = (v.authors ?? [uuid(700)]).map((personId, position) => ({
    submissionId: id,
    personId,
    role: position === 0 ? "lead" : "coauthor",
    position,
    status: "confirmed",
    invitedEmail: null,
    invitedName: null,
    invitedAffiliation: null,
  }));
  const assignments: Assignment[] = (v.reviewers ?? []).map((reviewerId, i) => ({
    id: uuid(9000 + n * 10 + i),
    conferenceId: CONFERENCE,
    reviewerId,
    submissionId: id,
    createdAt: at(-10),
    dueAt: null,
    assignedByPersonId: null,
  }));
  const conflicts: Conflict[] = (v.conflicted ?? []).map((personId, i) => ({
    id: uuid(8000 + n * 10 + i),
    conferenceId: CONFERENCE,
    personId,
    submissionId: id,
    otherPersonId: null,
    kind: "declared",
    declaredBy: "chair",
  }));
  return {
    config: CONFIG,
    phase: "reviewing",
    submission: s,
    contributions,
    assignments,
    conflicts,
  };
}

describe("who may see the People page", () => {
  const chair = chairOf(CONFERENCE);
  const others: [string, Viewer][] = [
    ["the public", PUBLIC],
    ["someone with no role", viewer(uuid(20))],
    ["a reviewer", viewer(uuid(21), [{ conferenceId: CONFERENCE, role: "reviewer", scope: [] }])],
    [
      "a track chair",
      viewer(uuid(22), [{ conferenceId: CONFERENCE, role: "track_chair", scope: [] }]),
    ],
    ["a chair of another conference", chairOf(ELSEWHERE, uuid(23))],
    ["a chair's tier M agent", agentOf(chair, "M")],
    ["a chair's tier C agent", agentOf(chair, "C")],
    ["a site admin's agent", agentOf(viewer(uuid(24), [], true), "C")],
  ];

  it("is a chair of that conference in person: a chair, an admin or a site admin", () => {
    const admin = viewer(uuid(11), [{ conferenceId: CONFERENCE, role: "admin", scope: [] }]);
    const siteAdmin = viewer(uuid(12), [], true);
    for (const v of [chair, admin, siteAdmin]) {
      expect(canManagePeople(v, CONFERENCE)).toBe(true);
      expect(projectPeople(v, record(), NOW)).toEqual({
        view: "people",
        chairs: [],
        reviewers: [],
        trackChairs: [],
        invitations: [],
      });
    }
  });

  it("is nobody else: the public, other roles, another conference's chair, and no agent", () => {
    const full = record({
      grants: [{ personId: uuid(30), role: "chair", scope: [] }],
      people: new Map([[uuid(30), person(30)]]),
      invitations: [invitation(31, "waiting")],
    });
    for (const [who, v] of others) {
      expect(canManagePeople(v, CONFERENCE), who).toBe(false);
      expect(projectPeople(v, full, NOW), who).toBeNull();
    }
  });
});

describe("the People page", () => {
  const me = chairOf(CONFERENCE, uuid(10));

  it("shows role holders by their profile: name and address, and nothing else of it", () => {
    const rec = record({
      grants: [
        { personId: uuid(10), role: "chair", scope: [] },
        // An admin is shown as a chair, and someone who is both is shown once.
        { personId: uuid(11), role: "admin", scope: [] },
        { personId: uuid(11), role: "chair", scope: [] },
        { personId: uuid(12), role: "reviewer", scope: [POOLS[0] as string] },
        { personId: uuid(13), role: "track_chair", scope: ["some_track"] },
      ],
      reviewerProfiles: [{ personId: uuid(12), languages: ["es", "pt"], maxLoad: 5 }],
      people: new Map([10, 11, 12, 13].map((n) => [uuid(n), person(n)])),
    });
    const view = projectPeople(me, rec, NOW);
    expect(view?.chairs).toEqual([
      { personId: uuid(10), displayName: "MARK-NAME-10", email: person(10).email, you: true },
      { personId: uuid(11), displayName: "MARK-NAME-11", email: person(11).email, you: false },
    ]);
    expect(view?.reviewers).toEqual([
      {
        personId: uuid(12),
        displayName: "MARK-NAME-12",
        email: person(12).email,
        pools: [POOLS[0]],
        assigned: 0,
        sent: 0,
        maxLoad: 5,
        languages: ["es", "pt"],
      },
    ]);
    expect(view?.trackChairs).toEqual([
      {
        personId: uuid(13),
        displayName: "MARK-NAME-13",
        email: person(13).email,
        tracks: ["some_track"],
      },
    ]);
    expect(
      findLeaks(
        view,
        [10, 11, 12, 13].flatMap((n) => [
          `MARK-AFFILIATION-${n}`,
          `MARK-BIO-${n}`,
          `MARK-PRONOUNS-${n}`,
        ]),
      ),
    ).toEqual([]);
  });

  it("shows a reviewer given the role on the server, who never said what they offer", () => {
    const rec = record({
      grants: [{ personId: uuid(12), role: "reviewer", scope: [] }],
      people: new Map([[uuid(12), person(12, { displayName: null })]]),
    });
    // No scope on the role is every pool; no profile is nothing said.
    expect(projectPeople(me, rec, NOW)?.reviewers).toEqual([
      {
        personId: uuid(12),
        displayName: null,
        email: person(12).email,
        pools: POOLS,
        assigned: 0,
        sent: 0,
        maxLoad: null,
        languages: [],
      },
    ]);
  });

  it("lists a reviewer's pools in the configuration's order, and keeps one that is gone", () => {
    expect(reviewerPools([], ["a", "b"])).toEqual(["a", "b"]);
    expect(reviewerPools(["b", "a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(reviewerPools(["b"], ["a", "b"])).toEqual(["b"]);
    expect(reviewerPools(["gone", "b"], ["a", "b"])).toEqual(["b", "gone"]);
  });

  it("lists invitations that are waiting, expired or declined, never accepted or cancelled ones", () => {
    const states: State[] = ["waiting", "expired", "declined", "accepted", "cancelled"];
    const rec = record({ invitations: states.map((s, i) => invitation(40 + i, s)) });
    const view = projectPeople(me, rec, NOW);
    expect(view?.invitations.map((i) => i.state).sort()).toEqual([
      "declined",
      "expired",
      "waiting",
    ]);
    // A declined or an expired one that a chair then took off the list is cancelled, and gone.
    const dismissed = record({
      invitations: [
        invitation(45, "declined", { cancelledAt: at(-1) }),
        invitation(46, "expired", { cancelledAt: at(-1) }),
      ],
    });
    expect(projectPeople(me, dismissed, NOW)?.invitations).toEqual([]);
    // An accepted one stays accepted whatever else its row says: the role is what is removed.
    expect(roleInvitationState(invitation(47, "accepted", { cancelledAt: at(-1) }), NOW)).toBe(
      "accepted",
    );
    // Another conference's invitation is not this one's, even if it is handed over.
    const stray = record({
      invitations: [invitation(50, "waiting", { conferenceId: ELSEWHERE })],
    });
    expect(projectPeople(me, stray, NOW)?.invitations).toEqual([]);
  });

  it("shows an invitation as the chair typed it: exactly these fields", () => {
    const inv = invitation(41, "declined", { role: "chair", pools: [], lang: "pt" });
    const view = projectPeople(me, record({ invitations: [inv] }), NOW);
    expect(view?.invitations).toEqual([
      {
        id: inv.id,
        role: "chair",
        pools: [],
        email: "typed-41@example.org",
        name: "TYPED-NAME-41",
        lang: "pt",
        state: "declined",
        sentAt: inv.sentAt,
        expiresAt: inv.expiresAt,
        answeredAt: inv.answeredAt,
      },
    ]);
    // Not even the id of the person the address belongs to.
    expect(findLeaks(view, [inv.personId])).toEqual([]);
  });

  it("puts the newest invitation first, whoever it is for", () => {
    const rec = record({
      invitations: [
        invitation(60, "waiting", { sentAt: at(-5) }),
        invitation(61, "waiting", { sentAt: at(-1) }),
        invitation(62, "declined", { sentAt: at(-3) }),
      ],
    });
    expect(projectPeople(me, rec, NOW)?.invitations.map((i) => i.email)).toEqual([
      "typed-61@example.org",
      "typed-62@example.org",
      "typed-60@example.org",
    ]);
    // Sent at the same moment: by address, then by role, so that the order is the same every
    // time and owes nothing to an id.
    const tied = [
      invitation(72, "waiting", { sentAt: at(-2) }),
      invitation(71, "waiting", { sentAt: at(-2) }),
      invitation(71, "declined", { sentAt: at(-2), role: "chair", pools: [], id: uuid(3000) }),
    ];
    for (const invitations of [tied, [...tied].reverse()]) {
      expect(
        projectPeople(me, record({ invitations }), NOW)?.invitations.map((i) => [i.email, i.role]),
      ).toEqual([
        ["typed-71@example.org", "chair"],
        ["typed-71@example.org", "reviewer"],
        ["typed-72@example.org", "reviewer"],
      ]);
    }
  });
});

describe("an invitation nobody accepted says nothing about the address's account", () => {
  const me = chairOf(CONFERENCE, uuid(10));
  type Scenario = {
    invitees: {
      n: number;
      state: "waiting" | "expired" | "declined";
      role: "reviewer" | "chair";
    }[];
    /** Which of them have an account with a profile. */
    withAccount: boolean[];
  };
  const scenario: fc.Arbitrary<Scenario> = fc.record({
    invitees: fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 100, max: 160 }),
        state: fc.constantFrom("waiting" as const, "expired" as const, "declined" as const),
        role: fc.constantFrom("reviewer" as const, "chair" as const),
      }),
      { minLength: 1, maxLength: 8, selector: (x) => x.n },
    ),
    withAccount: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  });
  const build = ({ invitees, withAccount }: Scenario, accounts: boolean) => {
    const people = new Map<string, Person>([[uuid(10), person(10)]]);
    const markers: string[] = [];
    invitees.forEach(({ n }, i) => {
      if (!withAccount[i]) return;
      const p = person(n, { orcid: "0000-0002-1825-009X" });
      markers.push(
        p.displayName ?? "",
        p.email,
        p.affiliation ?? "",
        p.bios.en ?? "",
        p.pronouns ?? "",
        p.orcid ?? "",
      );
      if (accounts) people.set(p.id, p);
    });
    const rec = record({
      grants: [{ personId: uuid(10), role: "chair", scope: [] }],
      people,
      invitations: invitees.map(({ n, state, role }) =>
        invitation(n, state, role === "chair" ? { role, pools: [] } : {}),
      ),
    });
    return { rec, markers };
  };

  it("holds nothing of a profile, even one that was loaded", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { rec, markers } = build(s, true);
        const view = projectPeople(me, rec, NOW);
        expect(view?.invitations).toHaveLength(s.invitees.length);
        expect(findLeaks(view, markers)).toEqual([]);
      }),
      RUNS,
    );
  });

  it("is rendered identically for an address with an account and one without", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const withAccounts = projectPeople(me, build(s, true).rec, NOW);
        const without = projectPeople(me, build(s, false).rec, NOW);
        expect(withAccounts).toEqual(without);
        expect(JSON.stringify(withAccounts)).toBe(JSON.stringify(without));
      }),
      RUNS,
    );
  });

  it("stays as typed for someone who holds another role, beside their profile as that role", () => {
    // A reviewer invited to be a chair: listed as a reviewer by profile, and the invitation as
    // typed. The page never joins the two.
    const rec = record({
      grants: [
        { personId: uuid(10), role: "chair", scope: [] },
        { personId: uuid(70), role: "reviewer", scope: [POOLS[0] as string] },
      ],
      people: new Map([
        [uuid(10), person(10)],
        [uuid(70), person(70)],
      ]),
      invitations: [invitation(70, "waiting", { role: "chair", pools: [] })],
    });
    const view = projectPeople(me, rec, NOW);
    expect(view?.reviewers[0]?.displayName).toBe("MARK-NAME-70");
    expect(view?.invitations[0]).toMatchObject({
      email: "typed-70@example.org",
      name: "TYPED-NAME-70",
    });
    expect(findLeaks(view?.invitations, ["MARK-NAME-70", person(70).email])).toEqual([]);
  });
});

describe("how many proposals a reviewer has, as a chair may know it", () => {
  const reviewer = uuid(80);
  const other = uuid(81);

  it("counts the proposals the chair manages, and leaves out their own and conflicted ones", () => {
    const author = chairOf(CONFERENCE, uuid(10));
    const submissions = [
      submission(1, { reviewers: [reviewer, other] }),
      submission(2, { reviewers: [reviewer] }),
      // The chair's own proposal: who reviews it is not theirs to learn, not even as a count.
      submission(3, { authors: [uuid(10)], reviewers: [reviewer] }),
      // One the chair has a conflict with.
      submission(4, { reviewers: [reviewer], conflicted: [uuid(10)] }),
      submission(5, { reviewers: [other] }),
    ];
    expect(assignedCount(author, reviewer, submissions)).toBe(2);
    expect(assignedCount(author, other, submissions)).toBe(2);
    // Another chair, with no proposal and no conflict, counts all four.
    expect(assignedCount(chairOf(CONFERENCE, uuid(11)), reviewer, submissions)).toBe(4);

    const rec = record({
      grants: [
        { personId: reviewer, role: "reviewer", scope: [] },
        { personId: other, role: "reviewer", scope: [] },
      ],
      people: new Map([
        [reviewer, person(80)],
        [other, person(81)],
      ]),
      submissions,
    });
    expect(projectPeople(author, rec, NOW)?.reviewers.map((r) => r.assigned)).toEqual([2, 2]);
  });

  it("does not count an assignment that was released: it is no longer one", () => {
    // Releasing removes the assignment (its record is kept elsewhere). What is left is counted.
    const chair = chairOf(CONFERENCE, uuid(11));
    const kept = submission(1, { reviewers: [reviewer, other] });
    const before = submission(2, { reviewers: [reviewer] });
    expect(assignedCount(chair, reviewer, [kept, before])).toBe(2);
    const after = { ...before, assignments: [] };
    expect(assignedCount(chair, reviewer, [kept, after])).toBe(1);
    expect(assignedCount(chair, other, [kept, after])).toBe(1);
  });

  it("is the same in every phase: a load is a load before reviewers can read", () => {
    const chair = chairOf(CONFERENCE, uuid(11));
    const submissions = [submission(1, { reviewers: [reviewer] })];
    for (const phase of ["draft", "cfp_open", "reviewing", "archived"]) {
      const there = submissions.map((s) => ({ ...s, phase }));
      expect(assignedCount(chair, reviewer, there), phase).toBe(1);
    }
  });

  it("cannot be used by a chair to find who reviews their own proposal", () => {
    // Whatever else is assigned, the chair's view is the same with and without the assignments
    // on their own proposal.
    const author = chairOf(CONFERENCE, uuid(10));
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        (onOthers, onOwn) => {
          const others = onOthers.map((assigned, i) =>
            submission(10 + i, { reviewers: assigned ? [reviewer] : [] }),
          );
          const own = (withReviewer: boolean) =>
            onOwn.map((assigned, i) =>
              submission(20 + i, {
                authors: [uuid(10)],
                reviewers: withReviewer && assigned ? [reviewer] : [],
              }),
            );
          expect(assignedCount(author, reviewer, [...others, ...own(true)])).toBe(
            assignedCount(author, reviewer, [...others, ...own(false)]),
          );
        },
      ),
      RUNS,
    );
  });
});

describe("the page of an invitation to a role", () => {
  const conference = { slug: "made-up", config: CONFIG };
  const inv = invitation(90, "waiting", { pools: [...POOLS].reverse() });

  it("shows the conference, the role, the committees and the address, and no typed name", () => {
    const view = projectRoleInvitation(PUBLIC, inv, conference, undefined, NOW);
    expect(view).toEqual({
      view: "role_invitation",
      conference: { slug: "made-up", title: CONFIG.title },
      role: "reviewer",
      // In the configuration's order, by the conference's own names.
      pools: CONFIG.reviewPools.map((p) => ({ key: p.key, name: p.name })),
      email: "typed-90@example.org",
      lang: "en",
      expiresAt: inv.expiresAt,
      nameNeeded: true,
    });
    // The name the chair typed is for the chairs only, and the person's id is nobody's.
    expect(findLeaks(view, ["TYPED-NAME-90", inv.personId, inv.id])).toEqual([]);
  });

  it("asks for a name only while the person's profile has none", () => {
    const needed = (displayName: string | null | undefined) =>
      projectRoleInvitation(
        PUBLIC,
        inv,
        conference,
        displayName === undefined ? undefined : { displayName },
        NOW,
      )?.nameNeeded;
    expect([needed(undefined), needed(null), needed("  "), needed("Ana")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("is the same for whoever opens the link, signed in or not", () => {
    const anyone = projectRoleInvitation(PUBLIC, inv, conference, undefined, NOW);
    for (const v of [viewer(uuid(20)), chairOf(CONFERENCE), viewer(inv.personId)]) {
      expect(projectRoleInvitation(v, inv, conference, undefined, NOW)).toEqual(anyone);
    }
  });

  it("is nothing for an agent, and nothing once it is answered, cancelled or expired", () => {
    const chair = chairOf(CONFERENCE);
    for (const tier of ["M", "C"] as const) {
      expect(projectRoleInvitation(agentOf(chair, tier), inv, conference, undefined, NOW)).toBe(
        null,
      );
    }
    for (const state of ["expired", "declined", "accepted", "cancelled"] as const) {
      expect(
        projectRoleInvitation(PUBLIC, invitation(91, state), conference, undefined, NOW),
        state,
      ).toBeNull();
    }
    // The moment it expires, it has expired.
    const edge = invitation(92, "waiting", { expiresAt: NOW.toISOString() });
    expect(projectRoleInvitation(PUBLIC, edge, conference, undefined, NOW)).toBeNull();
  });

  it("offers a reviewer only the pools the conference still has, and nothing when none is left", () => {
    const some = invitation(93, "waiting", { pools: ["gone", POOLS[0] as string] });
    expect(invitedPools(some, CONFIG).map((p) => p.key)).toEqual([POOLS[0]]);
    expect(
      projectRoleInvitation(PUBLIC, some, conference, undefined, NOW)?.pools.map((p) => p.key),
    ).toEqual([POOLS[0]]);
    const none = invitation(94, "waiting", { pools: ["gone"] });
    expect(projectRoleInvitation(PUBLIC, none, conference, undefined, NOW)).toBeNull();
    // An invitation to be a chair has no pools, and needs none.
    const chair = invitation(95, "waiting", { role: "chair", pools: [] });
    expect(projectRoleInvitation(PUBLIC, chair, conference, undefined, NOW)).toMatchObject({
      role: "chair",
      pools: [],
    });
  });
});
