import { describe, expect, it } from "vitest";
import { Key } from "./config";
import { LocalizedText } from "./i18n";
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

  const cp = (...points: number[]) => String.fromCodePoint(...points);
  const ZWJ = 0x200d;
  /** Tag characters spelling `text`, as in subdivision flags (and in hidden-text tricks). */
  const tags = (text: string) => cp(...[...text].map((c) => 0xe0000 + c.charCodeAt(0)));
  const BLACK_FLAG = 0x1f3f4;
  const CANCEL_TAG = 0xe007f;

  it.each([
    ["woman artist, medium skin tone", `she/her ${cp(0x1f469, 0x1f3fd, ZWJ, 0x1f3a8)}`],
    ["technologist, dark skin tone", `ela/dela ${cp(0x1f9d1, 0x1f3ff, ZWJ, 0x1f4bb)}`],
    [
      "couple with heart, two skin tones",
      `they ${cp(0x1f9d1, 0x1f3fb, ZWJ, 0x2764, 0xfe0f, ZWJ, 0x1f9d1, 0x1f3ff)}`,
    ],
    ["thumbs up with a skin tone", `they ${cp(0x1f44d, 0x1f3fd)}`],
    ["woman artist", `she/her ${cp(0x1f469, ZWJ, 0x1f3a8)}`],
    ["family", `he/him ${cp(0x1f468, ZWJ, 0x1f469, ZWJ, 0x1f467)}`],
    ["transgender flag", `they/them ${cp(0x1f3f3, 0xfe0f, ZWJ, 0x26a7, 0xfe0f)}`],
    ["the flag of Scotland", `she ${cp(BLACK_FLAG)}${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["the flag of Wales", `he ${cp(BLACK_FLAG)}${tags("gbwls")}${cp(CANCEL_TAG)}`],
    [
      "a subdivision flag outside the emoji set",
      `ela ${cp(BLACK_FLAG)}${tags("usca")}${cp(CANCEL_TAG)}`,
    ],
    ["a letter from outside the BMP", `${cp(0x1d49c)}na Pérez`],
  ])("accepts emoji and astral characters: %s", (_, s) => {
    expect(name.safeParse(s).success).toBe(true);
  });

  it.each([
    ["a lone tag character", `Ana${tags("g")}`],
    ["tags without a flag", `Ana ${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["tags after another pictograph", `she ${cp(0x1f3f3)}${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["a flag's tags without the cancel tag", `she ${cp(BLACK_FLAG)}${tags("gbsct")}`],
    ["a black flag and only the cancel tag", `she ${cp(BLACK_FLAG, CANCEL_TAG)}`],
    [
      "hidden words in tags after a flag",
      `Ana ${cp(BLACK_FLAG)}${tags("ignoreall")}${cp(CANCEL_TAG)}`,
    ],
    ["hidden text with spaces", `Ana ${cp(BLACK_FLAG)}${tags("gb sct")}${cp(CANCEL_TAG)}`],
    ["a joiner after a skin tone, at the end", `they ${cp(0x1f44d, 0x1f3fd, ZWJ)}`],
    ["a joiner after a skin tone, before a space", `she ${cp(0x1f469, 0x1f3fd, ZWJ)} x`],
    ["a skin tone then a right-to-left mark", `she ${cp(0x1f469, 0x1f3fd, 0x200f)}`],
    ["a lone high surrogate", `Ana ${String.fromCharCode(0xd800)} Pérez`],
    ["a lone low surrogate", `${String.fromCharCode(0xdc00)}Ana`],
    ["surrogates in the wrong order", `Ana ${String.fromCharCode(0xdc00, 0xd800)}`],
  ])("refuses %s", (_, s) => {
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

  it.each([
    ["a lone high surrogate", String.fromCharCode(0xd800)],
    ["a lone low surrogate", String.fromCharCode(0xdc00)],
    ["a reversed pair", String.fromCharCode(0xdc00, 0xd800)],
  ])("refuses %s (Postgres refuses it in JSON: a 500, not a 400)", (_, ch) => {
    const text = `a${ch}b`;
    expect(update({ title: text })).toBe(false);
    expect(update({ abstract: text })).toBe(false);
    expect(update({ fields: { needs: text } })).toBe(false);
    expect(update({ fields: { platforms: ["web", text] } })).toBe(false);
    expect(profile({ en: text })).toBe(false);
    expect(LocalizedText.safeParse({ en: text }).success).toBe(false);
  });

  it("keeps characters outside the BMP, which are written as surrogate pairs", () => {
    const text = `Olas ${String.fromCodePoint(0x1f30a)} y ${String.fromCodePoint(0x1d49c)}`;
    expect(text).toHaveLength(12);
    expect(update({ title: text, abstract: text })).toBe(true);
    expect(update({ fields: { needs: text, platforms: [text] } })).toBe(true);
    expect(profile({ en: text })).toBe(true);
    expect(LocalizedText.safeParse({ en: text }).success).toBe(true);
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
