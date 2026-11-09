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
    /** Profile details only chairs see, and only of confirmed people. */
    pronouns: string[];
    orcids: string[];
    /**
     * Country codes, distinct per person. Two letters can occur inside other text, so these are
     * checked as whole values anywhere in the output (valuesIn), not as substrings (findLeaks).
     */
    countries: string[];
    unconfirmedCountries: string[];
    /** Profile details of people who have not confirmed (invited or declined). */
    unconfirmedProfile: string[];
    /** What the owner typed for people still invited. */
    invitedTyped: string[];
    /** What the owner typed for people who declined. */
    declinedTyped: string[];
    content: string[]; // title, abstract
    identifyingFields: string[];
    otherFields: string[];
    /** A custom-field key the type does not define (owner-written text) and its value. */
    unknownField: string[];
  };
};

type Scenario = {
  config: ConferenceConfig;
  typePick: number;
  nContrib: number;
  statuses: Contribution["status"][];
  status: SubmissionStatus;
  ids: string[];
  unknownField: boolean;
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
  unknownField: fc.boolean(),
});

const COUNTRIES = ["AR", "BR", "CL", "MX", "PE", "UY"];

/**
 * A valid ORCID iD (ISO 7064 MOD 11-2 check digit), unique to `seed`, whose check digit is X.
 * Nothing else in a projection (UUIDs are lowercase hex, dates and numbers have no X) can
 * contain it, so it works as a substring marker. One of any 100 consecutive iDs that share
 * their first 13 digits ends in X, so the search stays within seed * 100 + [0, 100).
 */
function orcidMarker(seed: number): string {
  for (let n = seed * 100; ; n++) {
    const base = String(n).padStart(15, "0");
    let total = 0;
    for (const d of base) total = (total + Number(d)) * 2;
    if ((12 - (total % 11)) % 11 === 10) {
      return `${base.slice(0, 4)}-${base.slice(4, 8)}-${base.slice(8, 12)}-${base.slice(12)}X`;
    }
  }
}

function build({
  config,
  typePick,
  nContrib,
  statuses,
  status,
  ids,
  unknownField,
}: Scenario): Built {
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
    pronouns: [],
    orcids: [],
    countries: [],
    unconfirmedCountries: [],
    unconfirmedProfile: [],
    invitedTyped: [],
    declinedTyped: [],
    content: [],
    identifyingFields: [],
    otherFields: [],
    unknownField: [],
  };
  for (let i = 0; i < nContrib; i++) {
    const pid = id(4 + i);
    // The owner (position 0) is always confirmed; the others vary.
    const cstatus = i === 0 ? "confirmed" : (statuses[i] ?? "confirmed");
    const p: Person = {
      id: pid,
      email: `mail${i}x${tag}@example.test`,
      displayName: `NAME${i}x${tag}`,
      orcid: orcidMarker(Number.parseInt(tag, 16) * 10 + i),
      affiliation: `AFF${i}x${tag}`,
      country: COUNTRIES[i]!,
      languages: ["es"],
      bios: { es: `BIO${i}x${tag}` },
      pronouns: `PRON${i}x${tag}`,
    };
    people.set(pid, p);
    const profile = [
      p.displayName!,
      p.email,
      p.affiliation!,
      `BIO${i}x${tag}`,
      p.pronouns!,
      p.orcid!,
    ];
    m.names.push(p.displayName!);
    m.emails.push(p.email);
    m.affiliations.push(p.affiliation!);
    m.bios.push(`BIO${i}x${tag}`);
    m.pronouns.push(p.pronouns!);
    m.orcids.push(p.orcid!);
    m.countries.push(p.country!);
    if (cstatus !== "confirmed") {
      m.unconfirmedProfile.push(...profile);
      m.unconfirmedCountries.push(p.country!);
    }
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
  if (unknownField) {
    // As if saved before unknown keys were refused: the key itself is the owner's text.
    const key = `unknownkeyx${tag}`;
    fields[key] = `UNKNOWNVALx${tag}`;
    m.unknownField.push(key, `UNKNOWNVALx${tag}`);
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

/** One fixed scenario for examples: an owner, an invitee and someone who declined. */
const example = (over: Partial<Scenario> = {}): Built =>
  build({
    config: CONFIGS[1]!,
    typePick: 0,
    nContrib: 3,
    statuses: ["confirmed", "invited", "declined", "confirmed", "confirmed", "confirmed"],
    status: "submitted",
    ids: Array.from(
      { length: 12 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ),
    unknownField: false,
    ...over,
  });

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
const identity = (b: Built) => [
  ...b.m.names,
  ...b.m.emails,
  ...b.m.affiliations,
  ...b.m.bios,
  ...b.m.pronouns,
  ...b.m.orcids,
];
/** Profile details nobody but chairs sees (of confirmed people only). */
const chairOnly = (b: Built) => [...b.m.pronouns, ...b.m.orcids];
/** Everything about people who have not confirmed: their profiles and what the owner typed. */
const unconfirmed = (b: Built) => [
  ...b.m.unconfirmedProfile,
  ...b.m.invitedTyped,
  ...b.m.declinedTyped,
];

/**
 * Every string anywhere in `out` (values and keys) that is one of `values`. For short markers
 * such as country codes, where a substring search would find them inside unrelated text.
 */
function valuesIn(out: unknown, values: Iterable<string>): string[] {
  const wanted = new Set(values);
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (wanted.has(v)) found.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (wanted.has(k)) found.add(k);
        walk(x);
      }
    }
  };
  walk(JSON.parse(JSON.stringify(out ?? null)));
  return [...found].sort();
}

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
              ? [...b.m.emails, ...b.m.bios, ...chairOnly(b), ...unconfirmed(b)]
              : [...b.m.emails, ...chairOnly(b), ...unconfirmed(b)];
        expect(findLeaks(out, [...forbidden, ...b.m.unknownField])).toEqual([]);
        expect(valuesIn(out, b.m.countries)).toEqual([]);
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
          ...b.m.unknownField,
        ];
        expect(findLeaks(out, forbidden)).toEqual([]);
        expect(valuesIn(out, b.m.countries)).toEqual([]);
        if (out?.view === "metadata") {
          expect(typeof out.selfIdWarningCount).toBe("number");
          expect(
            out.contributors.every((c) => ["invited", "confirmed", "declined"].includes(c.status)),
          ).toBe(true);
          // Field keys come from the configuration, never from what was saved.
          const type = b.rec.config.submissionTypes.find((t) => t.key === b.rec.submission.typeKey);
          expect(out.filledFieldKeys).toEqual((type?.fields ?? []).map((f) => f.key).sort());
        }
      }),
      RUNS,
    );
  });

  it("list only configured field keys that hold a value", () => {
    fc.assert(
      fc.property(scenario, fc.nat(), (s, pick) => {
        const b = build(s);
        const type = b.rec.config.submissionTypes.find((t) => t.key === b.rec.submission.typeKey)!;
        // Blank out one configured field (if any): blank text, an empty list, an unticked box.
        const blanked = type.fields[pick % Math.max(type.fields.length, 1)];
        if (blanked) {
          b.rec.submission.fields[blanked.key] =
            blanked.kind === "boolean" ? false : blanked.kind === "multiselect" ? [] : "  ";
        }
        const out = projectSubmission(agent(chair(b), "M", b.conferenceId), b.rec);
        if (out?.view !== "metadata") throw new Error("expected the metadata view");
        const expected = type.fields
          .filter((f) => f.key !== blanked?.key)
          .map((f) => f.key)
          .sort();
        expect(out.filledFieldKeys).toEqual(expected);
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
          findLeaks(out, [
            ...b.m.emails,
            ...b.m.bios,
            ...chairOnly(b),
            ...b.m.otherFields,
            ...b.m.unknownField,
            ...unconfirmed(b),
          ]),
        ).toEqual([]);
        expect(valuesIn(out, b.m.countries)).toEqual([]);
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

  it("the owner and co-authors see invitees only as typed: never an unconfirmed profile", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        for (const c of b.rec.contributions.filter((x) => x.status === "confirmed")) {
          const out = projectSubmission(asPerson(c.personId), b.rec);
          expect(out?.view).toBe("submitter");
          expect(
            findLeaks(out, [...b.m.unconfirmedProfile, ...chairOnly(b), ...b.m.declinedTyped]),
          ).toEqual([]);
          expect(valuesIn(out, b.m.countries)).toEqual([]);
          expect(findLeaks(out, b.m.invitedTyped)).toEqual(b.m.invitedTyped);
        }
      }),
      RUNS,
    );
  });

  it("chairs see invited and declined people only as typed, never their profiles", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const out = projectSubmission(chair(b), b.rec);
        expect(out?.view).toBe("chair");
        expect(findLeaks(out, b.m.unconfirmedProfile)).toEqual([]);
        expect(valuesIn(out, b.m.unconfirmedCountries)).toEqual([]);
        // ...while confirmed people appear in full, and everyone else as typed.
        const typed = [...b.m.invitedTyped, ...b.m.declinedTyped];
        expect(findLeaks(out, typed)).toEqual(typed);
        const confirmed = (xs: string[]) => xs.filter((x) => !b.m.unconfirmedProfile.includes(x));
        const shown = confirmed([...identity(b)]);
        expect(findLeaks(out, shown)).toEqual(shown);
        const countries = b.m.countries.filter((c) => !b.m.unconfirmedCountries.includes(c));
        expect(valuesIn(out, countries)).toEqual([...countries].sort());
      }),
      RUNS,
    );
  });

  it("an invited contributor appears to chairs exactly as the owner typed them", () => {
    const b = example();
    const out = projectSubmission(chair(b), b.rec);
    if (out?.view !== "chair") throw new Error("expected the chair view");
    const [owner, invited, declined] = out.contributors;
    expect(owner).toMatchObject({ status: "confirmed", displayName: "NAME0x00000000" });
    expect(owner?.pronouns).toBe("PRON0x00000000");
    expect(owner?.country).toBe("AR");
    for (const [c, i] of [
      [invited, 1],
      [declined, 2],
    ] as const) {
      expect(c).toMatchObject({
        displayName: `INVNM${i}x00000000`,
        email: `invmb${i}x00000000@example.test`,
        affiliation: `INVORG${i}x00000000`,
        country: null,
        pronouns: null,
        orcid: null,
        bios: {},
      });
    }
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
        expect(
          findLeaks(out, [
            ...b.m.emails,
            ...typedEmails,
            ...b.m.unconfirmedProfile,
            ...chairOnly(b),
            ...b.m.declinedTyped,
          ]),
        ).toEqual([]);
        expect(valuesIn(out, b.m.countries)).toEqual([]);
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

  it("a chair-contributor's tier M agent sees no more people than the chair's own view", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const b = build(s);
        const own = projectSubmission(chair(b, b.ownerId), b.rec);
        const out = projectSubmission(agent(chair(b, b.ownerId), "M", b.conferenceId), b.rec);
        if (own?.view !== "submitter" || out?.view !== "metadata") {
          throw new Error("expected the submitter and metadata views");
        }
        const declined = b.rec.contributions
          .filter((c) => c.status === "declined")
          .map((c) => c.personId);
        expect(findLeaks(out, declined)).toEqual([]);
        expect(out.contributors.map((c) => c.personId)).toEqual(
          own.contributors.map((c) => c.personId),
        );
        // A chair who is not a contributor still sees everyone, declined people included.
        const managed = projectSubmission(agent(chair(b), "M", b.conferenceId), b.rec);
        expect(findLeaks(managed, declined)).toEqual(declined);
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
          findLeaks(out, [
            ...b.m.emails,
            ...b.m.bios,
            ...chairOnly(b),
            ...b.m.otherFields,
            ...b.m.unknownField,
            ...unconfirmed(b),
          ]),
        ).toEqual([]);
        expect(valuesIn(out, b.m.countries)).toEqual([]);
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

  it("flags confirmed contributors whose bio is longer than the configured limit", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");
    const b = example({
      nContrib: 4,
      statuses: ["confirmed", "confirmed", "invited", "confirmed", "confirmed", "confirmed"],
    });
    const max = b.rec.config.rules.bio?.maxWords;
    expect(max).toBe(300);
    const [owner, coauthor, invitee, other] = b.rec.contributions.map(
      (c) => b.rec.people.get(c.personId)!,
    );
    // Too long in one language of two; exactly at the limit; too long but not confirmed.
    owner!.bios = { es: "Corta.", en: words(301) };
    coauthor!.bios = { es: words(300) };
    invitee!.bios = { pt: words(400) };
    other!.bios = { pt: `${words(300)}, ${words(1)}.` };
    const viewer: PersonViewer = {
      kind: "person",
      personId: b.ownerId,
      siteAdmin: false,
      grants: [],
    };
    expect(projectCheck(viewer, b.rec, 0)?.longBios).toEqual([0, 3]);
    // Without bio rules, nothing is too long.
    b.rec.config = CONFIGS[0]!;
    expect(b.rec.config.rules.bio).toBeUndefined();
    expect(projectCheck(viewer, b.rec, 0)?.longBios).toEqual([]);
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
      unknownField: false,
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
