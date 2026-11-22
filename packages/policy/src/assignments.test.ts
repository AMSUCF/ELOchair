/**
 * Assigning reviewers (spec 03, §1.3): who may manage a proposal's reviewers, which proposals
 * take them, who is offered, and what the two views of it (the Reviewers section of a proposal's
 * page, the Assignments page) may hold. People carry markers; each view is rendered for each
 * kind of viewer and searched for what it must not hold.
 */
import {
  type Assignment,
  type AssignmentReleaseReason,
  CONFERENCE_PHASES,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  type Person,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SubmissionContext, submissionAccess } from "./access";
import {
  assignmentsAfter,
  assignmentsPosition,
  canManageReviewers,
  projectAssignments,
  projectProposalReviewers,
  type ReviewersRecord,
  reviewerCandidate,
  reviewerOffer,
  takesReviewers,
  underConsideration,
} from "./assignments";
import { projectSubmission } from "./projections";
import { findLeaks } from "./testing";
import { type AgentViewer, type PersonViewer, PUBLIC, type Viewer } from "./viewer";

const CONFIG: ConferenceConfig = ConfigSchema.parse(conferences.elo2026);
/** ELO 2026 has two pools: talks go to the first, exhibition works to the second. */
const [POOL_A, POOL_B] = CONFIG.reviewPools.map((p) => p.key) as [string, string];
const TYPE_A = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_A)?.key ?? "";
const TYPE_B = CONFIG.submissionTypes.find((t) => t.reviewPool === POOL_B)?.key ?? "";
const NEEDED_A = CONFIG.reviewPools[0]?.reviewsPerSubmission ?? 0;
/** After the call's closing date, and before it. */
const CLOSED = new Date(Date.parse(CONFIG.deadlines.submissionsClose) + 1000);
const OPEN = new Date(Date.parse(CONFIG.deadlines.submissionsClose) - 1000);
const RUNS = { numRuns: 200 };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONFERENCE = uuid(1);
const ELSEWHERE = uuid(2);
const CHAIR = uuid(10);
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

const viewer = (
  personId: string,
  grants: PersonViewer["grants"] = [],
  siteAdmin = false,
): PersonViewer => ({ kind: "person", personId, siteAdmin, grants });
const chairOf = (conferenceId: string, personId = CHAIR) =>
  viewer(personId, [{ conferenceId, role: "chair", scope: [] }]);
const agentOf = (owner: PersonViewer, tier: "M" | "C", conferenceId = CONFERENCE): AgentViewer => ({
  kind: "agent",
  tokenId: uuid(99),
  tier,
  conferenceId,
  owner,
});

type Made = {
  type?: string;
  status?: SubmissionStatus;
  authors?: number[];
  /** People on the proposal who are not confirmed: invited, or declined. */
  invited?: number[];
  declined?: number[];
  reviewers?: number[];
  /** People with a conflict that names the proposal. */
  conflicted?: number[];
  /** People with a conflict that names its first author. */
  conflictedWithAuthor?: number[];
  title?: string;
  created?: number;
};

/** A proposal: submitted, by person 700, unless told otherwise. */
function proposal(n: number, v: Made = {}): SubmissionContext {
  const id = uuid(5000 + n);
  const authors = v.authors ?? [700];
  const status = v.status ?? "submitted";
  const submission: Submission = {
    id,
    conferenceId: CONFERENCE,
    ownerPersonId: uuid(authors[0] ?? 700),
    version: 1,
    typeKey: v.type ?? TYPE_A,
    trackKey: null,
    topicKeys: [],
    language: "en",
    title: v.title ?? `MARK-TITLE-${n}`,
    abstract: `MARK-ABSTRACT-${n}`,
    fields: {},
    participationMode: null,
    status,
    createdAt: day(v.created ?? n),
    updatedAt: day(v.created ?? n),
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
  const contributions = [
    ...on(authors, "confirmed", 0),
    ...on(v.invited ?? [], "invited", authors.length),
    ...on(v.declined ?? [], "declined", authors.length + (v.invited?.length ?? 0)),
  ];
  const assignments: Assignment[] = (v.reviewers ?? []).map((r, i) => ({
    id: uuid(9000 + n * 10 + i),
    conferenceId: CONFERENCE,
    reviewerId: uuid(r),
    submissionId: id,
    createdAt: day(50 + i),
    dueAt: null,
    assignedByPersonId: CHAIR,
  }));
  const conflicts: Conflict[] = [
    ...(v.conflicted ?? []).map((p, i) => ({
      id: uuid(8000 + n * 10 + i),
      conferenceId: CONFERENCE,
      personId: uuid(p),
      submissionId: id,
      otherPersonId: null,
      kind: "declared" as const,
      declaredBy: "chair" as const,
    })),
    ...(v.conflictedWithAuthor ?? []).map((p, i) => ({
      id: uuid(8500 + n * 10 + i),
      conferenceId: CONFERENCE,
      personId: uuid(p),
      submissionId: null,
      otherPersonId: uuid(authors[0] ?? 700),
      kind: "institution" as const,
      declaredBy: "system" as const,
    })),
  ];
  return { config: CONFIG, phase: "reviewing", submission, contributions, assignments, conflicts };
}

type Reviewer = { n: number; pools?: string[]; maxLoad?: number | null; languages?: string[] };

/** A conference's record: these reviewers (in pool A, taking up to 8, unless told otherwise). */
function record(
  reviewers: Reviewer[],
  submissions: SubmissionContext[],
  more: Partial<ReviewersRecord> = {},
): ReviewersRecord {
  const assigned = submissions.flatMap((s) => s.assignments.map((a) => a.reviewerId));
  const ids = [...new Set([...reviewers.map((r) => uuid(r.n)), ...assigned])];
  return {
    conferenceId: CONFERENCE,
    config: CONFIG,
    phase: "reviewing",
    reviewers: reviewers.map((r) => ({ personId: uuid(r.n), scope: r.pools ?? [POOL_A] })),
    reviewerProfiles: reviewers
      .filter((r) => r.maxLoad !== null)
      .map((r) => ({
        personId: uuid(r.n),
        languages: r.languages ?? ["en"],
        maxLoad: r.maxLoad ?? 8,
      })),
    people: new Map(ids.map((id) => [id, person(Number(id.slice(-12)))])),
    submissions,
    conflictReleased: new Map(),
    ...more,
  };
}

/** The record once one reviewer's assignment to one proposal has been released: it is gone. */
function release(
  rec: ReviewersRecord,
  submissionId: string,
  reviewer: number,
  reason: AssignmentReleaseReason,
): ReviewersRecord {
  return {
    ...rec,
    submissions: rec.submissions.map((s) =>
      s.submission.id === submissionId
        ? { ...s, assignments: s.assignments.filter((a) => a.reviewerId !== uuid(reviewer)) }
        : s,
    ),
    conflictReleased:
      reason === "conflict"
        ? new Map([
            ...rec.conflictReleased,
            [submissionId, [...(rec.conflictReleased.get(submissionId) ?? []), uuid(reviewer)]],
          ])
        : rec.conflictReleased,
  };
}

describe("who may manage a proposal's reviewers", () => {
  const p = proposal(1, { authors: [700], reviewers: [80], conflicted: [61] });
  const rec = record([{ n: 80 }, { n: 81 }], [p]);
  const chair = chairOf(CONFERENCE);
  const id = p.submission.id;

  it("is a chair of the conference in person who manages the proposal: a chair, an admin or a site admin", () => {
    const admin = viewer(uuid(11), [{ conferenceId: CONFERENCE, role: "admin", scope: [] }]);
    const siteAdmin = viewer(uuid(12), [], true);
    for (const v of [chair, admin, siteAdmin]) {
      expect(canManageReviewers(v, p)).toBe(true);
      expect(projectProposalReviewers(v, rec, id, CLOSED)?.assigned.map((a) => a.personId)).toEqual(
        [uuid(80)],
      );
      expect(projectAssignments(v, rec, CLOSED)?.pools[0]?.items.map((x) => x.id)).toEqual([id]);
    }
  });

  it("is nobody else: not a track chair, a reviewer, one of its people, a stranger, the public, or any agent", () => {
    const others: [string, Viewer][] = [
      ["the public", PUBLIC],
      ["someone with no role", viewer(uuid(20))],
      // A track chair is given the proposal as a chair, and still does not manage its reviewers.
      [
        "a track chair",
        viewer(uuid(22), [{ conferenceId: CONFERENCE, role: "track_chair", scope: [] }]),
      ],
      [
        "its assigned reviewer",
        viewer(uuid(80), [{ conferenceId: CONFERENCE, role: "reviewer", scope: [POOL_A] }]),
      ],
      [
        "another reviewer",
        viewer(uuid(81), [{ conferenceId: CONFERENCE, role: "reviewer", scope: [] }]),
      ],
      ["its author", viewer(uuid(700))],
      ["a chair of another conference", chairOf(ELSEWHERE, uuid(23))],
      ["a chair's tier M agent", agentOf(chair, "M")],
      ["a chair's tier C agent", agentOf(chair, "C")],
      ["a site admin's agent", agentOf(viewer(uuid(24), [], true), "C")],
      ["an agent for another conference", agentOf(chair, "C", ELSEWHERE)],
    ];
    const everyone = [80, 81, 700].flatMap(marks);
    for (const [who, v] of others) {
      expect(canManageReviewers(v, p), who).toBe(false);
      const one = projectProposalReviewers(v, rec, id, CLOSED);
      const all = projectAssignments(v, rec, CLOSED);
      expect(one, who).toBeNull();
      expect(all, who).toBeNull();
      expect(findLeaks([one, all], everyone), who).toEqual([]);
    }
    // A track chair does get the chair view of the proposal itself: that is unchanged.
    const trackChair = others[2]?.[1] as PersonViewer;
    expect(submissionAccess(trackChair, p)).toBe("chair");
  });

  it("is not a chair for their own proposal, or for one they have a conflict with", () => {
    const author = chairOf(CONFERENCE, uuid(700));
    const conflicted = chairOf(CONFERENCE, uuid(61));
    // Invited, or having declined, is being one of its people or having a conflict with it.
    const invited = proposal(2, { authors: [701], invited: [62], reviewers: [80] });
    const withAuthor = proposal(3, {
      authors: [702],
      conflictedWithAuthor: [63],
      reviewers: [80],
    });
    const full = record([{ n: 80 }, { n: 81 }], [p, invited, withAuthor]);
    const cases: [string, PersonViewer, SubmissionContext][] = [
      ["its author", author, p],
      ["conflicted with it", conflicted, p],
      ["invited to it", chairOf(CONFERENCE, uuid(62)), invited],
      ["conflicted with its author", chairOf(CONFERENCE, uuid(63)), withAuthor],
    ];
    for (const [who, v, ctx] of cases) {
      expect(canManageReviewers(v, ctx), who).toBe(false);
      expect(projectProposalReviewers(v, full, ctx.submission.id, CLOSED), who).toBeNull();
      // They chair the conference, so the Assignments page is theirs: without that proposal.
      const page = projectAssignments(v, full, CLOSED);
      const listed = page?.pools.flatMap((x) => x.items.map((i) => i.id));
      expect(listed, who).not.toContain(ctx.submission.id);
      expect(page?.excluded, who).toBe(1);
      expect(findLeaks(page, [ctx.submission.id, ctx.submission.title]), who).toEqual([]);
    }
  });

  it("has no view of a proposal that is not this conference's, was never submitted, or does not exist", () => {
    const draft = proposal(4, { status: "draft" });
    const foreign = proposal(5);
    foreign.submission.conferenceId = ELSEWHERE;
    const full = record([{ n: 80 }], [p, draft, foreign]);
    for (const missing of [draft.submission.id, foreign.submission.id, uuid(4242)]) {
      expect(projectProposalReviewers(chair, full, missing, CLOSED)).toBeNull();
    }
    const page = projectAssignments(chair, full, CLOSED);
    expect(page?.pools.flatMap((x) => x.items.map((i) => i.id))).toEqual([id]);
    // A draft and another conference's proposal are nobody's to count as left out.
    expect(page?.excluded).toBe(0);
  });
});

describe("which proposals take reviewers, and when", () => {
  it("only one that was submitted and has no decision: never a draft or a withdrawn one", () => {
    const takes = (status: SubmissionStatus) =>
      underConsideration(proposal(1, { status }).submission);
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
      ).filter(takes),
    ).toEqual(["submitted"]);
    // Marked submitted without ever having been: not under consideration either.
    expect(underConsideration({ status: "submitted", submittedAt: null })).toBe(false);
  });

  it("only once the call has closed: its closing date has passed, or the conference is in a later phase", () => {
    const p = proposal(1);
    const at = (phase: string, now: Date) => takesReviewers({ ...p, phase }, now);
    // Before the closing date, a conference that still takes proposals takes no reviewers.
    expect(at("cfp_open", OPEN)).toBe("call_not_closed");
    expect(at("draft", OPEN)).toBe("call_not_closed");
    // After it, a chair assigns although the conference is not in review yet.
    expect(at("cfp_open", CLOSED)).toBe("yes");
    // In a later phase the call is closed whatever the dates say.
    for (const phase of CONFERENCE_PHASES.slice(2)) expect(at(phase, OPEN), phase).toBe("yes");
    // What the proposal is comes first.
    expect(takesReviewers(proposal(2, { status: "withdrawn" }), CLOSED)).toBe(
      "not_under_consideration",
    );
  });

  it("offers nobody while a proposal takes no reviewers, and still shows who reviews it", () => {
    const chair = chairOf(CONFERENCE);
    const withdrawn = proposal(1, { status: "withdrawn", reviewers: [80] });
    const rec = record([{ n: 80 }, { n: 81 }], [withdrawn]);
    const view = projectProposalReviewers(chair, rec, withdrawn.submission.id, CLOSED);
    expect(view).toMatchObject({ takes: "not_under_consideration", candidates: [] });
    expect(view?.assigned.map((a) => a.personId)).toEqual([uuid(80)]);
    const early = proposal(2, { reviewers: [] });
    const open = projectProposalReviewers(
      chair,
      record([{ n: 80 }], [{ ...early, phase: "cfp_open" }], { phase: "cfp_open" }),
      early.submission.id,
      OPEN,
    );
    expect(open).toMatchObject({ takes: "call_not_closed", candidates: [], assigned: [] });
  });
});

describe("who is offered as a reviewer of a proposal", () => {
  const chair = chairOf(CONFERENCE);

  it("the reviewers of the pool that reviews its format: a role without a scope is every pool", () => {
    const talk = proposal(1, { type: TYPE_A });
    const work = proposal(2, { type: TYPE_B });
    const rec = record(
      [
        { n: 80, pools: [POOL_A] },
        { n: 81, pools: [POOL_B] },
        { n: 82, pools: [POOL_A, POOL_B] },
        { n: 83, pools: [], maxLoad: null },
      ],
      [talk, work],
    );
    const offered = (ctx: SubmissionContext) =>
      projectProposalReviewers(chair, rec, ctx.submission.id, CLOSED)?.candidates.map(
        (c) => c.personId,
      );
    expect(offered(talk)).toEqual([uuid(80), uuid(82), uuid(83)]);
    expect(offered(work)).toEqual([uuid(81), uuid(82), uuid(83)]);
    expect(reviewerOffer(rec, talk, uuid(81))).toBe("not_offered");
    // A chair who is no reviewer, and someone with no role, are not offered.
    expect(reviewerOffer(rec, talk, CHAIR)).toBe("not_offered");
    expect(reviewerOffer(rec, talk, uuid(999))).toBe("not_offered");
    // A pool the conference no longer has reviews nothing: nobody is offered for its formats.
    const gone = {
      ...talk,
      config: { ...CONFIG, reviewPools: CONFIG.reviewPools.filter((x) => x.key !== POOL_A) },
    };
    expect(reviewerOffer(rec, gone, uuid(80))).toBe("not_offered");
    expect(reviewerOffer(rec, gone, uuid(83))).toBe("not_offered");
  });

  it("each with their name, their languages and their load beside the most they said they would take", () => {
    const p = proposal(1);
    const rec = record(
      [
        { n: 80, maxLoad: 5, languages: ["es", "pt"] },
        { n: 81, maxLoad: null },
      ],
      [p, proposal(2, { reviewers: [80] }), proposal(3, { reviewers: [80, 81] })],
    );
    expect(projectProposalReviewers(chair, rec, p.submission.id, CLOSED)?.candidates).toEqual([
      {
        personId: uuid(80),
        displayName: "MARK-NAME-80",
        email: "mark-email-80@example.org",
        languages: ["es", "pt"],
        assigned: 2,
        maxLoad: 5,
        full: false,
      },
      // Given the role on the server: they said nothing, so nothing is said for them.
      {
        personId: uuid(81),
        displayName: "MARK-NAME-81",
        email: "mark-email-81@example.org",
        languages: [],
        assigned: 1,
        maxLoad: null,
        full: false,
      },
    ]);
    // Nothing else of a profile.
    expect(
      findLeaks(
        projectProposalReviewers(chair, rec, p.submission.id, CLOSED),
        [80, 81].flatMap((n) => [`MARK-AFFILIATION-${n}`, `MARK-BIO-${n}`, `MARK-PRONOUNS-${n}`]),
      ),
    ).toEqual([]);
  });

  it("never the proposal's own people, whatever their status", () => {
    const p = proposal(1, { authors: [80, 81], invited: [82], declined: [83] });
    const rec = record([{ n: 80 }, { n: 81 }, { n: 82 }, { n: 83 }, { n: 84 }], [p]);
    for (const n of [80, 81, 82, 83]) {
      expect(reviewerOffer(rec, p, uuid(n)), String(n)).toBe("not_offered");
      expect(reviewerCandidate(chair, rec, p, uuid(n)), String(n)).toBeNull();
    }
    expect(
      projectProposalReviewers(chair, rec, p.submission.id, CLOSED)?.candidates.map(
        (c) => c.personId,
      ),
    ).toEqual([uuid(84)]);
  });

  it("never anyone with a conflict with the proposal or with one of its people, as for reading it", () => {
    const p = proposal(1, { authors: [700], conflicted: [80], conflictedWithAuthor: [81] });
    const rec = record([{ n: 80 }, { n: 81 }, { n: 82 }], [p]);
    expect(reviewerOffer(rec, p, uuid(80))).toBe("not_offered");
    expect(reviewerOffer(rec, p, uuid(81))).toBe("not_offered");
    expect(reviewerOffer(rec, p, uuid(82))).toBe("offered");
    // The rule is the one that decides who reads a proposal: whoever would be shown nothing as
    // its reviewer is not offered as one.
    for (const n of [80, 81, 82]) {
      const assigned: SubmissionContext = {
        ...p,
        assignments: proposal(1, { reviewers: [n] }).assignments,
      };
      const reads =
        projectSubmission(
          viewer(uuid(n), [{ conferenceId: CONFERENCE, role: "reviewer", scope: [POOL_A] }]),
          { ...assigned, people: new Map() },
        ) !== null;
      expect(reads, String(n)).toBe(reviewerOffer(rec, p, uuid(n)) === "offered");
    }
    // A conflict with someone who declined and is no longer on it is no conflict with it; they
    // are one of "its own people" all the same if they are the one who declined.
    const declined = proposal(2, { authors: [700], declined: [701] });
    declined.conflicts = [
      {
        id: uuid(8999),
        conferenceId: CONFERENCE,
        personId: uuid(80),
        submissionId: null,
        otherPersonId: uuid(701),
        kind: "institution",
        declaredBy: "system",
      },
    ];
    expect(reviewerOffer(record([{ n: 80 }], [declined]), declined, uuid(80))).toBe("offered");
  });

  it("never someone already assigned to it, who is listed as its reviewer instead", () => {
    const p = proposal(1, { reviewers: [80] });
    const rec = record([{ n: 80 }, { n: 81 }], [p]);
    expect(reviewerOffer(rec, p, uuid(80))).toBe("assigned");
    const view = projectProposalReviewers(chair, rec, p.submission.id, CLOSED);
    expect(view?.assigned).toEqual([
      {
        personId: uuid(80),
        displayName: "MARK-NAME-80",
        email: "mark-email-80@example.org",
        assignedAt: p.assignments[0]?.createdAt,
        blocked: false,
      },
    ]);
    expect(view?.candidates.map((c) => c.personId)).toEqual([uuid(81)]);
    expect(view).toMatchObject({ pool: POOL_A, needed: NEEDED_A, takes: "yes" });
  });

  it("someone released from it is offered again, except after a conflict", () => {
    const p = proposal(1, { reviewers: [80, 81] });
    const rec = record([{ n: 80 }, { n: 81 }, { n: 82 }], [p]);
    const id = p.submission.id;
    for (const reason of ["chair", "expertise", "time", "role_removed"] as const) {
      const after = release(rec, id, 80, reason);
      const ctx = after.submissions[0] as SubmissionContext;
      expect(reviewerOffer(after, ctx, uuid(80)), reason).toBe("offered");
      const view = projectProposalReviewers(chair, after, id, CLOSED);
      expect(
        view?.assigned.map((a) => a.personId),
        reason,
      ).toEqual([uuid(81)]);
      expect(
        view?.candidates.map((c) => c.personId),
        reason,
      ).toEqual([uuid(80), uuid(82)]);
    }
    const after = release(rec, id, 80, "conflict");
    const ctx = after.submissions[0] as SubmissionContext;
    expect(reviewerOffer(after, ctx, uuid(80))).toBe("not_offered");
    expect(reviewerCandidate(chair, after, ctx, uuid(80))).toBeNull();
    // And is named nowhere in what the chair is shown of the proposal.
    expect(findLeaks(projectProposalReviewers(chair, after, id, CLOSED), marks(80))).toEqual([]);
    // For another proposal they are a reviewer like any other.
    const other = proposal(2);
    const both = { ...after, submissions: [...after.submissions, other] };
    expect(reviewerOffer(both, other, uuid(80))).toBe("offered");
  });

  it("someone assigned who can no longer review it is marked, and is not counted among its reviewers", () => {
    // What was true when a reviewer was assigned can stop being true. Reviewer 80 still reviews
    // it. 81 has a conflict recorded since; the owner has since invited 82; 85 reviews for
    // another pool only. None of the three would be shown the proposal as its reviewer.
    const p = proposal(1, { reviewers: [80, 81, 82, 85], conflicted: [81], invited: [82] });
    const rec = record([{ n: 80 }, { n: 81 }, { n: 82 }, { n: 85, pools: [POOL_B] }], [p]);
    const reads = (n: number, pools: string[]) =>
      projectSubmission(
        viewer(uuid(n), [{ conferenceId: CONFERENCE, role: "reviewer", scope: pools }]),
        { ...p, people: new Map() },
      )?.view;
    expect([reads(80, [POOL_A]), reads(81, [POOL_A]), reads(85, [POOL_B])]).toEqual([
      "reviewer",
      undefined,
      undefined,
    ]);
    // (The one who was invited reads it as an invitee, which is another matter.)
    expect(reads(82, [POOL_A])).toBe("invitee");
    const view = projectProposalReviewers(chair, rec, p.submission.id, CLOSED);
    expect(view?.assigned.map((a) => [a.personId, a.blocked])).toEqual([
      [uuid(80), false],
      [uuid(81), true],
      [uuid(82), true],
      [uuid(85), true],
    ]);
    // On the Assignments page the proposal has one reviewer of the three it needs.
    const item = projectAssignments(chair, rec, CLOSED)?.pools[0]?.items[0];
    expect(item?.reviewers.map((r) => r.personId)).toEqual([uuid(80)]);
    expect(item?.short).toBe(true);
    // With three who can review it, it has its reviewers, whoever else is still assigned.
    const full = proposal(2, { reviewers: [80, 81, 82, 85] });
    const all = record([{ n: 80 }, { n: 81 }, { n: 82 }, { n: 85, pools: [POOL_B] }], [full]);
    expect(projectAssignments(chair, all, CLOSED)?.pools[0]?.items[0]).toMatchObject({
      short: false,
    });
    expect(
      projectAssignments(chair, all, CLOSED)?.pools[0]?.items[0]?.reviewers.map((r) => r.personId),
    ).toEqual([uuid(80), uuid(81), uuid(82)]);
  });

  it("someone who has reached their number is still offered, after the others", () => {
    const p = proposal(1);
    const rec = record(
      [
        { n: 80, maxLoad: 1 },
        { n: 81, maxLoad: 2 },
        { n: 82, maxLoad: 1 },
        { n: 83, maxLoad: null },
      ],
      [
        p,
        proposal(2, { reviewers: [80, 81, 83] }),
        proposal(3, { reviewers: [80, 83] }),
        proposal(4, { reviewers: [83] }),
      ],
    );
    const candidates = projectProposalReviewers(chair, rec, p.submission.id, CLOSED)?.candidates;
    expect(candidates?.map((c) => [c.personId, c.assigned, c.maxLoad, c.full])).toEqual([
      [uuid(81), 1, 2, false],
      [uuid(82), 0, 1, false],
      // Three proposals and no number given: there is no number to have reached.
      [uuid(83), 3, null, false],
      // Over their number counts as having reached it.
      [uuid(80), 2, 1, true],
    ]);
  });

  it("does not count as load a proposal its reviewers no longer read", () => {
    const p = proposal(1);
    const rec = record(
      [{ n: 80, maxLoad: 2 }],
      [
        p,
        proposal(2, { reviewers: [80] }),
        proposal(3, { status: "withdrawn", reviewers: [80] }),
        proposal(4, { status: "accepted", reviewers: [80] }),
      ],
    );
    // The withdrawn one is nobody's work; the accepted one is still theirs to read.
    expect(
      projectProposalReviewers(chair, rec, p.submission.id, CLOSED)?.candidates.map((c) => [
        c.assigned,
        c.full,
      ]),
    ).toEqual([[2, true]]);
  });

  it("counts a load as the chair looking may know it: without their own and conflicted proposals", () => {
    const author = chairOf(CONFERENCE, uuid(700));
    const p = proposal(1, { authors: [701] });
    const rec = record(
      [{ n: 80, maxLoad: 2 }],
      [
        p,
        proposal(2, { authors: [700], reviewers: [80] }),
        proposal(3, { authors: [701], reviewers: [80] }),
      ],
    );
    const seen = (v: PersonViewer) =>
      projectProposalReviewers(v, rec, p.submission.id, CLOSED)?.candidates.map((c) => [
        c.assigned,
        c.full,
      ]);
    expect(seen(chairOf(CONFERENCE))).toEqual([[2, true]]);
    // The author of proposal 2 is not told that it is one of this reviewer's.
    expect(seen(author)).toEqual([[1, false]]);
  });
});

describe("the Assignments page", () => {
  const chair = chairOf(CONFERENCE);

  it("lists, by pool, every proposal that takes reviewers, those still short first, with totals", () => {
    const subs = [
      proposal(1, { reviewers: [80, 81, 82], created: 1 }),
      proposal(2, { reviewers: [80], created: 2 }),
      proposal(3, { reviewers: [], created: 3 }),
      proposal(4, { reviewers: [80, 81, 82, 83], created: 4 }),
      proposal(5, { type: TYPE_B, reviewers: [90], created: 5 }),
      // Not under consideration: neither listed nor counted.
      proposal(6, { status: "withdrawn", reviewers: [80] }),
      proposal(7, { status: "accepted", reviewers: [80, 81, 82] }),
      proposal(8, { status: "draft" }),
    ];
    const rec = record(
      [{ n: 80 }, { n: 81 }, { n: 82 }, { n: 83 }, { n: 90, pools: [POOL_B] }],
      subs,
    );
    const page = projectAssignments(chair, rec, CLOSED);
    expect(page).toMatchObject({ view: "assignments", callClosed: true, excluded: 0 });
    expect(NEEDED_A).toBe(3);
    const [a, b] = page?.pools ?? [];
    expect(a).toMatchObject({ key: POOL_A, needed: 3, proposals: 4, short: 2 });
    // Short ones first, each group in the order the proposals were created.
    expect(a?.items.map((x) => [x.id, x.short, x.reviewers.length])).toEqual([
      [uuid(5002), true, 1],
      [uuid(5003), true, 0],
      [uuid(5001), false, 3],
      [uuid(5004), false, 4],
    ]);
    expect(a?.items[0]).toEqual({
      id: uuid(5002),
      title: "MARK-TITLE-2",
      typeKey: TYPE_A,
      reviewers: [
        { personId: uuid(80), displayName: "MARK-NAME-80", email: "mark-email-80@example.org" },
      ],
      short: true,
    });
    expect(b).toMatchObject({ key: POOL_B, proposals: 1, short: 1 });
    expect(b?.items.map((x) => x.id)).toEqual([uuid(5005)]);
    // No text of a proposal but its title, and nothing of a profile but a name and an address.
    expect(
      findLeaks(page, [
        ...subs.map((_, i) => `MARK-ABSTRACT-${i + 1}`),
        ...[80, 81, 82, 83, 90].flatMap((n) => [`MARK-AFFILIATION-${n}`, `MARK-BIO-${n}`]),
        // Not who wrote them either.
        ...marks(700),
      ]),
    ).toEqual([]);
  });

  it("says whether the call has closed, and lists the proposals either way", () => {
    const p = { ...proposal(1), phase: "cfp_open" };
    const rec = record([{ n: 80 }], [p], { phase: "cfp_open" });
    expect(projectAssignments(chair, rec, OPEN)).toMatchObject({ callClosed: false });
    expect(projectAssignments(chair, rec, CLOSED)).toMatchObject({ callClosed: true });
    expect(projectAssignments(chair, rec, OPEN)?.pools[0]?.proposals).toBe(1);
  });

  it("orders a pool's list by one position: short first, then when created, then the id", () => {
    const at = (short: boolean, created: number, n: number) =>
      assignmentsPosition(short, { createdAt: day(created), id: uuid(n) });
    const inOrder = [
      at(true, 1, 2),
      at(true, 1, 3),
      at(true, 9, 1),
      at(false, 0, 5),
      at(false, 1, 4),
    ];
    for (const [i, a] of inOrder.entries()) {
      for (const [j, b] of inOrder.entries()) {
        expect(assignmentsAfter(a, b), `${i} after ${j}`).toBe(i > j);
      }
    }
  });
});

describe("what the views give away", () => {
  const reviewerOf = (n: number, pools: string[]) =>
    viewer(uuid(n), [{ conferenceId: CONFERENCE, role: "reviewer", scope: pools }]);

  /**
   * One proposal with two reviewers, among others. Four people must learn nothing about who
   * reviews it: a reviewer released from it, a reviewer of another pool, a reviewer with a
   * conflict with it, and a chair with a conflict with it.
   */
  const scenario = fc.record({
    reason: fc.constantFrom<AssignmentReleaseReason>(
      "chair",
      "conflict",
      "expertise",
      "time",
      "role_removed",
    ),
    phase: fc.constantFrom(...CONFERENCE_PHASES),
    status: fc.constantFrom<SubmissionStatus>("submitted", "accepted", "rejected", "withdrawn"),
    others: fc.array(fc.subarray([80, 81, 82, 83]), { minLength: 0, maxLength: 4 }),
    closed: fc.boolean(),
  });

  it("nothing to a released reviewer, a reviewer of another pool, a conflicted reviewer or a conflicted chair", () => {
    fc.assert(
      fc.property(scenario, ({ reason, phase, status, others, closed }) => {
        // Reviewer 84 was assigned, and has a conflict with it all the same (one declared
        // since): the conflict rule comes first. Reviewer 85 is assigned too, by a row no route
        // would write, and reviews for another pool only.
        const target = proposal(1, {
          status,
          title: "MARK-THE-TARGET",
          reviewers: [80, 81, 84, 85],
          conflicted: [84, 61],
        });
        const subs = [target, ...others.map((rs, i) => proposal(10 + i, { reviewers: rs }))].map(
          (s) => ({ ...s, phase }),
        );
        const rec = release(
          record(
            [{ n: 80 }, { n: 81 }, { n: 82 }, { n: 83 }, { n: 84 }, { n: 85, pools: [POOL_B] }],
            subs,
            { phase },
          ),
          target.submission.id,
          82,
          reason,
        );
        const now = closed ? CLOSED : OPEN;
        const ctx = rec.submissions[0] as SubmissionContext;
        const learners: [string, PersonViewer][] = [
          ["a reviewer released from it", reviewerOf(82, [POOL_A])],
          ["a reviewer of another pool", reviewerOf(85, [POOL_B])],
          ["a reviewer with a conflict", reviewerOf(84, [POOL_A])],
          ["a chair with a conflict", chairOf(CONFERENCE, uuid(61))],
        ];
        for (const [who, v] of learners) {
          // The proposal itself: what the public gets of it, which is nothing.
          expect(submissionAccess(v, ctx), who).toBe("none");
          expect(submissionAccess(v, ctx), who).toBe(submissionAccess(PUBLIC, ctx));
          const seen = [
            projectSubmission(v, { ...ctx, people: rec.people }),
            projectProposalReviewers(v, rec, target.submission.id, now),
          ];
          expect(seen, who).toEqual([null, null]);
          // The Assignments page is a chair's. The chair with a conflict has it, and it is the
          // page they would have if nobody reviewed that proposal at all.
          const page = projectAssignments(v, rec, now);
          if (who !== "a chair with a conflict") {
            expect(page, who).toBeNull();
            continue;
          }
          const bare = {
            ...rec,
            submissions: rec.submissions.map((s, i) => (i === 0 ? { ...s, assignments: [] } : s)),
          };
          expect(page, who).toEqual(projectAssignments(v, bare, now));
          expect(findLeaks(page, [target.submission.id, target.submission.title]), who).toEqual([]);
          // Reviewers 80 and 81 appear on that page only where they review something else.
          const elsewhere = new Set(others.flat());
          for (const n of [80, 81]) {
            if (!elsewhere.has(n)) expect(findLeaks(page, marks(n)), `${who}: ${n}`).toEqual([]);
          }
          // And on the pages of the proposals that chair does manage, nobody's load counts it.
          for (const s of rec.submissions.slice(1)) {
            expect(
              projectProposalReviewers(v, rec, s.submission.id, now),
              `${who}: ${s.submission.id}`,
            ).toEqual(projectProposalReviewers(v, bare, s.submission.id, now));
          }
        }
      }),
      RUNS,
    );
  });

  it("a released reviewer is shown to nobody as a reviewer, and can be offered again", () => {
    const chair = chairOf(CONFERENCE);
    const p = proposal(1, { reviewers: [80, 81] });
    const rec = release(record([{ n: 80 }, { n: 81 }], [p]), p.submission.id, 80, "chair");
    const view = projectProposalReviewers(chair, rec, p.submission.id, CLOSED);
    expect(view?.assigned.map((a) => a.personId)).toEqual([uuid(81)]);
    // Released by a chair, they can be assigned again: a candidate, with nothing counted.
    expect(view?.candidates).toMatchObject([{ personId: uuid(80), assigned: 0 }]);
    const page = projectAssignments(chair, rec, CLOSED);
    expect(page?.pools[0]?.items[0]?.reviewers.map((r) => r.personId)).toEqual([uuid(81)]);
    expect(page?.pools[0]).toMatchObject({ proposals: 1, short: 1 });
  });

  it("a chair's own proposal changes nothing they are shown, whoever reviews it", () => {
    const author = chairOf(CONFERENCE, uuid(700));
    fc.assert(
      fc.property(
        fc.array(fc.subarray([80, 81, 82]), { minLength: 1, maxLength: 4 }),
        fc.subarray([80, 81, 82], { minLength: 1 }),
        (others, onOwn) => {
          const managed = others.map((rs, i) =>
            proposal(10 + i, { authors: [701], reviewers: rs }),
          );
          const own = (reviewers: number[]) => proposal(1, { authors: [700], reviewers });
          const of = (reviewers: number[]) =>
            record(
              [{ n: 80, maxLoad: 2 }, { n: 81, maxLoad: 2 }, { n: 82 }],
              [own(reviewers), ...managed],
            );
          const [withThem, without] = [of(onOwn), of([])];
          expect(projectAssignments(author, withThem, CLOSED)).toEqual(
            projectAssignments(author, without, CLOSED),
          );
          expect(projectAssignments(author, withThem, CLOSED)?.excluded).toBe(1);
          for (const s of managed) {
            expect(projectProposalReviewers(author, withThem, s.submission.id, CLOSED)).toEqual(
              projectProposalReviewers(author, without, s.submission.id, CLOSED),
            );
          }
          expect(projectProposalReviewers(author, withThem, uuid(5001), CLOSED)).toBeNull();
        },
      ),
      RUNS,
    );
  });
});
