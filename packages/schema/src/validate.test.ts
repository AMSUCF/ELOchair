import { describe, expect, it } from "vitest";
import { elo2026 } from "./conferences";
import { ConferenceConfig } from "./config";
import { validateSubmission } from "./validate";

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
