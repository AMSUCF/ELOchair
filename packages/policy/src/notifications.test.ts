/**
 * The emails of the review phase (spec 03, §1.7): whose they are, what a person is shown of
 * their own choices, whether something still holds when the email is made, and what an email
 * is made of. People, proposals and everything anyone wrote carry markers; what is handed over
 * for an email is searched for them.
 */
import {
  type Assignment,
  CONFERENCE_PHASES,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  DECLINE_REASONS,
  type DeclineReason,
  NOTICE_FREQUENCIES,
  NOTIFICATION_KINDS,
  type NoticeFrequency,
  type NotificationKind,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SubmissionContext } from "./access";
import {
  choicesInForce,
  emailRoles,
  noticesWait,
  notificationHolds,
  type PendingNotice,
  planNotices,
  projectEmailChoices,
  type StoredChoices,
  unsentReviews,
} from "./notifications";
import { findLeaks } from "./testing";
import { type AgentViewer, type PersonViewer, PUBLIC, type Viewer } from "./viewer";

const CONFIG: ConferenceConfig = ConfigSchema.parse(conferences.elo2026);
const [POOL_A, POOL_B] = CONFIG.reviewPools.map((p) => p.key) as [string, string];
const TYPE_A = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_A)?.key ?? "";
const RUNS = { numRuns: 300 };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONFERENCE = uuid(1);
const OTHER_CONFERENCE = uuid(2);
const day = (n: number) => new Date(Date.UTC(2031, 0, 1 + n)).toISOString();

const viewer = (
  n: number,
  grants: PersonViewer["grants"] = [],
  siteAdmin = false,
): PersonViewer => ({
  kind: "person",
  personId: uuid(n),
  siteAdmin,
  grants,
});
const grant = (role: PersonViewer["grants"][number]["role"], scope: string[] = []) => ({
  conferenceId: CONFERENCE,
  role,
  scope,
});
const chairOf = (n: number) => viewer(n, [grant("chair")]);
const adminOf = (n: number) => viewer(n, [grant("admin")]);
const reviewerOf = (n: number, pools: string[] = [POOL_A]) => viewer(n, [grant("reviewer", pools)]);
const chairWhoReviews = (n: number) => viewer(n, [grant("chair"), grant("reviewer", [POOL_A])]);
const agentOf = (owner: PersonViewer, tier: "M" | "C"): AgentViewer => ({
  kind: "agent",
  tokenId: uuid(99),
  tier,
  conferenceId: CONFERENCE,
  owner,
});

type Made = {
  status?: SubmissionStatus;
  phase?: string;
  authors?: number[];
  reviewers?: number[];
  conflicted?: number[];
};

/** A proposal of the first committee: submitted, by person 700, in review, unless told otherwise. */
function proposal(n: number, v: Made = {}): SubmissionContext {
  const id = uuid(5000 + n);
  const authors = v.authors ?? [700];
  const status = v.status ?? "submitted";
  const submission: Submission = {
    id,
    conferenceId: CONFERENCE,
    ownerPersonId: uuid(authors[0] ?? 700),
    version: 1,
    typeKey: TYPE_A,
    trackKey: null,
    topicKeys: [],
    language: "en",
    title: `MARK-TITLE-${n}`,
    abstract: `MARK-ABSTRACT-${n}`,
    fields: {},
    participationMode: null,
    status,
    createdAt: day(n),
    updatedAt: day(n),
    submittedAt: status === "draft" ? null : day(40),
  };
  const contributions: Contribution[] = authors.map((p, i) => ({
    submissionId: id,
    personId: uuid(p),
    role: i === 0 ? "lead" : "coauthor",
    position: i,
    status: "confirmed",
    invitedEmail: `mark-email-${p}@example.org`,
    invitedName: `MARK-NAME-${p}`,
    invitedAffiliation: null,
  }));
  const assignments: Assignment[] = (v.reviewers ?? []).map((r, i) => ({
    id: uuid(9000 + n * 10 + i),
    conferenceId: CONFERENCE,
    reviewerId: uuid(r),
    submissionId: id,
    createdAt: day(50 + i),
    dueAt: null,
    assignedByPersonId: uuid(10),
  }));
  const conflicts: Conflict[] = (v.conflicted ?? []).map((p, i) => ({
    id: uuid(8000 + n * 10 + i),
    conferenceId: CONFERENCE,
    personId: uuid(p),
    submissionId: id,
    otherPersonId: null,
    kind: "declared" as const,
    declaredBy: "chair" as const,
  }));
  return {
    config: CONFIG,
    phase: v.phase ?? "reviewing",
    submission,
    contributions,
    assignments,
    conflicts,
  };
}

const byId = (...list: SubmissionContext[]) => new Map(list.map((s) => [s.submission.id, s]));
/** Every marker a proposal or a person carries: none may be in what an email is made of. */
const MARKERS = (ns: number[]) =>
  ns.flatMap((n) => [`MARK-TITLE-${n}`, `MARK-ABSTRACT-${n}`, `MARK-NAME-${n}`, `mark-email-${n}`]);

let made = 0;
const notice = (
  kind: NotificationKind,
  proposalNumber: number,
  at: number,
  reason: DeclineReason | null = null,
): PendingNotice => ({
  id: uuid(70_000 + ++made),
  kind,
  submissionId: uuid(5000 + proposalNumber),
  reason,
  createdAt: day(at),
});

const conference = (phase = "reviewing", config: ConferenceConfig = CONFIG) => ({
  id: CONFERENCE,
  slug: "made-up",
  phase,
  config,
});

describe("whose these emails are", () => {
  it("a reviewer's are a reviewer's, a chair's are a chair's, and someone may hold both", () => {
    expect(emailRoles(reviewerOf(80), CONFERENCE)).toEqual({ reviewer: true, chair: false });
    expect(emailRoles(chairOf(10), CONFERENCE)).toEqual({ reviewer: false, chair: true });
    // `admin` means nothing more than `chair`.
    expect(emailRoles(adminOf(11), CONFERENCE)).toEqual({ reviewer: false, chair: true });
    expect(emailRoles(chairWhoReviews(12), CONFERENCE)).toEqual({ reviewer: true, chair: true });
  });

  it("nobody else's: not a track chair's, a stranger's, a site admin's without a role, or an agent's", () => {
    const none = { reviewer: false, chair: false };
    expect(emailRoles(viewer(30, [grant("track_chair")]), CONFERENCE)).toEqual(none);
    expect(emailRoles(viewer(999), CONFERENCE)).toEqual(none);
    expect(emailRoles(viewer(5, [], true), CONFERENCE)).toEqual(none);
    expect(emailRoles(PUBLIC, CONFERENCE)).toEqual(none);
    for (const tier of ["M", "C"] as const) {
      expect(emailRoles(agentOf(chairWhoReviews(12), tier), CONFERENCE)).toEqual(none);
    }
    // A role at one conference is no role at another.
    expect(emailRoles(chairWhoReviews(12), OTHER_CONFERENCE)).toEqual(none);
  });
});

describe('a person\'s own choices, as "Your account" shows them', () => {
  const mine = (n: number, more: Partial<StoredChoices> = {}): StoredChoices => ({
    personId: uuid(n),
    conferenceId: CONFERENCE,
    ...more,
  });

  it("are a summary a day and the reminder, until they choose otherwise", () => {
    expect(projectEmailChoices(reviewerOf(80), conference(), null)).toEqual({
      view: "email_choices",
      conference: { slug: "made-up", title: CONFIG.title, defaultLanguage: CONFIG.defaultLanguage },
      reviewer: { assignments: "daily", reminder: true, reminderDays: 3 },
      chair: null,
    });
    expect(projectEmailChoices(chairOf(10), conference(), undefined)).toMatchObject({
      reviewer: null,
      chair: { notices: "daily" },
    });
  });

  it("show what they chose, each part only for the role it belongs to", () => {
    const stored = mine(12, { assignments: "each", reminder: false, chairNotices: "none" });
    expect(projectEmailChoices(chairWhoReviews(12), conference(), stored)).toMatchObject({
      reviewer: { assignments: "each", reminder: false },
      chair: { notices: "none" },
    });
    // The same row for someone who only reviews, or only chairs: the other part is not theirs.
    expect(projectEmailChoices(reviewerOf(12), conference(), stored)?.chair).toBeNull();
    expect(projectEmailChoices(chairOf(12), conference(), stored)?.reviewer).toBeNull();
    // What is not stored is the default.
    expect(
      projectEmailChoices(chairWhoReviews(12), conference(), mine(12, { reminder: false })),
    ).toMatchObject({
      reviewer: { assignments: "daily", reminder: false },
      chair: { notices: "daily" },
    });
  });

  it("say how many days before the day reviews are due this conference reminds", () => {
    const five = { ...CONFIG, rules: { ...CONFIG.rules, reviewReminderDays: 5 } };
    expect(
      projectEmailChoices(reviewerOf(80), conference("reviewing", five), null)?.reviewer
        ?.reminderDays,
    ).toBe(5);
  });

  it("never show someone else's row, or another conference's, whichever is handed in", () => {
    const theirs: StoredChoices = {
      personId: uuid(81),
      conferenceId: CONFERENCE,
      assignments: "none",
      reminder: false,
      chairNotices: "none",
    };
    const elsewhere: StoredChoices = {
      ...theirs,
      personId: uuid(12),
      conferenceId: OTHER_CONFERENCE,
    };
    for (const stored of [theirs, elsewhere]) {
      expect(projectEmailChoices(chairWhoReviews(12), conference(), stored)).toMatchObject({
        reviewer: { assignments: "daily", reminder: true },
        chair: { notices: "daily" },
      });
      expect(choicesInForce(uuid(12), CONFERENCE, stored)).toEqual({
        assignments: "daily",
        reminder: true,
        chairNotices: "daily",
      });
    }
    // Their own row, for that conference, is what is in force.
    const own: StoredChoices = { ...theirs, personId: uuid(12) };
    expect(choicesInForce(uuid(12), CONFERENCE, own)).toEqual({
      assignments: "none",
      reminder: false,
      chairNotices: "none",
    });
  });

  it("are nobody's who neither reviews nor chairs there, and no agent's", () => {
    const stored = mine(12, { assignments: "each" });
    for (const who of [
      viewer(999),
      viewer(30, [grant("track_chair")]),
      viewer(5, [], true),
      PUBLIC,
      agentOf(chairWhoReviews(12), "M"),
      agentOf(chairWhoReviews(12), "C"),
    ] as Viewer[]) {
      expect(projectEmailChoices(who, conference(), stored)).toBeNull();
    }
  });

  it("are shown in every phase but the last: nothing is sent for an archived conference", () => {
    for (const phase of CONFERENCE_PHASES) {
      const view = projectEmailChoices(chairWhoReviews(12), conference(phase), null);
      expect(view === null, phase).toBe(phase === "archived");
    }
  });

  it("hold the conference's name, the person's own choices, and nothing else", () => {
    const view = projectEmailChoices(chairWhoReviews(12), conference(), mine(12));
    expect(Object.keys(view ?? {}).sort()).toEqual(["chair", "conference", "reviewer", "view"]);
    expect(Object.keys(view?.conference ?? {}).sort()).toEqual([
      "defaultLanguage",
      "slug",
      "title",
    ]);
    // Not even their own id: the page is theirs already.
    expect(findLeaks(view, [uuid(12), CONFERENCE])).toEqual([]);
  });
});

describe("whether something still holds when the email is made", () => {
  const assigned = proposal(1, { reviewers: [80] });

  it("a new assignment holds for its reviewer while the conference is in review", () => {
    expect(notificationHolds(reviewerOf(80), "assigned", assigned)).toBe(true);
    // A chair who also reviews, and is assigned, is its reviewer like anyone.
    expect(
      notificationHolds(chairWhoReviews(12), "assigned", proposal(1, { reviewers: [12] })),
    ).toBe(true);
  });

  it("a new assignment no longer holds once the reviewer is off the proposal or off the committee", () => {
    const cases: [string, Viewer, SubmissionContext | undefined][] = [
      ["removed from the proposal", reviewerOf(80), proposal(1, { reviewers: [] })],
      ["no longer a reviewer", viewer(80), assigned],
      ["a reviewer of another committee now", reviewerOf(80, [POOL_B]), assigned],
      [
        "a conflict recorded since",
        reviewerOf(80),
        proposal(1, { reviewers: [80], conflicted: [80] }),
      ],
      [
        "one of the proposal's people now",
        reviewerOf(80),
        proposal(1, { reviewers: [80], authors: [700, 80] }),
      ],
      [
        "the proposal was withdrawn",
        reviewerOf(80),
        proposal(1, { reviewers: [80], status: "withdrawn" }),
      ],
      ["the proposal is gone", reviewerOf(80), undefined],
      ["someone else's assignment", reviewerOf(81), assigned],
    ];
    for (const [why, who, ctx] of cases) {
      expect(notificationHolds(who, "assigned", ctx), why).toBe(false);
    }
  });

  it("a new assignment holds in `reviewing` only: before it nothing can be opened, after it nothing written", () => {
    for (const phase of CONFERENCE_PHASES) {
      const ctx = proposal(1, { reviewers: [80], phase });
      expect(notificationHolds(reviewerOf(80), "assigned", ctx), phase).toBe(phase === "reviewing");
    }
  });

  it("a notice to chairs holds for a chair who manages the proposal", () => {
    for (const kind of ["declined", "reviews_complete"] as const) {
      expect(notificationHolds(chairOf(10), kind, assigned), kind).toBe(true);
      expect(notificationHolds(adminOf(11), kind, assigned), kind).toBe(true);
      // Whatever phase the conference is in by then: it happened.
      for (const phase of ["reviewing", "deciding", "confirming"]) {
        expect(notificationHolds(chairOf(10), kind, proposal(1, { phase })), phase).toBe(true);
      }
    }
  });

  it("a notice to chairs never holds for a chair's own proposal, or one they have a conflict with", () => {
    for (const kind of ["declined", "reviews_complete"] as const) {
      const cases: [string, Viewer, SubmissionContext | undefined][] = [
        ["their own proposal", chairOf(700), assigned],
        ["a co-author's", chairOf(701), proposal(1, { authors: [700, 701] })],
        ["a conflict", chairOf(61), proposal(1, { conflicted: [61] })],
        ["no longer a chair", viewer(10), assigned],
        ["a reviewer, not a chair", reviewerOf(80), assigned],
        ["a track chair", viewer(30, [grant("track_chair")]), assigned],
        ["a site admin who holds no role there", viewer(5, [], true), assigned],
        ["a chair's agent", agentOf(chairOf(10), "M"), assigned],
        ["a chair's local agent", agentOf(chairOf(10), "C"), assigned],
        ["the public", PUBLIC, assigned],
        ["a proposal that is gone", chairOf(10), undefined],
      ];
      for (const [why, who, ctx] of cases) {
        expect(notificationHolds(who, kind, ctx), `${kind}: ${why}`).toBe(false);
      }
    }
  });
});

describe("what is made of what waits", () => {
  const SUMMARY = new Date(day(100));
  const before = 99;
  const after = 101;
  const plan = (
    who: Viewer,
    kind: NotificationKind,
    frequency: NoticeFrequency,
    pending: PendingNotice[],
    submissions: SubmissionContext[],
    phase = "reviewing",
  ) =>
    planNotices(who, {
      kind,
      frequency,
      phase,
      pending,
      submissions: byId(...submissions),
      summaryAt: SUMMARY,
    });
  const mine = [1, 2, 3].map((n) => proposal(n, { reviewers: [80] }));

  it("each one: an email for each, at once", () => {
    const pending = [notice("assigned", 1, after), notice("assigned", 2, after)];
    expect(plan(reviewerOf(80), "assigned", "each", pending, mine)).toEqual({
      action: "decide",
      emails: pending.map((n) => ({ ids: [n.id], count: 1, reasons: [] })),
      dropped: [],
    });
  });

  it("one summary a day: nothing until the summary's hour has passed since the oldest", () => {
    const fresh = [notice("assigned", 1, after), notice("assigned", 2, after)];
    expect(plan(reviewerOf(80), "assigned", "daily", fresh, mine)).toEqual({ action: "wait" });
    // Written at the very hour: it is for the next one.
    const onTheHour = [{ ...notice("assigned", 1, after), createdAt: SUMMARY.toISOString() }];
    expect(plan(reviewerOf(80), "assigned", "daily", onTheHour, mine)).toEqual({ action: "wait" });
  });

  it("one summary a day: then one email that counts everything that has gathered", () => {
    const pending = [
      notice("assigned", 1, before),
      notice("assigned", 2, before - 3),
      // Written after the hour, and there when the summary is made: counted with the rest.
      notice("assigned", 3, after),
    ];
    expect(plan(reviewerOf(80), "assigned", "daily", pending, mine)).toEqual({
      action: "decide",
      emails: [{ ids: pending.map((n) => n.id), count: 3, reasons: [] }],
      dropped: [],
    });
  });

  it("none: everything is dropped, whenever it was written", () => {
    const pending = [notice("assigned", 1, before), notice("assigned", 2, after)];
    for (const phase of ["cfp_open", "reviewing", "deciding"]) {
      expect(plan(reviewerOf(80), "assigned", "none", pending, mine, phase), phase).toEqual({
        action: "decide",
        emails: [],
        dropped: pending.map((n) => n.id),
      });
    }
  });

  it("a new assignment waits for the conference to be in review, however it is to be sent", () => {
    const early = [1, 2].map((n) => proposal(n, { reviewers: [80], phase: "cfp_open" }));
    const pending = [notice("assigned", 1, before), notice("assigned", 2, before)];
    for (const often of ["each", "daily"] as const) {
      expect(plan(reviewerOf(80), "assigned", often, pending, early, "cfp_open"), often).toEqual({
        action: "wait",
      });
    }
    // In review, what waited goes out: at once, or with the day's summary (already due here).
    expect(plan(reviewerOf(80), "assigned", "daily", pending, mine)).toMatchObject({
      emails: [{ count: 2 }],
    });
  });

  it("a new assignment that was not announced by the end of review is dropped", () => {
    const late = [1, 2].map((n) => proposal(n, { reviewers: [80], phase: "deciding" }));
    const pending = [notice("assigned", 1, before), notice("assigned", 2, before)];
    expect(plan(reviewerOf(80), "assigned", "each", pending, late, "deciding")).toEqual({
      action: "decide",
      emails: [],
      dropped: pending.map((n) => n.id),
    });
  });

  it("counts only what still holds: someone taken off a proposal gets no email about it", () => {
    const now = [
      proposal(1, { reviewers: [80] }),
      proposal(2, { reviewers: [] }),
      proposal(3, { reviewers: [80], status: "withdrawn" }),
    ];
    const pending = [1, 2, 3].map((n) => notice("assigned", n, before));
    const [kept, ...gone] = pending.map((n) => n.id);
    expect(plan(reviewerOf(80), "assigned", "daily", pending, now)).toEqual({
      action: "decide",
      emails: [{ ids: [kept], count: 1, reasons: [] }],
      dropped: gone,
    });
    // Nothing left that holds: no email at all, not one that says "0".
    expect(plan(reviewerOf(80), "assigned", "daily", pending.slice(1), now)).toEqual({
      action: "decide",
      emails: [],
      dropped: gone,
    });
    expect(plan(viewer(80), "assigned", "each", pending, now)).toEqual({
      action: "decide",
      emails: [],
      dropped: pending.map((n) => n.id),
    });
  });

  it("counts a proposal assigned to the same person twice meanwhile once", () => {
    const twice = [
      notice("assigned", 1, before),
      notice("assigned", 1, before),
      notice("assigned", 2, before),
    ];
    const ids = twice.map((n) => n.id);
    expect(plan(reviewerOf(80), "assigned", "daily", twice, mine)).toEqual({
      action: "decide",
      emails: [{ ids: [ids[0], ids[1], ids[2]], count: 2, reasons: [] }],
      dropped: [],
    });
    expect(plan(reviewerOf(80), "assigned", "each", twice, mine)).toEqual({
      action: "decide",
      emails: [
        { ids: [ids[0], ids[1]], count: 1, reasons: [] },
        { ids: [ids[2]], count: 1, reasons: [] },
      ],
      dropped: [],
    });
  });

  it("tells a chair of each proposal given back, with the reasons that were given, each once", () => {
    const managed = [1, 2, 3].map((n) => proposal(n));
    const pending = [
      notice("declined", 1, before, "time"),
      notice("declined", 2, before, "conflict"),
      notice("declined", 3, before, "time"),
    ];
    expect(plan(chairOf(10), "declined", "daily", pending, managed)).toEqual({
      action: "decide",
      emails: [{ ids: pending.map((n) => n.id), count: 3, reasons: ["conflict", "time"] }],
      dropped: [],
    });
    expect(plan(chairOf(10), "declined", "each", pending, managed)).toEqual({
      action: "decide",
      emails: pending.map((n) => ({ ids: [n.id], count: 1, reasons: [n.reason] })),
      dropped: [],
    });
  });

  it("counts a proposal that two reviewers gave back once, with both their reasons", () => {
    const managed = [1, 2].map((n) => proposal(n));
    const pending = [
      notice("declined", 1, before, "time"),
      notice("declined", 1, before, "expertise"),
      notice("declined", 2, before, "time"),
    ];
    const ids = pending.map((n) => n.id);
    // What is counted is proposals: the email says "proposals given back".
    expect(plan(chairOf(10), "declined", "daily", pending, managed)).toEqual({
      action: "decide",
      emails: [{ ids, count: 2, reasons: ["expertise", "time"] }],
      dropped: [],
    });
    expect(plan(chairOf(10), "declined", "each", pending, managed)).toEqual({
      action: "decide",
      emails: [
        { ids: [ids[0], ids[1]], count: 1, reasons: ["expertise", "time"] },
        { ids: [ids[2]], count: 1, reasons: ["time"] },
      ],
      dropped: [],
    });
  });

  it("says first, without looking at any proposal, whether everything waits", () => {
    const fresh = [notice("assigned", 1, after)];
    const old = [notice("assigned", 1, before), notice("assigned", 2, after)];
    const asks = (
      kind: NotificationKind,
      frequency: NoticeFrequency,
      phase: string,
      pending: PendingNotice[],
    ) => noticesWait({ kind, frequency, phase, pending, summaryAt: SUMMARY });
    // A summary waits for its hour; an email for each one never does.
    expect(asks("assigned", "daily", "reviewing", fresh)).toBe(true);
    expect(asks("assigned", "daily", "reviewing", old)).toBe(false);
    expect(asks("assigned", "each", "reviewing", fresh)).toBe(false);
    // A new assignment waits for review, however it is to be sent; a notice to chairs does not.
    for (const often of ["each", "daily"] as const) {
      expect(asks("assigned", often, "cfp_open", old), often).toBe(true);
    }
    expect(asks("declined", "each", "cfp_open", [notice("declined", 1, after, "time")])).toBe(
      false,
    );
    // After review nothing waits: what is left is decided, and dropped.
    expect(asks("assigned", "each", "deciding", fresh)).toBe(false);
    // Someone who chose no email has nothing to wait for, in any phase.
    for (const phase of ["cfp_open", "reviewing", "deciding"]) {
      expect(asks("assigned", "none", phase, fresh), phase).toBe(false);
    }
    // It is the answer planNotices gives.
    for (const often of NOTICE_FREQUENCIES) {
      for (const phase of ["cfp_open", "reviewing", "deciding"]) {
        for (const pending of [fresh, old]) {
          expect(
            plan(reviewerOf(80), "assigned", often, pending, mine, phase).action === "wait",
            `${often} ${phase}`,
          ).toBe(asks("assigned", often, phase, pending));
        }
      }
    }
  });

  it("tells a chair of each proposal with all its reviews, once", () => {
    const managed = [1, 2].map((n) => proposal(n));
    const pending = [
      notice("reviews_complete", 1, before),
      notice("reviews_complete", 1, before),
      notice("reviews_complete", 2, before),
    ];
    expect(plan(chairOf(10), "reviews_complete", "daily", pending, managed)).toMatchObject({
      emails: [{ count: 2, reasons: [] }],
      dropped: [],
    });
  });

  it("never counts a chair's own proposal, or one they have a conflict with: not in an email, not in a number", () => {
    const list = [proposal(1, { authors: [10] }), proposal(2, { conflicted: [10] }), proposal(3)];
    for (const kind of ["declined", "reviews_complete"] as const) {
      const pending = [1, 2, 3].map((n) =>
        notice(kind, n, before, kind === "declined" ? "time" : null),
      );
      const ids = pending.map((n) => n.id);
      for (const often of ["each", "daily"] as const) {
        expect(plan(chairOf(10), kind, often, pending, list), `${kind} ${often}`).toEqual({
          action: "decide",
          emails: [{ ids: [ids[2]], count: 1, reasons: kind === "declined" ? ["time"] : [] }],
          dropped: [ids[0], ids[1]],
        });
      }
      // With only those two, the chair gets nothing: no email says that something happened.
      expect(plan(chairOf(10), kind, "each", pending.slice(0, 2), list)).toEqual({
        action: "decide",
        emails: [],
        dropped: [ids[0], ids[1]],
      });
      // Another chair, who manages all three, is told of all three.
      expect(plan(chairOf(11), kind, "daily", pending, list)).toMatchObject({
        emails: [{ count: 3 }],
        dropped: [],
      });
    }
  });

  it("looks only at the kind it is asked about", () => {
    const pending = [notice("assigned", 1, before), notice("declined", 1, before, "time")];
    expect(
      plan(chairWhoReviews(12), "declined", "each", pending, [proposal(1, { reviewers: [12] })]),
    ).toEqual({
      action: "decide",
      emails: [{ ids: [pending[1]?.id], count: 1, reasons: ["time"] }],
      dropped: [],
    });
  });

  it("answers every waiting notification exactly once when it decides, and hands over numbers and reasons only", () => {
    const people = [10, 61, 80, 81, 700];
    const who = fc.constantFrom<[string, Viewer]>(
      ["a chair", chairOf(10)],
      ["a chair with a conflict", chairOf(61)],
      ["a chair who wrote one", chairOf(700)],
      ["a reviewer", reviewerOf(80)],
      ["another reviewer", reviewerOf(81)],
      ["a chair who reviews", viewer(80, [grant("chair"), grant("reviewer", [POOL_A])])],
      ["nobody any more", viewer(80)],
      ["an agent", agentOf(chairOf(10), "M")],
    );
    const proposals = fc.array(
      fc.record({
        reviewers: fc.subarray([80, 81]),
        conflicted: fc.subarray([61, 80]),
        authors: fc.constantFrom<number[]>([700], [701], [700, 81]),
        status: fc.constantFrom<SubmissionStatus>("submitted", "withdrawn", "accepted"),
      }),
      { minLength: 1, maxLength: 4 },
    );
    fc.assert(
      fc.property(
        who,
        proposals,
        fc.constantFrom(...NOTIFICATION_KINDS),
        fc.constantFrom(...NOTICE_FREQUENCIES),
        fc.constantFrom("cfp_open", "reviewing", "deciding"),
        fc.array(
          fc.record({
            n: fc.integer({ min: 0, max: 5 }),
            at: fc.constantFrom(before, after),
            reason: fc.constantFrom(...DECLINE_REASONS),
          }),
          { maxLength: 8 },
        ),
        ([, viewerOf], specs, kind, often, phase, waiting) => {
          const list = specs.map((spec, i) => proposal(i, { ...spec, phase }));
          const pending = waiting.map((w) =>
            notice(kind, w.n, w.at, kind === "declined" ? w.reason : null),
          );
          const result = planNotices(viewerOf, {
            kind,
            frequency: often,
            phase,
            pending,
            submissions: byId(...list),
            summaryAt: SUMMARY,
          });
          if (result.action === "wait") {
            // Only what could still be sent waits: a summary before its hour, or an
            // assignment before review.
            expect(often).not.toBe("none");
            return;
          }
          const answered = [...result.emails.flatMap((e) => e.ids), ...result.dropped];
          expect([...answered].sort()).toEqual(pending.map((n) => n.id).sort());
          expect(new Set(answered).size).toBe(answered.length);
          for (const email of result.emails) {
            expect(email.count).toBeGreaterThan(0);
            expect(email.count).toBeLessThanOrEqual(email.ids.length);
            // Every notification an email answers still holds for that person.
            for (const id of email.ids) {
              const n = pending.find((p) => p.id === id);
              expect(
                notificationHolds(viewerOf, kind, byId(...list).get(n?.submissionId ?? "")),
              ).toBe(true);
            }
            expect(Object.keys(email).sort()).toEqual(["count", "ids", "reasons"]);
          }
          if (often === "none") expect(result.emails).toEqual([]);
          if (often === "daily") expect(result.emails.length).toBeLessThanOrEqual(1);
          // Nothing of a proposal or of a person is in what is handed over for an email.
          const handed = result.emails.map((e) => ({ count: e.count, reasons: e.reasons }));
          expect(
            findLeaks(handed, [
              ...MARKERS([0, 1, 2, 3, ...people]),
              ...people.map(uuid),
              ...list.map((s) => s.submission.id),
            ]),
          ).toEqual([]);
        },
      ),
      RUNS,
    );
  });
});

describe("what the reminder counts", () => {
  const list = [1, 2, 3, 4].map((n) => proposal(n, { reviewers: [80, 81] }));
  const sent = (n: number, by: number) => ({ submissionId: uuid(5000 + n), reviewerId: uuid(by) });

  it("is the reviewer's own proposals that have no sent review of theirs", () => {
    expect(unsentReviews(reviewerOf(80), list, [])).toBe(4);
    expect(unsentReviews(reviewerOf(80), list, [sent(1, 80), sent(2, 80)])).toBe(2);
    expect(
      unsentReviews(
        reviewerOf(80),
        list,
        [1, 2, 3, 4].map((n) => sent(n, 80)),
      ),
    ).toBe(0);
  });

  it("never counts someone else's review as theirs, or a proposal that is not theirs to review", () => {
    expect(
      unsentReviews(
        reviewerOf(80),
        list,
        [1, 2, 3, 4].map((n) => sent(n, 81)),
      ),
    ).toBe(4);
    const now = [
      proposal(1, { reviewers: [80] }),
      proposal(2, { reviewers: [81] }),
      proposal(3, { reviewers: [80], conflicted: [80] }),
      proposal(4, { reviewers: [80], status: "withdrawn" }),
    ];
    expect(unsentReviews(reviewerOf(80), now, [])).toBe(1);
  });

  it("is nothing outside review, and nothing for anyone who is not a reviewer", () => {
    for (const phase of CONFERENCE_PHASES) {
      const then = [1, 2].map((n) => proposal(n, { reviewers: [80], phase }));
      expect(unsentReviews(reviewerOf(80), then, []), phase).toBe(phase === "reviewing" ? 2 : 0);
    }
    for (const who of [viewer(80), chairOf(10), PUBLIC, agentOf(reviewerOf(80), "C")] as Viewer[]) {
      expect(unsentReviews(who, list, [])).toBe(0);
    }
  });
});
