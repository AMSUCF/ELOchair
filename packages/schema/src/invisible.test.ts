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
    "Sinhala conjunct (virama, ZWJ)": `${cp(0xdc81, 0xdca, 0x200d, 0xdbb, 0xdd3)} Perera`,
    "red heart with emoji presentation": `Ana ${cp(0x2764, 0xfe0f)}`,
    keycap: `Sala ${cp(0x31, 0xfe0f, 0x20e3)}`,
    "eye in speech bubble": cp(0x1f441, 0xfe0f, 0x200d, 0x1f5e8, 0xfe0f),
    "transgender flag": cp(0x1f3f3, 0xfe0f, 0x200d, 0x26a7, 0xfe0f),
  };
  for (const [name, text] of Object.entries(kept)) {
    it(`keeps ${name}`, () => {
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
  };
  for (const [name, [text, cleaned]] of Object.entries(stray)) {
    it(`finds and removes ${name}`, () => {
      expect(hasStrayInvisible(text)).toBe(true);
      expect(removeStrayInvisible(text)).toBe(cleaned);
      expect(hasStrayInvisible(removeStrayInvisible(text))).toBe(false);
    });
  }
});
