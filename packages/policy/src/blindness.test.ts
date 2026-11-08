/**
 * Blindness suite. Every person, title, abstract and field value carries a unique marker; we
 * project each record for each kind of viewer, serialize the result, and assert that no marker
 * the viewer must not see appears anywhere in it.
 */
import {
  type Assignment,
  type ConferenceConfig,
  ConferenceConfig as ConfigSchema,
  type Conflict,
  type Contribution,
  conferences,
  effectiveBlindMode,
  type Person,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { submissionAccess } from "./access";
import { projectSubmission, type SubmissionRecord } from "./projections";
import { findLeaks } from "./testing";
import type { AgentViewer, PersonViewer, Tier } from "./viewer";

const CONFIGS: ConferenceConfig[] = [
  ConfigSchema.parse(conferences.elo2026),
  ConfigSchema.parse(conferences.elo2027),
];
const RUNS = { numRuns: 250 };
const NOT_PUBLISHED: SubmissionStatus[] = [
  "submitted",
  "accepted",
  "waitlisted",
  "rejected",
  "confirmed",
];

type Built = {
  rec: SubmissionRecord;
  conferenceId: string;
  reviewerId: string;
  chairId: string;
  m: {
    names: string[];
    emails: string[];
    affiliations: string[];
    bios: string[];
    content: string[]; // title, abstract
    identifyingFields: string[];
    otherFields: string[];
  };
};

type Scenario = {
  config: ConferenceConfig;
  typePick: number;
  nContrib: number;
  status: SubmissionStatus;
  ids: string[];
};

const scenario: fc.Arbitrary<Scenario> = fc.record({
  config: fc.constantFrom(...CONFIGS),
  typePick: fc.nat(),
  nContrib: fc.integer({ min: 1, max: 6 }),
  status: fc.constantFrom(...NOT_PUBLISHED),
  ids: fc.uniqueArray(fc.uuid(), { minLength: 12, maxLength: 12 }),
});

function build({ config, typePick, nContrib, status, ids }: Scenario): Built {
  const id = (i: number) => ids[i] as string;
  const [conferenceId, submissionId, reviewerId, chairId] = [id(0), id(1), id(2), id(3)];
  const type = config.submissionTypes[typePick % config.submissionTypes.length]!;
  const tag = id(1).slice(0, 8);

  const people = new Map<string, Person>();
  const contributions: Contribution[] = [];
  const m: Built["m"] = {
    names: [],
    emails: [],
    affiliations: [],
    bios: [],
    content: [],
    identifyingFields: [],
    otherFields: [],
  };
  for (let i = 0; i < nContrib; i++) {
    const pid = id(4 + i);
    const p: Person = {
      id: pid,
      email: `mail${i}x${tag}@example.test`,
      displayName: `NAME${i}x${tag}`,
      orcid: null,
      affiliation: `AFF${i}x${tag}`,
      country: "CO",
      languages: ["es"],
      bio: `BIO${i}x${tag}`,
      pronouns: null,
    };
    people.set(pid, p);
    m.names.push(p.displayName!);
    m.emails.push(p.email);
    m.affiliations.push(p.affiliation!);
    m.bios.push(p.bio!);
    contributions.push({
      submissionId,
      personId: pid,
      role: i === 0 ? "lead" : "presenter",
      position: i,
    });
  }

  const fields: Submission["fields"] = {};
  for (const f of type.fields) {
    const v = f.kind === "url" ? `https://FIELD${f.key}x${tag}.example/` : `FIELD${f.key}x${tag}`;
    fields[f.key] = v;
    (f.identifying ? m.identifyingFields : m.otherFields).push(v);
  }
  const title = `TITLEx${tag}`;
  const abstract = `ABSTRACTx${tag} words words words`;
  m.content.push(title, `ABSTRACTx${tag}`);

  const now = "2027-02-01T12:00:00Z";
  const submission: Submission = {
    id: submissionId,
    conferenceId,
    typeKey: type.key,
    trackKey: null,
    topicKeys: [],
    language: "es",
    title,
    abstract,
    fields,
    status,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
  };
  const assignments: Assignment[] = [
    { id: id(11), conferenceId, reviewerId, submissionId, createdAt: now, dueAt: null },
  ];
  return {
    rec: { config, submission, contributions, assignments, conflicts: [], people },
    conferenceId,
    reviewerId,
    chairId,
    m,
  };
}

const reviewer = (b: Built, scope: string[] = []): PersonViewer => ({
  kind: "person",
  personId: b.reviewerId,
  siteAdmin: false,
  grants: [{ conferenceId: b.conferenceId, role: "reviewer", scope }],
});
const chair = (b: Built, personId = b.chairId): PersonViewer => ({
  kind: "person",
  personId,
  siteAdmin: false,
  grants: [{ conferenceId: b.conferenceId, role: "chair", scope: [] }],
});
const agent = (owner: PersonViewer, tier: Tier, conferenceId: string): AgentViewer => ({
  kind: "agent",
  tokenId: "tok",
  tier,
  conferenceId,
  owner,
});
const identity = (b: Built) => [...b.m.names, ...b.m.emails, ...b.m.affiliations, ...b.m.bios];

describe("reviewers", () => {
  it("never see what their submission type's blind mode hides", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(reviewer(b), b.rec);
        expect(out?.view).toBe("reviewer");
        const mode = effectiveBlindMode(b.rec.config, b.rec.submission.typeKey);
        const forbidden =
          mode === "double"
            ? [...identity(b), ...b.m.identifyingFields]
            : mode === "single"
              ? [...b.m.emails, ...b.m.bios]
              : b.m.emails;
        expect(findLeaks(out, forbidden)).toEqual([]);
        // ...while still getting what they need to review.
        expect(findLeaks(out, b.m.content)).toEqual(b.m.content);
      }),
      RUNS,
    );
  });

  it("see nothing when unassigned, conflicted, or outside their pool", () => {
    fc.assert(
      fc.property(scenario, fc.nat({ max: 3 }), (s, how) => {
        const b = build(s);
        let viewer = reviewer(b);
        if (how === 0) b.rec.assignments = [];
        if (how === 1 || how === 2) {
          const c: Conflict = {
            id: s.ids[10]!,
            conferenceId: b.conferenceId,
            personId: b.reviewerId,
            submissionId: how === 1 ? b.rec.submission.id : null,
            otherPersonId: how === 2 ? b.rec.contributions.at(-1)!.personId : null,
            kind: how === 1 ? "declared" : "institution",
            declaredBy: "reviewer",
          };
          b.rec.conflicts = [c];
        }
        if (how === 3) viewer = reviewer(b, ["some_other_pool"]);
        expect(projectSubmission(viewer, b.rec)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe("tier M agents (cloud-safe)", () => {
  it("never receive names, contact details, titles, abstracts or field text", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(agent(chair(b), "M", b.conferenceId), b.rec);
        expect(out?.view).toBe("metadata");
        const forbidden = [
          ...identity(b),
          ...b.m.content,
          ...b.m.identifyingFields,
          ...b.m.otherFields,
        ];
        expect(findLeaks(out, forbidden)).toEqual([]);
      }),
      RUNS,
    );
  });

  it("get only what is already public once a submission is published", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        b.rec.submission.status = "published";
        const out = projectSubmission(agent(chair(b), "M", b.conferenceId), b.rec);
        expect(out?.view).toBe("public");
        expect(findLeaks(out, [...b.m.emails, ...b.m.bios, ...b.m.otherFields])).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("tier C agents (local models)", () => {
  it("see exactly what their owner sees", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const owner = chair(b);
        expect(projectSubmission(agent(owner, "C", b.conferenceId), b.rec)).toEqual(
          projectSubmission(owner, b.rec),
        );
      }),
      RUNS,
    );
  });
});

describe("agents in general", () => {
  it("get nothing for other conferences or when their owner does not chair", () => {
    fc.assert(
      fc.property(scenario, fc.constantFrom<Tier>("M", "C"), (s, tier) => {
        const b = build(s);
        expect(projectSubmission(agent(chair(b), tier, s.ids[9]!), b.rec)).toBeNull();
        expect(projectSubmission(agent(reviewer(b), tier, b.conferenceId), b.rec)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe("chairs and contributors", () => {
  it("a chair who is also a contributor sees only the submitter view", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const authorChair = chair(b, b.rec.contributions[0]!.personId);
        const out = projectSubmission(authorChair, b.rec);
        expect(out?.view).toBe("submitter");
        expect(findLeaks(out, [b.reviewerId])).toEqual([]); // who reviews it stays hidden
        expect(findLeaks(out, b.m.bios)).toEqual([]);
      }),
      RUNS,
    );
  });

  it("a chair-contributor's tier M agent never learns who reviews their submission", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const authorChair = chair(b, b.rec.contributions[0]!.personId);
        const out = projectSubmission(agent(authorChair, "M", b.conferenceId), b.rec);
        expect(out?.view).toBe("metadata");
        expect(findLeaks(out, [b.reviewerId])).toEqual([]);
        expect(out && "assignedReviewerIds" in out).toBe(false);
      }),
      RUNS,
    );
  });

  it("drafts are visible to contributors only", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        b.rec.submission.status = "draft";
        expect(projectSubmission(chair(b), b.rec)).toBeNull();
        expect(projectSubmission(reviewer(b), b.rec)).toBeNull();
        expect(projectSubmission(agent(chair(b), "C", b.conferenceId), b.rec)).toBeNull();
        const author: PersonViewer = {
          kind: "person",
          personId: b.rec.contributions[0]!.personId,
          siteAdmin: false,
          grants: [],
        };
        expect(projectSubmission(author, b.rec)?.view).toBe("submitter");
      }),
      RUNS,
    );
  });

  it("the public sees published work only, without contact details or private fields", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        expect(projectSubmission({ kind: "public" }, b.rec)).toBeNull();
        b.rec.submission.status = "published";
        const out = projectSubmission({ kind: "public" }, b.rec);
        expect(out?.view).toBe("public");
        expect(findLeaks(out, [...b.m.emails, ...b.m.bios, ...b.m.otherFields])).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("track chairs", () => {
  it("chair only their own tracks", () => {
    const b = build({
      config: CONFIGS[0]!,
      typePick: 1,
      nContrib: 1,
      status: "submitted",
      ids: Array.from(
        { length: 12 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ),
    });
    b.rec.submission.trackKey = "narratives_worlds";
    const tc = (scope: string[]): PersonViewer => ({
      kind: "person",
      personId: b.chairId,
      siteAdmin: false,
      grants: [{ conferenceId: b.conferenceId, role: "track_chair", scope }],
    });
    expect(submissionAccess(tc(["narratives_worlds"]), b.rec)).toBe("chair");
    expect(submissionAccess(tc([]), b.rec)).toBe("chair");
    expect(submissionAccess(tc(["hypertexts_fictions"]), b.rec)).toBe("none");
  });
});
