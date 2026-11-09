/**
 * Invisible characters in short text: what one-line fields refuse, what mail and the browser
 * remove, and the few sequences all three keep because writing systems and emoji need them.
 * Zod-free, so the browser, the server and the schema share one definition.
 */

/**
 * Invisible format characters that are part of how something is written, and are kept:
 * - zero-width (non-)joiners between letters or pictographs: Persian compound surnames, Indic
 *   scripts and emoji sequences (a skin tone counts as part of the pictograph before it, as in
 *   the woman artist with a medium skin tone, U+1F469 U+1F3FD U+200D U+1F3A8);
 * - the tags of the three standard subdivision flags (England, Scotland, Wales) after the black
 *   flag U+1F3F4. No other tag is kept: tag characters can spell out hidden text, the "ASCII
 *   smuggling" used to give instructions to AI mail readers.
 */
const KEPT =
  /(?<=[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}])[\u{200C}\u{200D}](?=[\p{L}\p{M}\p{Extended_Pictographic}])|(?<=\u{1F3F4})\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;

/** The kept sequences first, so the scan steps over them; any other format character is stray. */
const KEPT_OR_STRAY = new RegExp(`${KEPT.source}|(\\p{Cf})`, "gu");

/** Whether the text has an invisible format character that is not one of the kept sequences. */
export function hasStrayInvisible(text: string): boolean {
  return /\p{Cf}/u.test(text.replace(KEPT, ""));
}

/** Removes every invisible format character except the kept sequences. */
export function removeStrayInvisible(text: string): string {
  return text.replace(KEPT_OR_STRAY, (match, stray: string | undefined) =>
    stray === undefined ? match : "",
  );
}
