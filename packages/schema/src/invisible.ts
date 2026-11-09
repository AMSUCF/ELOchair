/**
 * Invisible characters in short text: what one-line fields refuse, what mail and the browser
 * remove, and the few sequences all of them keep because writing systems and emoji need them.
 * Zod-free, so the browser, the server and the schema share one definition.
 *
 * Invisible means a format character (\p{Cf}) or a default-ignorable code point: bidi controls,
 * zero-width spaces and joiners, soft hyphens, byte-order marks, variation selectors, tag
 * characters, combining grapheme joiners, Hangul fillers. Any of them can carry hidden text
 * (one selector or tag per byte is the "ASCII smuggling" used to give instructions to AI mail
 * readers), so each is stray unless it is one of these:
 * - a zero-width (non-)joiner between two visible letters, marks, digits or pictographs, how
 *   Persian compound surnames, Indic conjuncts and emoji sequences are spelled (the pictograph
 *   before it may carry a skin tone or one emoji presentation selector, as in the transgender
 *   flag U+1F3F3 U+FE0F U+200D U+26A7 U+FE0F);
 * - one text or emoji presentation selector (U+FE0E, U+FE0F) right after an emoji character,
 *   as in the red heart U+2764 U+FE0F or the keycap 1 U+0031 U+FE0F U+20E3;
 * - the tags of the three standard subdivision flags (England, Scotland, Wales) after the black
 *   flag U+1F3F4.
 * Ideographic variation selectors (U+E0100 to U+E01EF) are not kept: each could carry a byte
 * after every ideograph, and names are recognizable without them.
 */

const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const JOINS = /[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}]/u;
const EMOJI = /\p{Emoji}/u;
const PRESENTATION = new Set(["\u{FE0E}", "\u{FE0F}"]);
const JOINERS = new Set(["\u{200C}", "\u{200D}"]);
const BLACK_FLAG = "\u{1F3F4}";
/** gbeng, gbsct and gbwls in tag characters, each followed by the cancel tag. */
const FLAG_TAGS = ["gbeng", "gbsct", "gbwls"].map(
  (id) =>
    `${Array.from(id, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("")}\u{E007F}`,
);
const FLAG_TAG_LENGTH = 6;

const visible = (c: string | undefined): c is string => c !== undefined && !INVISIBLE.test(c);
const joinable = (c: string | undefined) => visible(c) && JOINS.test(c);

/** Code points of `text`, each marked as kept or stray. */
function scan(text: string): { chars: string[]; stray: boolean[] } {
  const chars = Array.from(text);
  const stray = chars.map(() => false);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    if (c === BLACK_FLAG) {
      const tags = chars.slice(i + 1, i + 1 + FLAG_TAG_LENGTH).join("");
      if (FLAG_TAGS.includes(tags)) i += FLAG_TAG_LENGTH;
      continue;
    }
    if (!INVISIBLE.test(c)) continue;
    const prev = chars[i - 1];
    if (PRESENTATION.has(c)) {
      stray[i] = !(visible(prev) && EMOJI.test(prev));
    } else if (JOINERS.has(c)) {
      // A presentation selector belongs to the pictograph before it.
      const base =
        prev !== undefined && PRESENTATION.has(prev) && !stray[i - 1] ? chars[i - 2] : prev;
      stray[i] = !(joinable(base) && joinable(chars[i + 1]));
    } else {
      stray[i] = true;
    }
  }
  return { chars, stray };
}

/** Whether the text has an invisible character that is not one of the kept sequences. */
export function hasStrayInvisible(text: string): boolean {
  return scan(text).stray.includes(true);
}

/** Removes every invisible character except the kept sequences. */
export function removeStrayInvisible(text: string): string {
  const { chars, stray } = scan(text);
  return chars.filter((_, i) => !stray[i]).join("");
}
