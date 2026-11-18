import { describe, expect, it } from "vitest";
import * as conferences from "./conferences";
import { ConferenceConfig, type ConferenceConfigInput } from "./config";
import {
  chairMayChange,
  configChanges,
  keyedPath,
  type Setting,
  settingAt,
  stageOneSettings,
  withSetting,
} from "./settings";

/** A small made-up conference: two languages, one format with a field of each relevant kind. */
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
      criteria: [{ key: "fit", label: { en: "Fit" } }],
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

describe("what a chair may change", () => {
  it("allows the stage-one values of existing formats, fields, tracks and topics", () => {
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
    ]) {
      expect(chairMayChange(path, config), path).toBe(true);
    }
  });

  it("allows a text only in a language the conference has", () => {
    // English and Spanish here. A text that is missing in one of them may be written.
    expect(config.theme.es).toBeUndefined();
    expect(chairMayChange("theme.es", config)).toBe(true);
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
      expect(chairMayChange(path, config), path).toBe(false);
    }
    // The same paths are a chair's where the conference has those languages.
    const wider = { ...config, languages: ["en", "es", "fr", "pt", "pt-BR", "de"] };
    expect(chairMayChange("title.fr", wider)).toBe(true);
    expect(chairMayChange("theme.pt-BR", wider)).toBe(true);
    // The list of languages itself stays an admin's, so a chair cannot widen it first.
    expect(chairMayChange("languages", wider)).toBe(false);
  });

  it("sees a crafted configuration that adds a language to a text as a change it refuses", () => {
    const crafted = structuredClone(config);
    crafted.title.fr = "Réunion inventée";
    const type = crafted.submissionTypes[0];
    if (!type) throw new Error("no format");
    type.name.fr = "Exposé";
    // The schema takes the extra texts: it is this check that keeps them an admin's.
    expect(ConferenceConfig.safeParse(crafted).success).toBe(true);
    const changed = configChanges(config, crafted).map((c) => c.path);
    expect(changed).toEqual(["title.fr", `submissionTypes.${type.key}.name.fr`]);
    expect(changed.filter((path) => !chairMayChange(path, config))).toEqual(changed);
  });

  it("allows a field's setting only on a stored field of a kind that has it", () => {
    // "needs" is a long text, "seats" a number, "link" a web address.
    const field = (key: string, setting: string) => `submissionTypes.talk.fields.${key}.${setting}`;
    for (const path of [
      field("needs", "maxWords"),
      field("seats", "min"),
      field("seats", "max"),
      field("seats", "integer"),
    ]) {
      expect(chairMayChange(path, config), path).toBe(true);
    }
    for (const path of [
      field("seats", "maxWords"),
      field("link", "maxWords"),
      field("needs", "min"),
      field("needs", "max"),
      field("needs", "integer"),
      field("link", "min"),
      field("link", "integer"),
      // A field the format does not have has no settings.
      field("nope", "maxWords"),
      "submissionTypes.nope.fields.needs.maxWords",
    ]) {
      expect(chairMayChange(path, config), path).toBe(false);
    }
    // It is the stored field's kind that counts: a field that is a number here has a range.
    const other = structuredClone(config);
    const needs = other.submissionTypes[0]?.fields[0];
    if (!needs) throw new Error("no field");
    needs.kind = "number";
    expect(chairMayChange(field("needs", "min"), other)).toBe(true);
    expect(chairMayChange(field("needs", "maxWords"), other)).toBe(false);
  });

  it("sees a crafted configuration that gives a field a setting its kind lacks as a change it refuses", () => {
    const crafted = structuredClone(config);
    const fields = crafted.submissionTypes[0]?.fields ?? [];
    const seats = fields.find((f) => f.key === "seats");
    const link = fields.find((f) => f.key === "link");
    if (!seats || !link) throw new Error("no field");
    seats.maxWords = 42;
    link.maxWords = 7;
    // The schema takes a word limit on any field: it is this check that keeps it off these two.
    expect(ConferenceConfig.safeParse(crafted).success).toBe(true);
    const changed = configChanges(config, crafted).map((c) => c.path);
    expect(changed).toEqual([
      "submissionTypes.talk.fields.seats.maxWords",
      "submissionTypes.talk.fields.link.maxWords",
    ]);
    expect(changed.filter((path) => !chairMayChange(path, config))).toEqual(changed);
  });

  it("leaves everything else to admins", () => {
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
      "agreements.privacy.version",
      "agreements.privacy.text.en",
      "reviewPools.committee.blindMode",
      "reviewPools.committee.criteria.fit.label.en",
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
      "nonsense",
    ]) {
      expect(chairMayChange(path, config), path).toBe(false);
    }
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
  });

  it("has no setting for a rule the conference does not have", () => {
    expect(paths(settings).filter((p) => p.startsWith("rules."))).toEqual([]);
    const withRules = ConferenceConfig.parse({
      ...input,
      rules: {
        presenterCap: { max: 2, countedRoles: ["lead"] },
        bio: { requested: true, maxWords: 300 },
      },
    });
    expect(paths(stageOneSettings(withRules)).filter((p) => p.startsWith("rules."))).toEqual([
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
  const all = [config, ...Object.values(conferences).map((c) => ConferenceConfig.parse(c))];

  it("offers only values a chair may change, each at its own path", () => {
    for (const c of all) {
      const found = stageOneSettings(c);
      expect(new Set(paths(found)).size).toBe(found.length);
      for (const s of found) {
        expect(chairMayChange(s.path, c), s.path).toBe(true);
        expect(settingAt(c, s.path), s.path).toEqual(s.value);
      }
      // Every text is offered in each language of the conference, and in no other.
      const offered = new Set(found.flatMap((s) => (s.lang ? [s.lang] : [])));
      expect([...offered].sort()).toEqual([...c.languages].sort());
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
