import { describe, expect, it } from "vitest";
import { elo2026 } from "./conferences";
import { ConferenceConfig } from "./config";
import { isFilledValue, validateSubmission } from "./validate";

const config = ConferenceConfig.parse(elo2026);
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const base = {
  typeKey: "talk",
  trackKey: null,
  topicKeys: ["generative_ai"],
  language: "en",
  title: "A talk",
  abstract: words(275),
  fields: {},
};
const lead = [{ role: "lead" as const }];

describe("validateSubmission", () => {
  it("accepts a valid talk", () => {
    expect(validateSubmission(config, base, lead)).toEqual([]);
  });

  it("enforces word limits with counts in the params", () => {
    const short = validateSubmission(config, { ...base, abstract: words(10) }, lead);
    expect(short).toEqual([
      { path: "abstract", code: "too_few_words", params: { count: 10, min: 250 } },
    ]);
    const long = validateSubmission(config, { ...base, abstract: words(301) }, lead);
    expect(long[0]?.code).toBe("too_many_words");
  });

  it("enforces team size and a lead", () => {
    const panel = { ...base, typeKey: "panel", abstract: words(400) };
    const codes = validateSubmission(config, panel, [{ role: "panelist" }]).map((i) => i.code);
    expect(codes).toEqual(["team_size", "no_lead"]);
  });

  it("checks required and typed custom fields", () => {
    const exhibit = { ...base, typeKey: "exhibition", abstract: words(400) };
    expect(validateSubmission(config, exhibit, lead).map((i) => i.path)).toEqual([
      "fields.tools_disclosure",
    ]);
    const badUrl = { ...exhibit, fields: { work_url: "not a url", tools_disclosure: "Twine." } };
    expect(validateSubmission(config, badUrl, lead)).toEqual([
      { path: "fields.work_url", code: "wrong_kind" },
    ]);
  });

  it("rejects unknown types, tracks and topics", () => {
    expect(validateSubmission(config, { ...base, typeKey: "poster" }, lead)[0]?.code).toBe(
      "unknown_type",
    );
    const codes = validateSubmission(
      config,
      { ...base, trackKey: "nope", topicKeys: ["nope"] },
      lead,
    ).map((i) => i.code);
    expect(codes).toEqual(["unknown_track", "unknown_topic"]);
  });
});

describe("review fixes: required fields", () => {
  const withConsent = ConferenceConfig.parse({
    ...structuredClone(elo2026),
    submissionTypes: elo2026.submissionTypes.map((t) =>
      t.key === "talk"
        ? {
            ...t,
            fields: [
              {
                key: "consent",
                label: { en: "I agree to be recorded" },
                kind: "boolean",
                required: true,
              },
              { key: "note", label: { en: "Note" }, kind: "text", required: true },
            ],
          }
        : t,
    ),
  });

  it("a required checkbox must be ticked", () => {
    const paths = (fields: Record<string, string | boolean>) =>
      validateSubmission(withConsent, { ...base, fields }, lead).map((i) => i.path);
    expect(paths({ note: "x" })).toEqual(["fields.consent"]);
    expect(paths({ note: "x", consent: false })).toEqual(["fields.consent"]);
    expect(paths({ note: "x", consent: true })).toEqual([]);
  });

  it("refuses every key the type does not define: it is owner-written text", () => {
    const issues = validateSubmission(
      withConsent,
      {
        ...base,
        fields: { consent: true, note: "x", zeta: "x", maria_rodriguez_unal: "", other: false },
      },
      lead,
    );
    expect(issues).toEqual([
      { path: "fields.maria_rodriguez_unal", code: "unknown_field" },
      { path: "fields.other", code: "unknown_field" },
      { path: "fields.zeta", code: "unknown_field" },
    ]);
    // A key that another type defines ("needs" belongs to workshops) is unknown on a talk.
    expect(validateSubmission(config, { ...base, fields: { needs: "A projector" } }, lead)).toEqual(
      [{ path: "fields.needs", code: "unknown_field" }],
    );
  });

  it("counts a field as filled only with a value: ticked, non-blank, non-empty", () => {
    expect([undefined, false, "", "  \n", []].map(isFilledValue)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([true, "x", ["a"], 0, 3].map(isFilledValue)).toEqual([true, true, true, true, true]);
  });

  it("whitespace does not satisfy a required text field", () => {
    const issues = validateSubmission(
      withConsent,
      { ...base, fields: { consent: true, note: "   " } },
      lead,
    );
    expect(issues).toEqual([{ path: "fields.note", code: "required" }]);
  });
});
