import {
  ANSWER_WORDS,
  type ConferenceConfig,
  type ContributionRole,
  fillMessage,
  type InvitationAnswer,
  LIMITS,
  type MailLang,
  type MailMessageKey,
  type MessagePart,
  type MessageValues,
  messageText,
  ROLE_WORDS,
  removeStrayInvisible,
  UNNAMED_OWNER,
} from "@elochair/schema";
import type { MailMessage } from "./mail";

/*
 * Participant emails, in en, es and pt. Their wording is the standard text, or the conference's
 * own where its chairs have written one (`messages` in its configuration; both are defined in
 * packages/schema/src/messages.ts). This file supplies what only the server knows: the values
 * that go into a text, cleaned.
 * - Invitations go to people who have agreed to nothing yet. They carry no text an owner wrote
 *   except the owner's display name, sanitized to one line without links (sanitizeName): ELO's
 *   signed mail must not become a vehicle for someone else's message.
 * - Mail to people who are part of the proposal (confirmed contributors, its owner, the
 *   conference's contact address) shows owner-written text, such as the title, as it was
 *   typed, cleaned up to one line (oneLine).
 *
 * A conference's own wording changes none of that:
 * - Every value is cleaned here, before it is put in, exactly as for the standard text. No text
 *   can ask for it uncleaned.
 * - A text gets the values of its own message and no others. An invitation has no title to
 *   give, whatever its text names (and the schema refuses a text that names one).
 * - Values are put in once and never read again: a name or a title that holds "{link}" stays
 *   those characters.
 * - A subject is never given the link (fillMessage), so that an invitation's link is only ever
 *   in the body, where mail.ts removes it from the stored copy. The subject of an invitation
 *   is not given the owner's name either: that stays in the body, where it has always been.
 * Chairs' text is used as it is written, as plain text.
 */

export type { MailLang };

/**
 * What these functions read of a conference's configuration: its own wording of the emails.
 * Every call passes the configuration in force, so that no mail is built without it.
 */
export type Wording = Pick<ConferenceConfig, "messages">;

/** The best supported language for a person ("pt-BR" → pt), else the fallback. */
export function mailLang(preferences: readonly string[], fallback: string): MailLang {
  for (const p of [...preferences, fallback]) {
    const base = p.toLowerCase().split("-")[0];
    if (base === "en" || base === "es" || base === "pt") return base;
  }
  return "en";
}

/** Dots that mail clients and IDNA treat as a domain separator. */
const DOT = "[.\\u3002\\uFF0E\\uFF61]";
/** A host label. Joiners count as part of it: a kept joiner must not split "evil.c<ZWJ>om". */
const LABEL = "[\\p{L}\\p{M}\\p{N}_\\u200C\\u200D-]+";
/**
 * Links with a scheme: "https://...", "ftp://...", "mailto:a@b", "tel:5550100". A scheme
 * without "//" needs a target right after its colon, so words such as "Data:" or "Tel: Aviv"
 * stay.
 */
const SCHEME_LINK =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/\S*|(?:mailto|tel|sms|callto|javascript|data):\S+)/giu;
/**
 * Bare host names ("evil-phish.com", "www.x.org/path"): a dotted name whose last label has two
 * or more letters, like every top-level domain. Initials ("J.R.R.") and "e.g." do not match.
 */
const BARE_HOST = new RegExp(
  `${LABEL}(?:${DOT}${LABEL})*${DOT}[\\u200C\\u200D]*\\p{L}[\\p{L}\\p{M}\\u200C\\u200D-]+\\S*`,
  "gu",
);
/** A dotted name followed by a path, whatever it ends in ("10.0.0.1/x"). */
const HOST_WITH_PATH = new RegExp(`${LABEL}(?:${DOT}${LABEL})+[/?#]\\S*`, "gu");
/** Four dotted numbers, marks after a digit included ("10<U+FE0F>.0.0.1"). */
const IPV4 = /(?<!\p{N})(?:\d\p{M}*){1,3}(?:\.(?:\d\p{M}*){1,3}){3}(?!\p{N})/gu;

/**
 * Owner-written text for ELO-signed mail to people who have agreed to nothing (the owner's name
 * in an invitation): one line, at most 100 characters, without links. It removes anything a
 * mail client might turn into a link (URLs, bare domains, email addresses) and invisible
 * characters other than those writing needs (removeStrayInvisible), which could otherwise hide
 * or reorder text. Ordinary names ("Ana María Pérez-Gómez", "J. R. R. Tolkien", "O'Neil",
 * Persian and Indic names spelled with joiners) pass.
 */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

export function sanitizeName(name: string | null | undefined, fallback: string): string {
  // Invisible characters go first, so "evil<U+200B>.com" cannot slip past the domain rule. Each
  // removal leaves a space, so what is left on either side can never join into a new link
  // ("evil.c1.2.3.4om" must not become "evil.com").
  const clean = removeStrayInvisible(name ?? "")
    .replace(/\p{Co}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\S*[@＠]\S*/gu, " ")
    .replace(SCHEME_LINK, " ")
    .replace(HOST_WITH_PATH, " ")
    .replace(BARE_HOST, " ")
    .replace(IPV4, " ")
    .replace(/\s+/g, " ")
    .trim();
  // At most 100 code points, cut between whole characters so no flag or joiner sequence is
  // split, then cleaned again in case a removal left a joiner with nothing to join.
  let kept = "";
  for (const { segment } of GRAPHEMES.segment(clean)) {
    if (Array.from(kept + segment).length > 100) break;
    kept += segment;
  }
  return removeStrayInvisible(kept).trim() || fallback;
}

/**
 * Owner-written text for mail to people who are part of the proposal (its title in receipts and
 * withdrawal notices): kept as written, links and all, on one line. Line breaks, tabs and other
 * control characters become spaces, invisible format characters (bidi overrides, zero-width
 * spaces) are removed, runs of spaces become one, and text longer than `max` characters is cut
 * between characters and ends with an ellipsis, never silently.
 */
export function oneLine(text: string | null | undefined, fallback: string, max = 300): string {
  // Invisible format characters go, except joiners inside words and emoji and the standard
  // subdivision flags (removeStrayInvisible).
  const clean = removeStrayInvisible(text ?? "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  const chars = Array.from(GRAPHEMES.segment(clean), (g) => g.segment);
  if (chars.length <= max) return clean;
  // A cut can leave a joiner whose partner was cut off: clean again before the ellipsis.
  const kept = removeStrayInvisible(chars.slice(0, max - 1).join("")).trimEnd();
  return `${kept}…`;
}

/**
 * One message as it is sent: for the subject and for the body, the text in force for this
 * reader's language (the conference's own where it has one, else the standard text), with the
 * values put in. `values` holds every placeholder of the message and nothing else, each already
 * cleaned by the caller.
 */
function message<K extends MailMessageKey>(
  wording: Wording,
  key: K,
  lang: MailLang,
  to: string,
  values: MessageValues<K>,
): MailMessage {
  const filled = (part: MessagePart) =>
    fillMessage(key, part, messageText(wording.messages, key, part, lang), values);
  return { to, subject: filled("subject"), text: filled("body") };
}

export function invitationMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: {
    ownerName: string | null;
    conference: string;
    format: string;
    role: ContributionRole;
    link: string;
  },
): MailMessage {
  return message(wording, "invitation", lang, to, {
    owner: sanitizeName(v.ownerName, UNNAMED_OWNER[lang]),
    role: ROLE_WORDS[lang][v.role],
    format: v.format,
    conference: v.conference,
    link: v.link,
  });
}

export function receivedMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string; format: string; title: string; link: string; deadline: string },
): MailMessage {
  return message(wording, "submission_received", lang, to, {
    title: oneLine(v.title, "—"),
    format: v.format,
    conference: v.conference,
    deadline: v.deadline,
    link: v.link,
  });
}

/**
 * Withdrawal notice for confirmed contributors and the conference's contact address: the title
 * and the proposal's link, so that the contact address can tell which proposal it was.
 */
export function withdrawnMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string; format: string; title: string; link: string },
): MailMessage {
  return message(wording, "submission_withdrawn", lang, to, {
    title: oneLine(v.title, "—"),
    format: v.format,
    conference: v.conference,
    link: v.link,
  });
}

/**
 * Withdrawal notice for people still invited: they never agreed to anything, so it carries no
 * title or other owner-written text (like the invitation itself).
 */
export function invitationWithdrawnMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string },
): MailMessage {
  return message(wording, "invitation_withdrawn", lang, to, { conference: v.conference });
}

export type Answer = InvitationAnswer;

/**
 * Tells the owner, its only recipient, that someone confirmed, declined or left. `who` is what
 * the owner typed when inviting them (the name, else the email address), shown as typed on one
 * line.
 */
export function answeredMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string; who: string; answer: Answer; link: string },
): MailMessage {
  return message(wording, "invitation_answered", lang, to, {
    person: oneLine(v.who, "—", LIMITS.name),
    answer: ANSWER_WORDS[lang][v.answer],
    conference: v.conference,
    link: v.link,
  });
}

export function draftDeletedMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string },
): MailMessage {
  return message(wording, "draft_deleted", lang, to, { conference: v.conference });
}
