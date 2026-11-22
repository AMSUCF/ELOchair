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
import { assignmentReleases, assignments, auditLog } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { createApiToken, getConference, grantRole, saveConference } from "./repo";
import { configIssues, configToken, reviewConfig } from "./services/settings";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Conference settings (spec 02, §1.9): a chair may save any valid configuration, as an admin
 * may (they are one group); nobody else and no agent. A save is reviewed first, never makes
 * submitted work invalid, never shows a reviewer who wrote a proposal they were assigned as
 * anonymized, is refused when it is based on an older configuration, and is audited value by
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

const fieldOf = (config: Config, typeKey: string, key: string) => {
  const field = typeOf(config, typeKey).fields.find((x) => x.key === key);
  if (!field) throw new Error(`no field ${typeKey}.${key}`);
  return field;
};

const poolOf = (config: Config, key: string) => {
  const pool = config.reviewPools.find((x) => x.key === key);
  if (!pool) throw new Error(`no review pool ${key}`);
  return pool;
};

const criterionOf = (config: Config, poolKey: string, key: string) => {
  const criterion = poolOf(config, poolKey).criteria.find((x) => x.key === key);
  if (!criterion) throw new Error(`no criterion ${poolKey}.${key}`);
  return criterion;
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
  slug = SLUG,
) {
  const cookie = cookies[who];
  const created = await call(t.public, "POST", at(slug, "submissions"), {
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

const configAudit = (of = conferenceId) =>
  t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.conferenceId, of), eq(auditLog.action, "conference.config_updated")));

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
  it("gives a chair and an admin the same thing: the configuration and its token", async () => {
    const chair = await settings("chair");
    expect(chair.status).toBe(200);
    expect(chair.json).toMatchObject({ slug: SLUG, phase: "cfp_open", callOpen: true });
    expect(chair.json.token).toBe(configToken(ConferenceConfig.parse(chair.json.config)));
    // Nothing says what this person may change: every chair may change all of it.
    expect(Object.keys(chair.json).sort()).toEqual([
      "callOpen",
      "config",
      "phase",
      "slug",
      "token",
    ]);
    const admin = await settings("admin");
    expect(admin.status).toBe(200);
    expect(admin.json).toEqual(chair.json);
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
  it("saves the values the screen offers, and audits each value that changed", async () => {
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

  it("saves the review values the screen offers, and audits each value that changed", async () => {
    const before = await settings("chair");
    const guidelines = {
      en: "Read the artist statement first.\n\nThen the technical requirements.",
      es: "Lee primero la declaración artística.",
    };
    const { config, token } = await edited("chair", (c) => {
      const pool = poolOf(c, "artistic");
      pool.name.es = "Jurado artístico";
      // From names shown to anonymized: allowed at any time.
      pool.blindMode = "double";
      pool.reviewsPerSubmission = 4;
      pool.guidelines = guidelines;
      const merit = criterionOf(c, "artistic", "merit");
      merit.label.en = "Artistic and literary merit";
      merit.min = 0;
      merit.max = 10;
    });
    const changes = [
      {
        path: "reviewPools.artistic.name.es",
        before: "Comité artístico",
        after: "Jurado artístico",
      },
      { path: "reviewPools.artistic.blindMode", before: "single", after: "double" },
      { path: "reviewPools.artistic.reviewsPerSubmission", before: 2, after: 4 },
      { path: "reviewPools.artistic.guidelines.en", after: guidelines.en },
      { path: "reviewPools.artistic.guidelines.es", after: guidelines.es },
      {
        path: "reviewPools.artistic.criteria.merit.label.en",
        before: "Artistic merit",
        after: "Artistic and literary merit",
      },
      { path: "reviewPools.artistic.criteria.merit.min", before: 1, after: 0 },
      { path: "reviewPools.artistic.criteria.merit.max", before: 5, after: 10 },
    ];
    expect((await preview("chair", config, token)).json).toMatchObject({
      changes,
      issues: [],
      blocked: null,
      canSave: true,
    });
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);

    // Stored as written, line breaks and all: the reviewer's page reads them from here.
    const open = await call(t.public, "GET", `/api/conferences/${SLUG}`);
    expect(poolOf(open.json.config, "artistic")).toMatchObject({
      blindMode: "double",
      reviewsPerSubmission: 4,
      guidelines,
    });
    expect(criterionOf(open.json.config, "artistic", "merit")).toMatchObject({ min: 0, max: 10 });
    const entry = (await configAudit()).at(-1);
    expect(entry?.actorKind).toBe("human");
    expect(entry?.details).toEqual({ draftsAffected: 0, changes });

    // Put back for the tests below. Guidelines that are cleared leave none, and that is audited.
    const back = await save("chair", before.json.config, res.json.token);
    expect(back.status).toBe(200);
    expect(back.json.token).toBe(before.json.token);
    expect(poolOf(back.json.config, "artistic")).not.toHaveProperty("guidelines");
    const undone = (await configAudit()).at(-1)?.details as { changes: { path: string }[] };
    expect(undone.changes).toEqual(
      changes.map(({ path, before: was, after: now }) => ({
        path,
        before: now,
        ...(was === undefined ? {} : { after: was }),
      })),
    );
  });

  it("saves the invitation's texts and the wording of a way to contribute, and audits each value", async () => {
    // The fixture call with an invitation of its own, in made-up words.
    const slug = "settings-inviting";
    const inviting = await saveConference(
      t.db,
      {
        ...fixtureCall,
        slug,
        invitation: { en: "Bring what you made." },
        contributionGroups: [
          {
            key: "spoken",
            name: { en: "Speaking" },
            summary: { en: "Panels and talks." },
            formats: ["panel", "talk"],
          },
        ],
      },
      "cfp_open",
    );
    await grantRole(t.db, {
      conferenceId: inviting.id,
      personId: await personId(t, "settings-chair@example.org"),
      role: "chair",
    });
    const distinction = {
      en: "The Test Society's first meeting on the coast",
      es: "El primer encuentro de la Sociedad de Prueba en la costa",
    };
    const { config, token } = await edited(
      "chair",
      (c) => {
        c.distinction = distinction;
        c.invitation = { en: "Bring what you made.\nWe will listen.", es: "Trae lo que hiciste." };
        const group = c.contributionGroups[0];
        if (!group) throw new Error("the conference has a way to contribute");
        group.name.es = "Hablar";
        group.summary.en = "Panels, and talks of every length.";
      },
      slug,
    );
    // Named in the order of the configuration.
    const changes = [
      { path: "distinction.en", after: distinction.en },
      { path: "distinction.es", after: distinction.es },
      {
        path: "invitation.en",
        before: "Bring what you made.",
        after: "Bring what you made.\nWe will listen.",
      },
      { path: "invitation.es", after: "Trae lo que hiciste." },
      { path: "contributionGroups.spoken.name.es", after: "Hablar" },
      {
        path: "contributionGroups.spoken.summary.en",
        before: "Panels and talks.",
        after: "Panels, and talks of every length.",
      },
    ];
    expect((await preview("chair", config, token)).json).toMatchObject({
      changes,
      issues: [],
      blocked: null,
      canSave: true,
    });
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);

    // Stored as written: the front page and the conference's page read them from here.
    const open = await call(t.public, "GET", `/api/conferences/${slug}`);
    expect(open.json.config).toMatchObject({
      distinction,
      invitation: { en: "Bring what you made.\nWe will listen.", es: "Trae lo que hiciste." },
      contributionGroups: [
        {
          key: "spoken",
          name: { en: "Speaking", es: "Hablar" },
          summary: { en: "Panels, and talks of every length." },
          formats: ["panel", "talk"],
        },
      ],
    });
    const entry = (await configAudit(inviting.id)).at(-1);
    expect(entry?.actorKind).toBe("human");
    expect(entry?.details).toEqual({ draftsAffected: 0, changes });

    // Which formats a way to contribute leads to is no setting of the screen, but a save is
    // held to it all the same: a format the call does not offer is refused, and named.
    const regrouped = await edited(
      "chair",
      (c) => {
        const group = c.contributionGroups[0];
        if (!group) throw new Error("the conference has a way to contribute");
        group.formats = ["panel", "poster"];
      },
      slug,
    );
    const refused = await preview("chair", regrouped.config, regrouped.token);
    expect(refused.json.canSave).toBe(false);
    expect(refused.json.issues).toMatchObject([
      { path: "contributionGroups.spoken.formats.1", code: "invalid" },
    ]);
    expect(refused.json.issues).toHaveLength(1);
    expect((await save("chair", regrouped.config, regrouped.token)).status).toBe(400);
    expect((await settings("chair", slug)).json.token).toBe(res.json.token);
  });

  it("saves every kind of change that used to be an admin's, and audits each one", async () => {
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
      [
        // The schema accepts the extra texts; the conference has English, Spanish, Portuguese.
        "texts in a language the conference does not have",
        (c) => {
          c.title.fr = "Rencontre inventée";
          typeOf(c, "talk").name.fr = "Exposé";
        },
        ["title.fr", "submissionTypes.talk.name.fr"],
      ],
      [
        // The schema takes a word limit on any field; only a text field has one to set.
        "a word limit on a field that is not text",
        (c) => {
          fieldOf(c, "performance", "work_url").maxWords = 12;
          fieldOf(c, "exhibition", "work_url").maxWords = 12;
        },
        [
          "submissionTypes.performance.fields.work_url.maxWords",
          "submissionTypes.exhibition.fields.work_url.maxWords",
        ],
      ],
    ];
    for (const [what, change, paths] of cases) {
      const before = await settings("chair");
      const rowsBefore = (await configAudit()).length;
      const { config, token } = await edited("chair", change);
      const reviewed = await preview("chair", config, token);
      expect(
        reviewed.json.changes.map((c: { path: string }) => c.path),
        what,
      ).toEqual(paths);
      expect(reviewed.json.canSave, what).toBe(true);
      // A review no longer says what a chair may not change: there is no such thing.
      expect(reviewed.json, what).not.toHaveProperty("forbidden");
      expect(reviewed.json, what).not.toHaveProperty("scope");
      const res = await save("chair", config, token);
      expect(res.status, what).toBe(200);
      expect(res.json.config, what).toEqual(ConferenceConfig.parse(config));
      const stored = await settings("chair");
      expect(stored.json.token, what).toBe(res.json.token);
      expect(stored.json.token, what).not.toBe(token);
      const rows = await configAudit();
      expect(rows.length, what).toBe(rowsBefore + 1);
      const entry = rows.at(-1);
      expect(entry?.actorKind, what).toBe("human");
      const audited = entry?.details as { changes: { path: string }[] } | undefined;
      expect(
        audited?.changes.map((c) => c.path),
        what,
      ).toEqual(paths);
      // Put back, by the chair again (which adds back the format, the field, the language and
      // the rule that were taken away), so that the tests below find the call as it was.
      const back = await save("chair", before.json.config, res.json.token);
      expect(back.status, what).toBe(200);
      expect(back.json.token, what).toBe(before.json.token);
    }
  });

  it("gives a chair and an admin the same review of the same change, and saves it for either", async () => {
    const { config, token } = await edited("admin", (c) => {
      typeOf(c, "exhibition").blindMode = "open";
    });
    const asAdmin = await preview("admin", config, token);
    expect(asAdmin.json).toMatchObject({
      changes: [{ path: "submissionTypes.exhibition.blindMode", after: "open" }],
      canSave: true,
    });
    expect(asAdmin.json).not.toHaveProperty("scope");
    expect(asAdmin.json).not.toHaveProperty("forbidden");
    expect((await preview("chair", config, token)).json).toEqual(asAdmin.json);
    // The admin role still works, and means what the chair role means.
    expect((await save("admin", config, token)).status).toBe(200);
  });

  it("lets a chair write a text in a language the conference does not have", async () => {
    // Through the API: the screen has no control for it (packages/schema settings.test.ts).
    const { config, token } = await edited("chair", (c) => {
      c.title.fr = "Rencontre inventée";
    });
    const reviewed = await preview("chair", config, token);
    expect(reviewed.json).toMatchObject({
      changes: [{ path: "title.fr", after: "Rencontre inventée" }],
      canSave: true,
    });
    expect((await preview("admin", config, token)).json).toEqual(reviewed.json);
  });

  it("lets a chair give a field a value its kind does not have, as the schema allows", async () => {
    const path = "submissionTypes.performance.fields.work_url.maxWords";
    const { config, token } = await edited("chair", (c) => {
      fieldOf(c, "performance", "work_url").maxWords = 12;
    });
    const reviewed = await preview("chair", config, token);
    expect(reviewed.json).toMatchObject({ changes: [{ path, after: 12 }], canSave: true });
    expect((await preview("admin", config, token)).json).toEqual(reviewed.json);
    // And a text field's word limit, which the screen does offer.
    const own = await edited("chair", (c) => {
      fieldOf(c, "workshop", "needs").maxWords = 150;
    });
    expect((await preview("chair", own.config, own.token)).json).toMatchObject({
      changes: [{ path: "submissionTypes.workshop.fields.needs.maxWords", after: 150 }],
      canSave: true,
    });
  });

  it("lets a chair clear a text, or write one, in a language the conference has", async () => {
    const cleared = await edited("chair", (c) => {
      delete c.location.pt;
    });
    expect((await preview("chair", cleared.config, cleared.token)).json).toMatchObject({
      changes: [{ path: "location.pt" }],
      canSave: true,
    });
    const written = await edited("chair", (c) => {
      typeOf(c, "workshop").fields[0] = {
        ...(typeOf(c, "workshop").fields[0] as Config["submissionTypes"][number]["fields"][number]),
        help: { en: "What the room must have.", es: "Lo que debe tener la sala." },
      };
    });
    const reviewed = await preview("chair", written.config, written.token);
    expect(reviewed.json).toMatchObject({ canSave: true });
    expect(reviewed.json.changes.map((c: { path: string }) => c.path)).toEqual([
      "submissionTypes.workshop.fields.needs.help.en",
      "submissionTypes.workshop.fields.needs.help.es",
    ]);
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
      issues: [],
      blocked: null,
      canSave: true,
    });
    // All that a review holds: nothing about who may change what.
    expect(Object.keys(res.json).sort()).toEqual([
      "blocked",
      "canSave",
      "changes",
      "issues",
      "stale",
      "token",
      "warnings",
    ]);
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

  it("names a review value that cannot be what was typed, beside it", async () => {
    const { config, token } = await edited("chair", (c) => {
      poolOf(c, "scientific").reviewsPerSubmission = 11;
      poolOf(c, "artistic").reviewsPerSubmission = 0;
      criterionOf(c, "scientific", "clarity").max = 4.5;
    });
    // A mode the conference cannot have, as a tampered form would send it.
    const body = structuredClone(config) as unknown as Json;
    ((body.reviewPools as Json[])[1] as Json).blindMode = "triple";
    const res = await call(t.public, "POST", at(SLUG, "config/preview"), {
      cookie: cookies.chair,
      ifMatch: token,
      body,
    });
    expect(res.json.canSave).toBe(false);
    expect(found(res.json).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "reviewPools.artistic.blindMode", code: "invalid" },
      { path: "reviewPools.artistic.reviewsPerSubmission", code: "too_small", params: { min: 1 } },
      { path: "reviewPools.scientific.criteria.clarity.max", code: "whole_number" },
      { path: "reviewPools.scientific.reviewsPerSubmission", code: "too_big", params: { max: 10 } },
    ]);

    // Values that do not fit: guidelines without the main language, a scale with one score.
    const unfit = await edited("chair", (c) => {
      poolOf(c, "scientific").guidelines = { es: "Solo en español." };
      criterionOf(c, "scientific", "fit").min = 5;
      criterionOf(c, "artistic", "merit").max = 0;
    });
    const refused = await preview("chair", unfit.config, unfit.token);
    expect(refused.json.canSave).toBe(false);
    expect(found(refused.json).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "reviewPools.artistic.criteria.merit.min", code: "min_not_below_max" },
      { path: "reviewPools.scientific.criteria.fit.min", code: "min_not_below_max" },
      { path: "reviewPools.scientific.guidelines.en", code: "default_language_required" },
    ]);
    expect((await save("chair", unfit.config, unfit.token)).status).toBe(400);
    expect((await settings("chair")).json.token).toBe(token);
  });

  it("names a whole-number field with no whole number between its ends, beside the smallest", () => {
    // The fixture call has no number field: the settings screen changes one where a call has it.
    const input = structuredClone(fixtureCall);
    const type = input.submissionTypes[0];
    if (!type) throw new Error("the fixture call has no format");
    type.fields = [
      ...(type.fields ?? []),
      { key: "seats", label: { en: "Seats" }, kind: "number", integer: true, min: 15.1, max: 15.9 },
    ];
    const parsed = ConferenceConfig.safeParse(input);
    if (parsed.success) throw new Error("the configuration should be refused");
    expect(configIssues(parsed.error, input).map(({ path, code }) => ({ path, code }))).toEqual([
      { path: `submissionTypes.${type.key}.fields.seats.min`, code: "no_whole_number" },
    ]);
    // A whole number between the ends, and the same configuration is fine.
    const seats = type.fields.at(-1);
    if (seats) seats.max = 16;
    expect(ConferenceConfig.safeParse(input).success).toBe(true);
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
    expect(reviewed.json).toMatchObject({ blocked, canSave: false, issues: [] });
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

  it("holds a chair to it beyond what the screen offers: a format in use cannot be removed", async () => {
    const rowsBefore = (await configAudit()).length;
    const { config, token } = await edited("chair", (c) => {
      c.submissionTypes = c.submissionTypes.filter((type) => type.key !== "talk");
    });
    // Both submitted talks would be of a format the conference no longer has.
    const blocked = { count: 2, byCode: { unknown_type: 2 }, submissionIds: [theirs] };
    const reviewed = await preview("chair", config, token);
    expect(reviewed.json).toMatchObject({
      changes: [{ path: "submissionTypes" }],
      blocked,
      canSave: false,
      issues: [],
    });
    const res = await save("chair", config, token);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "submitted_work_invalid", blocked });
    expect((await settings("chair")).json.token).toBe(token);
    expect((await configAudit()).length).toBe(rowsBefore);
    expect(findLeaks([reviewed.json, res.json], markers)).toEqual([]);
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

describe("an anonymized review that has begun stays anonymized", () => {
  const GUARD = "settings-anonymized";
  const POOL = "reviewPools.scientific.blindMode";
  let guardId: string;
  let talk: string;
  let workshop: string;
  let performance: string;

  /**
   * This call is still open, so no chair can assign yet (spec 03, §1.3): the row is written as
   * the route that assigns writes it. assignments.test.ts makes them through the route.
   */
  const assign = async (submissionId: string) => {
    await t.db.insert(assignments).values({
      conferenceId: guardId,
      reviewerId: await personId(t, "settings-reviewer@example.org"),
      submissionId,
    });
  };
  const refusal = (...paths: string[]) =>
    paths.map((path) => ({ path, code: "reviewers_assigned" }));
  const found = (json: { issues: { path: string; code: string }[] }) =>
    json.issues.map(({ path, code }) => ({ path, code }));
  const changed = (change: (c: Config) => void) => edited("chair", change, GUARD);

  beforeAll(async () => {
    ({ conferenceId: guardId } = await seedTestCall(t.db, { slug: GUARD, now: NOW }));
    await grantRole(t.db, {
      conferenceId: guardId,
      personId: await personId(t, "settings-chair@example.org"),
      role: "chair",
    });
    // The fixture call reviews talks and workshops anonymized, performances with names shown.
    talk = await proposal("owner", "talk", 260, "Ibis Talk Title", "zzra", false, GUARD);
    workshop = await proposal("owner", "workshop", 265, "Heron Shop Title", "zzrb", false, GUARD);
    performance = await proposal(
      "owner",
      "performance",
      400,
      "Egret Act Title",
      "zzrc",
      false,
      GUARD,
    );
  });

  it("allows names to be shown while no proposal has a reviewer", async () => {
    for (const mode of ["single", "open"] as const) {
      const { config, token } = await changed((c) => {
        poolOf(c, "scientific").blindMode = mode;
      });
      const reviewed = await preview("chair", config, token);
      expect(reviewed.json, mode).toMatchObject({
        changes: [{ path: POOL, before: "double", after: mode }],
        issues: [],
        canSave: true,
      });
      const res = await save("chair", config, token);
      expect(res.status, mode).toBe(200);
      // And back to anonymized, which is allowed at any time.
      const back = await changed((c) => {
        poolOf(c, "scientific").blindMode = "double";
      });
      expect((await save("chair", back.config, back.token)).status, mode).toBe(200);
    }
  });

  it("leaves a format with a mode of its own out of its pool's", async () => {
    // Workshops are given their own mode, anonymized, and a workshop gets a reviewer.
    const own = await changed((c) => {
      typeOf(c, "workshop").blindMode = "double";
    });
    expect((await save("chair", own.config, own.token)).status).toBe(200);
    await assign(workshop);
    // The pool's mode does not reach workshops, and no other proposal of the pool has a reviewer.
    const { config, token } = await changed((c) => {
      poolOf(c, "scientific").blindMode = "open";
    });
    expect((await preview("chair", config, token)).json).toMatchObject({
      changes: [{ path: POOL, before: "double", after: "open" }],
      issues: [],
      canSave: true,
    });
    // The workshops' own mode is what would show their authors: that is refused, at that value.
    for (const change of [
      (c: Config) => {
        typeOf(c, "workshop").blindMode = "single";
      },
      (c: Config) => {
        delete typeOf(c, "workshop").blindMode;
        poolOf(c, "scientific").blindMode = "open";
      },
    ]) {
      const bared = await changed(change);
      const reviewed = await preview("chair", bared.config, bared.token);
      expect(found(reviewed.json)).toEqual(refusal("submissionTypes.workshop.blindMode"));
      expect(reviewed.json.canSave).toBe(false);
      expect((await save("chair", bared.config, bared.token)).status).toBe(409);
    }
  });

  it("refuses to show names once a proposal of the pool has a reviewer, in the review and in the save", async () => {
    await assign(talk);
    const rowsBefore = (await configAudit(guardId)).length;
    for (const mode of ["single", "open"] as const) {
      const { config, token } = await changed((c) => {
        poolOf(c, "scientific").blindMode = mode;
        c.host = "Universidad Inventada del Centro";
      });
      // The review says what would change, and names the value that cannot.
      const reviewed = await preview("chair", config, token);
      expect(reviewed.status, mode).toBe(200);
      expect(reviewed.json, mode).toMatchObject({
        changes: [{ path: "host" }, { path: POOL, before: "double", after: mode }],
        blocked: null,
        canSave: false,
      });
      expect(found(reviewed.json), mode).toEqual(refusal(POOL));
      const res = await save("chair", config, token);
      expect(res.status, mode).toBe(409);
      expect(res.json.error, mode).toBe("reviewers_assigned");
      expect(found(res.json), mode).toEqual(refusal(POOL));
      // Nothing was saved, the harmless half of the change included.
      expect((await settings("chair", GUARD)).json.token, mode).toBe(token);
      expect(findLeaks([reviewed.json, res.json], markers), mode).toEqual([]);
    }
    expect((await configAudit(guardId)).length).toBe(rowsBefore);
    // Everything else about the pool can still be changed.
    const other = await changed((c) => {
      poolOf(c, "scientific").reviewsPerSubmission = 2;
      poolOf(c, "scientific").guidelines = { en: "Judge the proposal, not its author." };
    });
    expect((await preview("chair", other.config, other.token)).json).toMatchObject({
      issues: [],
      canSave: true,
    });
  });

  it("refuses the same through a format: a mode of its own, or another pool", async () => {
    const cases: [string, (c: Config) => void, string][] = [
      [
        "its own mode",
        (c) => {
          typeOf(c, "talk").blindMode = "open";
        },
        "submissionTypes.talk.blindMode",
      ],
      [
        "a pool that shows names",
        (c) => {
          typeOf(c, "talk").reviewPool = "artistic";
        },
        "submissionTypes.talk.reviewPool",
      ],
    ];
    for (const [what, change, path] of cases) {
      const { config, token } = await changed(change);
      const reviewed = await preview("chair", config, token);
      expect(found(reviewed.json), what).toEqual(refusal(path));
      expect(reviewed.json.canSave, what).toBe(false);
      const res = await save("chair", config, token);
      expect(res.status, what).toBe(409);
      expect(found(res.json), what).toEqual(refusal(path));
    }
    // A talk that keeps its anonymity may move: its own mode says so, whatever the pool's.
    const kept = await changed((c) => {
      typeOf(c, "talk").reviewPool = "artistic";
      typeOf(c, "talk").blindMode = "double";
    });
    expect((await preview("chair", kept.config, kept.token)).json).toMatchObject({
      issues: [],
      canSave: true,
    });
  });

  it("allows the other way with reviewers assigned, and bios where names are shown already", async () => {
    await assign(performance);
    // The rule protects anonymity and nothing more: here the authors are named already.
    const more = await changed((c) => {
      poolOf(c, "artistic").blindMode = "open";
    });
    expect((await preview("chair", more.config, more.token)).json).toMatchObject({
      issues: [],
      canSave: true,
    });
    // From names shown to anonymized.
    const { config, token } = await changed((c) => {
      poolOf(c, "artistic").blindMode = "double";
    });
    expect((await preview("chair", config, token)).json).toMatchObject({
      changes: [{ path: "reviewPools.artistic.blindMode", before: "single", after: "double" }],
      issues: [],
      canSave: true,
    });
    const res = await save("chair", config, token);
    expect(res.status).toBe(200);
    expect((await configAudit(guardId)).at(-1)?.details).toMatchObject({
      changes: [{ path: "reviewPools.artistic.blindMode", before: "single", after: "double" }],
    });
    // It is anonymized now, with a reviewer assigned: it stays so.
    const again = await changed((c) => {
      poolOf(c, "artistic").blindMode = "single";
    });
    expect(found((await preview("chair", again.config, again.token)).json)).toEqual(
      refusal("reviewPools.artistic.blindMode"),
    );
  });

  it("still counts an assignment that was released: the reviewer may have read it, and can be assigned again", async () => {
    // Every assignment of the conference is released, for each of the reasons there are: its
    // row leaves `assignments`, and its record is written to `assignment_releases`. A released
    // assignment counts nowhere else; here it does (spec 03, §1.3), or a chair could release
    // the reviewers, show names, and assign the same people again.
    const rows = await t.db.select().from(assignments).where(eq(assignments.conferenceId, guardId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const reasons = ["chair", "conflict", "expertise", "time", "role_removed"] as const;
    await t.db.delete(assignments).where(eq(assignments.conferenceId, guardId));
    await t.db.insert(assignmentReleases).values(
      rows.map((row, i) => ({
        conferenceId: row.conferenceId,
        submissionId: row.submissionId,
        reviewerId: row.reviewerId,
        assignmentId: row.id,
        assignedAt: row.createdAt,
        releasedAt: NOW,
        reason: reasons[i % reasons.length] ?? "chair",
      })),
    );
    expect(
      await t.db.select().from(assignments).where(eq(assignments.conferenceId, guardId)),
    ).toEqual([]);
    try {
      // Nobody reviews anything now: a chair's list of the proposals says so.
      const listed = await call(t.public, "GET", `/api/conferences/${GUARD}/submissions`, {
        cookie: cookies.chair,
      });
      expect(
        listed.json.items.flatMap((x: { assignedReviewerIds: string[] }) => x.assignedReviewerIds),
      ).toEqual([]);
      // The pool whose talk had a reviewer still cannot show names, in the review or the save.
      const { config, token } = await changed((c) => {
        poolOf(c, "scientific").blindMode = "single";
      });
      const reviewed = await preview("chair", config, token);
      expect(found(reviewed.json)).toEqual(refusal(POOL));
      expect(reviewed.json.canSave).toBe(false);
      const res = await save("chair", config, token);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("reviewers_assigned");
      expect((await settings("chair", GUARD)).json.token).toBe(token);
    } finally {
      // Assigned again, as the tests above left them.
      await t.db.delete(assignmentReleases).where(eq(assignmentReleases.conferenceId, guardId));
      await t.db.insert(assignments).values(rows);
    }
    // With no record of a release and nobody assigned, the same change would be taken: it is
    // the record that the guard read.
    await t.db.delete(assignments).where(eq(assignments.conferenceId, guardId));
    try {
      const { config, token } = await changed((c) => {
        poolOf(c, "scientific").blindMode = "single";
      });
      expect((await preview("chair", config, token)).json).toMatchObject({
        issues: [],
        canSave: true,
      });
    } finally {
      await t.db.insert(assignments).values(rows);
    }
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

  /**
   * A proposal whose every name, address, title and text carries a marker of its own. It has a
   * reviewer (`assigned: "now"`), had one whose assignment was released (`"before"`: the record
   * holds no assignment, as the loader would give it), or never had one.
   */
  function record(
    i: number,
    status: SubmissionStatus,
    typeKey: string,
    mine: boolean,
    assigned: "now" | "before" | "never",
  ) {
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
      phase: conference.phase,
      submission,
      contributions,
      assignments:
        assigned === "now"
          ? [
              {
                id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
                conferenceId: conference.id,
                reviewerId: `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
                submissionId: submission.id,
                createdAt: NOW.toISOString(),
                dueAt: null,
                assignedByPersonId: null,
              },
            ]
          : [],
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
    return {
      rec,
      /** It has, or has had, a reviewer. */
      ever: assigned !== "never",
      marks: all.flatMap((what) => [mark(what), mark(what).toLowerCase()]),
    };
  }

  it("answers in paths, codes, counts and IDs only, whatever the proposals hold", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom(...STATUSES),
            typeKey: fc.constantFrom(...config.submissionTypes.map((x) => x.key), "gone"),
            mine: fc.boolean(),
            assigned: fc.constantFrom("now" as const, "before" as const, "never" as const),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 1, max: 400 }),
        fc.boolean(),
        fc.array(fc.constantFrom("double", "single", "open"), {
          minLength: config.reviewPools.length,
          maxLength: config.reviewPools.length,
        }),
        (specs, maxWords, dropFields, modes) => {
          const built = specs.map((s, i) => record(i + 1, s.status, s.typeKey, s.mine, s.assigned));
          const next = structuredClone(config);
          next.reviewPools.forEach((pool, i) => {
            pool.blindMode = modes[i] ?? pool.blindMode;
          });
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
            everAssigned: new Set(built.filter((b) => b.ever).map((b) => b.rec.submission.id)),
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
          // A pool that was anonymized and would show names is named exactly when one of its
          // proposals has, or has had, a reviewer: an assignment that was released still counts
          // (no format of the fixture call has a mode of its own).
          const reviewedBy = (typeKey: string) =>
            config.submissionTypes.find((x) => x.key === typeKey)?.reviewPool;
          const promised = config.reviewPools
            .filter(
              (pool, i) =>
                pool.blindMode === "double" &&
                modes[i] !== "double" &&
                built.some((b) => b.ever && reviewedBy(b.rec.submission.typeKey) === pool.key),
            )
            .map((pool) => ({
              path: `reviewPools.${pool.key}.blindMode`,
              code: "reviewers_assigned",
            }));
          expect(review.issues.map(({ path, code }) => ({ path, code }))).toEqual(promised);
          if (promised.length > 0) expect(review.canSave).toBe(false);
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
