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
import { projectCheck, projectSubmission, type SubmissionRecord } from "./projections";
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
  ownerId: string;
  m: {
    /** Profile details of everyone, whatever their status. */
    names: string[];
    emails: string[];
    affiliations: string[];
    bios: string[];
    /** Profile details of people who have not confirmed (invited or declined). */
    unconfirmedProfile: string[];
    /** What the owner typed for people still invited. */
    invitedTyped: string[];
    /** What the owner typed for people who declined. */
    declinedTyped: string[];
    content: string[]; // title, abstract
    identifyingFields: string[];
    otherFields: string[];
  };
};

type Scenario = {
  config: ConferenceConfig;
  typePick: number;
  nContrib: number;
  statuses: Contribution["status"][];
  status: SubmissionStatus;
  ids: string[];
};

const scenario: fc.Arbitrary<Scenario> = fc.record({
  config: fc.constantFrom(...CONFIGS),
  typePick: fc.nat(),
  nContrib: fc.integer({ min: 1, max: 6 }),
  statuses: fc.array(fc.constantFrom<Contribution["status"]>("confirmed", "invited", "declined"), {
    minLength: 6,
    maxLength: 6,
  }),
  status: fc.constantFrom(...NOT_PUBLISHED),
  ids: fc.uniqueArray(fc.uuid(), { minLength: 12, maxLength: 12 }),
});

function build({ config, typePick, nContrib, statuses, status, ids }: Scenario): Built {
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
    unconfirmedProfile: [],
    invitedTyped: [],
    declinedTyped: [],
    content: [],
    identifyingFields: [],
    otherFields: [],
  };
  for (let i = 0; i < nContrib; i++) {
    const pid = id(4 + i);
    // The owner (position 0) is always confirmed; the others vary.
    const cstatus = i === 0 ? "confirmed" : (statuses[i] ?? "confirmed");
    const p: Person = {
      id: pid,
      email: `mail${i}x${tag}@example.test`,
      displayName: `NAME${i}x${tag}`,
      orcid: null,
      affiliation: `AFF${i}x${tag}`,
      country: "CO",
      languages: ["es"],
      bios: { es: `BIO${i}x${tag}` },
      pronouns: null,
    };
    people.set(pid, p);
    const profile = [p.displayName!, p.email, p.affiliation!, `BIO${i}x${tag}`];
    m.names.push(p.displayName!);
    m.emails.push(p.email);
    m.affiliations.push(p.affiliation!);
    m.bios.push(`BIO${i}x${tag}`);
    if (cstatus !== "confirmed") m.unconfirmedProfile.push(...profile);
    const typed =
      i === 0
        ? { invitedEmail: null, invitedName: null, invitedAffiliation: null }
        : {
            invitedEmail: `invmb${i}x${tag}@example.test`,
            invitedName: `INVNM${i}x${tag}`,
            invitedAffiliation: `INVORG${i}x${tag}`,
          };
    if (i > 0) {
      const values = [typed.invitedEmail!, typed.invitedName!, typed.invitedAffiliation!];
      if (cstatus === "invited") m.invitedTyped.push(...values);
      if (cstatus === "declined") m.declinedTyped.push(...values);
    }
    contributions.push({
      submissionId,
      personId: pid,
      role: i === 0 ? "lead" : "presenter",
      position: i,
      status: cstatus,
      ...typed,
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
    ownerPersonId: id(4),
    version: 3,
    typeKey: type.key,
    trackKey: null,
    topicKeys: [],
    language: "es",
    title,
    abstract,
    fields,
    participationMode: "online",
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
    ownerId: id(4),
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
/** Everything about people who have not confirmed: their profiles and what the owner typed. */
const unconfirmed = (b: Built) => [
  ...b.m.unconfirmedProfile,
  ...b.m.invitedTyped,
  ...b.m.declinedTyped,
];

describe("reviewers", () => {
  it("never see what their submission type's blind mode hides, nor anyone unconfirmed", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(reviewer(b), b.rec);
        expect(out?.view).toBe("reviewer");
        const mode = effectiveBlindMode(b.rec.config, b.rec.submission.typeKey);
        const forbidden =
          mode === "double"
            ? [...identity(b), ...b.m.identifyingFields, ...unconfirmed(b)]
            : mode === "single"
              ? [...b.m.emails, ...b.m.bios, ...unconfirmed(b)]
              : [...b.m.emails, ...unconfirmed(b)];
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
            otherPersonId: how === 2 ? b.ownerId : null,
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

  it("get the same view whether or not a cited surname belongs to an author (double-blind)", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        if (effectiveBlindMode(b.rec.config, b.rec.submission.typeKey) !== "double") return;
        b.rec.submission.abstract = "As shown before (Quintanilla 2020), electronic literature";
        const a = projectSubmission(reviewer(b), b.rec);
        const owner = b.rec.people.get(b.ownerId)!;
        b.rec.people.set(b.ownerId, { ...owner, displayName: "Ana Quintanilla" });
        expect(projectSubmission(reviewer(b), b.rec)).toEqual(a);
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
          ...unconfirmed(b),
          ...b.m.content,
          ...b.m.identifyingFields,
          ...b.m.otherFields,
        ];
        expect(findLeaks(out, forbidden)).toEqual([]);
        if (out?.view === "metadata") {
          expect(typeof out.selfIdWarningCount).toBe("number");
          expect(
            out.contributors.every((c) => ["invited", "confirmed", "declined"].includes(c.status)),
          ).toBe(true);
        }
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
        expect(
          findLeaks(out, [...b.m.emails, ...b.m.bios, ...b.m.otherFields, ...unconfirmed(b)]),
        ).toEqual([]);
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

describe("contributors and invitations", () => {
  const asPerson = (personId: string, grants: PersonViewer["grants"] = []): PersonViewer => ({
    kind: "person",
    personId,
    siteAdmin: false,
    grants,
  });

  it("the owner sees invitees only as typed: never an unconfirmed person's profile", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(asPerson(b.ownerId), b.rec);
        expect(out?.view).toBe("submitter");
        expect(findLeaks(out, [...b.m.unconfirmedProfile, ...b.m.declinedTyped])).toEqual([]);
        expect(findLeaks(out, b.m.invitedTyped)).toEqual(b.m.invitedTyped);
      }),
      RUNS,
    );
  });

  it("an invitee sees the submission but nobody's email, and no unconfirmed profile", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const invitee = b.rec.contributions.find((c) => c.status === "invited");
        if (!invitee) return;
        const out = projectSubmission(asPerson(invitee.personId), b.rec);
        expect(out?.view).toBe("invitee");
        const typedEmails = b.rec.contributions
          .map((c) => c.invitedEmail)
          .filter((e): e is string => !!e);
        expect(findLeaks(out, [...b.m.emails, ...typedEmails, ...b.m.unconfirmedProfile])).toEqual(
          [],
        );
      }),
      RUNS,
    );
  });

  it("someone who declined is no longer a contributor and sees nothing", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const declined = b.rec.contributions.find((c) => c.status === "declined");
        if (!declined) return;
        expect(projectSubmission(asPerson(declined.personId), b.rec)).toBeNull();
      }),
      RUNS,
    );
  });

  it("a chair who is also a contributor sees only the submitter view", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(chair(b, b.ownerId), b.rec);
        expect(out?.view).toBe("submitter");
        expect(findLeaks(out, [b.reviewerId, ...b.m.bios])).toEqual([]);
      }),
      RUNS,
    );
  });

  it("a chair-contributor's tier M agent never learns who reviews their submission", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(agent(chair(b, b.ownerId), "M", b.conferenceId), b.rec);
        expect(out?.view).toBe("metadata");
        expect(findLeaks(out, [b.reviewerId])).toEqual([]);
        expect(out && "assignedReviewerIds" in out).toBe(false);
      }),
      RUNS,
    );
  });

  it("work never submitted is visible to contributors only, whatever its status", () => {
    fc.assert(
      fc.property(scenario, fc.constantFrom<SubmissionStatus>("draft", "withdrawn"), (s, st) => {
        const b = build(s);
        b.rec.submission.status = st;
        b.rec.submission.submittedAt = null;
        expect(projectSubmission(chair(b), b.rec)).toBeNull();
        expect(projectSubmission(reviewer(b), b.rec)).toBeNull();
        expect(projectSubmission(agent(chair(b), "C", b.conferenceId), b.rec)).toBeNull();
        expect(projectSubmission(asPerson(b.ownerId), b.rec)?.view).toBe("submitter");
      }),
      RUNS,
    );
  });

  it("the public sees published work only, confirmed people only, without private fields", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        expect(projectSubmission({ kind: "public" }, b.rec)).toBeNull();
        b.rec.submission.status = "published";
        const out = projectSubmission({ kind: "public" }, b.rec);
        expect(out?.view).toBe("public");
        expect(
          findLeaks(out, [...b.m.emails, ...b.m.bios, ...b.m.otherFields, ...unconfirmed(b)]),
        ).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("the submission check", () => {
  it("tells a contributor only their own cap count, never other people or submissions", () => {
    fc.assert(
      fc.property(scenario, fc.nat({ max: 5 }), (s, own) => {
        const b = build(s);
        const out = projectCheck(
          { kind: "person", personId: b.ownerId, siteAdmin: false, grants: [] },
          b.rec,
          own,
        );
        expect(out).not.toBeNull();
        const cap = b.rec.config.rules.presenterCap;
        expect(out?.presenterCap).toEqual(cap ? { count: own, max: cap.max } : null);
        const others = b.rec.contributions.map((c) => c.personId);
        expect(findLeaks(out, [...others, b.reviewerId, b.rec.submission.id])).toEqual([]);
        expect(
          out?.selfIdentification.every((w) => Object.keys(w).sort().join() === "kind,path"),
        ).toBe(true);
      }),
      RUNS,
    );
  });

  it("is not available to reviewers, strangers or agents", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        expect(projectCheck(reviewer(b), b.rec, 0)).toBeNull();
        expect(
          projectCheck(
            { kind: "person", personId: "stranger", siteAdmin: false, grants: [] },
            b.rec,
            0,
          ),
        ).toBeNull();
        expect(projectCheck(agent(chair(b), "C", b.conferenceId), b.rec, 0)).toBeNull();
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
      statuses: ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "confirmed"],
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
