import {
  ADDRESS,
  ANSWER_WORDS,
  BARE_HOST,
  type ConferenceConfig,
  type ContributionRole,
  commentsBlock,
  committeeList,
  DECISION_MESSAGES,
  DECLINE_REASON_WORDS,
  type DecisionOutcome,
  type DeclineReason,
  fillMessage,
  HOST_WITH_PATH,
  type InvitationAnswer,
  IPV4,
  LIMITS,
  type MailedComment,
  type MailLang,
  type MailMessageKey,
  type MessagePart,
  type MessageValues,
  messageText,
  ROLE_WORDS,
  reasonList,
  removeStrayInvisible,
  reviewsDueSentence,
  SCHEME_LINK,
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
 * - Invitations to a role (reviewer, chair) go to people who have agreed to nothing as well.
 *   They carry nothing a person typed: not the inviting chair's name, and not the name that
 *   chair typed for the invitee. What they name comes from the conference's configuration.
 * - The emails of the review phase (new assignments and the reminder to a reviewer; a proposal
 *   given back and a proposal with all its reviews to a chair) carry nothing a person typed
 *   either: a number, the conference, a day, a reason in the app's own words, and two links.
 *   No title, no author, no reviewer, no word of a review or of a note.
 * - The emails about a decision go to a proposal's owner and its confirmed co-authors, who are
 *   part of it: they show its title as the receipt does (oneLine), and what its reviewers wrote
 *   for the authors, cleaned as text of several lines (mailedText) and cut where it is longer
 *   than an email carries. They hold no reviewer's name, no score, no recommendation and no
 *   word of a note for the chairs: none of those is ever handed to this file.
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
 * - A name stays a word of its own. sanitizeName takes links out of an owner's name; the schema
 *   refuses a text that puts the rest of a link around the name's placeholder
 *   ("https://{owner}.example"); and the fill sets a name apart by a space wherever it and its
 *   neighbours would still read as a link or an address. One definition of what that is serves
 *   all three: packages/schema/src/links.ts.
 * Chairs' text is used as it is written, as plain text, and the schema refuses one that holds
 * invisible characters writing does not need, as owners' names are cleaned of them.
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

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * A name on one line without anything a mail client might turn into a link, and without the
 * invisible characters that could hide or reorder text.
 */
function withoutLinks(name: string): string {
  let text = name;
  // Until nothing more goes. Taking one thing out can uncover another: "1.2.3.4tel:5550100" has
  // no word break before "tel", so no link, until the numbers are gone. Every round that changes
  // the text takes something out of it, so this ends.
  for (;;) {
    // Invisible characters go first, so "evil<U+200B>.com" cannot slip past the domain rule.
    // Each removal leaves a space, so what is left on either side cannot join into a new link
    // ("evil.c1.2.3.4om" must not become "evil.com").
    const next = removeStrayInvisible(text)
      .replace(/\p{Co}/gu, "")
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
      .replace(ADDRESS, " ")
      .replace(SCHEME_LINK, " ")
      .replace(HOST_WITH_PATH, " ")
      .replace(BARE_HOST, " ")
      .replace(IPV4, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (next === text) return text;
    text = next;
  }
}

/**
 * Owner-written text for ELO-signed mail to people who have agreed to nothing (the owner's name
 * in an invitation): one line, at most 100 characters, without links. It removes anything a
 * mail client might turn into a link (URLs, bare domains, email addresses: the detectors of
 * packages/schema/src/links.ts, which an email's text is held to as well) and invisible
 * characters other than those writing needs (removeStrayInvisible), which could otherwise hide
 * or reorder text. Ordinary names ("Ana María Pérez-Gómez", "J. R. R. Tolkien", "O'Neil",
 * Persian and Indic names spelled with joiners) pass.
 */
export function sanitizeName(name: string | null | undefined, fallback: string): string {
  const clean = withoutLinks(name ?? "");
  // At most 100 code points, cut between whole characters so no flag or joiner sequence is
  // split.
  let kept = "";
  for (const { segment } of GRAPHEMES.segment(clean)) {
    if (Array.from(kept + segment).length > 100) break;
    kept += segment;
  }
  // Cleaned again. The cut can leave a joiner with nothing to join, and it can end a run of
  // digits early: "1.2.3.4567" is no address, and "1.2.3.4" is one. A name the cut did not
  // change comes out of this as it went in.
  return withoutLinks(kept) || fallback;
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
 * Text of several lines that a person wrote, for mail to people who are part of the proposal
 * it is about (a review's comments for the authors, sent with the decision): plain text, kept
 * as written, links and all, with its line breaks.
 * - Invisible format characters (bidi overrides, zero-width spaces) are removed, as from a
 *   title (removeStrayInvisible): they could hide or reorder words.
 * - Every kind of line break becomes one line feed. Tabs and other control characters become
 *   spaces, spaces at the end of a line go, and more than one empty line becomes one.
 * - Text longer than `max` characters is cut between characters and ends with an ellipsis:
 *   `cut` says so, and whoever puts it in an email says so there, never silently
 *   (commentsBlock adds a line and the link to the page that shows it whole).
 */
export function mailedText(
  text: string | null | undefined,
  max: number = LIMITS.mailedComment,
): MailedComment {
  const clean = removeStrayInvisible(text ?? "")
    .replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/[^\S\n]|(?!\n)\p{Cc}/gu, " ")
    // Line by line: a pattern for "spaces at the end of a line" takes long over a long run of
    // spaces that ends nowhere, and this runs while a send holds its rows.
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(GRAPHEMES.segment(clean), (g) => g.segment);
  if (chars.length <= max) return { text: clean, cut: false };
  // A cut can leave a joiner whose partner was cut off: clean again before the ellipsis.
  const kept = removeStrayInvisible(chars.slice(0, max - 1).join("")).trimEnd();
  return { text: `${kept}…`, cut: true };
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

/**
 * The invitation to review (spec 03, §1.2). `committees` are the names of the review pools the
 * person is invited to, as the configuration has them in the reader's language: each is put on
 * one line, and they are listed together. Nothing a person typed is in it.
 */
export function reviewerInvitationMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string; committees: readonly string[]; link: string },
): MailMessage {
  return message(wording, "reviewer_invitation", lang, to, {
    committees: committeeList(v.committees.map((name) => oneLine(name, "—"))),
    conference: v.conference,
    link: v.link,
  });
}

/** The invitation to be a chair (spec 03, §1.2): the conference and the link, and no person. */
export function chairInvitationMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: { conference: string; link: string },
): MailMessage {
  return message(wording, "chair_invitation", lang, to, {
    conference: v.conference,
    link: v.link,
  });
}

/** What the four emails of the review phase have in common. */
type ReviewPhaseMail = {
  conference: string;
  /** How many: proposals newly assigned, reviews not sent, proposals given back or complete. */
  count: number;
  /** Where the work is: "My reviews" for a reviewer, the Assignments page for a chair. */
  link: string;
  /** Where the reader says how often they want these emails: "Your account". */
  choices: string;
};

/**
 * To a reviewer: proposals were assigned to them (spec 03, §1.7). How many, when reviews are
 * due (a sentence that also says when no day is set), and the link to their list. Which
 * proposals is not said: an email holds no title and no author, in any committee. `deadline`
 * is the day reviews are due as formatDeadline writes it, or null where the chairs set none.
 */
export function newAssignmentsMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: ReviewPhaseMail & { deadline: string | null },
): MailMessage {
  return message(wording, "new_assignments", lang, to, {
    count: String(v.count),
    conference: v.conference,
    due: reviewsDueSentence(v.deadline, lang),
    link: v.link,
    choices: v.choices,
  });
}

/**
 * To a reviewer: reviews are due soon, and how many of theirs are not sent. `deadline` is the
 * day reviews are due as formatDeadline writes it: there is one, or no reminder is sent.
 */
export function reviewReminderMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: ReviewPhaseMail & { deadline: string },
): MailMessage {
  return message(wording, "review_reminder", lang, to, {
    count: String(v.count),
    conference: v.conference,
    due: reviewsDueSentence(v.deadline, lang),
    link: v.link,
    choices: v.choices,
  });
}

/**
 * To a chair: reviewers gave proposals back. How many, and the reasons that were given, each
 * once, in the app's own words. Who it was, and what they wrote for the chairs, is on the
 * proposal's page and never in an email.
 */
export function reviewerDeclinedMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: ReviewPhaseMail & { reasons: readonly DeclineReason[] },
): MailMessage {
  return message(wording, "reviewer_declined", lang, to, {
    count: String(v.count),
    reason: reasonList(v.reasons.map((reason) => DECLINE_REASON_WORDS[lang][reason])),
    conference: v.conference,
    link: v.link,
    choices: v.choices,
  });
}

/** To a chair: proposals have all the reviews their committee asks for. How many. */
export function reviewsCompleteMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: ReviewPhaseMail,
): MailMessage {
  return message(wording, "reviews_complete", lang, to, {
    count: String(v.count),
    conference: v.conference,
    link: v.link,
    choices: v.choices,
  });
}

/**
 * To a proposal's owner and each of its confirmed co-authors, when the chairs send the
 * decisions (spec 03, §1.6): the outcome, which the text of its message says, the proposal's
 * title as the receipt writes it, and the reviewers' comments for the authors, each under a
 * number. `comments` holds those comments and nothing else of a review: no reviewer, no score,
 * no recommendation, no note for the chairs. Each is cleaned and bounded here (mailedText),
 * and numbered by its place: the same comments under the same numbers as on the proposal's
 * page, which shows what was sent. None is left out here: a review with nothing to read in
 * its comments is not among them (commentsForAuthors).
 */
export function decisionMessage(
  wording: Wording,
  lang: MailLang,
  to: string,
  v: {
    outcome: DecisionOutcome;
    conference: string;
    format: string;
    title: string;
    link: string;
    comments: readonly string[];
  },
): MailMessage {
  const mailed = v.comments.map((text) => mailedText(text));
  return message(wording, DECISION_MESSAGES[v.outcome], lang, to, {
    title: oneLine(v.title, "—"),
    format: v.format,
    conference: v.conference,
    comments: commentsBlock(mailed, v.link, lang),
    link: v.link,
  });
}
