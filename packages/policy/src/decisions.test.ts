/**
 * Decisions (spec 03, §1.6): who may record one, which proposals take one, what the chairs are
 * shown, what sending would do, and what a proposal's people are shown once a decision is sent.
 * People, proposals and everything a reviewer writes carry markers; each view is rendered for
 * each kind of viewer, before a decision is sent and after, and searched for what it must not
 * hold.
 */
import {
  type Assignment,
  CONFERENCE_PHASES,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  DECISION_OUTCOMES,
  type Decision,
  type DecisionOutcome,
  type Person,
  type Review,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectAssignments, type ReviewersRecord } from "./assignments";
import {
  awaitsDecision,
  canDecide,
  commentsForAuthors,
  type DecisionsRecord,
  decisionsRank,
  projectAuthorDecision,
  projectDecisionColumns,
  projectDecisions,
  projectProposalDecision,
  projectSendSummary,
  sendPlan,
  sentDecision,
  takesDecision,
  waitingDecision,
} from "./decisions";
import { projectSubmission, type SubmissionRecord } from "./projections";
import { projectMyReviews, projectOwnReview } from "./reviews";
import { findLeaks } from "./testing";
import { type AgentViewer, type PersonViewer, PUBLIC, type Viewer } from "./viewer";

const CONFIG: ConferenceConfig = ConfigSchema.parse(conferences.elo2026);
/** ELO 2026 has two pools: the first reviews talks anonymized, the second sees names. */
const [POOL_A, POOL_B] = CONFIG.reviewPools.map((p) => p.key) as [string, string];
const TYPE_A = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_A)?.key ?? "";
const TYPE_B = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_B)?.key ?? "";
const NEEDED_A = CONFIG.reviewPools[0]?.reviewsPerSubmission ?? 0;
const CRITERIA_A = CONFIG.reviewPools[0]?.criteria.map((c) => c.key) ?? [];
const RUNS = { numRuns: 200 };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONFERENCE = uuid(1);
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

function person(n: number): Person {
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
  };
}
/** Everything that names person `n`: their id, and their name and address. */
const marks = (n: number) => [uuid(n), `MARK-NAME-${n}`, `mark-email-${n}@example.org`];

const viewer = (personId: string, grants: PersonViewer["grants"] = []): PersonViewer => ({
  kind: "person",
  personId,
  siteAdmin: false,
  grants,
});
const chairOf = (n: number) =>
  viewer(uuid(n), [{ conferenceId: CONFERENCE, role: "chair", scope: [] }]);
const reviewerOf = (n: number, pools: string[] = [POOL_A]) =>
  viewer(uuid(n), [{ conferenceId: CONFERENCE, role: "reviewer", scope: pools }]);
const agentOf = (owner: PersonViewer, tier: "M" | "C"): AgentViewer => ({
  kind: "agent",
  tokenId: uuid(99),
  tier,
  conferenceId: CONFERENCE,
  owner,
});

/** The cast. Chairs: 10 and 11; 12 owns proposal 3; 13 has a conflict with proposal 4. */
const CHAIR = chairOf(10);
const SECOND = chairOf(11);
const AUTHOR_CHAIR = chairOf(12);
const CONFLICTED_CHAIR = chairOf(13);
const ADMIN = viewer(uuid(15), [{ conferenceId: CONFERENCE, role: "admin", scope: [] }]);
const SITE_ADMIN: PersonViewer = { ...viewer(uuid(16)), siteAdmin: true };
const TRACK_CHAIR = viewer(uuid(14), [
  { conferenceId: CONFERENCE, role: "track_chair", scope: [] },
]);
const OWNER = viewer(uuid(700));
const COAUTHOR = viewer(uuid(701));
const INVITEE = viewer(uuid(702));
const DECLINED = viewer(uuid(703));
const STRANGER = viewer(uuid(999));
const R1 = reviewerOf(80);
const R2 = reviewerOf(81);
const RELEASED = reviewerOf(82);
const OTHER_POOL = reviewerOf(85, [POOL_B]);

type Made = {
  status?: SubmissionStatus;
  phase?: string;
  type?: string;
  authors?: number[];
  invited?: number[];
  declined?: number[];
  reviewers?: number[];
  conflicted?: number[];
};

const PEOPLE = new Map(
  [10, 11, 12, 13, 14, 15, 16, 80, 81, 82, 85, 700, 701, 702, 703, 999].map((n) => [
    uuid(n),
    person(n),
  ]),
);
const subId = (n: number) => uuid(5000 + n);

/** A proposal of the first pool: submitted, by person 700, being decided, unless told otherwise. */
function proposal(n: number, v: Made = {}): SubmissionRecord {
  const id = subId(n);
  const authors = v.authors ?? [700];
  const status = v.status ?? "submitted";
  const submission: Submission = {
    id,
    conferenceId: CONFERENCE,
    ownerPersonId: uuid(authors[0] ?? 700),
    version: 3,
    typeKey: v.type ?? TYPE_A,
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
  const on = (list: number[], cstatus: Contribution["status"], from: number): Contribution[] =>
    list.map((p, i) => ({
      submissionId: id,
      personId: uuid(p),
      role: from + i === 0 ? "lead" : "coauthor",
      position: from + i,
      status: cstatus,
      invitedEmail: cstatus === "confirmed" ? null : `typed-${p}@example.org`,
      invitedName: cstatus === "confirmed" ? null : `Typed ${p}`,
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
    phase: v.phase ?? "deciding",
    submission,
    contributions: [
      ...on(authors, "confirmed", 0),
      ...on(v.invited ?? [], "invited", authors.length),
      ...on(v.declined ?? [], "declined", authors.length + (v.invited?.length ?? 0)),
    ],
    assignments,
    conflicts,
    people: PEOPLE,
  };
}

/** Person `by`'s review of proposal `n`: marked in everything they wrote. */
function review(
  n: number,
  by: number,
  status: Review["status"],
  more: Partial<Review> = {},
): Review {
  return {
    id: uuid(6000 + n * 100 + by),
    conferenceId: CONFERENCE,
    submissionId: subId(n),
    reviewerId: uuid(by),
    version: 2,
    status,
    scores: Object.fromEntries(CRITERIA_A.map((key, i) => [key, 1 + ((by + i) % 5)])),
    comments: `MARK-COMMENTS-${n}-${by}`,
    chairNote: `MARK-CHAIRNOTE-${n}-${by}`,
    recommendation: "accept",
    createdAt: day(60),
    updatedAt: day(62),
    sentAt: status === "sent" ? day(61) : null,
    ...more,
  };
}

/** A decision about proposal `n`: waiting, unless `sentOn` says the day it was sent. */
function decision(
  n: number,
  outcome: DecisionOutcome,
  sentOn: number | null = null,
  comments: string[] = [],
): Decision {
  return {
    id: uuid(7000 + n * 10 + (sentOn === null ? 0 : DECISION_OUTCOMES.indexOf(outcome) + 1)),
    conferenceId: CONFERENCE,
    submissionId: subId(n),
    outcome,
    decidedByPersonId: uuid(11),
    decidedAt: day(70),
    sentAt: sentOn === null ? null : day(sentOn),
    sentByPersonId: sentOn === null ? null : uuid(10),
    comments: sentOn === null ? null : comments,
  };
}

/**
 * The proposals of the tests. 1: an owner, a confirmed co-author, someone invited and someone
 * who declined, two reviewers. 2: one reviewer. 3: a chair's own. 4: one a chair has a conflict
 * with. 5: on the waiting list. 6: withdrawn. 7: a draft. 8: accepted. 9: of the other pool.
 */
const all = (phase = "deciding"): SubmissionRecord[] => [
  proposal(1, { phase, authors: [700, 701], invited: [702], declined: [703], reviewers: [80, 81] }),
  proposal(2, { phase, reviewers: [80] }),
  proposal(3, { phase, authors: [12], reviewers: [81] }),
  proposal(4, { phase, conflicted: [13], reviewers: [80] }),
  proposal(5, { phase, status: "waitlisted", reviewers: [81] }),
  proposal(6, { phase, status: "withdrawn" }),
  proposal(7, { phase, status: "draft" }),
  proposal(8, { phase, status: "accepted", reviewers: [80] }),
  proposal(9, { phase, type: TYPE_B, reviewers: [85] }),
];
const REVIEWS: Review[] = [
  review(1, 80, "sent", { recommendation: "accept" }),
  review(1, 81, "sent", { recommendation: "unsure" }),
  // A draft is its reviewer's own: nothing here may read it, although it is handed over.
  review(1, 82, "draft", { recommendation: "reject" }),
  review(2, 80, "sent", { recommendation: "reject" }),
  review(3, 81, "sent"),
  review(4, 80, "sent", { recommendation: null }),
  review(5, 81, "sent", { recommendation: "unsure" }),
  review(8, 80, "sent"),
  review(9, 85, "sent"),
];

function record(decisions: Decision[], phase = "deciding", reviews = REVIEWS): DecisionsRecord {
  return {
    conferenceId: CONFERENCE,
    config: CONFIG,
    phase,
    submissions: all(phase),
    decisions,
    reviews,
  };
}
const of = (rec: DecisionsRecord, n: number): SubmissionRecord => {
  const found = rec.submissions.find((s) => s.submission.id === subId(n));
  if (!found) throw new Error(`no proposal ${n}`);
  return found;
};

describe("who may record a decision", () => {
  it("a chair of the conference, in person, for a proposal they are given as a chair", () => {
    const rec = record([]);
    for (const who of [CHAIR, SECOND, ADMIN, SITE_ADMIN]) {
      expect(canDecide(who, of(rec, 1))).toBe(true);
      expect(canDecide(who, of(rec, 5))).toBe(true);
    }
    // Never their own proposal, and never one they have a conflict with.
    expect(canDecide(AUTHOR_CHAIR, of(rec, 3))).toBe(false);
    expect(canDecide(AUTHOR_CHAIR, of(rec, 1))).toBe(true);
    expect(canDecide(CONFLICTED_CHAIR, of(rec, 4))).toBe(false);
    expect(canDecide(CONFLICTED_CHAIR, of(rec, 1))).toBe(true);
    // Nor a draft, which is no chair's to read.
    expect(canDecide(CHAIR, of(rec, 7))).toBe(false);
  });

  it("nobody else: not a track chair, a reviewer, the proposal's people, a stranger, the public or an agent", () => {
    const rec = record([]);
    const others: Viewer[] = [
      TRACK_CHAIR,
      R1,
      R2,
      RELEASED,
      OTHER_POOL,
      OWNER,
      COAUTHOR,
      INVITEE,
      DECLINED,
      STRANGER,
      PUBLIC,
      agentOf(CHAIR, "M"),
      agentOf(CHAIR, "C"),
    ];
    for (const who of others) {
      for (const n of [1, 2, 3, 4, 5]) expect(canDecide(who, of(rec, n))).toBe(false);
    }
  });
});

describe("which proposals take a decision", () => {
  it("one that is under consideration or on the waiting list, once the conference is in review", () => {
    const takes = (status: SubmissionStatus, phase: string) =>
      takesDecision(proposal(1, { status, phase }));
    const before = CONFERENCE_PHASES.slice(0, CONFERENCE_PHASES.indexOf("reviewing"));
    const from = CONFERENCE_PHASES.slice(CONFERENCE_PHASES.indexOf("reviewing"));
    for (const phase of before) {
      expect(takes("submitted", phase), phase).toBe("not_in_review");
      expect(takes("waitlisted", phase), phase).toBe("not_in_review");
    }
    for (const phase of [...from]) {
      expect(takes("submitted", phase), phase).toBe("yes");
      expect(takes("waitlisted", phase), phase).toBe("yes");
    }
    // A phase that is not one is not a phase of review.
    expect(takes("submitted", "made_up")).toBe("not_in_review");
    for (const phase of CONFERENCE_PHASES) {
      for (const status of ["draft", "withdrawn"] as const) {
        expect(takes(status, phase), `${status} ${phase}`).toBe("not_under_consideration");
      }
      // A sent accept or reject is final in the app, and so is what follows an accept.
      for (const status of ["accepted", "rejected", "confirmed", "published"] as const) {
        expect(takes(status, phase), `${status} ${phase}`).toBe("decided");
      }
    }
  });

  it("awaits a decision only while it is submitted or on the waiting list", () => {
    const awaits = (status: SubmissionStatus) => awaitsDecision(proposal(1, { status }).submission);
    expect(
      (
        [
          "draft",
          "submitted",
          "withdrawn",
          "accepted",
          "waitlisted",
          "rejected",
          "confirmed",
          "published",
        ] as const
      ).filter(awaits),
    ).toEqual(["submitted", "waitlisted"]);
    // "Submitted" without ever having been sent in is a draft in all but name.
    const never = proposal(1).submission;
    expect(awaitsDecision({ ...never, submittedAt: null })).toBe(false);
  });

  it("finds the decision that waits, and what the authors were last told", () => {
    const decisions = [
      decision(5, "waitlisted", 80, ["a"]),
      decision(5, "accepted"),
      decision(8, "waitlisted", 80, []),
      decision(8, "accepted", 81, []),
    ];
    expect(waitingDecision(decisions, subId(5))?.outcome).toBe("accepted");
    expect(sentDecision(decisions, subId(5))?.outcome).toBe("waitlisted");
    expect(waitingDecision(decisions, subId(8))).toBeUndefined();
    expect(sentDecision(decisions, subId(8))?.outcome).toBe("accepted");
    expect(waitingDecision(decisions, subId(1))).toBeUndefined();
    expect(sentDecision(decisions, subId(1))).toBeUndefined();
    // Sent at one and the same instant: the waiting list is the earlier of the two.
    for (const outcome of ["accepted", "rejected"] as const) {
      const same = [decision(8, outcome, 80, []), decision(8, "waitlisted", 80, [])];
      expect(sentDecision(same, subId(8))?.outcome).toBe(outcome);
      expect(sentDecision([...same].reverse(), subId(8))?.outcome).toBe(outcome);
    }
  });
});

describe("the Decisions page", () => {
  it("is for a chair of the conference, in person: nobody else gets it", () => {
    const rec = record([decision(1, "accepted")]);
    const others: Viewer[] = [
      TRACK_CHAIR,
      R1,
      OWNER,
      COAUTHOR,
      STRANGER,
      PUBLIC,
      agentOf(CHAIR, "M"),
      agentOf(CHAIR, "C"),
      viewer(uuid(10), [{ conferenceId: uuid(2), role: "chair", scope: [] }]),
    ];
    for (const who of others) expect(projectDecisions(who, rec)).toBeNull();
    for (const who of [CHAIR, SECOND, ADMIN, SITE_ADMIN]) {
      expect(projectDecisions(who, rec)?.view).toBe("decisions");
    }
  });

  it("lists by committee what awaits a decision: no decision first, then recorded, then the waiting list", () => {
    const rec = record([
      decision(2, "rejected"),
      decision(5, "waitlisted", 80, []),
      decision(8, "accepted", 80, []),
    ]);
    const view = projectDecisions(CHAIR, rec);
    expect(view).toMatchObject({ canRecord: true, canSend: true, excluded: 0 });
    expect(view?.pools.map((p) => [p.key, p.needed, p.proposals, p.undecided])).toEqual([
      [POOL_A, NEEDED_A, 5, 3],
      [POOL_B, CONFIG.reviewPools[1]?.reviewsPerSubmission, 1, 1],
    ]);
    // Not the withdrawn one, the draft or the accepted one.
    expect(view?.pools[0]?.items).toEqual([
      {
        id: subId(1),
        title: "MARK-TITLE-1",
        typeKey: TYPE_A,
        waitlisted: false,
        // Two sent reviews; the draft is not counted, and its recommendation is not either.
        sent: 2,
        recommendations: { accept: 1, unsure: 1, reject: 0 },
        recorded: null,
      },
      {
        id: subId(3),
        title: "MARK-TITLE-3",
        typeKey: TYPE_A,
        waitlisted: false,
        sent: 1,
        recommendations: { accept: 1, unsure: 0, reject: 0 },
        recorded: null,
      },
      {
        id: subId(4),
        title: "MARK-TITLE-4",
        typeKey: TYPE_A,
        waitlisted: false,
        // A review without a recommendation is counted as sent, and in none of the three.
        sent: 1,
        recommendations: { accept: 0, unsure: 0, reject: 0 },
        recorded: null,
      },
      {
        id: subId(2),
        title: "MARK-TITLE-2",
        typeKey: TYPE_A,
        waitlisted: false,
        sent: 1,
        recommendations: { accept: 0, unsure: 0, reject: 1 },
        recorded: "rejected",
      },
      {
        id: subId(5),
        title: "MARK-TITLE-5",
        typeKey: TYPE_A,
        waitlisted: true,
        sent: 1,
        recommendations: { accept: 0, unsure: 1, reject: 0 },
        recorded: null,
      },
    ]);
    expect(decisionsRank({ waitlisted: false, recorded: null })).toBe(0);
    expect(decisionsRank({ waitlisted: false, recorded: "accepted" })).toBe(1);
    // A new decision recorded for a proposal on the waiting list is one that waits to be sent.
    expect(decisionsRank({ waitlisted: true, recorded: "accepted" })).toBe(1);
    expect(decisionsRank({ waitlisted: true, recorded: null })).toBe(2);
  });

  it("says by the phase whether decisions can be recorded, and whether they can be sent", () => {
    const can = (phase: string) => {
      const view = projectDecisions(CHAIR, record([], phase));
      return [view?.canRecord, view?.canSend];
    };
    expect(can("draft")).toEqual([false, false]);
    expect(can("cfp_open")).toEqual([false, false]);
    expect(can("reviewing")).toEqual([true, false]);
    for (const phase of ["deciding", "confirming", "scheduling", "published", "archived"]) {
      expect(can(phase), phase).toEqual([true, true]);
    }
  });

  it("never lists a chair's own proposal or one they have a conflict with, and holds nobody's name or word", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(CHAIR, SECOND, AUTHOR_CHAIR, CONFLICTED_CHAIR, ADMIN, SITE_ADMIN),
        fc.subarray([1, 2, 3, 4, 5, 9]),
        fc.constantFrom(...DECISION_OUTCOMES),
        (who, decided, outcome) => {
          const rec = record(
            decided.map((n) =>
              decision(n, n === 5 && outcome === "waitlisted" ? "accepted" : outcome),
            ),
          );
          const view = projectDecisions(who, rec);
          const kept = [3, 4].filter((n) => !canDecide(who, of(rec, n)));
          expect(view?.excluded).toBe(kept.length);
          const hidden = kept.flatMap((n) => [subId(n), `MARK-TITLE-${n}`]);
          // No person, no word of a review, no decision's id: titles, counts and outcomes.
          const never = [
            ...[...PEOPLE.keys()].flatMap((id) => marks(Number(id.slice(-4)))),
            "MARK-COMMENTS",
            "MARK-CHAIRNOTE",
            "MARK-ABSTRACT",
            ...rec.decisions.map((d) => d.id),
            ...rec.reviews.map((r) => r.id),
          ];
          expect(findLeaks(view, [...hidden, ...never])).toEqual([]);
          // What is listed is exactly what they manage, of what awaits a decision.
          const listed = (view?.pools ?? []).flatMap((p) => p.items.map((x) => x.id)).sort();
          expect(listed).toEqual(
            [1, 2, 3, 4, 5, 9]
              .filter((n) => !kept.includes(n))
              .map(subId)
              .sort(),
          );
        },
      ),
      RUNS,
    );
  });
});

describe("the Decision section of a proposal's page", () => {
  it("says what is recorded, what the authors were told, and what the reviewers recommend", () => {
    const rec = record([
      decision(1, "rejected"),
      decision(5, "waitlisted", 80, []),
      decision(5, "accepted"),
    ]);
    expect(projectProposalDecision(CHAIR, rec, subId(1))).toEqual({
      view: "proposal_decision",
      submissionId: subId(1),
      takes: "yes",
      outcomes: ["accepted", "waitlisted", "rejected"],
      recorded: { outcome: "rejected", at: day(70) },
      told: null,
      reviews: {
        sent: 2,
        asked: NEEDED_A,
        recommendations: { accept: 1, unsure: 1, reject: 0 },
      },
      canSend: true,
    });
    // On the waiting list: the two outcomes that end it, and what was told is still said.
    expect(projectProposalDecision(CHAIR, rec, subId(5))).toMatchObject({
      takes: "yes",
      outcomes: ["accepted", "rejected"],
      recorded: { outcome: "accepted" },
      told: { outcome: "waitlisted", at: day(80) },
    });
    expect(projectProposalDecision(CHAIR, rec, subId(6))).toMatchObject({
      takes: "not_under_consideration",
      outcomes: [],
    });
    expect(projectProposalDecision(CHAIR, record([], "cfp_open"), subId(1))).toMatchObject({
      takes: "not_in_review",
      outcomes: [],
      canSend: false,
    });
  });

  it("is nobody's but a chair's who manages the proposal", () => {
    const rec = record([decision(1, "accepted"), decision(3, "accepted"), decision(4, "rejected")]);
    const nobody: [Viewer, number][] = [
      [AUTHOR_CHAIR, 3],
      [CONFLICTED_CHAIR, 4],
      [CHAIR, 7],
      [TRACK_CHAIR, 1],
      [R1, 1],
      [OWNER, 1],
      [COAUTHOR, 1],
      [INVITEE, 1],
      [STRANGER, 1],
      [PUBLIC, 1],
      [agentOf(CHAIR, "M"), 1],
      [agentOf(CHAIR, "C"), 1],
    ];
    for (const [who, n] of nobody) expect(projectProposalDecision(who, rec, subId(n))).toBeNull();
    // A proposal of another conference, and one that is not there.
    expect(projectProposalDecision(CHAIR, { ...rec, conferenceId: uuid(2) }, subId(1))).toBeNull();
    expect(projectProposalDecision(CHAIR, rec, uuid(424242))).toBeNull();
    // And a chair who manages it is shown no reviewer and no word of a review here.
    expect(
      findLeaks(projectProposalDecision(CHAIR, rec, subId(1)), [
        ...marks(80),
        ...marks(81),
        "MARK-COMMENTS",
        "MARK-CHAIRNOTE",
      ]),
    ).toEqual([]);
  });
});

describe("what sending the decisions would do", () => {
  const waiting = [
    decision(1, "accepted"),
    decision(3, "rejected"),
    decision(4, "waitlisted"),
    decision(5, "accepted"),
    decision(6, "accepted"),
    decision(5, "waitlisted", 80, []),
  ];

  it("sends every decision that waits for a proposal that still awaits one, to its owner and confirmed co-authors", () => {
    const plan = sendPlan(record(waiting));
    expect(plan.send.map((p) => [p.decision.submissionId, p.decision.outcome])).toEqual([
      [subId(1), "accepted"],
      [subId(3), "rejected"],
      [subId(4), "waitlisted"],
      [subId(5), "accepted"],
    ]);
    // The owner and the co-author who confirmed: not the person invited, nor the one who declined.
    expect(plan.send[0]?.recipients.map((p) => p.id)).toEqual([uuid(700), uuid(701)]);
    expect(plan.send[1]?.recipients.map((p) => p.id)).toEqual([uuid(12)]);
    // Its proposal was withdrawn since: nothing is sent for it.
    expect(plan.dropped.map((d) => d.submissionId)).toEqual([subId(6)]);
    // Proposals 2 and 9 are under consideration with no decision: they are told nothing.
    expect(plan.undecided).toBe(2);
  });

  it("carries the comments of the sent reviews and nothing else of them, in an order that says nothing", () => {
    const rec = record(waiting);
    const [first] = sendPlan(rec).send;
    // In the order of the reviews' own ids; the draft's comments are not among them.
    expect(first?.comments).toEqual(["MARK-COMMENTS-1-80", "MARK-COMMENTS-1-81"]);
    // Whoever sent first, whoever was assigned first, whatever they are called: the same order.
    const reordered: Review[] = [
      review(1, 81, "sent", { sentAt: day(55), createdAt: day(54) }),
      review(1, 80, "sent", { sentAt: day(69), createdAt: day(68) }),
    ];
    expect(commentsForAuthors({ reviews: reordered }, subId(1))).toEqual(first?.comments);
    expect(commentsForAuthors({ reviews: [...reordered].reverse() }, subId(1))).toEqual(
      first?.comments,
    );
    // A review whose comments are empty adds nothing, and one of another proposal is not read.
    const blank = [review(2, 80, "sent", { comments: "  \n " }), review(1, 81, "sent")];
    expect(commentsForAuthors({ reviews: blank }, subId(2))).toEqual([]);
    // What cannot be seen is not handed on: an override that turns the words around, and
    // zero-width characters, are gone from the text that is stored, shown and mailed.
    const at = (...points: number[]) => String.fromCodePoint(...points);
    const hiding = `Good${at(0x202e)} work${at(0x200b)}.\r\n\r\n\r\nA second${at(0x2060)} paragraph.${at(0x202c)}  `;
    const nothing = ` ${at(0x202e)}${at(0x200b)}\n${at(0x2060)} ${at(0xfeff)}`;
    expect(
      commentsForAuthors(
        {
          reviews: [
            review(2, 80, "sent", { comments: nothing }),
            review(2, 81, "sent", { comments: hiding }),
          ],
        },
        subId(2),
      ),
      // And a comment of nothing but such characters is no comment: it gets no number.
    ).toEqual(["Good work.\n\nA second paragraph."]);
    expect(
      findLeaks(
        sendPlan(rec).send.map((p) => p.comments),
        ["MARK-CHAIRNOTE"],
      ),
    ).toEqual([]);
  });

  it("never sends a proposal on the waiting list there again, or anything to one that is decided", () => {
    const odd = [decision(5, "waitlisted"), decision(8, "rejected"), decision(7, "accepted")];
    const plan = sendPlan(record(odd));
    expect(plan.send).toEqual([]);
    expect(plan.dropped.map((d) => d.submissionId).sort()).toEqual([subId(5), subId(7), subId(8)]);
  });

  it("is told to a chair in numbers, which count the proposals they are kept from and name none", () => {
    const rec = record(waiting);
    const plan = sendPlan(rec);
    const numbers = {
      view: "send_decisions",
      canSend: true,
      accepted: 2,
      waitlisted: 1,
      rejected: 1,
      // 700 (on proposals 1, 4 and 5) and 701 and 12: three people, though four proposals.
      people: 3,
      undecided: 2,
      dropped: 1,
    };
    for (const who of [CHAIR, SECOND, AUTHOR_CHAIR, CONFLICTED_CHAIR, ADMIN, SITE_ADMIN]) {
      const summary = projectSendSummary(who, rec, plan);
      expect(summary).toEqual(numbers);
      expect(
        findLeaks(summary, [
          ...rec.submissions.flatMap((s) => [s.submission.id, s.submission.title]),
          ...[...PEOPLE.keys()],
          "MARK-",
        ]),
      ).toEqual([]);
    }
    expect(projectSendSummary(CHAIR, record(waiting, "reviewing"), plan)?.canSend).toBe(false);
    for (const who of [
      TRACK_CHAIR,
      R1,
      OWNER,
      STRANGER,
      PUBLIC,
      agentOf(CHAIR, "M"),
      agentOf(CHAIR, "C"),
    ]) {
      expect(projectSendSummary(who, rec, plan)).toBeNull();
    }
  });
});

describe("what a proposal's people are shown", () => {
  const told = decision(1, "accepted", 80, ["MARK-COMMENTS-1-80", "MARK-COMMENTS-1-81"]);

  it("the owner and a confirmed co-author read a sent decision, with the comments as they were sent", () => {
    const ctx = of(record([told]), 1);
    for (const who of [OWNER, COAUTHOR]) {
      expect(projectAuthorDecision(who, ctx, [told])).toEqual({
        view: "author_decision",
        submissionId: subId(1),
        outcome: "accepted",
        sentAt: day(80),
        comments: ["MARK-COMMENTS-1-80", "MARK-COMMENTS-1-81"],
      });
    }
    // A chair is the author of their own proposal like anyone.
    const own = decision(3, "rejected", 80, ["MARK-COMMENTS-3-81"]);
    expect(projectAuthorDecision(AUTHOR_CHAIR, of(record([own]), 3), [own])?.outcome).toBe(
      "rejected",
    );
  });

  it("nobody else reads it: not someone invited, a reviewer, a chair, a stranger, the public or an agent", () => {
    const ctx = of(record([told]), 1);
    const others: Viewer[] = [
      INVITEE,
      DECLINED,
      R1,
      R2,
      RELEASED,
      OTHER_POOL,
      CHAIR,
      SECOND,
      TRACK_CHAIR,
      STRANGER,
      PUBLIC,
      agentOf(CHAIR, "M"),
      agentOf(CHAIR, "C"),
    ];
    for (const who of others) expect(projectAuthorDecision(who, ctx, [told])).toBeNull();
    // Not even the agent of a chair on that chair's own proposal: an agent is shown no review.
    const own = decision(3, "accepted", 80, ["MARK-COMMENTS-3-81"]);
    for (const tier of ["M", "C"] as const) {
      expect(
        projectAuthorDecision(agentOf(AUTHOR_CHAIR, tier), of(record([own]), 3), [own]),
      ).toBeNull();
    }
    // A decision of another proposal that is handed in is not this one's.
    expect(projectAuthorDecision(OWNER, of(record([]), 2), [told])).toBeNull();
  });

  it("before a decision is sent, they read nothing of it, whatever is recorded", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DECISION_OUTCOMES),
        fc.constantFrom(OWNER, COAUTHOR),
        (outcome, who) => {
          const waits = decision(1, outcome);
          const ctx = of(record([waits]), 1);
          expect(projectAuthorDecision(who, ctx, [waits])).toBeNull();
          // And a new one that waits does not change what was sent before it.
          const earlier = decision(1, "waitlisted", 80, ["MARK-COMMENTS-1-80"]);
          expect(projectAuthorDecision(who, ctx, [earlier, waits])).toEqual(
            projectAuthorDecision(who, ctx, [earlier]),
          );
        },
      ),
      RUNS,
    );
  });

  it("holds the comments and never who wrote them, what they scored or recommended, or their note", () => {
    const ctx = of(record([told]), 1);
    const shown = projectAuthorDecision(OWNER, ctx, [told]);
    expect(Object.keys(shown ?? {}).sort()).toEqual([
      "comments",
      "outcome",
      "sentAt",
      "submissionId",
      "view",
    ]);
    expect(
      findLeaks(shown, [
        ...marks(80),
        ...marks(81),
        ...marks(10),
        ...marks(11),
        "MARK-CHAIRNOTE",
        told.id,
        ...REVIEWS.map((r) => r.id),
      ]),
    ).toEqual([]);
  });
});

/** Everything the policy gives a viewer that could show a decision, for one state of things. */
function shownTo(who: Viewer, rec: DecisionsRecord, n: number) {
  const ctx = of(rec, n);
  const reviewers: ReviewersRecord = {
    conferenceId: CONFERENCE,
    config: CONFIG,
    phase: rec.phase,
    reviewers: [
      ...[80, 81, 82].map((p) => ({ personId: uuid(p), scope: [POOL_A] })),
      { personId: uuid(85), scope: [POOL_B] },
    ],
    reviewerProfiles: [],
    people: PEOPLE,
    submissions: rec.submissions,
    conflictReleased: new Map(),
    reviews: rec.reviews,
    declines: [],
  };
  const own =
    who.kind === "person"
      ? rec.reviews.find(
          (r) => r.submissionId === ctx.submission.id && r.reviewerId === who.personId,
        )
      : undefined;
  return {
    proposal: projectSubmission(who, ctx),
    decision: projectAuthorDecision(who, ctx, rec.decisions),
    page: projectDecisions(who, rec),
    section: projectProposalDecision(who, rec, ctx.submission.id),
    columns: projectDecisionColumns(who, rec),
    ownReview: projectOwnReview(who, ctx, own),
    myReviews: projectMyReviews(
      who,
      { id: CONFERENCE, slug: "made-up", phase: rec.phase, config: CONFIG },
      rec.submissions,
      rec.reviews,
    ),
    assignments: projectAssignments(who, reviewers, new Date(Date.UTC(2027, 0, 1))),
  };
}

describe("what anyone can learn of a decision, before it is sent and after", () => {
  /** Everyone who is not a chair managing proposal 1: before it is sent, nothing changes for them. */
  const kept: [string, Viewer][] = [
    ["the owner", OWNER],
    ["a confirmed co-author", COAUTHOR],
    ["someone invited", INVITEE],
    ["someone who declined", DECLINED],
    ["a reviewer of it", R1],
    ["another reviewer of it", R2],
    ["a released reviewer", RELEASED],
    ["a reviewer of another committee", OTHER_POOL],
    ["a track chair", TRACK_CHAIR],
    ["a stranger", STRANGER],
    ["the public", PUBLIC],
    ["an agent, tier M", agentOf(CHAIR, "M")],
    ["an agent, tier C", agentOf(CHAIR, "C")],
  ];

  it("a decision that waits changes nothing anyone but a managing chair is given", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DECISION_OUTCOMES),
        fc.constantFrom(...kept),
        fc.constantFrom("reviewing", "deciding", "confirming"),
        (outcome, [what, who], phase) => {
          const waits = decision(1, outcome);
          const before = shownTo(who, record([], phase), 1);
          const after = shownTo(who, record([waits], phase), 1);
          expect(after, what).toEqual(before);
          expect(findLeaks(after, [waits.id]), what).toEqual([]);
        },
      ),
      RUNS,
    );
    // The same for a chair, of their own proposal and of one they have a conflict with.
    for (const [who, n] of [
      [AUTHOR_CHAIR, 3],
      [CONFLICTED_CHAIR, 4],
    ] as const) {
      for (const outcome of DECISION_OUTCOMES) {
        const waits = decision(n, outcome);
        expect(shownTo(who, record([waits]), n)).toEqual(shownTo(who, record([]), n));
      }
    }
  });

  it("once it is sent, a reviewer still learns nothing: no status, no decision, no other review", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DECISION_OUTCOMES),
        fc.constantFrom(R1, R2, RELEASED, OTHER_POOL),
        fc.constantFrom("deciding", "confirming", "archived"),
        (outcome, who, phase) => {
          const told = decision(1, outcome, 80, ["MARK-COMMENTS-1-80", "MARK-COMMENTS-1-81"]);
          const rec = record([told], phase);
          // The proposal as it is once the decision was sent: its status is the outcome.
          const decided = {
            ...rec,
            submissions: rec.submissions.map((s) =>
              s.submission.id === subId(1)
                ? { ...s, submission: { ...s.submission, status: outcome } }
                : s,
            ),
          };
          const shown = shownTo(who, decided, 1);
          const others = [80, 81].filter((r) => uuid(r) !== who.personId);
          expect(
            findLeaks(shown, [
              `"${outcome}"`,
              '"author_decision"',
              told.id,
              ...others.flatMap((r) => [
                `MARK-COMMENTS-1-${r}`,
                `MARK-CHAIRNOTE-1-${r}`,
                ...marks(r),
              ]),
            ]),
          ).toEqual([]);
          // What they read of the proposal is what they read before any decision.
          const undecided = shownTo(who, record([], phase), 1);
          expect(shown.proposal).toEqual(undecided.proposal);
          expect(shown.ownReview).toEqual(undecided.ownReview);
          expect(shown.myReviews).toEqual(undecided.myReviews);
        },
      ),
      RUNS,
    );
  });

  it("once it is sent, an agent is given the status and nothing of a review, whatever its tier", () => {
    const told = decision(1, "accepted", 80, ["MARK-COMMENTS-1-80", "MARK-COMMENTS-1-81"]);
    const waits = decision(2, "rejected");
    const rec = record([told, waits]);
    const decided = {
      ...rec,
      submissions: rec.submissions.map((s) =>
        s.submission.id === subId(1)
          ? { ...s, submission: { ...s.submission, status: "accepted" as const } }
          : s,
      ),
    };
    for (const tier of ["M", "C"] as const) {
      const agent = agentOf(CHAIR, tier);
      const shown = [shownTo(agent, decided, 1), shownTo(agent, decided, 2)];
      expect(shown[0]?.proposal).toMatchObject({ status: "accepted" });
      expect(shown[1]?.proposal).toMatchObject({ status: "submitted" });
      expect(
        findLeaks(shown, [told.id, waits.id, "MARK-COMMENTS", "MARK-CHAIRNOTE", '"rejected"']),
      ).toEqual([]);
      for (const one of shown) {
        expect([one.decision, one.page, one.section, one.columns]).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }
    }
  });

  it("someone invited, a stranger and the public are given no decision and no comment, sent or not", () => {
    const told = decision(1, "accepted", 80, ["MARK-COMMENTS-1-80"]);
    const rec = record([told]);
    for (const who of [INVITEE, DECLINED, STRANGER, PUBLIC]) {
      const shown = shownTo(who, rec, 1);
      expect(shown.decision).toBeNull();
      expect(findLeaks(shown, ["MARK-COMMENTS", "MARK-CHAIRNOTE", told.id])).toEqual([]);
    }
    expect(shownTo(STRANGER, rec, 1).proposal).toBeNull();
    expect(shownTo(PUBLIC, rec, 1).proposal).toBeNull();
  });
});

describe("what the proposals export says of decisions and reviews", () => {
  const decisions = [
    decision(1, "accepted"),
    decision(5, "waitlisted", 80, []),
    decision(8, "accepted", 80, []),
    decision(3, "rejected"),
  ];

  it("is the decision that stands for each proposal a chair manages, whether it was sent, and the reviews sent", () => {
    const columns = projectDecisionColumns(CHAIR, record(decisions));
    expect(columns?.[subId(1)]).toEqual({ decision: "accepted", sent: false, reviewsSent: 2 });
    expect(columns?.[subId(2)]).toEqual({ decision: null, sent: false, reviewsSent: 1 });
    expect(columns?.[subId(5)]).toEqual({ decision: "waitlisted", sent: true, reviewsSent: 1 });
    expect(columns?.[subId(8)]).toEqual({ decision: "accepted", sent: true, reviewsSent: 1 });
    // A new decision recorded for a proposal on the waiting list is the one that stands.
    const again = projectDecisionColumns(CHAIR, record([...decisions, decision(5, "rejected")]));
    expect(again?.[subId(5)]).toEqual({ decision: "rejected", sent: false, reviewsSent: 1 });
    // A draft is no chair's to read, and is not in it.
    expect(columns).not.toHaveProperty(subId(7));
  });

  it("leaves out a chair's own proposal and conflicts, and is not a track chair's or an agent's at all", () => {
    expect(projectDecisionColumns(AUTHOR_CHAIR, record(decisions))).not.toHaveProperty(subId(3));
    expect(projectDecisionColumns(CONFLICTED_CHAIR, record(decisions))).not.toHaveProperty(
      subId(4),
    );
    expect(projectDecisionColumns(CONFLICTED_CHAIR, record(decisions))).toHaveProperty(subId(3));
    for (const who of [
      TRACK_CHAIR,
      R1,
      OWNER,
      STRANGER,
      PUBLIC,
      agentOf(CHAIR, "M"),
      agentOf(CHAIR, "C"),
    ]) {
      expect(projectDecisionColumns(who, record(decisions))).toBeNull();
    }
  });
});
