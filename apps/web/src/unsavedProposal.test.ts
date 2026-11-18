import type { ConferenceConfig, CustomField, SubmissionType } from "@elochair/schema";
import { describe, expect, it } from "vitest";
import { readUnsaved, type Store, writeUnsaved } from "./unsaved";
import { fitField, type ProposalForm, withUnsaved } from "./unsavedProposal";

/** A made-up format's field: only what restoring looks at is filled in. */
const field = (key: string, kind: CustomField["kind"], more: Partial<CustomField> = {}) =>
  ({
    key,
    label: { en: key },
    kind,
    required: false,
    identifying: false,
    public: false,
    ...more,
  }) satisfies CustomField;

/** localStorage as a Map: what goes in comes back as the text it was stored as. */
function memoryStore(): Store {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const options = (...keys: string[]) => keys.map((key) => ({ key, label: { en: key } }));

const fields: CustomField[] = [
  field("people", "number", { min: 15, max: 30, integer: true }),
  field("budget", "number"),
  field("needs", "longtext"),
  field("link", "url"),
  field("recorded", "boolean"),
  field("room", "select", { options: options("small", "large") }),
  field("gear", "multiselect", { options: options("screen", "sound") }),
];
// Restoring reads a format's fields and a conference's languages, tracks and topics: no more.
const type = { key: "workshop", fields } as unknown as SubmissionType;
const config = {
  languages: ["en", "es"],
  tracks: [{ key: "main", name: { en: "Main" } }],
  topics: [{ key: "sound", label: { en: "Sound" } }],
} as unknown as ConferenceConfig;

const saved: ProposalForm = {
  title: "Mapping attention by hand",
  abstract: "",
  trackKey: null,
  topicKeys: [],
  language: "en",
  participationMode: "in_person",
  fields: { needs: "Tables." },
};

describe("fitField", () => {
  const by = (key: string) => fields.find((f) => f.key === key) as CustomField;

  it("gives a number field its number back, whole or not, and nothing that is not a number", () => {
    expect(fitField(by("people"), 20)).toBe(20);
    // Out of range or fractional is still what the person typed: the form says what is wrong.
    expect(fitField(by("people"), 15.5)).toBe(15.5);
    expect(fitField(by("people"), 40)).toBe(40);
    expect(fitField(by("budget"), 0)).toBe(0);
    expect(fitField(by("people"), "20")).toBeUndefined();
    expect(fitField(by("people"), true)).toBeUndefined();
    expect(fitField(by("people"), ["20"])).toBeUndefined();
  });

  it("gives text, links and ticks back only as what they are", () => {
    expect(fitField(by("needs"), "Pens.")).toBe("Pens.");
    expect(fitField(by("needs"), "")).toBe("");
    expect(fitField(by("link"), "https://example.org/work")).toBe("https://example.org/work");
    expect(fitField(by("needs"), 3)).toBeUndefined();
    expect(fitField(by("recorded"), false)).toBe(false);
    expect(fitField(by("recorded"), "yes")).toBeUndefined();
  });

  it("drops a choice the field no longer offers", () => {
    expect(fitField(by("room"), "large")).toBe("large");
    expect(fitField(by("room"), "huge")).toBeUndefined();
    expect(fitField(by("gear"), ["screen", "sound"])).toEqual(["screen", "sound"]);
    expect(fitField(by("gear"), ["screen", "smoke"])).toEqual(["screen"]);
    // Nothing of what was ticked is offered any more: no answer, not "nothing ticked".
    expect(fitField(by("gear"), ["smoke"])).toBeUndefined();
    // Everything unticked on purpose stays that.
    expect(fitField(by("gear"), [])).toEqual([]);
    expect(fitField(by("gear"), "screen")).toBeUndefined();
  });
});

describe("withUnsaved", () => {
  it("puts a whole-number answer back as a number after a trip through the browser's store", () => {
    const store = memoryStore();
    writeUnsaved(store, "p1", "submission:s1", 3, { "fields.people": 20, title: "Mapping" });
    const found = readUnsaved(store, "p1", "submission:s1");
    const form = withUnsaved(saved, found?.values ?? {}, config, type);
    expect(form.fields.people).toBe(20);
    expect(form.title).toBe("Mapping");
    // What was not changed stays as saved.
    expect(form.fields.needs).toBe("Tables.");
  });

  it("clears a field that was emptied, and leaves the saved copy alone", () => {
    const form = withUnsaved(saved, { "fields.needs": null }, config, type);
    expect(form.fields).toEqual({});
    expect(saved.fields).toEqual({ needs: "Tables." });
  });

  it("leaves out a value for a field the format no longer has", () => {
    const form = withUnsaved(
      saved,
      { "fields.tools_disclosure": "A model wrote none of it.", "fields.people": 18 },
      config,
      type,
    );
    expect(form.fields).toEqual({ needs: "Tables.", people: 18 });
    // With no format at all (it was removed), no field value comes back.
    expect(withUnsaved(saved, { "fields.people": 18 }, config, undefined).fields).toEqual({
      needs: "Tables.",
    });
  });

  it("leaves out a language, a track and topics the conference no longer offers", () => {
    const form = withUnsaved(
      saved,
      { language: "pt", trackKey: "gone", topicKeys: ["sound", "gone"] },
      config,
      type,
    );
    expect(form.language).toBe("en");
    expect(form.trackKey).toBeNull();
    expect(form.topicKeys).toEqual(["sound"]);
    expect(withUnsaved(saved, { language: "es", trackKey: "main" }, config, type)).toMatchObject({
      language: "es",
      trackKey: "main",
    });
  });

  it("leaves out a value of the wrong kind, so nothing malformed is sent", () => {
    const form = withUnsaved(
      saved,
      { "fields.people": "twenty", "fields.needs": 7, title: 3, participationMode: "by_post" },
      config,
      type,
    );
    expect(form).toEqual(saved);
  });
});
