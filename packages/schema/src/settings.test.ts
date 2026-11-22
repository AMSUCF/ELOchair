import { describe, expect, it } from "vitest";
import * as conferences from "./conferences";
import { ConferenceConfig, type ConferenceConfigInput } from "./config";
import { REVIEW_EMAILS } from "./limits";
import { MAIL_LANGUAGES, MESSAGE_KEYS, MESSAGES } from "./messages";
import { reviewReminderDays, reviewReminderWindow } from "./notifications";
import {
  configChanges,
  keyedPath,
  type Setting,
  settingAt,
  stageOneSettings,
  withSetting,
} from "./settings";

/**
 * A small made-up conference: two languages, one format with a field of each relevant kind, and
 * two review pools (one with guidelines and a scale of its own).
 */
const input: ConferenceConfigInput = {
  slug: "settings-test",
  year: 2031,
  title: { en: "Made-up meeting", es: "Encuentro inventado" },
  theme: { en: "Nothing in particular" },
  host: "Instituto Inventado",
  location: { en: "Nowhere" },
  modality: "online",
  timezone: "America/Bogota",
  defaultLanguage: "en",
  languages: ["en", "es"],
  contactEmail: "meeting@example.org",
  dates: { start: "2031-08-03", end: "2031-08-06" },
  deadlines: {
    submissionsOpen: "2031-01-11T00:00:00-05:00",
    submissionsClose: "2031-02-14T23:59:00-12:00",
    notification: "2031-04-30T23:59:00-05:00",
    finalMaterials: "2031-05-31T23:59:00-05:00",
  },
  rules: { presenterCap: null },
  reviewPools: [
    {
      key: "committee",
      name: { en: "Committee" },
      blindMode: "double",
      reviewsPerSubmission: 2,
      criteria: [
        { key: "fit", label: { en: "Fit" } },
        { key: "clarity", label: { en: "Clarity", es: "Claridad" } },
      ],
    },
    {
      key: "jury",
      name: { en: "Jury", es: "Jurado" },
      blindMode: "single",
      reviewsPerSubmission: 1,
      guidelines: { en: "Read it twice.\n\nThen score it.", es: "Léelo dos veces." },
      criteria: [
        {
          key: "merit",
          label: { en: "Merit" },
          description: { en: "0 is no merit at all." },
          min: 0,
          max: 10,
        },
      ],
      // The jury's form: comments within limits, worded by its chairs, and no recommendation.
      form: {
        comments: { description: { en: "Write to the artist." }, minWords: 20, maxWords: 400 },
        recommendation: { enabled: false },
      },
    },
  ],
  tracks: [{ key: "main", name: { en: "Main track" } }],
  topics: [{ key: "sound", label: { en: "Sound" } }],
  submissionTypes: [
    {
      key: "talk",
      name: { en: "Talk" },
      description: { en: "A short talk." },
      reviewPool: "committee",
      abstract: { label: { en: "Abstract" }, maxWords: 300 },
      team: { min: 1, max: 4 },
      fields: [
        { key: "needs", label: { en: "Needs" }, kind: "longtext", maxWords: 200 },
        { key: "seats", label: { en: "Seats" }, kind: "number", min: 15, max: 30 },
        { key: "link", label: { en: "Link" }, kind: "url", identifying: true },
      ],
    },
  ],
  otherFormats: [{ key: "pitch", name: { en: "Pitch" }, description: { en: "By email." } }],
};
const config = ConferenceConfig.parse(input);
const paths = (settings: Setting[]) => settings.map((s) => s.path);

/** The same conference with what it lacks: both rules, a place on the map and an agreement. */
const fuller = ConferenceConfig.parse({
  ...input,
  coordinates: { lat: 10.99, lon: -74.79 },
  rules: {
    presenterCap: { max: 2, countedRoles: ["lead"] },
    bio: { requested: true, maxWords: 300 },
  },
  agreements: [
    { key: "privacy", title: { en: "Privacy" }, text: { en: "We keep little." }, version: "1" },
  ],
});

/*
 * The screen offers the stage-one values and nothing else. That is what has a control, not a
 * permission: a chair may save any valid configuration (the server's settings.test.ts).
 */
describe("what the settings screen offers", () => {
  it("offers the stage-one values of existing formats, fields, tracks and topics", () => {
    const offered = paths(stageOneSettings(fuller));
    for (const path of [
      "title.en",
      "theme.es",
      "host",
      "modality",
      "contactEmail",
      "website",
      "placeholder",
      "dates.start",
      "deadlines.submissionsClose",
      "rules.presenterCap.max",
      "rules.bio.maxWords",
      "submissionTypes.talk.name.es",
      "submissionTypes.talk.abstract.label.en",
      "submissionTypes.talk.abstract.minWords",
      "submissionTypes.talk.durationMinutes",
      "submissionTypes.talk.team.max",
      "submissionTypes.talk.fields.needs.help.en",
      "submissionTypes.talk.fields.seats.integer",
      "otherFormats.pitch.description.es",
      "tracks.main.name.en",
      "topics.sound.label.en",
      // The invitation's two texts, although this conference has written neither.
      "distinction.en",
      "invitation.es",
    ]) {
      expect(offered, path).toContain(path);
    }
  });

  it("offers a text only in a language the conference has", () => {
    // English and Spanish here. A text that is missing in one of them is offered, to be written.
    expect(config.theme.es).toBeUndefined();
    const offered = paths(stageOneSettings(config));
    expect(offered).toContain("theme.es");
    for (const path of [
      "title.fr",
      "title.pt",
      "theme.pt-BR",
      "location.de",
      "submissionTypes.talk.name.fr",
      "submissionTypes.talk.description.pt",
      "submissionTypes.talk.abstract.label.fr",
      "submissionTypes.talk.fields.needs.label.fr",
      "submissionTypes.talk.fields.needs.help.pt",
      "otherFormats.pitch.name.fr",
      "tracks.main.name.fr",
      "topics.sound.label.fr",
    ]) {
      expect(offered, path).not.toContain(path);
    }
    // The same texts are offered where the conference has those languages.
    const wider = paths(
      stageOneSettings({ ...config, languages: ["en", "es", "fr", "pt", "pt-BR", "de"] }),
    );
    expect(wider).toContain("title.fr");
    expect(wider).toContain("theme.pt-BR");
    // The list of languages itself has no control.
    expect(wider).not.toContain("languages");
  });

  it("names a text in a language the conference lacks as a change, though no control makes it", () => {
    const crafted = structuredClone(config);
    crafted.title.fr = "Réunion inventée";
    const type = crafted.submissionTypes[0];
    if (!type) throw new Error("no format");
    type.name.fr = "Exposé";
    // The schema takes the extra texts, and a save names them one by one.
    expect(ConferenceConfig.safeParse(crafted).success).toBe(true);
    const changed = configChanges(config, crafted).map((c) => c.path);
    expect(changed).toEqual(["title.fr", `submissionTypes.${type.key}.name.fr`]);
    // Before the change or after it, the screen has no control for either.
    for (const offered of [stageOneSettings(config), stageOneSettings(crafted)]) {
      for (const path of changed) expect(paths(offered), path).not.toContain(path);
    }
  });

  it("names a setting on a field whose kind lacks it as a change, though no control makes it", () => {
    const crafted = structuredClone(config);
    const fields = crafted.submissionTypes[0]?.fields ?? [];
    const seats = fields.find((f) => f.key === "seats");
    const link = fields.find((f) => f.key === "link");
    if (!seats || !link) throw new Error("no field");
    seats.maxWords = 42;
    link.maxWords = 7;
    // The schema takes a word limit on any field, and a save names each one.
    expect(ConferenceConfig.safeParse(crafted).success).toBe(true);
    const changed = configChanges(config, crafted).map((c) => c.path);
    expect(changed).toEqual([
      "submissionTypes.talk.fields.seats.maxWords",
      "submissionTypes.talk.fields.link.maxWords",
    ]);
    // Even once a number and a link hold a word limit, the screen offers it on neither.
    for (const offered of [stageOneSettings(config), stageOneSettings(crafted)]) {
      for (const path of changed) expect(paths(offered), path).not.toContain(path);
    }
  });

  it("offers nothing else: the rest of a configuration has no control", () => {
    const offered = paths(stageOneSettings(fuller));
    for (const path of [
      "slug",
      "year",
      "timezone",
      "languages",
      "defaultLanguage",
      "coordinates.lat",
      "rules.presenterCap",
      "rules.presenterCap.countedRoles",
      "rules.bio.requested",
      // Of an agreement, what it says and its version; not its key, nor the list itself.
      "agreements",
      "agreements.privacy",
      "agreements.privacy.key",
      "agreements.privacy.title",
      "agreements.privacy.text",
      "agreements.privacy.title.pt",
      "agreements.terms.version",
      "reviewPools",
      "reviewPools.committee.key",
      "reviewPools.committee.name",
      "reviewPools.committee.guidelines",
      "reviewPools.committee.criteria",
      "reviewPools.committee.criteria.fit.key",
      "reviewPools.committee.criteria.fit.label",
      "submissionTypes",
      "submissionTypes.talk.key",
      "submissionTypes.talk.reviewPool",
      "submissionTypes.talk.blindMode",
      "submissionTypes.talk.countsTowardPresenterCap",
      "submissionTypes.talk.fields",
      "submissionTypes.talk.fields.needs.kind",
      "submissionTypes.talk.fields.needs.identifying",
      "submissionTypes.talk.fields.needs.public",
      "submissionTypes.talk.fields.needs.options",
      "otherFormats",
      "tracks",
      "title",
      "title.en.extra",
      // Of the invitation, its texts in the conference's languages; no group where there is none.
      "distinction",
      "invitation",
      "invitation.pt",
      "contributionGroups",
      "contributionGroups.talks.name.en",
      // Of an email, its texts only, and only in a language the app writes mail in.
      "messages",
      "messages.invitation",
      "messages.invitation.subject",
      "messages.invitation.subject.fr",
      "messages.invitation.subject.pt-BR",
      "messages.invitation.footer.en",
      "messages.reminder.subject.en",
      "nonsense",
    ]) {
      expect(offered, path).not.toContain(path);
    }
    // The values it leaves alone are there, in the configuration: they only have no control.
    expect(settingAt(fuller, "agreements.privacy.version")).toBe("1");
    expect(settingAt(fuller, "submissionTypes.talk.reviewPool")).toBe("committee");
    expect(settingAt(fuller, "rules.presenterCap.countedRoles")).toEqual(["lead"]);
  });
});

describe("the settings of a configuration", () => {
  const settings = stageOneSettings(config);

  it("lists each text once per language of the conference, written or not", () => {
    expect(settings.filter((s) => s.id === "theme")).toEqual([
      {
        path: "theme.en",
        id: "theme",
        kind: "longtext",
        optional: false,
        lang: "en",
        value: "Nothing in particular",
      },
      {
        path: "theme.es",
        id: "theme",
        kind: "longtext",
        optional: false,
        lang: "es",
        value: undefined,
      },
    ]);
    // A field's help is optional and absent here: it can still be written.
    expect(paths(settings)).toContain("submissionTypes.talk.fields.needs.help.es");
  });

  it("gives a field only the settings its kind has", () => {
    const of = (field: string) =>
      settings
        .filter((s) => s.path.startsWith(`submissionTypes.talk.fields.${field}.`))
        .map((s) => s.id);
    expect(new Set(of("needs"))).toEqual(
      new Set(["field.label", "field.help", "field.required", "field.maxWords"]),
    );
    expect(new Set(of("seats"))).toEqual(
      new Set([
        "field.label",
        "field.help",
        "field.required",
        "field.min",
        "field.max",
        "field.integer",
      ]),
    );
    expect(new Set(of("link"))).toEqual(new Set(["field.label", "field.help", "field.required"]));
    // A field or a format the conference does not have has no settings.
    expect(
      paths(settings).filter((path) =>
        /^submissionTypes\.(nope\.|talk\.fields\.nope\.)/.test(path),
      ),
    ).toEqual([]);
    // It is the field's kind that counts: where "needs" is a number, it has a range and no words.
    const other = structuredClone(config);
    const needs = other.submissionTypes[0]?.fields[0];
    if (!needs) throw new Error("no field");
    needs.kind = "number";
    const asNumber = paths(stageOneSettings(other));
    expect(asNumber).toContain("submissionTypes.talk.fields.needs.min");
    expect(asNumber).toContain("submissionTypes.talk.fields.needs.integer");
    expect(asNumber).not.toContain("submissionTypes.talk.fields.needs.maxWords");
  });

  it("has no setting for a rule the conference does not have", () => {
    // The days before the reminder are no such rule: an optional number, offered set or not.
    const rules = (list: Setting[]) =>
      paths(list).filter((p) => p.startsWith("rules.") && p !== "rules.reviewReminderDays");
    expect(rules(settings)).toEqual([]);
    expect(rules(stageOneSettings(fuller))).toEqual([
      "rules.presenterCap.max",
      "rules.bio.maxWords",
    ]);
  });

  it("reads optional values that are absent as undefined", () => {
    const value = (path: string) => settings.find((s) => s.path === path);
    expect(value("website")).toMatchObject({ optional: true, value: undefined });
    expect(value("submissionTypes.talk.abstract.minWords")).toMatchObject({
      optional: true,
      value: undefined,
    });
    expect(value("submissionTypes.talk.abstract.maxWords")).toMatchObject({
      optional: false,
      value: 300,
    });
  });

  // Run over every registered configuration: nothing here depends on what they say.
  const all = [config, fuller, ...Object.values(conferences).map((c) => ConferenceConfig.parse(c))];

  it("offers each value once, at the path where the configuration holds it", () => {
    for (const c of all) {
      const found = stageOneSettings(c);
      expect(new Set(paths(found)).size).toBe(found.length);
      for (const s of found) {
        expect(settingAt(c, s.path), s.path).toEqual(s.value);
      }
      // Every text is offered in each language of the conference, and in no other. The
      // wording of an email is the exception: it is offered in the three languages the app
      // writes mail in, whichever of them the conference has.
      const langs = (which: (s: Setting) => boolean) =>
        [...new Set(found.filter(which).flatMap((s) => (s.lang ? [s.lang] : [])))].sort();
      const email = (s: Setting) => s.path.startsWith("messages.");
      expect(langs((s) => !email(s))).toEqual([...c.languages].sort());
      expect(langs(email)).toEqual(["en", "es", "pt"]);
    }
  });

  it("changes exactly the value at a setting's path, and nothing else", () => {
    const other: Record<Setting["kind"], unknown> = {
      text: "Another text",
      longtext: "Another, longer text",
      int: 7919,
      number: 7919.5,
      bool: "flip",
      date: "2031-12-24",
      datetime: "2031-12-24T12:00:00+01:00",
      email: "another@example.org",
      url: "https://another.example.org/",
      modality: "flip",
      blindMode: "flip",
    };
    for (const c of all) {
      for (const s of stageOneSettings(c)) {
        const next =
          s.kind === "bool"
            ? !s.value
            : s.kind === "modality"
              ? s.value === "hybrid"
                ? "online"
                : "hybrid"
              : s.kind === "blindMode"
                ? s.value === "open"
                  ? "double"
                  : "open"
                : other[s.kind];
        const changed = withSetting(c, s.path, next);
        expect(configChanges(c, changed), s.path).toEqual([
          { path: s.path, ...(s.value === undefined ? {} : { before: s.value }), after: next },
        ]);
        // The configuration it was made from is untouched.
        expect(settingAt(c, s.path)).toEqual(s.value);
      }
    }
  });
});

/*
 * The review settings: of each existing pool its name, how authors appear to its reviewers, the
 * reviews a proposal gets and the guidelines; of each existing criterion its label and scale.
 */
describe("the review settings", () => {
  const settings = stageOneSettings(config);
  const under = (prefix: string) => settings.filter((s) => s.path.startsWith(prefix));

  it("lists every pool's name, blind mode, reviews per proposal and guidelines", () => {
    const pool = (key: string) => under(`reviewPools.${key}.`).filter((s) => /^pool\./.test(s.id));
    expect(pool("committee")).toEqual([
      {
        path: "reviewPools.committee.name.en",
        id: "pool.name",
        kind: "text",
        optional: false,
        lang: "en",
        value: "Committee",
      },
      {
        path: "reviewPools.committee.name.es",
        id: "pool.name",
        kind: "text",
        optional: false,
        lang: "es",
        value: undefined,
      },
      {
        path: "reviewPools.committee.blindMode",
        id: "pool.blindMode",
        kind: "blindMode",
        optional: false,
        value: "double",
      },
      {
        path: "reviewPools.committee.reviewsPerSubmission",
        id: "pool.reviewsPerSubmission",
        kind: "int",
        optional: false,
        value: 2,
      },
      // No guidelines yet: they are offered all the same, in each language, to be written.
      {
        path: "reviewPools.committee.guidelines.en",
        id: "pool.guidelines",
        kind: "longtext",
        optional: true,
        lang: "en",
        value: undefined,
      },
      {
        path: "reviewPools.committee.guidelines.es",
        id: "pool.guidelines",
        kind: "longtext",
        optional: true,
        lang: "es",
        value: undefined,
      },
    ]);
    expect(pool("jury").map((s) => [s.path, s.value])).toEqual([
      ["reviewPools.jury.name.en", "Jury"],
      ["reviewPools.jury.name.es", "Jurado"],
      ["reviewPools.jury.blindMode", "single"],
      ["reviewPools.jury.reviewsPerSubmission", 1],
      ["reviewPools.jury.guidelines.en", "Read it twice.\n\nThen score it."],
      ["reviewPools.jury.guidelines.es", "Léelo dos veces."],
    ]);
  });

  it("lists every criterion's label, its description and the two ends of its scale", () => {
    const criterion = (pool: string, key: string) =>
      under(`reviewPools.${pool}.criteria.${key}.`).map((s) => [s.id, s.kind, s.path, s.value]);
    const at = "reviewPools.committee.criteria.fit";
    // A scale that the configuration left out is the default one, 1 to 5. A description is
    // offered in each language although none is written: it is the chairs' to write.
    expect(criterion("committee", "fit")).toEqual([
      ["criterion.label", "text", `${at}.label.en`, "Fit"],
      ["criterion.label", "text", `${at}.label.es`, undefined],
      ["criterion.description", "longtext", `${at}.description.en`, undefined],
      ["criterion.description", "longtext", `${at}.description.es`, undefined],
      ["criterion.min", "int", `${at}.min`, 1],
      ["criterion.max", "int", `${at}.max`, 5],
    ]);
    expect(criterion("committee", "clarity").map(([, , path]) => path)).toEqual([
      "reviewPools.committee.criteria.clarity.label.en",
      "reviewPools.committee.criteria.clarity.label.es",
      "reviewPools.committee.criteria.clarity.description.en",
      "reviewPools.committee.criteria.clarity.description.es",
      "reviewPools.committee.criteria.clarity.min",
      "reviewPools.committee.criteria.clarity.max",
    ]);
    expect(criterion("jury", "merit")).toEqual([
      ["criterion.label", "text", "reviewPools.jury.criteria.merit.label.en", "Merit"],
      ["criterion.label", "text", "reviewPools.jury.criteria.merit.label.es", undefined],
      [
        "criterion.description",
        "longtext",
        "reviewPools.jury.criteria.merit.description.en",
        "0 is no merit at all.",
      ],
      [
        "criterion.description",
        "longtext",
        "reviewPools.jury.criteria.merit.description.es",
        undefined,
      ],
      ["criterion.min", "int", "reviewPools.jury.criteria.merit.min", 0],
      ["criterion.max", "int", "reviewPools.jury.criteria.merit.max", 10],
    ]);
    expect(under("reviewPools.").filter((s) => s.id === "criterion.description")[0]).toMatchObject({
      optional: true,
    });
    // That is all there is under a pool: its own six, six for each criterion, and ten for the
    // fixed part of its form. Nothing adds, removes or reorders pools or criteria.
    expect(under("reviewPools.").length).toBe(6 + 6 + 6 + 10 + 6 + 6 + 10);
    // A pool or a criterion the conference does not have has no settings.
    expect(
      paths(settings).filter((p) => /^reviewPools\.(nope|committee\.criteria\.nope)\./.test(p)),
    ).toEqual([]);
  });

  it("offers the fixed part of each pool's review form, whether or not anything is set", () => {
    const form = (pool: string) =>
      under(`reviewPools.${pool}.form.`).map((s) => [
        s.id,
        s.kind,
        s.optional,
        s.path.slice(`reviewPools.${pool}.form.`.length),
        s.value,
      ]);
    // Nothing set: every limit and description is offered empty, and the form has a note and
    // a recommendation.
    expect(form("committee")).toEqual([
      ["form.comments.description", "longtext", true, "comments.description.en", undefined],
      ["form.comments.description", "longtext", true, "comments.description.es", undefined],
      ["form.comments.minWords", "int", true, "comments.minWords", undefined],
      ["form.comments.maxWords", "int", true, "comments.maxWords", undefined],
      ["form.chairNote.enabled", "bool", false, "chairNote.enabled", true],
      ["form.chairNote.description", "longtext", true, "chairNote.description.en", undefined],
      ["form.chairNote.description", "longtext", true, "chairNote.description.es", undefined],
      ["form.recommendation.enabled", "bool", false, "recommendation.enabled", true],
      [
        "form.recommendation.description",
        "longtext",
        true,
        "recommendation.description.en",
        undefined,
      ],
      [
        "form.recommendation.description",
        "longtext",
        true,
        "recommendation.description.es",
        undefined,
      ],
    ]);
    expect(form("jury").map(([, , , path, value]) => [path, value])).toEqual([
      ["comments.description.en", "Write to the artist."],
      ["comments.description.es", undefined],
      ["comments.minWords", 20],
      ["comments.maxWords", 400],
      ["chairNote.enabled", true],
      ["chairNote.description.en", undefined],
      ["chairNote.description.es", undefined],
      ["recommendation.enabled", false],
      ["recommendation.description.en", undefined],
      ["recommendation.description.es", undefined],
    ]);
  });

  it("sets and clears a limit and a description of the form by path, and takes the note off", () => {
    const at = "reviewPools.committee.form";
    const limited = withSetting(config, `${at}.comments.maxWords`, 300);
    expect(configChanges(config, limited)).toEqual([
      { path: `${at}.comments.maxWords`, after: 300 },
    ]);
    expect(ConferenceConfig.parse(limited).reviewPools[0]?.form.comments).toEqual({
      maxWords: 300,
    });
    // Cleared, the limit is gone; what is sent has no empty part, and reads back as it was.
    const cleared = withSetting(limited, `${at}.comments.maxWords`, undefined);
    expect(configChanges(config, cleared)).toEqual([]);
    expect(ConferenceConfig.parse(cleared)).toEqual(config);

    const worded = withSetting(
      config,
      `${at}.chairNote.description.es`,
      "Solo para la presidencia.",
    );
    // A text needs the conference's main language, here as everywhere.
    expect(ConferenceConfig.safeParse(worded).success).toBe(false);
    expect(
      ConferenceConfig.safeParse(
        withSetting(worded, `${at}.chairNote.description.en`, "For the chairs' eyes."),
      ).success,
    ).toBe(true);

    const without = withSetting(config, `${at}.chairNote.enabled`, false);
    expect(configChanges(config, without)).toEqual([
      { path: `${at}.chairNote.enabled`, before: true, after: false },
    ]);
    expect(ConferenceConfig.parse(without).reviewPools[0]?.form.chairNote).toEqual({
      enabled: false,
    });
  });

  it("offers the day reviews are due among the deadlines, set or not, and takes it away again", () => {
    const due = settings.find((s) => s.path === "deadlines.reviewsDue");
    expect(due).toEqual({
      path: "deadlines.reviewsDue",
      id: "deadlines.reviewsDue",
      kind: "datetime",
      optional: true,
      value: undefined,
    });
    // After the day the call closes, before the day decisions are sent: where it is listed.
    expect(settings.filter((s) => s.path.startsWith("deadlines.")).map((s) => s.path)).toEqual([
      "deadlines.submissionsOpen",
      "deadlines.submissionsClose",
      "deadlines.reviewsDue",
      "deadlines.notification",
      "deadlines.finalMaterials",
    ]);
    const set = withSetting(config, "deadlines.reviewsDue", "2031-03-15T23:59:00-05:00");
    expect(configChanges(config, set)).toEqual([
      { path: "deadlines.reviewsDue", after: "2031-03-15T23:59:00-05:00" },
    ]);
    expect(ConferenceConfig.parse(set).deadlines.reviewsDue).toBe("2031-03-15T23:59:00-05:00");
    expect(configChanges(config, withSetting(set, "deadlines.reviewsDue", undefined))).toEqual([]);
  });

  it("offers the days before the reminder right after the day reviews are due, set or not", () => {
    const days = settings.find((s) => s.path === "rules.reviewReminderDays");
    expect(days).toEqual({
      path: "rules.reviewReminderDays",
      id: "rules.reviewReminderDays",
      kind: "int",
      optional: true,
      value: undefined,
    });
    // It is kept among the rules, and offered beside the day it counts back from.
    const order = paths(settings);
    expect(order.indexOf("rules.reviewReminderDays")).toBe(
      order.indexOf("deadlines.reviewsDue") + 1,
    );
    const set = withSetting(config, "rules.reviewReminderDays", 5);
    expect(configChanges(config, set)).toEqual([{ path: "rules.reviewReminderDays", after: 5 }]);
    expect(ConferenceConfig.parse(set).rules.reviewReminderDays).toBe(5);
    expect(configChanges(config, withSetting(set, "rules.reviewReminderDays", undefined))).toEqual(
      [],
    );
  });

  it("does not offer a format's own blind mode, or the pool that reviews it", () => {
    const own = structuredClone(config);
    const talk = own.submissionTypes[0];
    if (!talk) throw new Error("no format");
    talk.blindMode = "open";
    talk.reviewPool = "jury";
    expect(ConferenceConfig.safeParse(own).success).toBe(true);
    // A save names both, and the screen has a control for neither, before or after.
    const changed = configChanges(config, own).map((c) => c.path);
    expect(changed).toEqual(["submissionTypes.talk.reviewPool", "submissionTypes.talk.blindMode"]);
    for (const offered of [settings, stageOneSettings(own)]) {
      for (const path of changed) expect(paths(offered), path).not.toContain(path);
    }
  });

  it("writes guidelines where a pool has none, and clears them language by language", () => {
    const at = "reviewPools.committee.guidelines";
    const written = withSetting(config, `${at}.en`, "Be kind.\nBe exact.");
    expect(configChanges(config, written)).toEqual([
      { path: `${at}.en`, after: "Be kind.\nBe exact." },
    ]);
    expect(ConferenceConfig.parse(written).reviewPools[0]?.guidelines).toEqual({
      en: "Be kind.\nBe exact.",
    });
    // Cleared in its last language, the pool has no guidelines at all, as before.
    const cleared = withSetting(written, `${at}.en`, undefined);
    expect(settingAt(cleared, "reviewPools.committee")).not.toHaveProperty("guidelines");
    expect(configChanges(config, cleared)).toEqual([]);
  });
});

describe("the wording of the emails", () => {
  const emails = (c: ConferenceConfig) =>
    stageOneSettings(c).filter((s) => s.path.startsWith("messages."));
  const written = ConferenceConfig.parse({
    ...input,
    messages: { invitation: { body: { es: "Responde aquí: {link}" } } },
  });

  it("offers the subject and the body of every email, though the conference has written none", () => {
    expect(config).not.toHaveProperty("messages");
    const offered = emails(config);
    // Six emails, a subject and a body, in the three languages the app writes mail in: the
    // conference's two, and Portuguese, which someone may be invited in all the same.
    expect(config.languages).toEqual(["en", "es"]);
    expect(paths(offered)).toEqual(
      ["subject", "body"].flatMap((part) =>
        MESSAGE_KEYS.flatMap((key) =>
          ["en", "es", "pt"].map((lang) => `messages.${key}.${part}.${lang}`),
        ),
      ),
    );
    for (const s of offered) {
      expect(s, s.path).toMatchObject({ optional: true, value: undefined });
      expect(s.kind).toBe(s.id === "message.subject" ? "text" : "longtext");
      expect(["message.subject", "message.body"]).toContain(s.id);
    }
    expect(offered.find((s) => s.path === "messages.invitation.subject.es")).toEqual({
      path: "messages.invitation.subject.es",
      id: "message.subject",
      kind: "text",
      optional: true,
      lang: "es",
      value: undefined,
      standard: "{conference}: confirma tu participación",
    });
  });

  it("gives each its standard text, which is what is sent while none is written", () => {
    for (const s of emails(config)) {
      const [, key, part, lang] = s.path.split(".");
      const message = MESSAGE_KEYS.find((k) => k === key);
      const mail = MAIL_LANGUAGES.find((l) => l === lang);
      if (!message || (part !== "subject" && part !== "body") || !mail)
        throw new Error(`not an email's text: ${s.path}`);
      expect(s.standard, s.path).toBe(MESSAGES[message].standard[mail][part]);
    }
    // No other setting has one.
    for (const s of stageOneSettings(fuller)) {
      if (!s.path.startsWith("messages.")) expect(s, s.path).not.toHaveProperty("standard");
    }
  });

  it("reads a text the conference has written, beside the standard one", () => {
    const body = emails(written).find((s) => s.path === "messages.invitation.body.es");
    expect(body).toMatchObject({
      value: "Responde aquí: {link}",
      standard: MESSAGES.invitation.standard.es.body,
    });
    // The rest of that email, and every other, is still to write.
    expect(emails(written).filter((s) => s.value !== undefined)).toHaveLength(1);
    expect(paths(emails(written))).toEqual(paths(emails(config)));
  });

  it("offers them in all three mail languages whatever the conference's are, its main one first", () => {
    const langs = (languages: string[], defaultLanguage = "en") => [
      ...new Set(emails({ ...config, languages, defaultLanguage }).map((s) => s.lang)),
    ];
    expect(langs(["en"])).toEqual(["en", "es", "pt"]);
    expect(langs(["en", "es", "pt"])).toEqual(["en", "es", "pt"]);
    expect(langs(["es", "en"], "es")).toEqual(["es", "en", "pt"]);
    expect(langs(["pt"], "pt")).toEqual(["pt", "en", "es"]);
    // French and a regional Portuguese are languages a conference may have, and not ones the
    // app writes mail in: they add nothing here, and their readers are sent en or pt mail.
    expect(langs(["en", "fr", "pt-BR"])).toEqual(["en", "es", "pt"]);
    expect(langs(["pt-BR", "fr"], "pt-BR")).toEqual(["pt", "en", "es"]);
    // Every other text of that conference is still offered in its own languages only.
    const others = stageOneSettings({ ...config, languages: ["en", "fr", "pt-BR"] }).filter(
      (s) => !s.path.startsWith("messages."),
    );
    expect([...new Set(others.flatMap((s) => (s.lang ? [s.lang] : [])))]).toEqual([
      "en",
      "fr",
      "pt-BR",
    ]);
  });

  it("writes a text where there was no `messages`, and removing the last one leaves none", () => {
    const at = "messages.invitation.subject.es";
    const one = withSetting(config, at, "Te han invitado a {conference}");
    expect(one.messages).toEqual({
      invitation: { subject: { es: "Te han invitado a {conference}" } },
    });
    expect(configChanges(config, one)).toEqual([
      { path: at, after: "Te han invitado a {conference}" },
    ]);
    expect(ConferenceConfig.safeParse(one).success).toBe(true);
    expect(settingAt(one, at)).toBe("Te han invitado a {conference}");

    // A second text, in another email; then the first one is taken back.
    const two = withSetting(one, "messages.draft_deleted.body.en", "Never mind.");
    const back = withSetting(two, at, undefined);
    expect(back.messages).toEqual({ draft_deleted: { body: { en: "Never mind." } } });
    expect(configChanges(two, back)).toEqual([
      { path: at, before: "Te han invitado a {conference}" },
    ]);

    // Without the last one there is no `messages`, no empty object anywhere, and the
    // configuration is the one it was, to the byte.
    const none = withSetting(back, "messages.draft_deleted.body.en", undefined);
    expect(none).not.toHaveProperty("messages");
    expect(JSON.stringify(none)).toBe(JSON.stringify(config));
    expect(configChanges(config, none)).toEqual([]);
    // Removing what was never written changes nothing either.
    expect(JSON.stringify(withSetting(config, at, undefined))).toBe(JSON.stringify(config));
  });

  it("leaves a configuration without `messages` when anything else is changed", () => {
    /** Another value of a setting's kind: what it is does not matter here, only that it differs. */
    const another = (s: Setting) =>
      s.kind === "bool"
        ? s.value !== true
        : s.kind === "int" || s.kind === "number"
          ? 7919
          : `${String(s.value ?? "")} changed`;
    for (const c of [config, fuller]) {
      for (const s of stageOneSettings(c)) {
        if (s.path.startsWith("messages.")) continue;
        const changed = withSetting(c, s.path, another(s));
        expect(configChanges(c, changed), s.path).toHaveLength(1);
        expect(changed, s.path).not.toHaveProperty("messages");
        expect(JSON.stringify(changed), s.path).not.toContain('"messages"');
      }
    }
    // And one that has its own wording keeps exactly that.
    const renamed = withSetting(written, "host", "Another host");
    expect(renamed.messages).toEqual(written.messages);
  });
});

describe("the agreements", () => {
  /** The made-up conference with two agreements: one with a text, one with a link. */
  const agreed = ConferenceConfig.parse({
    ...input,
    agreements: [
      {
        key: "privacy",
        title: { en: "Privacy notice", es: "Aviso de privacidad" },
        text: { en: "We keep little.\n\nWe share nothing." },
        version: "1",
      },
      {
        key: "conduct",
        title: { en: "Code of conduct" },
        url: "https://example.org/conduct",
        version: "2031-01",
      },
    ],
  });
  const at = (c: ConferenceConfig, prefix: string) =>
    stageOneSettings(c).filter((s) => s.path.startsWith(prefix));

  it("lists every agreement's title and text in each language, its link and its version", () => {
    expect(
      at(agreed, "agreements.").map((s) => [s.path, s.id, s.kind, s.optional, s.value]),
    ).toEqual([
      ["agreements.privacy.title.en", "agreement.title", "text", false, "Privacy notice"],
      ["agreements.privacy.title.es", "agreement.title", "text", false, "Aviso de privacidad"],
      ["agreements.conduct.title.en", "agreement.title", "text", false, "Code of conduct"],
      ["agreements.conduct.title.es", "agreement.title", "text", false, undefined],
      [
        "agreements.privacy.text.en",
        "agreement.text",
        "longtext",
        true,
        "We keep little.\n\nWe share nothing.",
      ],
      ["agreements.privacy.text.es", "agreement.text", "longtext", true, undefined],
      // An agreement without a text has one to write, in each language.
      ["agreements.conduct.text.en", "agreement.text", "longtext", true, undefined],
      ["agreements.conduct.text.es", "agreement.text", "longtext", true, undefined],
      ["agreements.privacy.url", "agreement.url", "url", true, undefined],
      ["agreements.conduct.url", "agreement.url", "url", true, "https://example.org/conduct"],
      ["agreements.privacy.version", "agreement.version", "text", false, "1"],
      ["agreements.conduct.version", "agreement.version", "text", false, "2031-01"],
    ]);
    // A conference without agreements has no such settings: one is not added here.
    expect(config.agreements).toEqual([]);
    expect(at(config, "agreements.")).toEqual([]);
  });

  it("changes what an agreement says and its version by path, and never adds one", () => {
    let next = withSetting(agreed, "agreements.privacy.text.es", "Guardamos poco.");
    next = withSetting(next, "agreements.privacy.version", "2");
    next = withSetting(next, "agreements.conduct.url", "https://example.org/conduct-2");
    expect(configChanges(agreed, next)).toEqual([
      { path: "agreements.privacy.text.es", after: "Guardamos poco." },
      { path: "agreements.privacy.version", before: "1", after: "2" },
      {
        path: "agreements.conduct.url",
        before: "https://example.org/conduct",
        after: "https://example.org/conduct-2",
      },
    ]);
    expect(ConferenceConfig.safeParse(next).success).toBe(true);
    // A text cleared in its last language is gone, as an optional text is.
    const cleared = withSetting(agreed, "agreements.privacy.text.en", undefined);
    expect(settingAt(cleared, "agreements.privacy")).not.toHaveProperty("text");
    const same = withSetting(agreed, "agreements.terms.version", "1");
    expect(configChanges(agreed, same)).toEqual([]);
  });

  it("needs a text or a link, said beside the link, and takes only an https link", () => {
    const refusals = (change: (c: ConferenceConfig) => ConferenceConfig) => {
      const parsed = ConferenceConfig.safeParse(change(agreed));
      return parsed.success
        ? []
        : parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            ...(issue.code === "custom" && issue.params ? { params: issue.params } : {}),
          }));
    };
    expect(refusals((c) => withSetting(c, "agreements.privacy.text.en", undefined))).toEqual([
      {
        path: "agreements.0",
        params: { code: "agreement_needs_text_or_link", leaf: "url" },
      },
    ]);
    expect(refusals((c) => withSetting(c, "agreements.conduct.url", undefined))).toEqual([
      {
        path: "agreements.1",
        params: { code: "agreement_needs_text_or_link", leaf: "url" },
      },
    ]);
    // With a text, the link may go; with a link, the text may.
    expect(
      refusals((c) =>
        withSetting(
          withSetting(c, "agreements.conduct.text.en", "Be kind."),
          "agreements.conduct.url",
          undefined,
        ),
      ),
    ).toEqual([]);
    for (const url of [
      "http://example.org/x",
      "javascript:alert(1)",
      "mailto:a@example.org",
      "x",
    ]) {
      expect(
        refusals((c) => withSetting(c, "agreements.conduct.url", url)),
        url,
      ).toEqual([{ path: "agreements.1.url" }]);
    }
    // A text needs the conference's main language, like any other; a version is 1 to 40 characters.
    expect(
      refusals((c) =>
        withSetting(
          withSetting(c, "agreements.privacy.text.en", undefined),
          "agreements.privacy.text.es",
          "Guardamos poco.",
        ),
      ),
    ).toEqual([
      { path: "agreements.0.text", params: { code: "default_language_required", leaf: "en" } },
    ]);
    expect(refusals((c) => withSetting(c, "agreements.privacy.version", "x".repeat(41)))).toEqual([
      { path: "agreements.0.version" },
    ]);
    expect(refusals((c) => withSetting(c, "agreements.privacy.version", undefined))).toEqual([
      { path: "agreements.0.version" },
    ]);
  });
});

/*
 * The invitation (the front page and the top of the conference page): what sets the edition
 * apart, the paragraph that invites, and of each existing group of formats its name and its
 * line. Which formats a group holds is not offered: regrouping is an import, like formats.
 */
describe("the invitation and the ways to contribute", () => {
  /** The made-up conference with an invitation and two groups, one of them only in English. */
  const invited = ConferenceConfig.parse({
    ...input,
    distinction: { en: "The first meeting on the island", es: "El primer encuentro en la isla" },
    invitation: { en: "Bring what you made.\nWe will listen." },
    contributionGroups: [
      {
        key: "talks",
        name: { en: "Talking", es: "Hablar" },
        summary: { en: "Talks of every length.", es: "Charlas de cualquier duración." },
        formats: ["talk"],
      },
      {
        key: "elsewhere",
        name: { en: "By email" },
        summary: { en: "Pitches, sent by email." },
        formats: ["pitch"],
      },
    ],
  });
  const at = (c: ConferenceConfig, pattern: RegExp) =>
    stageOneSettings(c)
      .filter((s) => pattern.test(s.path))
      .map((s) => [s.path, s.id, s.kind, s.optional, s.value]);
  const refusals = (candidate: unknown) => {
    const parsed = ConferenceConfig.safeParse(candidate);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          ...(issue.code === "custom" && issue.params ? { params: issue.params } : {}),
        }));
  };

  it("offers what sets the edition apart and the invitation in each language, written or not", () => {
    expect(at(invited, /^(distinction|invitation)\./)).toEqual([
      ["distinction.en", "distinction", "text", true, "The first meeting on the island"],
      ["distinction.es", "distinction", "text", true, "El primer encuentro en la isla"],
      ["invitation.en", "invitation", "longtext", true, "Bring what you made.\nWe will listen."],
      ["invitation.es", "invitation", "longtext", true, undefined],
    ]);
    // A conference that has neither is offered both all the same, to be written.
    expect(config).not.toHaveProperty("distinction");
    expect(config).not.toHaveProperty("invitation");
    expect(at(config, /^(distinction|invitation)\./)).toEqual([
      ["distinction.en", "distinction", "text", true, undefined],
      ["distinction.es", "distinction", "text", true, undefined],
      ["invitation.en", "invitation", "longtext", true, undefined],
      ["invitation.es", "invitation", "longtext", true, undefined],
    ]);
    // They come with the conference's own texts, straight after its theme.
    const order = stageOneSettings(config).map((s) => s.id);
    expect(order.indexOf("distinction")).toBe(order.lastIndexOf("theme") + 1);
  });

  it("lists every group's name and its line in each language, and nothing else of a group", () => {
    expect(at(invited, /^contributionGroups\./)).toEqual([
      ["contributionGroups.talks.name.en", "group.name", "text", false, "Talking"],
      ["contributionGroups.talks.name.es", "group.name", "text", false, "Hablar"],
      ["contributionGroups.elsewhere.name.en", "group.name", "text", false, "By email"],
      ["contributionGroups.elsewhere.name.es", "group.name", "text", false, undefined],
      [
        "contributionGroups.talks.summary.en",
        "group.summary",
        "longtext",
        false,
        "Talks of every length.",
      ],
      [
        "contributionGroups.talks.summary.es",
        "group.summary",
        "longtext",
        false,
        "Charlas de cualquier duración.",
      ],
      [
        "contributionGroups.elsewhere.summary.en",
        "group.summary",
        "longtext",
        false,
        "Pitches, sent by email.",
      ],
      ["contributionGroups.elsewhere.summary.es", "group.summary", "longtext", false, undefined],
    ]);
    // A conference without groups has no such settings: a group is not added here.
    expect(config.contributionGroups).toEqual([]);
    expect(at(config, /^contributionGroups\./)).toEqual([]);
    // Which formats a group holds has no control: regrouping is an import.
    expect(settingAt(invited, "contributionGroups.talks.formats")).toEqual(["talk"]);
  });

  it("writes an invitation where there is none, and clears it language by language", () => {
    const written = withSetting(config, "invitation.en", "Come as you are.");
    expect(configChanges(config, written)).toEqual([
      { path: "invitation.en", after: "Come as you are." },
    ]);
    expect(ConferenceConfig.parse(written).invitation).toEqual({ en: "Come as you are." });
    // Cleared in its last language, the conference has no invitation at all, as before.
    const cleared = withSetting(written, "invitation.en", undefined);
    expect(cleared).not.toHaveProperty("invitation");
    expect(configChanges(config, cleared)).toEqual([]);
    // One language of two goes, and the other stays.
    const half = withSetting(invited, "distinction.es", undefined);
    expect(half.distinction).toEqual({ en: "The first meeting on the island" });
    expect(ConferenceConfig.safeParse(half).success).toBe(true);
  });

  it("changes a group's name and line by path, and never adds or regroups one", () => {
    let next = withSetting(invited, "contributionGroups.elsewhere.name.es", "Por correo");
    next = withSetting(next, "contributionGroups.talks.summary.en", "Talks, long and short.");
    expect(configChanges(invited, next)).toEqual([
      {
        path: "contributionGroups.talks.summary.en",
        before: "Talks of every length.",
        after: "Talks, long and short.",
      },
      { path: "contributionGroups.elsewhere.name.es", after: "Por correo" },
    ]);
    expect(ConferenceConfig.safeParse(next).success).toBe(true);
    const same = withSetting(invited, "contributionGroups.nope.name.en", "Another");
    expect(configChanges(invited, same)).toEqual([]);
    // Regrouping through the API is one change, named by the list it changes.
    const regrouped = structuredClone(invited);
    regrouped.contributionGroups.reverse();
    expect(configChanges(invited, regrouped)).toEqual([
      { path: "contributionGroups", before: ["talks", "elsewhere"], after: ["elsewhere", "talks"] },
    ]);
  });

  it("the schema takes a conference without them, and then it holds no groups", () => {
    expect(refusals(input)).toEqual([]);
    expect(config.contributionGroups).toEqual([]);
    // A stored configuration from before these existed is read the same way.
    const { contributionGroups: _, ...stored } = config;
    expect(ConferenceConfig.parse(stored)).toEqual(config);
  });

  it("the schema needs each of these texts in the conference's main language", () => {
    const named = (path: string) => [
      { path, params: { code: "default_language_required", leaf: "en" } },
    ];
    expect(refusals({ ...input, distinction: { es: "Solo en español." } })).toEqual(
      named("distinction"),
    );
    expect(refusals({ ...input, invitation: {} })).toEqual(named("invitation"));
    expect(refusals({ ...input, invitation: { en: "" } })).toEqual([{ path: "invitation.en" }]);
    const group = (change: Record<string, unknown>) => ({
      ...input,
      contributionGroups: [
        { key: "talks", name: { en: "T" }, summary: { en: "S" }, formats: ["talk"], ...change },
      ],
    });
    expect(refusals(group({}))).toEqual([]);
    expect(refusals(group({ name: { es: "Hablar" } }))).toEqual(named("contributionGroups.0.name"));
    expect(refusals(group({ summary: { es: "Charlas." } }))).toEqual(
      named("contributionGroups.0.summary"),
    );
  });

  it("a group names formats the call offers, submitted here or not, and no format twice", () => {
    const groups = (...formats: string[][]) => ({
      ...input,
      contributionGroups: formats.map((keys, i) => ({
        key: `group_${i}`,
        name: { en: "Group" },
        summary: { en: "What is in it." },
        formats: keys,
      })),
    });
    // "talk" is submitted here and "pitch" goes by email: both are formats of the call.
    expect(refusals(groups(["talk", "pitch"]))).toEqual([]);
    expect(refusals(groups(["talk"], ["pitch"]))).toEqual([]);
    // A format may be in no group.
    expect(refusals(groups(["pitch"]))).toEqual([]);
    expect(refusals(groups(["talk", "poster"]))).toEqual([
      { path: "contributionGroups.0.formats.1" },
    ]);
    expect(refusals(groups(["talk"], ["pitch", "talk"]))).toEqual([
      { path: "contributionGroups.1.formats.1" },
    ]);
    expect(refusals(groups(["talk", "talk"]))).toEqual([
      { path: "contributionGroups.0.formats.1" },
    ]);
    // A group without formats would lead nowhere.
    expect(refusals(groups([]))).toEqual([{ path: "contributionGroups.0.formats" }]);
    // Two groups cannot share a key: a setting is named by it.
    const twice = groups(["talk"], ["pitch"]);
    twice.contributionGroups[1] = { ...twice.contributionGroups[1]!, key: "group_0" };
    expect(refusals(twice)).toEqual([{ path: "contributionGroups.1.key" }]);
  });
});

describe("a review pool's guidelines and scales in the schema", () => {
  /** The made-up conference with its first pool changed. */
  const withPool = (change: Record<string, unknown>) => ({
    ...input,
    reviewPools: input.reviewPools.map((pool, i) => (i === 0 ? { ...pool, ...change } : pool)),
  });
  const refusals = (candidate: unknown) => {
    const parsed = ConferenceConfig.safeParse(candidate);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          ...(issue.code === "custom" && issue.params ? { params: issue.params } : {}),
        }));
  };

  it("takes a pool without guidelines, and keeps guidelines as they were written", () => {
    expect(config.reviewPools[0]).not.toHaveProperty("guidelines");
    // Line breaks and all, in the main language and any other.
    expect(config.reviewPools[1]?.guidelines).toEqual({
      en: "Read it twice.\n\nThen score it.",
      es: "Léelo dos veces.",
    });
    expect(refusals(withPool({ guidelines: { en: "Only in the main language." } }))).toEqual([]);
  });

  it("needs guidelines in the conference's main language, like any other text", () => {
    expect(refusals(withPool({ guidelines: { es: "Solo en español." } }))).toEqual([
      {
        path: "reviewPools.0.guidelines",
        params: { code: "default_language_required", leaf: "en" },
      },
    ]);
    // No language at all is no text in the main language either.
    expect(refusals(withPool({ guidelines: {} }))).toEqual([
      {
        path: "reviewPools.0.guidelines",
        params: { code: "default_language_required", leaf: "en" },
      },
    ]);
  });

  it("refuses guidelines that are empty, or not a text in each language", () => {
    expect(refusals(withPool({ guidelines: { en: "" } }))).toEqual([
      { path: "reviewPools.0.guidelines.en" },
    ]);
    expect(refusals(withPool({ guidelines: "Read it twice." }))).toEqual([
      { path: "reviewPools.0.guidelines" },
    ]);
  });

  it("names a scale whose smallest score is not below its largest, beside the smallest", () => {
    const scale = (min: number, max: number) =>
      refusals(withPool({ criteria: [{ key: "fit", label: { en: "Fit" }, min, max }] }));
    const named = [
      { path: "reviewPools.0.criteria.0", params: { code: "min_not_below_max", leaf: "min" } },
    ];
    expect(scale(5, 5)).toEqual(named);
    expect(scale(6, 5)).toEqual(named);
    expect(scale(0, 1)).toEqual([]);
  });

  it("takes a criterion's description like any other text, in the main language at least", () => {
    const described = (description: unknown) =>
      refusals(withPool({ criteria: [{ key: "fit", label: { en: "Fit" }, description }] }));
    expect(described({ en: "1 is off the theme, 5 is at its heart." })).toEqual([]);
    expect(described({ es: "Solo en español." })).toEqual([
      {
        path: "reviewPools.0.criteria.0.description",
        params: { code: "default_language_required", leaf: "en" },
      },
    ]);
    expect(described({ en: "" })).toEqual([{ path: "reviewPools.0.criteria.0.description.en" }]);
  });

  it("gives every pool the whole form: nothing set, a note and a recommendation", () => {
    // What a stored configuration from before the form reads as.
    expect(config.reviewPools[0]?.form).toEqual({
      comments: {},
      chairNote: { enabled: true },
      recommendation: { enabled: true },
    });
    expect(config.reviewPools[1]?.form).toEqual({
      comments: { description: { en: "Write to the artist." }, minWords: 20, maxWords: 400 },
      chairNote: { enabled: true },
      recommendation: { enabled: false },
    });
  });

  it("holds the form's limits and texts to the rules of every limit and text", () => {
    const form = (change: Record<string, unknown>) => refusals(withPool({ form: change }));
    expect(form({ comments: { minWords: 50, maxWords: 50 } })).toEqual([]);
    // The fewest words above the most: said beside the fewest.
    expect(form({ comments: { minWords: 51, maxWords: 50 } })).toEqual([
      { path: "reviewPools.0.form.comments", params: { code: "min_over_max", leaf: "minWords" } },
    ]);
    // A limit is a whole number of words, one at least.
    for (const bad of [0, -3, 2.5, "ten"]) {
      expect(form({ comments: { maxWords: bad } }), `${bad}`).toEqual([
        { path: "reviewPools.0.form.comments.maxWords" },
      ]);
      expect(form({ comments: { minWords: bad } }), `${bad}`).toEqual([
        { path: "reviewPools.0.form.comments.minWords" },
      ]);
    }
    for (const part of ["comments", "chairNote", "recommendation"]) {
      expect(form({ [part]: { description: { es: "Solo en español." } } }), part).toEqual([
        {
          path: `reviewPools.0.form.${part}.description`,
          params: { code: "default_language_required", leaf: "en" },
        },
      ]);
    }
    expect(form({ chairNote: { enabled: "no" } })).toEqual([
      { path: "reviewPools.0.form.chairNote.enabled" },
    ]);
  });

  it("takes the three blind modes, and no other", () => {
    for (const mode of ["double", "single", "open"]) {
      expect(refusals(withPool({ blindMode: mode })), mode).toEqual([]);
    }
    expect(refusals(withPool({ blindMode: "triple" }))).toEqual([
      { path: "reviewPools.0.blindMode" },
    ]);
  });
});

describe("the day reviews are due in the schema", () => {
  const due = (reviewsDue: unknown) => {
    const parsed = ConferenceConfig.safeParse({
      ...input,
      deadlines: { ...input.deadlines, reviewsDue },
    });
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          ...(issue.code === "custom" && issue.params ? { params: issue.params } : {}),
        }));
  };
  const order = [{ path: "deadlines.reviewsDue", params: { code: "reviews_due_order" } }];

  it("is optional: a call that sets none is as valid as before", () => {
    expect(config.deadlines).not.toHaveProperty("reviewsDue");
    expect(due(undefined)).toEqual([]);
  });

  it("is after the day the call closes and before the day decisions are sent", () => {
    // The call closes 2031-02-14T23:59-12:00 and decisions are sent 2031-04-30T23:59-05:00.
    expect(due("2031-03-15T23:59:00-05:00")).toEqual([]);
    // A minute after the one, a minute before the other, on any clock.
    expect(due("2031-02-15T12:00:00Z")).toEqual([]);
    expect(due("2031-05-01T04:58:00Z")).toEqual([]);
    for (const bad of [
      // The very instants the call closes and decisions are sent.
      "2031-02-14T23:59:00-12:00",
      "2031-02-15T11:59:00Z",
      "2031-04-30T23:59:00-05:00",
      "2031-01-20T12:00:00-05:00",
      "2031-06-01T12:00:00-05:00",
    ]) {
      expect(due(bad), bad).toEqual(order);
    }
  });

  it("is a date and a time with an offset, like every deadline", () => {
    for (const bad of ["2031-03-15", "2031-03-15T23:59:00", "soon", 5, null]) {
      expect(due(bad), `${bad}`).toEqual([{ path: "deadlines.reviewsDue" }]);
    }
  });
});

describe("the days before the reminder in the schema", () => {
  const days = (reviewReminderDays: unknown) =>
    ConferenceConfig.safeParse({ ...input, rules: { ...input.rules, reviewReminderDays } });

  it("is optional, and three where the chairs set none", () => {
    expect(config.rules).not.toHaveProperty("reviewReminderDays");
    expect(REVIEW_EMAILS.reminderDays).toBe(3);
    expect(reviewReminderDays(config)).toBe(3);
    const set = days(7);
    expect(set.success && reviewReminderDays(set.data)).toBe(7);
  });

  it("is a whole number of days from 1 to 30", () => {
    for (const good of [1, 3, 30]) expect(days(good).success, `${good}`).toBe(true);
    for (const bad of [0, -1, 31, 2.5, "3", null]) {
      const parsed = days(bad);
      expect(parsed.success, `${bad}`).toBe(false);
      expect(parsed.error?.issues.map((i) => i.path.join("."))).toEqual([
        "rules.reviewReminderDays",
      ]);
    }
  });

  it("needs no day reviews are due: without one it means nothing, and is kept", () => {
    const parsed = days(5);
    expect(parsed.success && parsed.data.deadlines.reviewsDue).toBeUndefined();
    expect(parsed.success && reviewReminderWindow(parsed.data)).toBeNull();
  });
});

describe("what differs between two configurations", () => {
  const edit = (change: (c: ConferenceConfig) => void) => {
    const next = structuredClone(config);
    change(next);
    return configChanges(config, next);
  };

  it("finds nothing between a configuration and its copy", () => {
    expect(edit(() => {})).toEqual([]);
    expect(
      configChanges(config, ConferenceConfig.parse(JSON.parse(JSON.stringify(config)))),
    ).toEqual([]);
  });

  it("names changed values by keys, in the order of the configuration", () => {
    expect(
      edit((c) => {
        const talk = c.submissionTypes[0] as ConferenceConfig["submissionTypes"][number];
        talk.team.max = 6;
        talk.abstract.minWords = 100;
        (talk.fields[1] as { required: boolean }).required = true;
        (talk.fields[0] as { help?: Record<string, string> }).help = { en: "What you need." };
        c.title.es = "Otro encuentro";
        delete c.theme.en;
      }),
    ).toEqual([
      { path: "title.es", before: "Encuentro inventado", after: "Otro encuentro" },
      { path: "theme.en", before: "Nothing in particular" },
      { path: "submissionTypes.talk.abstract.minWords", after: 100 },
      { path: "submissionTypes.talk.team.max", before: 4, after: 6 },
      { path: "submissionTypes.talk.fields.needs.help.en", after: "What you need." },
      { path: "submissionTypes.talk.fields.seats.required", before: false, after: true },
    ]);
  });

  it("reports a list whose keys differ as one change, and still looks inside what remains", () => {
    expect(
      edit((c) => {
        const talk = c.submissionTypes[0] as ConferenceConfig["submissionTypes"][number];
        talk.fields = [talk.fields[2], talk.fields[0]] as typeof talk.fields;
        (talk.fields[1] as { maxWords: number }).maxWords = 100;
        c.tracks = [];
        c.submissionTypes.push({ ...structuredClone(talk), key: "poster" });
      }),
    ).toEqual([
      { path: "tracks", before: ["main"], after: [] },
      { path: "submissionTypes", before: ["talk"], after: ["talk", "poster"] },
      {
        path: "submissionTypes.talk.fields",
        before: ["needs", "seats", "link"],
        after: ["link", "needs"],
      },
      { path: "submissionTypes.talk.fields.needs.maxWords", before: 200, after: 100 },
    ]);
  });

  it("treats a list of plain values, and a rule switched on, as one value", () => {
    expect(
      edit((c) => {
        c.languages = ["en"];
        c.rules.presenterCap = { max: 2, countedRoles: ["lead"] };
        c.rules.bio = { requested: true, maxWords: 250 };
      }),
    ).toEqual([
      { path: "languages", before: ["en", "es"], after: ["en"] },
      { path: "rules.presenterCap", before: null, after: { max: 2, countedRoles: ["lead"] } },
      { path: "rules.bio.requested", after: true },
      { path: "rules.bio.maxWords", after: 250 },
    ]);
  });
});

describe("changing one value", () => {
  it("removes a text that loses its last language, so an optional text can be cleared", () => {
    const withHelp = withSetting(config, "submissionTypes.talk.fields.needs.help.en", "Help");
    expect(settingAt(withHelp, "submissionTypes.talk.fields.needs.help")).toEqual({ en: "Help" });
    const cleared = withSetting(withHelp, "submissionTypes.talk.fields.needs.help.en", undefined);
    expect(settingAt(cleared, "submissionTypes.talk.fields.needs")).not.toHaveProperty("help");
    expect(configChanges(config, cleared)).toEqual([]);
  });

  it("never adds a format or a field", () => {
    const same = withSetting(config, "submissionTypes.poster.name.en", "Poster");
    expect(configChanges(config, same)).toEqual([]);
    expect(settingAt(same, "submissionTypes.poster")).toBeUndefined();
  });
});

describe("keyed paths", () => {
  it("turn the positions the schema reports into keys", () => {
    expect(keyedPath(config, ["submissionTypes", 0, "fields", 1, "label"])).toBe(
      "submissionTypes.talk.fields.seats.label",
    );
    expect(keyedPath(config, ["deadlines", "notification"])).toBe("deadlines.notification");
    // Where there is nothing to look up, the position stays.
    expect(keyedPath(config, ["submissionTypes", 4, "team"])).toBe("submissionTypes.4.team");
    expect(keyedPath(config, ["languages", 1])).toBe("languages.1");
  });
});
