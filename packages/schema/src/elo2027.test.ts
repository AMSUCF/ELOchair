import { describe, expect, it } from "vitest";
import { elo2027 } from "./conferences";
import { ConferenceConfig, type ConferenceConfigInput, effectiveBlindMode } from "./config";
import { validateSubmission } from "./validate";

/*
 * ELO 2027 as its call describes it (https://elo27.eliterature.org/, read 2026-11-10). These
 * tests are the record of what the call says; other tests use a made-up call, so changing the
 * conference only ever means changing this file.
 */

const config = ConferenceConfig.parse(elo2027);
const type = (key: string) => {
  const found = config.submissionTypes.find((t) => t.key === key);
  if (!found) throw new Error(`no format ${key}`);
  return found;
};
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const lead = [{ role: "lead" as const }];
const submission = (typeKey: string, more: Record<string, unknown> = {}) => ({
  typeKey,
  trackKey: null,
  topicKeys: [],
  language: "en",
  participationMode: "in_person" as const,
  title: "A proposal",
  abstract: words(120),
  fields: {},
  ...more,
});
const codes = (...args: Parameters<typeof validateSubmission>) =>
  validateSubmission(...args).map((i) => `${i.path}: ${i.code}`);

describe("the ELO 2027 call's formats", () => {
  it("offers the seven formats submitted here, in the call's order, and one by email", () => {
    expect(config.submissionTypes.map((t) => [t.key, t.name.en, t.name.es])).toEqual([
      ["talk", "Paper", "Ponencia"],
      ["lightning", "Lightning talk", "Charla relámpago"],
      ["panel", "Panel", "Panel"],
      ["artist_talk", "Artist talk", "Charla de artista"],
      ["workshop", "Workshop", "Taller"],
      ["performance", "Reading or performance", "Lectura o performance"],
      ["exhibition", "Work for the exhibition", "Obra para la exposición"],
    ]);
    expect(config.otherFormats.map((f) => [f.key, f.name.es])).toEqual([
      ["curatorial_pitch", "Propuesta curatorial"],
    ]);
    expect(config.otherFormats[0]?.description.en).toMatch(/by email/);
  });

  it("has the call's lengths: words and minutes", () => {
    const lengths = config.submissionTypes.map((t) => [
      t.key,
      t.abstract.maxWords,
      t.durationMinutes ?? null,
    ]);
    expect(lengths).toEqual([
      ["talk", 300, 15],
      ["lightning", 150, 5],
      ["panel", 150, null],
      ["artist_talk", 300, 15],
      ["workshop", 300, 60],
      ["performance", 300, null],
      ["exhibition", 300, null],
    ]);
    // The call gives no minimum: an abstract only has to be there.
    expect(new Set(config.submissionTypes.map((t) => t.abstract.minWords))).toEqual(new Set([1]));
  });

  it("reviews the call's academic formats anonymized and its artistic ones with names", () => {
    const modes = config.submissionTypes.map((t) => [
      t.key,
      t.reviewPool,
      effectiveBlindMode(config, t.key),
    ]);
    expect(modes).toEqual([
      ["talk", "scientific", "double"],
      ["lightning", "scientific", "double"],
      ["panel", "scientific", "double"],
      ["artist_talk", "scientific", "double"],
      ["workshop", "scientific", "double"],
      ["performance", "artistic", "single"],
      ["exhibition", "artistic", "single"],
    ]);
    const reviews = Object.fromEntries(
      config.reviewPools.map((p) => [p.key, p.reviewsPerSubmission]),
    );
    expect(reviews).toEqual({ scientific: 3, artistic: 2 });
  });

  it("takes submissions in English or Spanish, and caps lead or presenting roles at two", () => {
    expect(config.languages).toEqual(["en", "es"]);
    expect(config.rules.presenterCap).toEqual({ max: 2, countedRoles: ["lead", "presenter"] });
    expect(type("panel").countsTowardPresenterCap).toBe(false);
    expect(codes(config, submission("talk", { language: "es" }), lead)).toEqual([]);
    expect(codes(config, submission("talk", { language: "pt" }), lead)).toEqual([
      "language: unknown_language",
    ]);
  });

  it("every format's name, description, labels and help exist in en, es and pt", () => {
    const missing: string[] = [];
    const check = (where: string, text: Record<string, string> | undefined) => {
      for (const lang of ["en", "es", "pt"]) {
        if (text && !text[lang]?.trim()) missing.push(`${where}.${lang}`);
      }
    };
    for (const t of config.submissionTypes) {
      check(`${t.key}.name`, t.name);
      check(`${t.key}.description`, t.description);
      check(`${t.key}.abstract`, t.abstract.label);
      for (const f of t.fields) {
        check(`${t.key}.${f.key}.label`, f.label);
        check(`${t.key}.${f.key}.help`, f.help);
      }
    }
    for (const f of config.otherFormats) {
      check(`${f.key}.name`, f.name);
      check(`${f.key}.description`, f.description);
    }
    expect(missing).toEqual([]);
  });
});

describe("submitting to ELO 2027", () => {
  it("a paper takes up to 300 words and must not be empty", () => {
    expect(codes(config, submission("talk", { abstract: words(300) }), lead)).toEqual([]);
    expect(codes(config, submission("talk", { abstract: words(1) }), lead)).toEqual([]);
    expect(codes(config, submission("talk", { abstract: words(301) }), lead)).toEqual([
      "abstract: too_many_words",
    ]);
    expect(codes(config, submission("talk", { abstract: "  " }), lead)).toEqual([
      "abstract: too_few_words",
    ]);
  });

  it("a lightning talk takes up to 150 words", () => {
    expect(codes(config, submission("lightning", { abstract: words(150) }), lead)).toEqual([]);
    expect(codes(config, submission("lightning", { abstract: words(151) }), lead)).toEqual([
      "abstract: too_many_words",
    ]);
  });

  it("a panel needs three to six people, a rationale of up to 150 words, and its papers' abstracts", () => {
    const three = [
      { role: "lead" as const },
      { role: "panelist" as const },
      { role: "panelist" as const },
    ];
    const full = submission("panel", { fields: { paper_abstracts: words(450) } });
    expect(codes(config, full, three)).toEqual([]);
    expect(codes(config, full, lead)).toEqual(["contributions: team_size"]);
    expect(codes(config, submission("panel"), three)).toEqual(["fields.paper_abstracts: required"]);
    expect(codes(config, { ...full, abstract: words(151) }, three)).toEqual([
      "abstract: too_many_words",
    ]);
    // Six abstracts of 150 words and their titles fit; a seventh does not.
    const long = { ...full, fields: { paper_abstracts: words(1001) } };
    expect(codes(config, long, three)).toEqual(["fields.paper_abstracts: too_many_words"]);
  });

  it("a workshop says how many people it expects and what it needs", () => {
    expect(codes(config, submission("workshop"), lead)).toEqual([
      "fields.participants: required",
      "fields.needs: required",
    ]);
    const filled = submission("workshop", { fields: { participants: 20, needs: "A projector." } });
    expect(codes(config, filled, lead)).toEqual([]);
    const text = submission("workshop", { fields: { participants: "twenty", needs: "x" } });
    expect(codes(config, text, lead)).toEqual(["fields.participants: wrong_kind"]);
  });

  it("a workshop is for 15 to 30 people, as the call says", () => {
    const withPeople = (participants: number) =>
      validateSubmission(
        config,
        submission("workshop", { fields: { participants, needs: "A projector." } }),
        lead,
      );
    expect(withPeople(15)).toEqual([]);
    expect(withPeople(30)).toEqual([]);
    for (const n of [14, 31, 0, -5]) {
      expect(withPeople(n)).toEqual([
        { path: "fields.participants", code: "out_of_range", params: { min: 15, max: 30 } },
      ]);
    }
  });

  it("readings, performances and exhibition works need only an abstract; a link is optional", () => {
    for (const key of ["performance", "exhibition", "artist_talk"]) {
      expect(codes(config, submission(key, { abstract: words(300) }), lead)).toEqual([]);
    }
    const linked = submission("exhibition", { fields: { work_url: "https://example.net/work" } });
    expect(codes(config, linked, lead)).toEqual([]);
    const bad = submission("performance", { fields: { work_url: "not a link" } });
    expect(codes(config, bad, lead)).toEqual(["fields.work_url: wrong_kind"]);
    // The 2026 formats are gone.
    expect(codes(config, submission("experimental"), lead)).toEqual(["typeKey: unknown_type"]);
  });
});

describe("a range on a number field", () => {
  const withField = (field: Record<string, unknown>): string[] => {
    const input = structuredClone(elo2027);
    const workshop = input.submissionTypes.find((t) => t.key === "workshop");
    if (!workshop?.fields?.[0]) throw new Error("no workshop field");
    Object.assign(workshop.fields[0], field);
    const r = ConferenceConfig.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it("may have one end only, but not its ends the wrong way round", () => {
    expect(withField({ min: 1, max: undefined })).toEqual([]);
    expect(withField({ min: 30, max: 15 })).toEqual([
      "submissionTypes.4.fields.0: min must not exceed max",
    ]);
  });

  it("belongs to number fields only", () => {
    expect(withField({ kind: "text" })).toEqual([
      "submissionTypes.4.fields.0: min and max are for number fields",
    ]);
  });
});

describe("formats handled outside the portal", () => {
  const withOther = (other: ConferenceConfigInput["otherFormats"]): string[] => {
    const r = ConferenceConfig.safeParse({ ...structuredClone(elo2027), otherFormats: other });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  const text = { en: "x", es: "x", pt: "x" };

  it("are optional, and need a name and a description in the default language", () => {
    expect(withOther(undefined)).toEqual([]);
    expect(withOther([{ key: "poster", name: text, description: text }])).toEqual([]);
    expect(withOther([{ key: "poster", name: { es: "x" }, description: text }])).toEqual([
      "otherFormats.0.name",
    ]);
  });

  it("cannot repeat a key, or reuse the key of a format that is submitted here", () => {
    const one = { key: "poster", name: text, description: text };
    expect(withOther([one, one])).toEqual(["otherFormats.1.key"]);
    expect(withOther([{ ...one, key: "talk" }])).toEqual(["otherFormats.0.key"]);
  });
});
