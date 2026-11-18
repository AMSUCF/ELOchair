import type { PersonViewer, SubmissionRecord } from "@elochair/policy";
import { findLeaks } from "@elochair/policy/testing";
import {
  ConferenceConfig,
  type Contribution,
  type Person,
  type Submission,
  type SubmissionStatus,
} from "@elochair/schema";
import { and, eq } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { createApiToken, getConference, grantRole, saveConference } from "./repo";
import { configToken, reviewConfig } from "./services/settings";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Conference settings (spec 02, §1.9): chairs change the stage-one values of a configuration,
 * admins anything, nobody else and no agent. A save is reviewed first, never makes submitted
 * work invalid, is refused when it is based on an older configuration, and is audited value by
 * value. All on the made-up fixture call.
 */

let t: TestApp;
let conferenceId: string;
const SLUG = "settings-call";
const NOW = new Date("2027-02-01T12:00:00Z");
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
const words = (n: number, w = "verse") => Array.from({ length: n }, () => w).join(" ");

const cookies: Record<string, string> = {};
let agentToken: string;
/** Names, emails, titles and text that no settings answer may contain. */
const markers: string[] = [];

type Config = ConferenceConfig;
type Json = Record<string, unknown>;
const at = (slug: string, rest: string) => `/api/conferences/${slug}/${rest}`;

async function person(email: string, name: string) {
  const cookie = await signIn(t, email);
  const res = await call(t.public, "PUT", "/api/me/profile", {
    cookie,
    body: {
      displayName: name,
      affiliation: null,
      country: null,
      languages: ["en"],
      pronouns: null,
      orcid: null,
      bios: {},
    },
  });
  expect(res.status).toBe(200);
  markers.push(name, email);
  return cookie;
}

const settings = async (who: string, slug = SLUG) =>
  call(t.public, "GET", at(slug, "settings"), { cookie: cookies[who] });

/** The stored configuration with `change` applied, and the token it was read with. */
async function edited(who: string, change: (config: Config) => void, slug = SLUG) {
  const got = await settings(who, slug);
  expect(got.status).toBe(200);
  const config = structuredClone(got.json.config) as Config;
  change(config);
  return { config, token: got.json.token as string };
}

const preview = (who: string, config: Config, token?: string) =>
  call(t.public, "POST", at(config.slug, "config/preview"), {
    cookie: cookies[who],
    ifMatch: token,
    body: config,
  });

const save = (who: string, config: Config, token: string) =>
  call(t.public, "PUT", at(config.slug, "config"), {
    cookie: cookies[who],
    ifMatch: token,
    body: config,
  });

const typeOf = (config: Config, key: string) => {
  const type = config.submissionTypes.find((x) => x.key === key);
  if (!type) throw new Error(`no format ${key}`);
  return type;
};

/**
 * A proposal of `typeKey` whose abstract is `count` times `word`; submitted unless `asDraft`.
 * The word is short: an abstract may hold eight characters for each word its format allows.
 */
async function proposal(
  who: string,
  typeKey: string,
  count: number,
  title: string,
  word: string,
  asDraft = false,
) {
  const cookie = cookies[who];
  const created = await call(t.public, "POST", at(SLUG, "submissions"), {
    cookie,
    body: { typeKey, language: "en", participationMode: "in_person" },
  });
  expect(created.status).toBe(201);
  const abstract = words(count, word);
  markers.push(title, `${word} ${word}`);
  const filled = await call(t.public, "PATCH", `/api/submissions/${created.json.id}`, {
    cookie,
    body: { version: created.json.version, title, abstract },
  });
  expect(filled.status).toBe(200);
  if (!asDraft) {
    const sent = await call(t.public, "POST", `/api/submissions/${created.json.id}/submit`, {
      cookie,
      body: { version: filled.json.version, acceptedAgreements: AGREEMENTS },
    });
    expect(sent.status).toBe(200);
  }
  return created.json.id as string;
}

const configAudit = () =>
  t.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.conferenceId, conferenceId),
        eq(auditLog.action, "conference.config_updated"),
      ),
    );

beforeAll(async () => {
  t = await makeTestApp();
  ({ conferenceId } = await seedTestCall(t.db, { slug: SLUG, now: NOW }));
  const roles = {
    admin: "admin",
    chair: "chair",
    track: "track_chair",
    reviewer: "reviewer",
  } as const;
  for (const [who, role] of Object.entries(roles)) {
    cookies[who] = await person(`settings-${who}@example.org`, `Zed ${who} Settingsperson`);
    await grantRole(t.db, {
      conferenceId,
      personId: await personId(t, `settings-${who}@example.org`),
      role,
    });
  }
  cookies.owner = await person("settings-owner@example.org", "Zora Ownerperson");
  agentToken = (
    await createApiToken(t.db, {
      personId: await personId(t, "settings-chair@example.org"),
      conferenceId,
      tier: "M",
      name: "settings test",
    })
  ).token;
}, 120_000);
afterAll(() => t.close());

describe("who may open and change the settings", () => {
  it("gives chairs the configuration, its token and the stage-one scope; admins, everything", async () => {
    const chair = await settings("chair");
    expect(chair.status).toBe(200);
    expect(chair.json).toMatchObject({ slug: SLUG, phase: "cfp_open", callOpen: true });
    expect(chair.json.scope).toBe("stage_one");
    expect(chair.json.token).toBe(configToken(ConferenceConfig.parse(chair.json.config)));
    expect((await settings("admin")).json.scope).toBe("all");
  });

  it("refuses a track chair, a reviewer, a submitter, the public and every agent", async () => {
    const { config, token } = await edited("chair", (c) => {
      c.host = "Universidad Inventada del Sur";
    });
    for (const who of ["track", "reviewer", "owner", "public"]) {
      expect((await settings(who)).status, who).toBe(403);
      expect((await preview(who, config, token)).status, who).toBe(403);
      expect((await save(who, config, token)).status, who).toBe(403);
    }
    // Configuration changes are human-only, even for the agent of a chair who could make them.
    for (const [method, path] of [
      ["GET", "settings"],
      ["POST", "config/preview"],
      ["PUT", "config"],
    ] as const) {
      const res = await call(t.public, method, at(SLUG, path), {
        token: agentToken,
        ifMatch: token,
        body: method === "GET" ? undefined : config,
      });
      expect(res.status, path).toBe(403);
    }
    expect((await settings("chair")).json.config.host).not.toBe("Universidad Inventada del Sur");
  });

  it("keeps a draft conference invisible to everyone but its chairs", async () => {
    const hidden = await saveConference(t.db, { ...fixtureCall, slug: "settings-hidden" }, "draft");
    const config = ConferenceConfig.parse({ ...fixtureCall, slug: "settings-hidden" });
    for (const who of ["chair", "reviewer", "owner", "public"]) {
      // Chairs of another conference are nobody here.
      expect((await settings(who, hidden.slug)).status, who).toBe(404);
      expect((await preview(who, config, configToken(config))).status, who).toBe(404);
      expect((await save(who, config, configToken(config))).status, who).toBe(404);
    }
    await grantRole(t.db, {
      conferenceId: hidden.id,
      personId: await personId(t, "settings-chair@example.org"),
      role: "chair",
    });
    expect((await settings("chair", hidden.slug)).status).toBe(200);
  });
});

describe("what a chair may change", () => {
  it("saves stage-one values, and audits each value that changed", async () => {
    const { config, token } = await edited("chair", (c) => {
      c.title.es = "Convocatoria de prueba, segunda edición";
      c.deadlines.notification = "2027-04-10T23:59:00-05:00";
      typeOf(c, "talk").abstract.maxWords = 320;
      typeOf(c, "talk").durationMinutes = 15;
      const needs = typeOf(c, "workshop").fields.find((f) => f.key === "needs");
      if (!needs) throw new Error("the fixture call's workshop has a needs field");
      needs.required = true;
      needs.label.en = "What the room needs";
      needs.help = { en: "Tables, power, a projector." };
    });
    const before = (await settings("chair")).json.config as Config;
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);
    expect(res.json.token).not.toBe(token);

    const open = await call(t.public, "GET", `/api/conferences/${SLUG}`);
    expect(typeOf(open.json.config, "talk").abstract.maxWords).toBe(320);
    expect(open.json.config.deadlines.notification).toBe("2027-04-10T23:59:00-05:00");
    expect((await settings("chair")).json.token).toBe(res.json.token);

    const entry = (await configAudit()).at(-1);
    expect(entry?.actorKind).toBe("human");
    expect(entry?.details).toEqual({
      draftsAffected: 0,
      changes: [
        { path: "title.es", before: before.title.es, after: config.title.es },
        {
          path: "deadlines.notification",
          before: before.deadlines.notification,
          after: "2027-04-10T23:59:00-05:00",
        },
        { path: "submissionTypes.talk.abstract.maxWords", before: 300, after: 320 },
        { path: "submissionTypes.talk.durationMinutes", before: 12, after: 15 },
        {
          path: "submissionTypes.workshop.fields.needs.label.en",
          before: "Technical needs and timeslot requirements",
          after: "What the room needs",
        },
        {
          path: "submissionTypes.workshop.fields.needs.help.en",
          after: "Tables, power, a projector.",
        },
        { path: "submissionTypes.workshop.fields.needs.required", before: false, after: true },
      ],
    });
  });

  it("refuses every kind of change that is an admin's, with the paths, and saves nothing", async () => {
    const cases: [string, (c: Config) => void, string[]][] = [
      [
        "a blind mode",
        (c) => {
          (c.reviewPools[0] as Config["reviewPools"][number]).blindMode = "open";
        },
        ["reviewPools.scientific.blindMode"],
      ],
      [
        "an agreement",
        (c) => {
          (c.agreements[0] as Config["agreements"][number]).version = "draft-2";
        },
        ["agreements.privacy.version"],
      ],
      [
        "an added format",
        (c) => {
          c.submissionTypes.push({ ...structuredClone(typeOf(c, "talk")), key: "poster" });
        },
        ["submissionTypes"],
      ],
      [
        "a removed field",
        (c) => {
          typeOf(c, "workshop").fields = [];
        },
        ["submissionTypes.workshop.fields"],
      ],
      [
        "a field that becomes identifying",
        (c) => {
          (typeOf(c, "workshop").fields[0] as { identifying: boolean }).identifying = true;
        },
        ["submissionTypes.workshop.fields.needs.identifying"],
      ],
      [
        "the languages and a new rule",
        (c) => {
          c.languages = ["en", "es"];
          c.rules.presenterCap = null;
        },
        ["languages", "rules.presenterCap"],
      ],
    ];
    const rowsBefore = (await configAudit()).length;
    for (const [what, change, paths] of cases) {
      const { config, token } = await edited("chair", change);
      const reviewed = await preview("chair", config, token);
      expect(reviewed.json.forbidden, what).toEqual(paths);
      expect(reviewed.json.canSave, what).toBe(false);
      const res = await save("chair", config, token);
      expect(res.status, what).toBe(403);
      expect(res.json, what).toEqual({ error: "forbidden", paths });
      expect((await settings("chair")).json.token, what).toBe(token);
    }
    expect((await configAudit()).length).toBe(rowsBefore);
  });

  it("does not refuse an admin", async () => {
    const { config, token } = await edited("admin", (c) => {
      typeOf(c, "exhibition").blindMode = "open";
    });
    expect((await preview("admin", config, token)).json).toMatchObject({
      scope: "all",
      forbidden: [],
      canSave: true,
    });
    expect((await save("admin", config, token)).status).toBe(200);
  });
});

describe("reviewing before saving", () => {
  it("previews the changed values and saves nothing", async () => {
    const rowsBefore = (await configAudit()).length;
    const { config, token } = await edited("chair", (c) => {
      c.contactEmail = "elsewhere@example.org";
      typeOf(c, "panel").team.max = 8;
    });
    const res = await preview("chair", config, token);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      token,
      stale: false,
      scope: "stage_one",
      issues: [],
      forbidden: [],
      blocked: null,
      canSave: true,
    });
    expect(res.json.changes).toEqual([
      { path: "contactEmail", before: "call@example.org", after: "elsewhere@example.org" },
      { path: "submissionTypes.panel.team.max", before: 6, after: 8 },
    ]);
    expect((await settings("chair")).json.token).toBe(token);
    expect((await configAudit()).length).toBe(rowsBefore);
    // Nothing changed is nothing to save.
    const same = await edited("chair", () => {});
    expect((await preview("chair", same.config, same.token)).json).toMatchObject({
      changes: [],
      canSave: false,
    });
  });

  const found = (json: { issues: { path: string; code: string; params?: Json }[] }) =>
    json.issues.map(({ path, code, params }) => ({ path, code, ...(params ? { params } : {}) }));

  it("names a value that cannot be what was typed, with a code for each", async () => {
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "panel").team.max = 0;
      typeOf(c, "talk").durationMinutes = 12.5;
      c.contactEmail = "not an address";
      c.website = "http://call.example.org/";
      c.dates.start = "3 August";
    });
    // The screen sends a number left blank as null.
    const body = structuredClone(config) as unknown as Json;
    ((body.submissionTypes as Json[])[1] as { abstract: Json }).abstract.maxWords = null;
    const res = await call(t.public, "POST", at(SLUG, "config/preview"), {
      cookie: cookies.chair,
      ifMatch: token,
      body,
    });
    expect(res.status).toBe(200);
    expect(res.json.canSave).toBe(false);
    expect(found(res.json).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "contactEmail", code: "email" },
      { path: "dates.start", code: "date" },
      { path: "submissionTypes.panel.team.max", code: "too_small", params: { min: 1 } },
      { path: "submissionTypes.talk.abstract.maxWords", code: "number_required" },
      { path: "submissionTypes.talk.durationMinutes", code: "whole_number" },
      { path: "website", code: "url" },
    ]);
    // The same body is refused by a save, as any malformed input is.
    const refused = await call(t.public, "PUT", at(SLUG, "config"), {
      cookie: cookies.chair,
      ifMatch: token,
      body,
    });
    expect(refused.status).toBe(400);
    expect((await settings("chair")).json.token).toBe(token);
  });

  it("names values that do not fit each other, beside the one to change", async () => {
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "talk").abstract.minWords = 400;
      typeOf(c, "panel").team.min = 9;
      c.deadlines.notification = "2027-01-01T00:00:00-05:00";
      c.dates.end = "2027-05-30";
    });
    // The screen sends a text left blank as no text at all.
    const body = structuredClone(config) as unknown as Json;
    delete (body.title as Json).en;
    const res = await call(t.public, "POST", at(SLUG, "config/preview"), {
      cookie: cookies.chair,
      ifMatch: token,
      body,
    });
    expect(res.json.canSave).toBe(false);
    expect(found(res.json).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "dates.end", code: "dates_order" },
      { path: "deadlines.notification", code: "deadline_order" },
      { path: "submissionTypes.panel.team.min", code: "min_over_max" },
      { path: "submissionTypes.talk.abstract.minWords", code: "min_over_max" },
      { path: "title.en", code: "default_language_required" },
    ]);
  });

  it("warns when a change closes the call now or moves a deadline into the past", async () => {
    const { config, token } = await edited("chair", (c) => {
      c.deadlines.submissionsClose = "2027-02-01T11:00:00Z";
    });
    const res = await preview("chair", config, token);
    expect(res.json.warnings).toEqual({
      drafts: 0,
      callOpens: false,
      callCloses: true,
      pastDeadlines: ["submissionsClose"],
    });
    expect(res.json.canSave).toBe(true);
    const later = await edited("chair", (c) => {
      c.deadlines.submissionsOpen = "2027-02-02T00:00:00Z";
    });
    expect((await preview("chair", later.config, later.token)).json.warnings).toMatchObject({
      callCloses: true,
      pastDeadlines: [],
    });
  });

  it("refuses a save based on a configuration that someone has since changed", async () => {
    const mine = await edited("chair", (c) => {
      c.host = "Universidad Inventada del Este";
    });
    const theirs = await edited("admin", (c) => {
      c.location.en = "Ciudad Imaginaria, Colombia";
    });
    const first = await save("admin", theirs.config, theirs.token);
    expect(first.status).toBe(200);
    expect((await preview("chair", mine.config, mine.token)).json).toMatchObject({
      stale: true,
      canSave: false,
      token: first.json.token,
    });
    const lost = await save("chair", mine.config, mine.token);
    expect(lost.status).toBe(409);
    expect(lost.json).toEqual({ error: "stale", token: first.json.token });
    const now = (await settings("chair")).json.config as Config;
    expect(now.location.en).toBe("Ciudad Imaginaria, Colombia");
    expect(now.host).not.toBe("Universidad Inventada del Este");
  });
});

describe("submitted work stays valid", () => {
  let theirs: string;
  let own: string;

  beforeAll(async () => {
    theirs = await proposal("owner", "talk", 260, "Zebra Crossing Title", "zzqa");
    // The chair's own proposal: counted, but never listed back to them.
    own = await proposal("chair", "talk", 265, "Quagga Stripes Title", "zzqb");
    await proposal("owner", "workshop", 270, "Okapi Workshop Draft", "zzqc", true);
  });

  it("refuses a change that would make a submitted proposal invalid, and saves nothing", async () => {
    const rowsBefore = (await configAudit()).length;
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "talk").abstract.maxWords = 255;
      c.host = "Universidad Inventada del Oeste";
    });
    const blocked = { count: 2, byCode: { too_many_words: 2 }, submissionIds: [theirs] };
    const reviewed = await preview("chair", config, token);
    expect(reviewed.json).toMatchObject({ blocked, canSave: false, forbidden: [], issues: [] });
    const res = await save("chair", config, token);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "submitted_work_invalid", blocked });
    expect(blocked.submissionIds).not.toContain(own);
    // The harmless half of the change was not saved either.
    expect((await settings("chair")).json.token).toBe(token);
    expect((await configAudit()).length).toBe(rowsBefore);
    // An admin is held to the same rule, and sees both proposals (neither is theirs).
    const asAdmin = await save("admin", config, token);
    expect(asAdmin.status).toBe(409);
    expect(asAdmin.json.blocked.submissionIds.sort()).toEqual([theirs, own].sort());
    for (const answer of [reviewed.json, res.json, asAdmin.json]) {
      expect(findLeaks(answer, markers)).toEqual([]);
    }
  });

  it("counts a proposal once however many problems it gains, and each problem by its code", async () => {
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "talk").abstract.maxWords = 262;
      typeOf(c, "talk").team.min = 2;
      typeOf(c, "talk").team.max = 3;
    });
    expect((await preview("chair", config, token)).json.blocked).toEqual({
      count: 2,
      byCode: { too_many_words: 1, team_size: 2 },
      submissionIds: [theirs],
    });
  });

  it("saves a change that leaves submitted work valid", async () => {
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "talk").abstract.maxWords = 400;
      typeOf(c, "talk").abstract.minWords = 100;
    });
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);
    expect(findLeaks(res.json, markers)).toEqual([]);
  });

  it("only warns about drafts, with their number", async () => {
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "workshop").abstract.maxWords = 260;
    });
    const reviewed = await preview("chair", config, token);
    expect(reviewed.json).toMatchObject({ blocked: null, canSave: true });
    expect(reviewed.json.warnings.drafts).toBe(1);
    expect(findLeaks(reviewed.json, markers)).toEqual([]);
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);
    expect(res.json.warnings.drafts).toBe(1);
    expect((await configAudit()).at(-1)?.details).toMatchObject({ draftsAffected: 1 });
  });

  it("ignores work that was withdrawn", async () => {
    const withdrawn = await proposal("owner", "performance", 400, "Withdrawn Gnu Title", "zzqd");
    const got = await call(t.public, "GET", `/api/submissions/${withdrawn}`, {
      cookie: cookies.owner,
    });
    const gone = await call(t.public, "POST", `/api/submissions/${withdrawn}/withdraw`, {
      cookie: cookies.owner,
      body: { version: got.json.version },
    });
    expect(gone.status).toBe(200);
    const { config, token } = await edited("chair", (c) => {
      typeOf(c, "performance").abstract.maxWords = 380;
      typeOf(c, "performance").abstract.minWords = 300;
    });
    expect((await preview("chair", config, token)).json).toMatchObject({
      blocked: null,
      canSave: true,
    });
  });
});

describe("a review never carries anyone's words (house rule 2)", () => {
  const config = ConferenceConfig.parse({ ...fixtureCall, slug: "leak-call" });
  const conference = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "leak-call",
    phase: "cfp_open",
    config,
  };
  const chair: PersonViewer = {
    kind: "person",
    personId: "00000000-0000-4000-8000-0000000000c1",
    siteAdmin: false,
    grants: [{ conferenceId: conference.id, role: "chair", scope: [] }],
  };
  const STATUSES: SubmissionStatus[] = ["draft", "submitted", "accepted", "withdrawn", "rejected"];

  /** A proposal whose every name, address, title and text carries a marker of its own. */
  function record(i: number, status: SubmissionStatus, typeKey: string, mine: boolean) {
    const mark = (what: string) => `MARK${what}${i}X`;
    const ownerId = mine
      ? chair.personId
      : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const owner: Person = {
      id: ownerId,
      email: `${mark("mail")}@example.org`.toLowerCase(),
      displayName: mark("name"),
      orcid: null,
      affiliation: mark("affiliation"),
      country: null,
      languages: ["en"],
      bios: { en: mark("bio") },
      pronouns: null,
    };
    const submission: Submission = {
      id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      conferenceId: conference.id,
      ownerPersonId: ownerId,
      version: 3,
      typeKey,
      trackKey: null,
      topicKeys: [],
      language: "en",
      title: mark("title"),
      abstract: words(260, mark("abstract")),
      fields: { needs: mark("field"), [mark("fieldkey").toLowerCase()]: mark("stray") },
      participationMode: "in_person",
      status,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      submittedAt: status === "draft" ? null : NOW.toISOString(),
    };
    const contributions: Contribution[] = [
      {
        submissionId: submission.id,
        personId: ownerId,
        role: "lead",
        position: 0,
        status: "confirmed",
        invitedEmail: null,
        invitedName: null,
        invitedAffiliation: null,
      },
    ];
    const rec: SubmissionRecord = {
      config,
      submission,
      contributions,
      assignments: [],
      conflicts: [],
      people: new Map([[ownerId, owner]]),
    };
    const all = [
      "mail",
      "name",
      "affiliation",
      "bio",
      "title",
      "abstract",
      "field",
      "fieldkey",
      "stray",
    ];
    return { rec, marks: all.flatMap((what) => [mark(what), mark(what).toLowerCase()]) };
  }

  it("answers in paths, codes, counts and IDs only, whatever the proposals hold", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom(...STATUSES),
            typeKey: fc.constantFrom(...config.submissionTypes.map((x) => x.key), "gone"),
            mine: fc.boolean(),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 1, max: 400 }),
        fc.boolean(),
        (specs, maxWords, dropFields) => {
          const built = specs.map((s, i) => record(i + 1, s.status, s.typeKey, s.mine));
          const next = structuredClone(config);
          for (const type of next.submissionTypes) {
            type.abstract.maxWords = maxWords;
            type.abstract.minWords = Math.min(type.abstract.minWords ?? 0, maxWords);
            type.team = { min: 2, max: 3 };
            if (dropFields) type.fields = [];
            // Something no proposal has, so that each one of a format that exists gains a problem.
            type.fields.push({
              key: "extra",
              label: { en: "Extra" },
              kind: "text",
              required: true,
              identifying: false,
              public: false,
            });
          }
          const { review } = reviewConfig({
            viewer: chair,
            conference,
            records: built.map((b) => b.rec),
            input: next,
            base: null,
            now: NOW,
          });
          expect(
            findLeaks(
              review,
              built.flatMap((b) => b.marks),
            ),
          ).toEqual([]);
          const known = built.filter((b) => b.rec.submission.typeKey !== "gone");
          const live = known.filter((b) =>
            ["submitted", "accepted"].includes(b.rec.submission.status),
          );
          expect(review.blocked?.count ?? 0).toBe(live.length);
          expect(review.warnings.drafts).toBe(
            known.filter((b) => b.rec.submission.status === "draft").length,
          );
          // Their own work is counted and never listed back to them.
          expect(review.blocked?.submissionIds ?? []).toEqual(
            live
              .filter((b) => b.rec.submission.ownerPersonId !== chair.personId)
              .map((b) => b.rec.submission.id),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("the conference row is the lock", () => {
  it("lets one of two saves from the same configuration through, never both", async () => {
    const { conferenceId: id, slug } = await seedTestCall(t.db, {
      slug: "settings-race",
      now: NOW,
    });
    for (const who of ["admin", "chair"]) {
      await grantRole(t.db, {
        conferenceId: id,
        personId: await personId(t, `settings-${who}@example.org`),
        role: who as "admin" | "chair",
      });
    }
    const a = await edited(
      "chair",
      (c) => {
        c.host = "Sede A";
      },
      slug,
    );
    const b = await edited(
      "admin",
      (c) => {
        c.host = "Sede B";
      },
      slug,
    );
    const results = await Promise.all([
      save("chair", a.config, a.token),
      save("admin", b.config, b.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await getConference(t.db, slug);
    const winner = results.find((r) => r.status === 200);
    expect(stored?.config.host).toBe(winner?.json.config.host);
    expect(results.find((r) => r.status === 409)?.json.error).toBe("stale");
  });
});
