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

  it("marks 2027 as a placeholder and 2026 as final", () => {
    expect(ConferenceConfig.parse(elo2027).placeholder).toBe(true);
    expect(ConferenceConfig.parse(elo2026).placeholder).toBe(false);
  });

  it("2027 has every user-facing string in en, es and pt", () => {
    const missing: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) {
        for (const [i, x] of v.entries()) walk(x, `${path}.${i}`);
      } else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("en" in o && typeof o.en === "string") {
          for (const l of ["es", "pt"]) if (typeof o[l] !== "string") missing.push(`${path}.${l}`);
        } else for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
      }
    };
    walk(elo2027, "elo2027");
    expect(missing).toEqual([]);
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
  const c2027 = ConferenceConfig.parse(elo2027);

  it("uses the pool default unless the type overrides it", () => {
    expect(effectiveBlindMode(c2026, "talk")).toBe("double");
    expect(effectiveBlindMode(c2026, "exhibition")).toBe("single");
    expect(effectiveBlindMode(c2026, "performance")).toBe("double"); // 2026 override
    expect(effectiveBlindMode(c2027, "performance")).toBe("single"); // 2027 default
  });

  it("fails closed for unknown types", () => {
    expect(effectiveBlindMode(c2026, "mystery")).toBe("double");
  });
});
