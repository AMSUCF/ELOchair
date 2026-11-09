import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hasStrayInvisible, removeStrayInvisible } from "./invisible";

const cp = (...points: number[]) => String.fromCodePoint(...points);
const tags = (ascii: string) =>
  Array.from(ascii, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
const BLACK_FLAG = cp(0x1f3f4);
const CANCEL = cp(0xe007f);
const flag = (id: string) => `${BLACK_FLAG}${tags(id)}${CANCEL}`;

describe("invisible characters", () => {
  const kept = {
    "Persian compound with ZWNJ": `می${cp(0x200c)}خواهم`,
    "woman artist, medium skin tone": cp(0x1f469, 0x1f3fd, 0x200d, 0x1f3a8),
    family: cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    Scotland: `Ailsa ${flag("gbsct")}`,
    England: flag("gbeng"),
    Wales: flag("gbwls"),
    "Sinhala conjunct (virama, ZWJ)": `${cp(0xdc1, 0xdca, 0x200d, 0xdbb, 0xdd3)} Perera`,
    // Legacy chillus: consonant, virama, joiner at the end of a word (Mohanlal; Bengali khanda ta).
    "Malayalam legacy chillus": cp(
      0xd2e,
      0xd4b,
      0xd39,
      0xd28,
      0xd4d,
      0x200d,
      0xd32,
      0xd3e,
      0xd32,
      0xd4d,
      0x200d,
    ),
    "Bengali khanda ta": `${cp(0x9b8, 0x9a4, 0x9cd, 0x200d)} Roy`,
    "red heart with emoji presentation": `Ana ${cp(0x2764, 0xfe0f)}`,
    keycap: `Sala ${cp(0x31, 0xfe0f, 0x20e3)}`,
    "eye in speech bubble": cp(0x1f441, 0xfe0f, 0x200d, 0x1f5e8, 0xfe0f),
    "transgender flag": cp(0x1f3f3, 0xfe0f, 0x200d, 0x26a7, 0xfe0f),
  };
  for (const [name, text] of Object.entries(kept)) {
    it(`keeps ${name}`, () => {
      expect(/\p{Cs}/u.test(text)).toBe(false);
      expect(hasStrayInvisible(text)).toBe(false);
      expect(removeStrayInvisible(text)).toBe(text);
    });
  }

  const stray: Record<string, [string, string]> = {
    "a direction mark": [`Nina${cp(0x200e)}`, "Nina"],
    "a bidi override": [`Ana ${cp(0x202e)}moc.live`, "Ana moc.live"],
    "a zero-width space": [`Ana${cp(0x200b)}Pérez`, "AnaPérez"],
    "a soft hyphen": [`Nu${cp(0xad)}ñez`, "Nuñez"],
    "a joiner at the start": [`${cp(0x200d)}Ana`, "Ana"],
    // Tags spelling hidden text after black flags, in chunks that look like subdivision ids.
    "hidden text in flag-shaped chunks": [
      `Ana ${["ignore", "allpre", "vious"].map(flag).join("")}`,
      `Ana ${BLACK_FLAG}${BLACK_FLAG}${BLACK_FLAG}`,
    ],
    "a subdivision that is not a standard emoji flag": [`${flag("usca")}`, BLACK_FLAG],
    "tags after another pictograph": [
      `Poems ${cp(0x1f4ce)}${tags("IGNORE")}${CANCEL}`,
      `Poems ${cp(0x1f4ce)}`,
    ],
    "lone tags": [`a${tags("hi")}b`, "ab"],
    // One byte per variation selector after visible letters ("emoji smuggling").
    "variation selectors after letters": [
      `Ana${Array.from("hi", (c) => cp(0xfe00 + (c.charCodeAt(0) & 15))).join("")} Pérez`,
      "Ana Pérez",
    ],
    "supplementary variation selectors": [`Ana${cp(0xe0100, 0xe0141, 0xe0142)}`, "Ana"],
    "ideographic variation selectors": [`${cp(0x845b, 0xe0100)}西`, `${cp(0x845b)}西`],
    "two presentation selectors in a row": [cp(0x2764, 0xfe0f, 0xfe0f), cp(0x2764, 0xfe0f)],
    "unassigned tag-plane characters": [`Ana${cp(0xe00c1, 0xe00c2)}`, "Ana"],
    "combining grapheme joiners": [`Ana${cp(0x34f, 0x34f, 0x34f)}`, "Ana"],
    "a joiner chained to an invisible mark": [`Ana${cp(0x200d, 0x34f, 0x200d, 0xfe0f)}b`, "Anab"],
    "Hangul fillers": [`Ana${cp(0x3164)} ${cp(0x115f)}`, "Ana "],
    "a Mongolian free variation selector": [`Ana${cp(0x180b)}`, "Ana"],
    // No Latin, Greek or Cyrillic spelling needs a joiner: there it could only mark letters.
    "joiners between Latin letters": [`A${cp(0x200c)}na P${cp(0x200d)}érez`, "Ana Pérez"],
    "a joiner between Cyrillic letters": [`Ан${cp(0x200d)}на`, "Анна"],
    // After a digit, # or *, a presentation selector belongs only in a keycap.
    "a presentation selector after a digit": [`Sala 1${cp(0xfe0f)}2`, "Sala 12"],
    "halves of surrogate pairs": [`Ana${"\uDB40"}${cp(0x200b)}${"\uDC68"} Pérez`, "Ana Pérez"],
  };
  for (const [name, [text, cleaned]] of Object.entries(stray)) {
    it(`finds and removes ${name}`, () => {
      expect(hasStrayInvisible(text)).toBe(true);
      expect(removeStrayInvisible(text)).toBe(cleaned);
      expect(hasStrayInvisible(removeStrayInvisible(text))).toBe(false);
    });
  }

  // Any string at all, broken surrogates included: what is removed leaves nothing stray behind,
  // and cleaning twice changes nothing.
  it("leaves no stray character in any string, and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 40 }), (text) => {
        const once = removeStrayInvisible(text);
        expect(hasStrayInvisible(once)).toBe(false);
        expect(removeStrayInvisible(once)).toBe(once);
        expect(hasStrayInvisible(text)).toBe(once !== text);
      }),
      { numRuns: 20_000 },
    );
  });

  it("holds for strings built from the characters the rules are about", () => {
    const atoms = [
      ..."aÄ ن1#*",
      ...[0xd30, 0xd4d, 0x915, 0x94d, 0xdbb, 0xdca, 0x2764, 0x20e3].map((c) => cp(c)),
      ...[0x200c, 0x200d, 0xfe0e, 0xfe0f, 0x200b, 0x34f, 0xe0100].map((c) => cp(c)),
      ...[0x1f469, 0x1f3fd, 0x1f3a8, 0x1f3f4, 0x1f3f3, 0x26a7].map((c) => cp(c)),
      ...[0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f].map((c) => cp(c)),
      "\uDB40",
      "\uDC68",
      flag("gbsct"),
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 24 }), (parts) => {
        const text = parts.join("");
        const once = removeStrayInvisible(text);
        expect(hasStrayInvisible(once)).toBe(false);
        expect(removeStrayInvisible(once)).toBe(once);
      }),
      { numRuns: 50_000 },
    );
  });
});
