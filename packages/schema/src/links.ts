/*
 * What a mail client might turn into a link or an address. One definition, Zod-free, for the
 * two places that keep a person's name from becoming one:
 * - the server takes these out of an owner's name before it goes into ELO-signed mail to
 *   someone who has agreed to nothing (sanitizeName in apps/server/src/templates.ts);
 * - an email's text, which chairs may word themselves, must not build one around a name
 *   (messages.ts: the rule for a name's neighbours, and the space that sets a name apart).
 *
 * The detectors err on the side of matching: "Tel:," and "J.R?" are no links to any mail
 * client, and both count here. Each is a global expression. Use them with `replace` and
 * `matchAll` only, which leave no state behind; never with `test` or `exec`.
 */

/** Dots that mail clients and IDNA treat as a domain separator. */
const DOT = "[.\\u3002\\uFF0E\\uFF61]";
/** A host label. Joiners count as part of it: a kept joiner must not split "evil.c<ZWJ>om". */
const LABEL = "[\\p{L}\\p{M}\\p{N}_\\u200C\\u200D-]+";

/** Anything with an at sign in it, to the spaces around it: an email address or a handle. */
export const ADDRESS = /\S*[@＠]\S*/gu;
/**
 * Links with a scheme: "https://...", "ftp://...", "mailto:a@b", "tel:5550100". A scheme
 * without "//" needs a target right after its colon, so words such as "Data:" or "Tel: Aviv"
 * stay.
 */
export const SCHEME_LINK =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/\S*|(?:mailto|tel|sms|callto|javascript|data):\S+)/giu;
/**
 * Bare host names ("evil-phish.com", "www.x.org/path"): a dotted name whose last label has two
 * or more letters, like every top-level domain. Initials ("J.R.R.") and "e.g." do not match.
 */
export const BARE_HOST = new RegExp(
  `${LABEL}(?:${DOT}${LABEL})*${DOT}[\\u200C\\u200D]*\\p{L}[\\p{L}\\p{M}\\u200C\\u200D-]+\\S*`,
  "gu",
);
/** A dotted name followed by a path, whatever it ends in ("10.0.0.1/x"). */
export const HOST_WITH_PATH = new RegExp(`${LABEL}(?:${DOT}${LABEL})+[/?#]\\S*`, "gu");
/** Four dotted numbers, marks after a digit included ("10<U+FE0F>.0.0.1"). */
export const IPV4 = /(?<!\p{N})(?:\d\p{M}*){1,3}(?:\.(?:\d\p{M}*){1,3}){3}(?!\p{N})/gu;

/** Every detector, in the order the server applies them to a name. */
export const LINK_DETECTORS: readonly RegExp[] = [
  ADDRESS,
  SCHEME_LINK,
  HOST_WITH_PATH,
  BARE_HOST,
  IPV4,
];

/** Where a text holds something a detector takes for a link or an address: [start, end). */
export function linkSpans(text: string): { start: number; end: number }[] {
  return LINK_DETECTORS.flatMap((detector) =>
    Array.from(text.matchAll(detector), (m) => ({
      start: m.index,
      end: m.index + m[0].length,
    })),
  ).filter((span) => span.end > span.start);
}
