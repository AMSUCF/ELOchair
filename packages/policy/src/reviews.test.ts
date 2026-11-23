/**
 * Reviews (spec 03, §1.4 and §1.5): who may write one, and what anyone is shown of one. People
 * and everything a reviewer writes carry markers; each view is rendered for each kind of viewer
 * and searched for what it must not hold.
 *
 * The three views: a reviewer's own review of a proposal, a chair's view of a proposal's
 * reviews (the Reviewers section), and the rows of a reviewer's own list. The counts that
 * follow from sent reviews (the Assignments page, the People page) are checked with them.
 */
import {
  type Assignment,
  CONFERENCE_PHASES,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  type Person,
  type Review,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SubmissionContext, submissionAccess } from "./access";
import {
  canManageReviewers,
  projectAssignments,
  projectProposalReviewers,
  type ReviewersRecord,
} from "./assignments";
import { type PeopleRecord, projectPeople } from "./people";
import { projectSubmission, type SubmissionRecord } from "./projections";
import {
  canWriteReview,
  chairReview,
  isReviewerOf,
  projectMyReviews,
  projectOwnReview,
  type ReviewDecline,
  reviewsKeptFrom,
  reviewsOpen,
} from "./reviews";
import { findLeaks } from "./testing";
import { type AgentViewer, type PersonViewer, PUBLIC, type Viewer } from "./viewer";

const CONFIG: ConferenceConfig = ConfigSchema.parse(conferences.elo2026);
/** ELO 2026 has two pools: the first reviews talks anonymized, the second sees names. */
const [POOL_A, POOL_B] = CONFIG.reviewPools.map((p) => p.key) as [string, string];
const TYPE_A = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_A)?.key ?? "";
const CRITERIA_A = CONFIG.reviewPools[0]?.criteria.map((c) => c.key) ?? [];
const NOW = new Date(Date.parse(CONFIG.deadlines.submissionsClose) + 1000);
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
/** Everything person `n` wrote in a review, or when they said they could not review. */
const written = (n: number) => [
  `MARK-COMMENTS-${n}`,
  `MARK-CHAIRNOTE-${n}`,
  `MARK-DECLINE-NOTE-${n}`,
];

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
/** A chair who also holds the reviewer's role: chairs review like anyone, where assigned. */
const chairWhoReviews = (n: number, pools: string[] = [POOL_A]) =>
  viewer(uuid(n), [
    { conferenceId: CONFERENCE, role: "chair", scope: [] },
    { conferenceId: CONFERENCE, role: "reviewer", scope: pools },
  ]);
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
  invited?: number[];
  declined?: number[];
  reviewers?: number[];
  conflicted?: number[];
};

/** A proposal of the first pool: submitted, by person 700, in review, unless told otherwise. */
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
  const on = (list: number[], cstatus: Contribution["status"], from: number): Contribution[] =>
    list.map((p, i) => ({
      submissionId: id,
      personId: uuid(p),
      role: from + i === 0 ? "lead" : "coauthor",
      position: from + i,
      status: cstatus,
      invitedEmail: null,
      invitedName: null,
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
    contributions: [
      ...on(authors, "confirmed", 0),
      ...on(v.invited ?? [], "invited", authors.length),
      ...on(v.declined ?? [], "declined", authors.length + (v.invited?.length ?? 0)),
    ],
    assignments,
    conflicts,
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
    submissionId: uuid(5000 + n),
    reviewerId: uuid(by),
    version: 2,
    status,
    scores: Object.fromEntries(CRITERIA_A.map((key, i) => [key, 1 + ((by + i) % 5)])),
    comments: `MARK-COMMENTS-${by}`,
    chairNote: `MARK-CHAIRNOTE-${by}`,
    recommendation: "accept",
    createdAt: day(60),
    updatedAt: day(62),
    sentAt: status === "sent" ? day(61) : null,
    ...more,
  };
}

const PEOPLE = new Map(
  [10, 30, 61, 80, 81, 82, 84, 85, 700, 701, 702, 703, 999].map((n) => [uuid(n), person(n)]),
);

function record(
  submissions: SubmissionContext[],
  reviews: Review[],
  more: Partial<ReviewersRecord> = {},
): ReviewersRecord {
  return {
    conferenceId: CONFERENCE,
    config: CONFIG,
    phase: submissions[0]?.phase ?? "reviewing",
    reviewers: [
      ...[80, 81, 82, 84].map((n) => ({ personId: uuid(n), scope: [POOL_A] })),
      { personId: uuid(85), scope: [POOL_B] },
    ],
    reviewerProfiles: [],
    people: PEOPLE,
    submissions,
    conflictReleased: new Map(),
    reviews,
    declines: [],
    ...more,
  };
}

/*
 * One proposal, and everyone who stands in some relation to it.
 * - 80 and 81 review it: 80 has sent a review, 81 has a draft.
 * - 82 was released from it (no assignment is left), and said why in a note.
 * - 84 is assigned and has a conflict with it; 85 is assigned and reviews for another pool.
 * - 700 and 701 wrote it, 702 is invited to it, 703 declined. 700 also chairs the conference.
 * - 10 chairs the conference and manages it; 61 chairs it and has a conflict with this proposal.
 * - 30 is a track chair; 999 is nobody here.
 */
const target = (v: Made = {}) =>
  proposal(1, {
    authors: [700, 701],
    invited: [702],
    declined: [703],
    reviewers: [80, 81, 84, 85],
    conflicted: [84, 61],
    ...v,
  });
const REVIEWS = [review(1, 80, "sent"), review(1, 81, "draft"), review(1, 82, "draft")];
const DECLINE: ReviewDecline = {
  submissionId: uuid(5001),
  reviewerId: uuid(82),
  reason: "time",
  note: "MARK-DECLINE-NOTE-82",
  at: day(55),
};

const chair = chairOf(10);
const everyoneElse: [string, Viewer][] = [
  ["a reviewer who was released from it", reviewerOf(82)],
  ["a reviewer of another committee", reviewerOf(85, [POOL_B])],
  ["a reviewer with a conflict", reviewerOf(84)],
  ["its owner", viewer(uuid(700))],
  ["a confirmed co-author", viewer(uuid(701))],
  ["someone invited to it", viewer(uuid(702))],
  ["someone who declined it", viewer(uuid(703))],
  ["a chair with a conflict", chairOf(61)],
  ["a chair on their own proposal", chairOf(700)],
  [
    "a track chair",
    viewer(uuid(30), [{ conferenceId: CONFERENCE, role: "track_chair", scope: [] }]),
  ],
  ["a stranger", viewer(uuid(999))],
  ["the public", PUBLIC],
  ["a chair's cloud agent (tier M)", agentOf(chair, "M")],
  ["a chair's local agent (tier C)", agentOf(chair, "C")],
];
/** Everything anyone wrote in a review of the proposal, or in saying they could not review it. */
const ALL_WRITTEN = [80, 81, 82].flatMap(written);

describe("who may write a review", () => {
  it("the proposal's reviewer, in person, while the conference is in `reviewing`", () => {
    for (const phase of CONFERENCE_PHASES) {
      const ctx = target({ phase });
      for (const n of [80, 81]) {
        expect(canWriteReview(reviewerOf(n), ctx), `${phase} ${n}`).toBe(phase === "reviewing");
      }
      expect(reviewsOpen(phase), phase).toBe(phase === "reviewing");
    }
    expect(reviewsOpen("no such phase")).toBe(false);
  });

  it("nobody else: not a chair, an author, a released or conflicted reviewer, a stranger or an agent", () => {
    const ctx = target();
    for (const [who, v] of [...everyoneElse, ["the chair who manages it", chair] as const]) {
      expect(canWriteReview(v, ctx), who).toBe(false);
      expect(isReviewerOf(v, ctx), who).toBe(false);
    }
    // An agent of a reviewer does not exist: tokens are a chair's. Whatever its owner is, an
    // agent writes nothing.
    for (const tier of ["M", "C"] as const) {
      expect(canWriteReview(agentOf(reviewerOf(80), tier), ctx), tier).toBe(false);
    }
  });

  it("a chair who also reviews, where they are assigned: the proposal is given to them as a chair, and they are its reviewer", () => {
    const both = chairWhoReviews(86);
    const theirs = proposal(7, { reviewers: [86, 80] });
    expect(submissionAccess(both, theirs)).toBe("chair");
    expect(isReviewerOf(both, theirs)).toBe(true);
    for (const phase of CONFERENCE_PHASES) {
      const ctx = proposal(7, { reviewers: [86, 80], phase });
      expect(canWriteReview(both, ctx), phase).toBe(phase === "reviewing");
      expect(isReviewerOf(both, ctx), phase).toBe(
        CONFERENCE_PHASES.indexOf(phase) >= CONFERENCE_PHASES.indexOf("reviewing"),
      );
    }
    // Their own review is theirs, and nothing of the other reviewer's comes with it.
    const own = projectOwnReview(both, theirs, review(7, 86, "draft"));
    expect(own).toMatchObject({ status: "draft", comments: "MARK-COMMENTS-86", canDecline: true });
    expect(projectOwnReview(both, theirs, review(7, 80, "sent"))).toMatchObject({
      status: "not_started",
      comments: "",
    });

    // Never where a chair is not a reviewer: not assigned, another committee's reviewer, a
    // proposal nobody reviews, their own proposal, one they have a conflict with. The last two
    // are not given to them as a chair either, so an assignment there changes nothing.
    const not: [string, PersonViewer, SubmissionContext][] = [
      ["not assigned", both, proposal(7, { reviewers: [80] })],
      [
        "a reviewer of another committee",
        chairWhoReviews(86, [POOL_B]),
        proposal(7, { reviewers: [86] }),
      ],
      ["a draft", both, proposal(7, { reviewers: [86], status: "draft" })],
      ["withdrawn", both, proposal(7, { reviewers: [86], status: "withdrawn" })],
      ["their own proposal", both, proposal(7, { reviewers: [86], authors: [700, 86] })],
      ["invited to it", both, proposal(7, { reviewers: [86], invited: [86] })],
      ["a conflict", both, proposal(7, { reviewers: [86], conflicted: [86] })],
    ];
    for (const [why, v, ctx] of not) {
      expect(isReviewerOf(v, ctx), why).toBe(false);
      expect(canWriteReview(v, ctx), why).toBe(false);
      expect(projectOwnReview(v, ctx, review(7, 86, "draft")), why).toBeNull();
    }
    // A track chair is given the proposals of their track as a chair too, and reviews one that
    // is assigned to them in the same way.
    const trackChair = viewer(uuid(87), [
      { conferenceId: CONFERENCE, role: "track_chair", scope: [] },
      { conferenceId: CONFERENCE, role: "reviewer", scope: [POOL_A] },
    ]);
    const tracked = proposal(7, { reviewers: [87] });
    expect(submissionAccess(trackChair, tracked)).toBe("chair");
    expect(canWriteReview(trackChair, tracked)).toBe(true);
    expect(canWriteReview(trackChair, proposal(7, { reviewers: [80] }))).toBe(false);
    // And never their agent, whatever its tier.
    for (const tier of ["M", "C"] as const) {
      expect(isReviewerOf(agentOf(both, tier), theirs), tier).toBe(false);
      expect(
        projectOwnReview(agentOf(both, tier), theirs, review(7, 86, "draft")),
        tier,
      ).toBeNull();
    }
  });

  it("only for a proposal reviewers still read: never a draft or a withdrawn one", () => {
    for (const status of ["draft", "withdrawn"] as const) {
      expect(canWriteReview(reviewerOf(80), target({ status })), status).toBe(false);
    }
    for (const status of [
      "submitted",
      "accepted",
      "waitlisted",
      "rejected",
      "confirmed",
    ] as const) {
      expect(canWriteReview(reviewerOf(80), target({ status })), status).toBe(true);
    }
  });
});

describe("a reviewer's own review", () => {
  it("is theirs in full: what they scored and wrote, and where it stands", () => {
    const ctx = target();
    const [sent, draft] = REVIEWS as [Review, Review, Review];
    expect(projectOwnReview(reviewerOf(80), ctx, sent)).toEqual({
      view: "own_review",
      submissionId: uuid(5001),
      status: "sent",
      version: 2,
      scores: sent.scores,
      comments: "MARK-COMMENTS-80",
      chairNote: "MARK-CHAIRNOTE-80",
      recommendation: "accept",
      sentAt: day(61),
      updatedAt: day(62),
      open: true,
      // Once sent it stays theirs: they change it, or write to the chairs.
      canDecline: false,
    });
    expect(projectOwnReview(reviewerOf(81), ctx, draft)).toMatchObject({
      status: "draft",
      comments: "MARK-COMMENTS-81",
      sentAt: null,
      open: true,
      canDecline: true,
    });
    expect(projectOwnReview(reviewerOf(81), ctx, null)).toEqual({
      view: "own_review",
      submissionId: uuid(5001),
      status: "not_started",
      version: 0,
      scores: {},
      comments: "",
      chairNote: "",
      recommendation: null,
      sentAt: null,
      updatedAt: null,
      open: true,
      canDecline: true,
    });
  });

  it("is read only once the conference has left `reviewing`, sent or not", () => {
    for (const phase of ["deciding", "confirming", "scheduling", "published", "archived"]) {
      const ctx = target({ phase });
      const [sent, draft] = REVIEWS as [Review, Review, Review];
      expect(projectOwnReview(reviewerOf(80), ctx, sent), phase).toMatchObject({
        status: "sent",
        open: false,
        canDecline: false,
      });
      // A draft never sent stays a draft, and is shown as not sent.
      expect(projectOwnReview(reviewerOf(81), ctx, draft), phase).toMatchObject({
        status: "draft",
        sentAt: null,
        open: false,
        canDecline: false,
      });
    }
  });

  it("holds scores for the committee's own criteria, and nothing under any other key", () => {
    const odd = review(1, 80, "draft", { scores: { [CRITERIA_A[0] ?? ""]: 3, "MARK-KEY": 5 } });
    expect(projectOwnReview(reviewerOf(80), target(), odd)?.scores).toEqual({
      [CRITERIA_A[0] ?? ""]: 3,
    });
  });

  it("never shows someone else's review, whichever row is handed in", () => {
    const ctx = target();
    const [byEighty] = REVIEWS as [Review, Review, Review];
    // The other reviewer of the same proposal, handed the first one's row by mistake: nothing
    // of it. Nor a review of another proposal under this one.
    for (const wrong of [byEighty, review(2, 81, "sent")]) {
      const shown = projectOwnReview(reviewerOf(81), ctx, wrong);
      expect(shown).toMatchObject({ status: "not_started", version: 0, comments: "" });
      expect(findLeaks(shown, [...written(80), ...written(81), ...marks(80)])).toEqual([]);
    }
  });

  it("says nothing about who else reviews the proposal, what they wrote, or who wrote it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFERENCE_PHASES),
        fc.constantFrom<SubmissionStatus>("submitted", "accepted", "rejected"),
        fc.constantFrom(80, 81),
        (phase, status, me) => {
          const ctx = target({ phase, status });
          const mine = REVIEWS.find((r) => r.reviewerId === uuid(me));
          const shown = projectOwnReview(reviewerOf(me), ctx, mine);
          if (CONFERENCE_PHASES.indexOf(phase) < CONFERENCE_PHASES.indexOf("reviewing")) {
            // Before the conference is in review an assignment gives nothing yet.
            expect(shown).toBeNull();
            return;
          }
          const other = me === 80 ? 81 : 80;
          expect(
            findLeaks(shown, [
              ...marks(other),
              ...written(other),
              ...written(82),
              ...[82, 84, 85, 10, 61].flatMap(marks),
              // Anonymized: nothing of the authors either.
              ...[700, 701, 702, 703].flatMap(marks),
            ]),
          ).toEqual([]);
          // And nothing that could be a decision.
          expect(JSON.stringify(shown)).not.toContain(status === "submitted" ? "decision" : status);
        },
      ),
      RUNS,
    );
  });

  it("is nothing at all to anyone who is not given the proposal as its reviewer", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFERENCE_PHASES),
        fc.constantFrom<SubmissionStatus>("draft", "submitted", "accepted", "withdrawn"),
        fc.constantFrom(...REVIEWS, null),
        (phase, status, handed) => {
          const ctx = target({ phase, status });
          for (const [who, v] of [...everyoneElse, ["the chair who manages it", chair] as const]) {
            expect(projectOwnReview(v, ctx, handed), who).toBeNull();
          }
        },
      ),
      RUNS,
    );
  });
});

describe("a chair's view of a proposal's reviews", () => {
  const rec = record([target(), proposal(2, { reviewers: [80] })], REVIEWS, {
    declines: [DECLINE],
  });
  const id = uuid(5001);

  it("shows each sent review in full, with who wrote it and when", () => {
    const view = projectProposalReviewers(chair, rec, id, NOW);
    const [sent] = REVIEWS as [Review, Review, Review];
    expect(view?.assigned.find((a) => a.personId === uuid(80))).toEqual({
      personId: uuid(80),
      displayName: "MARK-NAME-80",
      email: "mark-email-80@example.org",
      assignedAt: day(50),
      blocked: false,
      review: {
        scores: sent.scores,
        comments: "MARK-COMMENTS-80",
        chairNote: "MARK-CHAIRNOTE-80",
        recommendation: "accept",
        sentAt: day(61),
        changedAt: day(62),
      },
    });
    // A review that was not changed since it was sent says so by saying nothing.
    const unchanged = review(1, 80, "sent", { updatedAt: day(61) });
    expect(chairReview(target(), unchanged)).toMatchObject({ sentAt: day(61), changedAt: null });
  });

  it("never shows a draft, or any sign that one exists", () => {
    const view = projectProposalReviewers(chair, rec, id, NOW);
    expect(view?.assigned.find((a) => a.personId === uuid(81))?.review).toBeNull();
    expect(findLeaks(view, [...written(81), "MARK-COMMENTS-82", "MARK-CHAIRNOTE-82"])).toEqual([]);
    // The same view, to the letter, as when nobody had begun a draft.
    const noDrafts = { ...rec, reviews: rec.reviews.filter((r) => r.status === "sent") };
    expect(view).toEqual(projectProposalReviewers(chair, noDrafts, id, NOW));
    expect(projectAssignments(chair, rec, NOW)).toEqual(projectAssignments(chair, noDrafts, NOW));
    // A draft is never a chair's to read, whoever hands it over.
    expect(chairReview(target(), REVIEWS[1] as Review)).toBeNull();
    // Nor a sent review under a proposal that is not its own.
    expect(chairReview(proposal(2), REVIEWS[0] as Review)).toBeNull();
  });

  it("lists who said they could not review it, with the reason and their note", () => {
    const view = projectProposalReviewers(chair, rec, id, NOW);
    expect(view?.declined).toEqual([
      {
        personId: uuid(82),
        displayName: "MARK-NAME-82",
        email: "mark-email-82@example.org",
        reason: "time",
        note: "MARK-DECLINE-NOTE-82",
        at: day(55),
      },
    ]);
    // Another proposal's page says nothing of it.
    const other = projectProposalReviewers(chair, rec, uuid(5002), NOW);
    expect(other?.declined).toEqual([]);
    expect(findLeaks(other, ALL_WRITTEN)).toEqual([]);
  });

  it("keeps a sent review whose reviewer is no longer assigned: it is still the proposal's", () => {
    const orphaned = record([proposal(3, { reviewers: [81] })], [review(3, 80, "sent")]);
    const view = projectProposalReviewers(chair, orphaned, uuid(5003), NOW);
    expect(view?.assigned.map((a) => [a.personId, a.review])).toEqual([[uuid(81), null]]);
    expect(view?.otherReviews).toMatchObject([
      { personId: uuid(80), displayName: "MARK-NAME-80", review: { comments: "MARK-COMMENTS-80" } },
    ]);
  });

  it("is nothing at all to anyone else: no review, no reviewer, no note", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFERENCE_PHASES),
        fc.constantFrom<SubmissionStatus>("submitted", "accepted", "rejected", "withdrawn"),
        (phase, status) => {
          const here = record(
            [target({ phase, status }), proposal(2, { phase, reviewers: [80] })],
            REVIEWS,
            { declines: [DECLINE], phase },
          );
          const ctx = here.submissions[0] as SubmissionContext;
          for (const [who, v] of [
            ...everyoneElse,
            ["a reviewer of the same proposal", reviewerOf(80)] as const,
            ["the other reviewer of it", reviewerOf(81)] as const,
          ]) {
            expect(projectProposalReviewers(v, here, id, NOW), who).toBeNull();
            // Whatever they are given of the proposal itself holds no word of any review.
            const given = projectSubmission(v, { ...ctx, people: here.people });
            expect(findLeaks(given, ALL_WRITTEN), who).toEqual([]);
            // A cloud agent (tier M) gets no reviewer's name or address either.
            if (v.kind === "agent" && v.tier === "M") {
              expect(
                findLeaks(
                  given,
                  [80, 81, 82, 84, 85].flatMap((n) => marks(n).slice(1)),
                ),
                who,
              ).toEqual([]);
            }
            // A reviewer of the proposal learns of nobody else who reviews it.
            if (v.kind === "person" && [uuid(80), uuid(81)].includes(v.personId)) {
              const me = v.personId === uuid(80) ? 80 : 81;
              const rest = [80, 81, 82, 84, 85].filter((n) => n !== me).flatMap(marks);
              expect(findLeaks(given, rest), who).toEqual([]);
            }
          }
        },
      ),
      RUNS,
    );
  });

  it("keeps a proposal's reviews from its own people and from anyone with a conflict, whatever became of it", () => {
    const kept: [string, number][] = [
      ["its owner", 700],
      ["a confirmed co-author", 701],
      ["someone invited to it", 702],
      ["a chair with a conflict", 61],
      ["a reviewer with a conflict", 84],
    ];
    const not: [string, number][] = [
      ["a chair with nothing to do with it", 10],
      ["its reviewer", 80],
      ["a stranger", 999],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFERENCE_PHASES),
        fc.constantFrom<SubmissionStatus>("draft", "submitted", "accepted", "withdrawn"),
        (phase, status) => {
          const here = record([target({ phase, status })], REVIEWS, { phase });
          const ctx = here.submissions[0] as SubmissionContext;
          // Who they are decides it: not the phase, the proposal's status, or any review.
          for (const [who, n] of kept) expect(reviewsKeptFrom(chairOf(n), ctx), who).toBe(true);
          for (const [who, n] of not) expect(reviewsKeptFrom(chairOf(n), ctx), who).toBe(false);
          for (const [who, n] of [...kept, ...not]) {
            const v = chairOf(n);
            // A chair is shown a proposal's reviews exactly where they are not kept from them
            // and the proposal is one chairs are given (it was submitted and is not a draft).
            const given = status !== "draft";
            expect(canManageReviewers(v, ctx), who).toBe(!reviewsKeptFrom(v, ctx) && given);
            if (reviewsKeptFrom(v, ctx)) {
              expect(projectProposalReviewers(v, here, id, NOW), who).toBeNull();
            }
          }
        },
      ),
      RUNS,
    );
  });

  it("counts sent reviews for a chair who manages the proposal, and never a draft", () => {
    const page = projectAssignments(chair, rec, NOW);
    const listed = page?.pools.flatMap((p) => p.items) ?? [];
    expect(listed.map((x) => [x.id, x.sent])).toEqual([
      [uuid(5001), 1],
      [uuid(5002), 0],
    ]);
    expect(findLeaks(page, ALL_WRITTEN)).toEqual([]);
  });

  it("puts a proposal that has its reviewers and still waits for reviews before one that has both", () => {
    const needed = CONFIG.reviewPools[0]?.reviewsPerSubmission ?? 0;
    const reviewers = [80, 81, 82].slice(0, needed);
    const done = proposal(1, { reviewers });
    const waiting = proposal(2, { reviewers });
    const short = proposal(3, { reviewers: reviewers.slice(1) });
    const all = record(
      [done, waiting, short],
      [
        ...reviewers.map((n) => review(1, n, "sent")),
        // A draft, and one sent review of the three: still waiting.
        review(2, 80, "sent"),
        review(2, 81, "draft"),
      ],
    );
    const pool = projectAssignments(chair, all, NOW)?.pools[0];
    expect(pool?.items.map((x) => [x.id, x.short, x.sent])).toEqual([
      [uuid(5003), true, 0],
      [uuid(5002), false, 1],
      [uuid(5001), false, needed],
    ]);
    expect(pool).toMatchObject({ proposals: 3, short: 1, waiting: 1 });
  });

  it("changes nothing a chair is shown where the reviews are of their own proposal, or of one they have a conflict with", () => {
    fc.assert(
      fc.property(fc.subarray(REVIEWS, { minLength: 1 }), (reviews) => {
        // Two proposals by someone else, which both chairs manage.
        const others = [
          proposal(2, { authors: [705], reviewers: [80, 81] }),
          proposal(3, { authors: [705], reviewers: [82] }),
        ];
        const withThem = record([target(), ...others], reviews, { declines: [DECLINE] });
        const without = record([target(), ...others], []);
        for (const v of [chairOf(61), chairOf(700)]) {
          expect(projectAssignments(v, without, NOW)?.pools[0]?.proposals).toBe(2);
          expect(projectAssignments(v, withThem, NOW)).toEqual(projectAssignments(v, without, NOW));
          for (const s of others) {
            expect(projectProposalReviewers(v, withThem, s.submission.id, NOW)).toEqual(
              projectProposalReviewers(v, without, s.submission.id, NOW),
            );
          }
          const people = (rec: ReviewersRecord): PeopleRecord => ({
            conferenceId: CONFERENCE,
            poolKeys: [POOL_A, POOL_B],
            grants: rec.reviewers.map((r) => ({ ...r, role: "reviewer" as const })),
            reviewerProfiles: [],
            people: PEOPLE,
            invitations: [],
            submissions: rec.submissions,
            sentReviews: rec.reviews.filter((r) => r.status === "sent"),
          });
          expect(projectPeople(v, people(withThem), NOW)).toEqual(
            projectPeople(v, people(without), NOW),
          );
        }
      }),
      RUNS,
    );
  });

  it("counts a reviewer's sent reviews on the People page as the chair looking may know them", () => {
    const subs = [
      target(),
      proposal(2, { authors: [705], reviewers: [80] }),
      proposal(3, { authors: [705], reviewers: [80] }),
    ];
    const people: PeopleRecord = {
      conferenceId: CONFERENCE,
      poolKeys: [POOL_A, POOL_B],
      grants: [{ personId: uuid(80), role: "reviewer", scope: [POOL_A] }],
      reviewerProfiles: [],
      people: PEOPLE,
      invitations: [],
      submissions: subs,
      // Sent for the first two; the third has only an assignment.
      sentReviews: [
        { submissionId: uuid(5001), reviewerId: uuid(80) },
        { submissionId: uuid(5002), reviewerId: uuid(80) },
        // Someone else's, and one of a proposal they are not assigned to: neither is theirs.
        { submissionId: uuid(5003), reviewerId: uuid(81) },
      ],
    };
    const counts = (v: PersonViewer) =>
      projectPeople(v, people, NOW)?.reviewers.map((r) => [r.assigned, r.sent]);
    expect(counts(chair)).toEqual([[3, 2]]);
    // The author of the first proposal, who chairs too: it is left out of both numbers.
    expect(counts(chairOf(700))).toEqual([[2, 1]]);
    expect(counts(chairOf(61))).toEqual([[2, 1]]);
  });
});

describe("a reviewer's own list", () => {
  const conference = { id: CONFERENCE, slug: "made-up", phase: "reviewing", config: CONFIG };
  const withPeople = (ctx: SubmissionContext): SubmissionRecord => ({ ...ctx, people: PEOPLE });
  const records = [
    proposal(1, { reviewers: [80, 81] }),
    proposal(2, { reviewers: [80] }),
    proposal(3, { reviewers: [80, 82] }),
    // Not theirs: assigned to someone else, and one they were released from.
    proposal(4, { reviewers: [81] }),
    proposal(5, { reviewers: [] }),
  ].map(withPeople);
  const reviews = [
    review(1, 80, "sent"),
    review(2, 80, "draft"),
    // Other people's, handed in all the same: they change nothing.
    review(1, 81, "draft"),
    review(3, 82, "sent"),
    review(4, 81, "sent"),
  ];

  it("lists their own assignments with where each review stands: drafts, then not started, then sent", () => {
    const view = projectMyReviews(reviewerOf(80), conference, records, reviews);
    expect(view?.proposals).toEqual([
      {
        submissionId: uuid(5002),
        title: "MARK-TITLE-2",
        typeKey: TYPE_A,
        language: "en",
        status: "draft",
      },
      {
        submissionId: uuid(5003),
        title: "MARK-TITLE-3",
        typeKey: TYPE_A,
        language: "en",
        status: "not_started",
      },
      {
        submissionId: uuid(5001),
        title: "MARK-TITLE-1",
        typeKey: TYPE_A,
        language: "en",
        status: "sent",
      },
    ]);
    expect(view?.counts).toEqual({ sent: 1, draft: 1, notStarted: 1 });
    expect(view).toMatchObject({
      view: "my_reviews",
      open: true,
      reviewsDue: null,
      conference: { slug: "made-up", timezone: CONFIG.timezone },
    });
    expect(Object.keys(view?.formats ?? {})).toEqual([TYPE_A]);
  });

  it("holds nothing of anyone else: no other reviewer, no other proposal, no author, no review text", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONFERENCE_PHASES),
        fc.constantFrom(80, 81, 82),
        (phase, me) => {
          const here = records.map((r) => ({ ...r, phase }));
          const view = projectMyReviews(reviewerOf(me), { ...conference, phase }, here, reviews);
          if (CONFERENCE_PHASES.indexOf(phase) < CONFERENCE_PHASES.indexOf("reviewing")) {
            // Before the conference is in review there is no list at all.
            expect(view).toBeNull();
            return;
          }
          const mine = records.filter((r) => r.assignments.some((a) => a.reviewerId === uuid(me)));
          expect(view?.proposals.map((p) => p.submissionId).sort()).toEqual(
            mine.map((r) => r.submission.id).sort(),
          );
          expect(view?.open).toBe(phase === "reviewing");
          const notMine = records.filter((r) => !mine.includes(r));
          expect(
            findLeaks(view, [
              ...[80, 81, 82, 84, 85, 10, 700].flatMap(marks),
              ...[80, 81, 82].flatMap(written),
              ...notMine.flatMap((r) => [r.submission.id, r.submission.title]),
              ...records.map((r) => r.submission.abstract),
            ]),
          ).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("lists a chair's own assignments when the chair also reviews: the same five things, and no more", () => {
    const both = chairWhoReviews(86);
    const theirs = [
      proposal(11, { reviewers: [86, 80] }),
      proposal(12, { reviewers: [86] }),
      // Not theirs to review: someone else's, their own, and one they have a conflict with.
      proposal(13, { reviewers: [80] }),
      proposal(14, { reviewers: [86], authors: [86] }),
      proposal(15, { reviewers: [86], conflicted: [86] }),
    ].map(withPeople);
    const view = projectMyReviews(both, conference, theirs, [
      review(11, 86, "sent"),
      review(11, 80, "sent"),
      review(13, 80, "draft"),
    ]);
    expect(view?.proposals).toEqual([
      {
        submissionId: uuid(5012),
        title: "MARK-TITLE-12",
        typeKey: TYPE_A,
        language: "en",
        status: "not_started",
      },
      {
        submissionId: uuid(5011),
        title: "MARK-TITLE-11",
        typeKey: TYPE_A,
        language: "en",
        status: "sent",
      },
    ]);
    expect(view?.counts).toEqual({ sent: 1, draft: 0, notStarted: 1 });
    // A chair is given the authors of a proposal; the list is not where they are shown.
    expect(
      findLeaks(view, [
        ...[80, 86, 700].flatMap(marks),
        ...[80, 86].flatMap(written),
        ...theirs.map((r) => r.submission.abstract),
        ...[13, 14, 15].flatMap((n) => [uuid(5000 + n), `MARK-TITLE-${n}`]),
      ]),
    ).toEqual([]);
  });

  it("names the committees they review for, each with the chairs' guidelines where there are any", () => {
    const guided: ConferenceConfig = {
      ...CONFIG,
      deadlines: { ...CONFIG.deadlines, reviewsDue: "2026-03-10T23:59:00-05:00" },
      reviewPools: CONFIG.reviewPools.map((p) =>
        p.key === POOL_B ? { ...p, guidelines: { en: "MARK-GUIDELINES-B" } } : p,
      ),
    };
    const at = { ...conference, config: guided };
    const one = projectMyReviews(reviewerOf(80, [POOL_B]), at, [], []);
    expect(one?.committees).toEqual([
      { key: POOL_B, name: CONFIG.reviewPools[1]?.name, guidelines: { en: "MARK-GUIDELINES-B" } },
    ]);
    expect(one?.reviewsDue).toBe("2026-03-10T23:59:00-05:00");
    // A role without a scope is every committee; one without guidelines says so with nothing.
    const all = projectMyReviews(reviewerOf(80, []), at, [], []);
    expect(all?.committees.map((c) => [c.key, c.guidelines])).toEqual([
      [POOL_A, null],
      [POOL_B, { en: "MARK-GUIDELINES-B" }],
    ]);
    expect(all?.proposals).toEqual([]);
  });

  it("is nobody's but a reviewer's, in person", () => {
    for (const [who, v] of [
      ["a chair", chair],
      ["an author", viewer(uuid(700))],
      ["a stranger", viewer(uuid(999))],
      [
        "a reviewer of another conference",
        viewer(uuid(80), [{ conferenceId: uuid(2), role: "reviewer", scope: [] }]),
      ],
      ["the public", PUBLIC],
      ["a cloud agent (tier M)", agentOf(chair, "M")],
      ["a local agent (tier C)", agentOf(chair, "C")],
      ["an agent of someone who reviews", agentOf(reviewerOf(80), "C")],
    ] as [string, Viewer][]) {
      expect(projectMyReviews(v, conference, records, reviews), who).toBeNull();
    }
  });

  it("drops a proposal the moment the policy no longer gives it to them", () => {
    const listed = (rs: SubmissionRecord[]) =>
      projectMyReviews(reviewerOf(80), conference, rs, reviews)?.proposals.map(
        (p) => p.submissionId,
      );
    const first = records[0] as SubmissionRecord;
    // Released: no assignment is left. Withdrawn: nobody reviews it. A conflict recorded since.
    const cases: [string, SubmissionRecord][] = [
      [
        "released",
        { ...first, assignments: first.assignments.filter((a) => a.reviewerId !== uuid(80)) },
      ],
      ["withdrawn", { ...first, submission: { ...first.submission, status: "withdrawn" } }],
      [
        "a conflict",
        {
          ...first,
          conflicts: [
            {
              id: uuid(8999),
              conferenceId: CONFERENCE,
              personId: uuid(80),
              submissionId: first.submission.id,
              otherPersonId: null,
              kind: "declared",
              declaredBy: "reviewer",
            },
          ],
        },
      ],
    ];
    for (const [why, changed] of cases) {
      expect(listed([changed, ...records.slice(1)]), why).not.toContain(first.submission.id);
      // And it is no longer theirs to read or to review, anywhere.
      expect(submissionAccess(reviewerOf(80), changed), why).toBe("none");
      expect(projectOwnReview(reviewerOf(80), changed, reviews[0]), why).toBeNull();
    }
    expect(listed(records)).toContain(first.submission.id);
  });
});
