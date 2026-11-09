import { describe, expect, it } from "vitest";
import { Key } from "./config";
import { AnswerInvitationInput, OneLine, ProfileInput, UpdateSubmissionInput } from "./inputs";

const name = OneLine(200);

describe("one-line text: names, affiliations, pronouns", () => {
  it.each([
    "Ana Lucía Pérez",
    "João Carlos Gonçalves",
    "Ñuñez Ibáñez",
    "O'Brien",
    "D’Angelo",
    "Jean-Luc Picard",
    "Anne-Marie de la Cruz",
    "J. R. R. Tolkien",
    "王小明",
    "李",
    "محمد عبد الله",
    "فاطمة الزهراء",
    "Νίκος Παπαδόπουλος",
    "Дмитрий Иванов",
    "प्रिया शर्मा",
    "김민지",
    "שרה כהן",
    // A Persian compound surname, joined with a zero-width non-joiner.
    "مریم حسینی\u200Cنژاد",
    "Studio 404",
    "they/them",
    // An emoji sequence built with a zero-width joiner.
    "they/them \u{1F3F3}\u{FE0F}\u200D\u{1F308}",
  ])("accepts %j", (s) => {
    expect(name.safeParse(s).success).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["Ana\nPérez", "a line break"],
    ["Ana\u0000", "NUL"],
    ["Ana\u2028Pérez", "a line separator"],
    ["Ana\u2029Pérez", "a paragraph separator"],
    ["\u200B", "only a zero-width space"],
    ["Ana\u200BPérez", "a zero-width space"],
    ["\u202Eevil.exe", "a right-to-left override"],
    ["Ana \u2066Pérez\u2069", "bidi isolates"],
    ["Ana\u200FPérez", "a right-to-left mark"],
    ["An\uFEFFa", "a byte-order mark inside"],
    ["Ana\u00ADPérez", "a soft hyphen"],
    ["\u200C", "a lone zero-width non-joiner"],
    ["Ana \u200D", "a zero-width joiner outside a word"],
    ["\u3164", "only a Hangul filler (a letter, but invisible)"],
    ["---", "no letter or digit"],
    ["—", "only a dash"],
    [". .", "only punctuation"],
  ])("refuses %j (%s)", (s) => {
    expect(name.safeParse(s).success).toBe(false);
  });

  it("applies to the name an invitee gives when confirming", () => {
    const answer = (displayName: string) =>
      AnswerInvitationInput.safeParse({ answer: "confirm", displayName }).success;
    expect(answer("Nina Newbie")).toBe(true);
    expect(answer("\u200B")).toBe(false);
  });
});

describe("free text: title, abstract, field values and bios", () => {
  const update = (patch: Record<string, unknown>) =>
    UpdateSubmissionInput.safeParse({ version: 1, ...patch }).success;
  const profile = (bios: Record<string, string>) =>
    ProfileInput.safeParse({
      displayName: "Ana",
      affiliation: null,
      country: null,
      languages: [],
      pronouns: null,
      orcid: null,
      bios,
    }).success;

  it("keeps line breaks and tabs", () => {
    const text = "First line\nsecond line\r\nthird\tline";
    expect(update({ title: "A\ttitle", abstract: text })).toBe(true);
    expect(update({ fields: { needs: text, platforms: ["web", "VR\nheadset"] } })).toBe(true);
    expect(update({ fields: { consent: true, minutes: 30 } })).toBe(true);
    expect(profile({ en: text, es: "Biografía." })).toBe(true);
  });

  it.each([
    ["NUL", "\u0000"],
    ["escape", "\u001B"],
    ["backspace", "\u0008"],
    ["delete", "\u007F"],
    ["next line (C1)", "\u0085"],
  ])("refuses %s", (_, ch) => {
    const text = `a${ch}b`;
    expect(update({ title: text })).toBe(false);
    expect(update({ abstract: text })).toBe(false);
    expect(update({ fields: { needs: text } })).toBe(false);
    expect(update({ fields: { platforms: ["web", text] } })).toBe(false);
    expect(profile({ en: text })).toBe(false);
  });
});

describe("machine keys", () => {
  it("are at most 64 characters", () => {
    expect(Key.safeParse("a".repeat(64)).success).toBe(true);
    expect(Key.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("bound custom-field keys in submissions", () => {
    const fields = (key: string) =>
      UpdateSubmissionInput.safeParse({ version: 1, fields: { [key]: "x" } }).success;
    expect(fields(`k${"x".repeat(63)}`)).toBe(true);
    expect(fields(`olga_owner_universidad_imaginaria_del_caribe_${"x".repeat(30)}`)).toBe(false);
  });
});
