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
  };
  for (const [name, [text, cleaned]] of Object.entries(stray)) {
    it(`finds and removes ${name}`, () => {
      expect(hasStrayInvisible(text)).toBe(true);
      expect(removeStrayInvisible(text)).toBe(cleaned);
      expect(hasStrayInvisible(removeStrayInvisible(text))).toBe(false);
    });
  }
});
