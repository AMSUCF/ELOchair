import type { Setting } from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { editsAfterSave, parts, rawOf, storedRaw } from "./settingsEdits";

/** Settings as the screen lists them, with the values a configuration stores. */
const stored = (values: Record<string, unknown>): Setting[] =>
  (
    [
      ["title.en", "text"],
      ["website", "url"],
      ["placeholder", "bool"],
      ["deadlines.notification", "datetime"],
      ["submissionTypes.paper.abstract.maxWords", "int"],
      ["submissionTypes.paper.team.max", "int"],
    ] as const
  ).map(([path, kind]) => ({ path, kind, id: "title", optional: false, value: values[path] }));

const before = stored({
  "title.en": "ELO 2027",
  placeholder: true,
  "deadlines.notification": "2027-04-30T23:59:00-05:00",
  "submissionTypes.paper.abstract.maxWords": 300,
  "submissionTypes.paper.team.max": 4,
});
const MAX = "submissionTypes.paper.abstract.maxWords";
const TEAM = "submissionTypes.paper.team.max";
const DAY = "deadlines.notification#date";
const TIME = "deadlines.notification#time";

/** The settings after `sent` was saved over `before`, the way the server stores them. */
const saved = (values: Record<string, unknown>) =>
  stored({ ...Object.fromEntries(before.map((s) => [s.path, s.value])), ...values });

describe("what a control shows for a stored value", () => {
  it("is the value as text, a ticked box, or one part of a deadline", () => {
    expect(storedRaw(before, MAX)).toBe("300");
    expect(storedRaw(before, "placeholder")).toBe(true);
    // An optional value that is absent is an empty control.
    expect(storedRaw(before, "website")).toBe("");
    expect(storedRaw(before, DAY)).toBe("2027-04-30");
    expect(storedRaw(before, TIME)).toBe("23:59");
    expect(storedRaw(before, "deadlines.notification#offset")).toBe("-05:00");
    expect(rawOf(before[0] as Setting)).toBe("ELO 2027");
    // "Z" is shown as the offset it is.
    expect(parts("2027-04-30T23:59:00Z").offset).toBe("+00:00");
  });

  it("is undefined for a key that names no control", () => {
    expect(storedRaw(before, "title.pt")).toBeUndefined();
    expect(storedRaw(before, "deadlines.notification")).toBeUndefined();
    expect(storedRaw(before, "deadlines.notification#seconds")).toBeUndefined();
    expect(storedRaw(before, "title.en#date")).toBeUndefined();
  });
});

describe("editsAfterSave", () => {
  it("leaves nothing when the form was not touched while the save was on its way", () => {
    const sent = { [MAX]: "320", placeholder: false, [DAY]: "2027-05-02" };
    const after = saved({
      [MAX]: 320,
      placeholder: false,
      "deadlines.notification": "2027-05-02T23:59:00-05:00",
    });
    expect(editsAfterSave(sent, sent, before, after)).toEqual({});
    expect(editsAfterSave(sent, { ...sent }, before, after)).toEqual({});
  });

  it("keeps a value typed again during the save, as a change to what was saved", () => {
    const sent = { [MAX]: "320" };
    const after = saved({ [MAX]: 320 });
    expect(editsAfterSave(sent, { [MAX]: "330" }, before, after)).toEqual({ [MAX]: "330" });
  });

  it("keeps a value first typed during the save, and drops the ones that were saved", () => {
    const sent = { [MAX]: "320", "title.en": "ELO 2027 in Barranquilla" };
    const after = saved({ [MAX]: 320, "title.en": "ELO 2027 in Barranquilla" });
    const current = { ...sent, [TEAM]: "6", placeholder: false };
    expect(editsAfterSave(sent, current, before, after)).toEqual({
      [TEAM]: "6",
      placeholder: false,
    });
  });

  it("keeps a value taken back during the save: it now differs from what was saved", () => {
    const sent = { [MAX]: "320", placeholder: false };
    const after = saved({ [MAX]: 320, placeholder: false });
    // Both edits were undone in the form, so the form shows 300 and a ticked box again.
    expect(editsAfterSave(sent, {}, before, after)).toEqual({ [MAX]: "300", placeholder: true });
  });

  it("has no edit where what was typed during the save is what was saved", () => {
    const sent = { [MAX]: "320" };
    // Typed "330" and then "320" again: the control shows the saved value.
    expect(editsAfterSave(sent, { [MAX]: "320" }, before, saved({ [MAX]: 320 }))).toEqual({});
    // Typed during the save, and the same value arrived in the saved configuration.
    expect(editsAfterSave({}, { [TEAM]: "6" }, before, saved({ [TEAM]: 6 }))).toEqual({});
  });

  it("shows what the server stored where it tidied an untouched value", () => {
    // " 0320 " was sent and stored as 320: the control shows 320, with nothing left to save.
    const sent = { [MAX]: " 0320 ", "title.en": "  ELO 2027, again " };
    const after = saved({ [MAX]: 320, "title.en": "ELO 2027, again" });
    expect(editsAfterSave(sent, sent, before, after)).toEqual({});
  });

  it("treats each part of a deadline on its own", () => {
    // The date was saved; the time was typed while it was being saved.
    const sent = { [DAY]: "2027-05-02" };
    const after = saved({ "deadlines.notification": "2027-05-02T23:59:00-05:00" });
    expect(editsAfterSave(sent, { ...sent, [TIME]: "18:00" }, before, after)).toEqual({
      [TIME]: "18:00",
    });
    // The date typed again during the save stays; the offset, untouched, is the stored one.
    expect(editsAfterSave(sent, { [DAY]: "2027-05-03" }, before, after)).toEqual({
      [DAY]: "2027-05-03",
    });
  });

  it("drops an edit to a value that is no longer a setting", () => {
    const sent = { [MAX]: "320" };
    const after = saved({ [MAX]: 320 }).filter((s) => s.path !== TEAM);
    expect(
      editsAfterSave(sent, { ...sent, [TEAM]: "6", "title.pt": "ELO" }, before, after),
    ).toEqual({});
  });
});
