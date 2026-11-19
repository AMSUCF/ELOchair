import { describe, expect, it } from "vitest";
import { elo2026, elo2027 } from "./conferences";
import { ConferenceConfig, type ConferenceConfigInput, effectiveBlindMode } from "./config";

const clone = (c: ConferenceConfigInput): ConferenceConfigInput => structuredClone(c);

function issuePaths(input: ConferenceConfigInput): string[] {
  const r = ConferenceConfig.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}

describe("ConferenceConfig", () => {
  it("accepts the ELO 2026 and ELO 2027 configurations", () => {
    expect(issuePaths(elo2026)).toEqual([]);
    expect(issuePaths(elo2027)).toEqual([]);
  });

  it("a configuration is final unless it says it is a placeholder", () => {
    expect(ConferenceConfig.parse(elo2026).placeholder).toBe(false);
    expect(ConferenceConfig.parse({ ...clone(elo2026), placeholder: true }).placeholder).toBe(true);
  });

  it("rejects a type that points at a missing review pool", () => {
    const c = clone(elo2026);
    c.submissionTypes[0] = { ...c.submissionTypes[0]!, reviewPool: "nonexistent" };
    expect(issuePaths(c)).toContain("submissionTypes.0.reviewPool");
  });

  it("rejects text missing the default language", () => {
    const c = clone(elo2027);
    c.submissionTypes[1] = { ...c.submissionTypes[1]!, name: { es: "Ponencia" } };
    expect(issuePaths(c)).toContain("submissionTypes.1.name");
  });

  it("rejects duplicate keys, inverted limits and out-of-order deadlines", () => {
    const c = clone(elo2026);
    c.tracks = [...(c.tracks ?? []), { key: "narratives_worlds", name: { en: "Again" } }];
    c.submissionTypes[1] = {
      ...c.submissionTypes[1]!,
      abstract: { label: { en: "x" }, minWords: 400, maxWords: 300 },
      team: { min: 3, max: 1 },
    };
    c.deadlines = { ...c.deadlines, notification: "2026-01-01T00:00:00Z" };
    const paths = issuePaths(c);
    expect(paths).toContain("tracks.3.key");
    expect(paths).toContain("submissionTypes.1.abstract");
    expect(paths).toContain("submissionTypes.1.team");
    expect(paths).toContain("deadlines.notification");
  });

  it("rejects an unknown time zone and a select field without options", () => {
    const c = clone(elo2026);
    c.timezone = "Mars/Olympus_Mons";
    c.submissionTypes[2] = {
      ...c.submissionTypes[2]!,
      fields: [{ key: "format", label: { en: "Format" }, kind: "select" }],
    };
    const paths = issuePaths(c);
    expect(paths).toContain("timezone");
    expect(paths).toContain("submissionTypes.2.fields.0.options");
  });
});

describe("effectiveBlindMode", () => {
  const c2026 = ConferenceConfig.parse(elo2026);

  it("uses the pool default unless the type overrides it", () => {
    expect(effectiveBlindMode(c2026, "talk")).toBe("double");
    expect(effectiveBlindMode(c2026, "exhibition")).toBe("single"); // the artistic pool's default
    expect(effectiveBlindMode(c2026, "performance")).toBe("double"); // 2026 override
  });

  it("fails closed for unknown types", () => {
    expect(effectiveBlindMode(c2026, "mystery")).toBe("double");
  });
});

describe("review fixes: configuration rules", () => {
  it("requires final materials strictly before the first day, in the conference's time zone", () => {
    const sameDay = clone(elo2026);
    sameDay.deadlines = { ...sameDay.deadlines, finalMaterials: "2026-07-15T09:00:00-04:00" };
    expect(issuePaths(sameDay)).toContain("deadlines.finalMaterials");
    // 2026-07-15T02:00Z is still July 14 in New York: allowed.
    const eveBefore = clone(elo2026);
    eveBefore.deadlines = { ...eveBefore.deadlines, finalMaterials: "2026-07-15T02:00:00Z" };
    expect(issuePaths(eveBefore)).not.toContain("deadlines.finalMaterials");
  });

  it("rejects fixed offsets and abbreviations as time zones", () => {
    for (const tz of ["+05:00", "EST", "GMT-5"]) {
      const c = clone(elo2026);
      c.timezone = tz;
      expect(issuePaths(c)).toContain("timezone");
    }
    const utc = clone(elo2026);
    utc.timezone = "UTC";
    expect(issuePaths(utc)).toEqual([]);
  });

  it("rejects duplicate option keys in a select field", () => {
    const c = clone(elo2026);
    c.submissionTypes[2] = {
      ...c.submissionTypes[2]!,
      fields: [
        {
          key: "format",
          label: { en: "Format" },
          kind: "select",
          options: [
            { key: "online", label: { en: "Online" } },
            { key: "online", label: { en: "Also online" } },
          ],
        },
      ],
    };
    expect(issuePaths(c)).toContain("submissionTypes.2.fields.0.options.1.key");
  });
});

describe("conference details shown on its page", () => {
  it("website and coordinates are optional", () => {
    const c = ConferenceConfig.parse(elo2026);
    expect(c.website).toBeUndefined();
    expect(c.coordinates).toBeUndefined();
  });

  it.each<[string, Partial<ConferenceConfigInput>, string]>([
    ["a website that is not https", { website: "http://elo27.eliterature.org/" }, "website"],
    ["a website that is not a URL", { website: "elo27.eliterature.org" }, "website"],
    ["a script URL", { website: "javascript:alert(1)" }, "website"],
    ["a latitude off the globe", { coordinates: { lat: 91, lon: 0 } }, "coordinates.lat"],
    ["a longitude off the globe", { coordinates: { lat: 0, lon: -181 } }, "coordinates.lon"],
  ])("rejects %s", (_, change, path) => {
    expect(issuePaths({ ...clone(elo2027), ...change })).toEqual([path]);
  });
});
