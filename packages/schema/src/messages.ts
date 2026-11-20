import type { ContributionRole } from "./config";
import { hasStrayInvisible, removeStrayInvisible } from "./invisible";
import { LIMITS } from "./limits";
import { linkSpans } from "./links";

/*
 * The emails the app sends to the people on a proposal: one definition of each, shared by the
 * server, which sends them, and the settings screen, where chairs change their wording and see
 * what will be sent. Zod-free, so that the browser can use it.
 *
 * A message has a subject and a body, each with a standard text in English, Spanish and
 * Portuguese. A text names what is only known when the mail is sent with a placeholder: a name
 * in braces, "{link}" or "{conference}". A conference may hold its own wording of any subject or
 * body, language by language (`messages` in its configuration), in each of the three languages
 * whichever of them are its own; what it has not written is the standard text.
 *
 * The sign-in email is not here. It is the same for every conference (apps/server/src/mail.ts).
 */

/** The languages the app writes mail in. Each person gets theirs (mailLang() in the server). */
export const MAIL_LANGUAGES = ["en", "es", "pt"] as const;
export type MailLang = (typeof MAIL_LANGUAGES)[number];

export const isMailLanguage = (lang: string): lang is MailLang =>
  (MAIL_LANGUAGES as readonly string[]).includes(lang);

/**
 * The languages an email's wording is offered in at a conference: all three, whatever the
 * conference's own languages are, because mail goes out in any of them (an owner may invite in
 * any, and everyone else is written to in the first their profile lists). The conference's main
 * language comes first when it is one of them ("pt-BR" counts as pt), then the others in their
 * usual order.
 */
export function mailLanguagesFor(mainLanguage: string): MailLang[] {
  const main = mainLanguage.toLowerCase().split("-")[0];
  return [
    ...MAIL_LANGUAGES.filter((lang) => lang === main),
    ...MAIL_LANGUAGES.filter((lang) => lang !== main),
  ];
}

/**
 * The messages, by key. Keys are stored in configurations and in the audit log: one is never
 * renamed or reused. A stored configuration is read through the schema, so removing a key or a
 * placeholder would make a conference that uses it unreadable.
 */
export const MESSAGE_KEYS = [
  "invitation",
  "submission_received",
  "submission_withdrawn",
  "invitation_withdrawn",
  "invitation_answered",
  "draft_deleted",
] as const;
export type MailMessageKey = (typeof MESSAGE_KEYS)[number];

export const MESSAGE_PARTS = ["subject", "body"] as const;
export type MessagePart = (typeof MESSAGE_PARTS)[number];

type MessageDefinition = {
  /** The names a text of this message may hold in braces. The server has a value for each. */
  placeholders: readonly string[];
  /** Those a body must hold, because the message is useless without them. */
  required: readonly string[];
  /** Those only a body may hold: a subject that names one is refused, and is never given it. */
  bodyOnly: readonly string[];
  /**
   * Those that stand for a name a person typed: the owner's own display name, or what the owner
   * typed for someone they invited. A text must leave such a placeholder standing as a word of
   * its own, and the name put in its place is never joined to the text around it (see
   * NAME_OPENS, NAME_CLOSES and setApart).
   */
  names: readonly string[];
  standard: Record<MailLang, Record<MessagePart, string>>;
};

/**
 * Each message: its placeholders, which of them a body must hold, and the standard texts.
 *
 * What a text may name is what the message has always carried, and no more. The two messages
 * to people who were invited and have agreed to nothing (`invitation`, and the notices that
 * what they were invited to is gone) have no "{title}": ELO's signed mail does not carry text
 * an owner wrote to them, whatever wording a conference chooses. The owner's name in an
 * invitation is cleaned by the server before it is put in (sanitizeName).
 *
 * A link is required wherever a message has one. It is the only thing in the mail that says
 * which proposal it is about (titles repeat, and an invitation carries none), and for someone
 * invited it is the only way to answer. "{conference}" and "{format}" are never required: a
 * conference can name itself in its own words.
 *
 * Two things stay out of a subject:
 * - the link. An invitation's link is a secret that the server removes from its stored copy of
 *   the body once the mail is sent (redactTokens in mail.ts), and nobody can follow a link in a
 *   subject line.
 * - in an invitation, the owner's name. It is the one thing an owner wrote that reaches someone
 *   who has agreed to nothing, and it has only ever stood in the body, after ELO's own subject.
 *   A name is chosen by its owner, and the first line a person reads should not be.
 * Allowing either later would be a decision; forbidding one later would make stored
 * configurations unreadable.
 *
 * A name is a word of its own. The server takes links out of an owner's name (sanitizeName), but
 * a text could put the rest of a link around the placeholder: "https://{owner}.example" would
 * turn the name "attacker" into an address in ELO-signed mail. So the placeholders that stand
 * for a name a person typed are marked (`names`), a text may let only brackets, quotation marks
 * and the punctuation that ends a phrase touch them, and the name is set apart by a space
 * wherever it and its neighbours would still read as a link or an address.
 */
export const MESSAGES = {
  /** To someone an owner has added to a proposal, and again when the owner sends it again. */
  invitation: {
    placeholders: ["owner", "role", "format", "conference", "link"],
    // The invitee's only way to see the proposal and to confirm or decline, account or not.
    required: ["link"],
    bodyOnly: ["owner", "link"],
    // The owner's display name, cleaned by the server. Its reader has agreed to nothing.
    names: ["owner"],
    standard: {
      en: {
        subject: "{conference}: please confirm your participation",
        body: "{owner} has listed you as {role} on a proposal ({format}) for {conference}.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\n{link}\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
      },
      es: {
        subject: "{conference}: confirma tu participación",
        body: "{owner} te ha incluido con el rol de {role} en una propuesta ({format}) para {conference}.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\n{link}\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
      },
      pt: {
        subject: "{conference}: confirme a sua participação",
        body: "{owner} incluiu-o com o papel de {role} numa proposta ({format}) para {conference}.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\n{link}\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
      },
    },
  },
  /** The receipt, to everyone confirmed on a proposal when it is submitted. */
  submission_received: {
    placeholders: ["title", "format", "conference", "deadline", "link"],
    // Which proposal was received (a person may be on several), and where it can be edited.
    required: ["link"],
    bodyOnly: ["link"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: proposal received",
        body: 'Your proposal "{title}" ({format}) for {conference} has been submitted.\n\nIt can still be edited until {deadline}:\n\n{link}',
      },
      es: {
        subject: "{conference}: propuesta recibida",
        body: "Tu propuesta «{title}» ({format}) para {conference} se ha enviado.\n\nAún puede editarse hasta el {deadline}:\n\n{link}",
      },
      pt: {
        subject: "{conference}: proposta recebida",
        body: "A sua proposta «{title}» ({format}) para {conference} foi submetida.\n\nAinda pode ser editada até {deadline}:\n\n{link}",
      },
    },
  },
  /** To everyone confirmed on a proposal, and the conference's contact address, on withdrawal. */
  submission_withdrawn: {
    placeholders: ["title", "format", "conference", "link"],
    // So that its readers, the contact address among them, can tell which proposal it was.
    required: ["link"],
    bodyOnly: ["link"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: proposal withdrawn",
        body: 'The proposal "{title}" ({format}) for {conference} has been withdrawn by its owner.\n\n{link}',
      },
      es: {
        subject: "{conference}: propuesta retirada",
        body: "La propuesta «{title}» ({format}) para {conference} ha sido retirada por quien la creó.\n\n{link}",
      },
      pt: {
        subject: "{conference}: proposta retirada",
        body: "A proposta «{title}» ({format}) para {conference} foi retirada por quem a criou.\n\n{link}",
      },
    },
  },
  /** To someone still invited to a proposal that was withdrawn. Nothing an owner wrote. */
  invitation_withdrawn: {
    placeholders: ["conference"],
    // It says that something ended, and has no link to give.
    required: [],
    bodyOnly: [],
    names: [],
    standard: {
      en: {
        subject: "{conference}: a proposal you were invited to was withdrawn",
        body: "A proposal for {conference} that listed you was withdrawn by its owner. It can no longer be confirmed, and there is nothing you need to do.",
      },
      es: {
        subject: "{conference}: se retiró una propuesta a la que te invitaron",
        body: "Quien creó una propuesta para {conference} en la que figurabas la ha retirado. Ya no se puede confirmar y no tienes que hacer nada.",
      },
      pt: {
        subject: "{conference}: foi retirada uma proposta para a qual foi convidado/a",
        body: "Foi retirada por quem a criou uma proposta para {conference} em que constava. Já não pode ser confirmada e não precisa de fazer nada.",
      },
    },
  },
  /** To the owner, when someone they invited confirms or declines, or a contributor leaves. */
  invitation_answered: {
    placeholders: ["person", "answer", "conference", "link"],
    // One text serves three events: without who and what it says nothing, and without the link
    // it does not say which of the owner's proposals.
    required: ["person", "answer", "link"],
    bodyOnly: ["link"],
    // The name, or the address, the owner typed for the person. Its only reader is that owner,
    // and it is shown as typed, so it may itself be an address: the text adds nothing to it.
    names: ["person"],
    standard: {
      en: {
        subject: "{conference}: {person} {answer} your proposal",
        body: "{person} {answer} your proposal for {conference}. Check that it still meets the format's requirements:\n\n{link}",
      },
      es: {
        subject: "{conference}: {person} {answer} tu propuesta",
        body: "{person} {answer} tu propuesta para {conference}. Comprueba que sigue cumpliendo los requisitos del formato:\n\n{link}",
      },
      pt: {
        subject: "{conference}: {person} {answer} a sua proposta",
        body: "{person} {answer} a sua proposta para {conference}. Verifique se continua a cumprir os requisitos do formato:\n\n{link}",
      },
    },
  },
  /** To someone still invited to a draft that its owner deleted. Nothing an owner wrote. */
  draft_deleted: {
    placeholders: ["conference"],
    // As for a withdrawn invitation: there is nothing left to link to.
    required: [],
    bodyOnly: [],
    names: [],
    standard: {
      en: {
        subject: "{conference}: an invitation was cancelled",
        body: "A draft proposal for {conference} that listed you was deleted by its owner. There is nothing you need to do.",
      },
      es: {
        subject: "{conference}: se canceló una invitación",
        body: "Se eliminó un borrador de propuesta para {conference} en el que figurabas. No tienes que hacer nada.",
      },
      pt: {
        subject: "{conference}: um convite foi cancelado",
        body: "Foi eliminado um rascunho de proposta para {conference} em que constava. Não precisa de fazer nada.",
      },
    },
  },
} as const satisfies Record<MailMessageKey, MessageDefinition>;

/** A placeholder of a message, as a name without its braces. */
export type MessagePlaceholder<K extends MailMessageKey = MailMessageKey> =
  (typeof MESSAGES)[K]["placeholders"][number];

/** A value for each placeholder of a message, and for nothing else. */
export type MessageValues<K extends MailMessageKey> = Record<MessagePlaceholder<K>, string>;

/**
 * The words that "{role}" stands for. They read after "listed you as" and its translations, so
 * Spanish and Portuguese name the role, not the person.
 */
export const ROLE_WORDS: Record<MailLang, Record<ContributionRole, string>> = {
  en: {
    lead: "lead author",
    presenter: "presenter",
    coauthor: "co-author",
    panelist: "panelist",
    moderator: "moderator",
  },
  es: {
    lead: "autoría principal",
    presenter: "presentación",
    coauthor: "coautoría",
    panelist: "panelista",
    moderator: "moderación",
  },
  pt: {
    lead: "autoria principal",
    presenter: "apresentação",
    coauthor: "coautoria",
    panelist: "painelista",
    moderator: "moderação",
  },
};

/** What an invited person or a contributor did, as the owner is told. */
export type InvitationAnswer = "confirmed" | "declined" | "left";

/**
 * The words that "{answer}" stands for. They read between the person and "your proposal" (in
 * Spanish, "tu propuesta"; in Portuguese, "a sua proposta"), so each brings its own preposition.
 */
export const ANSWER_WORDS: Record<MailLang, Record<InvitationAnswer, string>> = {
  en: { confirmed: "confirmed", declined: "declined", left: "left" },
  es: {
    confirmed: "confirmó su participación en",
    declined: "rechazó participar en",
    left: "dejó",
  },
  pt: {
    confirmed: "confirmou a participação em",
    declined: "recusou participar em",
    left: "saiu de",
  },
};

/** What "{owner}" stands for when the owner has no name that can be shown. */
export const UNNAMED_OWNER: Record<MailLang, string> = {
  en: "Someone",
  es: "Alguien",
  pt: "Alguém",
};

const DATE_LOCALE: Record<MailLang, string> = { en: "en", es: "es-CO", pt: "pt-BR" };

/**
 * What "{deadline}" stands for: an instant in the reader's language, in the conference's time
 * zone, which is named.
 */
export function formatDeadline(iso: string, timeZone: string, lang: MailLang): string {
  const when = new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
  return `${when} (${timeZone})`;
}

/**
 * A placeholder as it is written: braces around anything that is on one line and holds no
 * brace. So "{link}" is one, and so are "{ link }", "{Link}" and "{enlace}", which are refused
 * as unknown instead of being sent as they stand. A brace on its own is ordinary text.
 */
const PLACEHOLDER = /\{([^{}\r\n]*)\}/g;

/** The names written in braces in a text, each once, in the order they first appear. */
export function placeholdersIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1] ?? ""))];
}

/** A stretch of a text: [start, end). */
export type TextSpan = { start: number; end: number };

/**
 * A text with its placeholders filled from `values`, and where the value of each placeholder
 * that `marks` names came to stand. A name `values` does not have is left as it is written.
 */
function fill(
  text: string,
  values: Readonly<Record<string, string>>,
  marks: readonly string[] = [],
): { text: string; marked: TextSpan[] } {
  let out = "";
  let from = 0;
  const marked: TextSpan[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1] ?? "";
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) continue;
    out += text.slice(from, m.index);
    if (marks.includes(name)) marked.push({ start: out.length, end: out.length + value.length });
    out += value;
    from = m.index + m[0].length;
  }
  return { text: out + text.slice(from), marked };
}

/**
 * A text with its placeholders filled from `values`. A name `values` does not have is left as
 * it is written, braces and all. Each value is put in once and is not read again: a value that
 * itself holds "{link}" stays those six characters.
 */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return fill(text, values).text;
}

/**
 * A filled text with each name set apart from what stands next to it, wherever the two together
 * read as a link or an address (linkSpans) and the name on its own does not: a space goes
 * between them, on the side where they join. `names` says where each name stands in `text`, in
 * order; the answer says where each stands afterwards.
 *
 * The rule for a text (NAME_OPENS, NAME_CLOSES) leaves little for this to do: a name that ends
 * "Tel:" before a comma, or "J.R" before a question mark, which the detectors take for a link.
 * It is also what holds whatever a text says, should one ever be stored that the rule refuses.
 * What is a link inside the name itself is not this function's: an owner's name has none left
 * (sanitizeName), and the name an owner typed for an invitee is shown to that owner as typed.
 * No standard text is changed by it: there a name has a space on either side already.
 */
function setApart(text: string, names: readonly TextSpan[]): { text: string; names: TextSpan[] } {
  let out = text;
  /** How far the spaces put in so far have moved what comes after them. */
  let moved = 0;
  const placed: TextSpan[] = [];
  for (const original of names) {
    const name = { start: original.start + moved, end: original.end + moved };
    // Looked at again after a space has gone in: with one side closed, a link on the other may
    // only then show. A name gets two spaces at most, one on each side, so three looks do.
    for (let round = 0; round < 3; round++) {
      // Nothing a detector matches holds a space, so only the words that touch the name count.
      const from = out.slice(0, name.start).search(/\S*$/u);
      const to = name.end + (/^\S*/u.exec(out.slice(name.end))?.[0].length ?? 0);
      const own = linkSpans(out.slice(name.start, name.end));
      const itsOwn = (at: number) =>
        own.some((o) => name.start + o.start <= at && at < name.start + o.end);
      let before = false;
      let after = false;
      for (const found of linkSpans(out.slice(from, to))) {
        const link = { start: from + found.start, end: from + found.end };
        if (link.start >= name.start && link.end <= name.end) continue;
        let more = false;
        for (let at = Math.max(link.start, name.start); at < Math.min(link.end, name.end); at++) {
          if (!itsOwn(at)) more = true;
        }
        if (!more) continue;
        before ||= link.start < name.start;
        after ||= link.end > name.end;
      }
      if (!before && !after) break;
      if (after) {
        out = `${out.slice(0, name.end)} ${out.slice(name.end)}`;
        moved += 1;
      }
      if (before) {
        out = `${out.slice(0, name.start)} ${out.slice(name.start)}`;
        name.start += 1;
        name.end += 1;
        moved += 1;
      }
    }
    placed.push(name);
  }
  return { text: out, names: placed };
}

/**
 * The placeholders one part of a message may hold: all of the message's in a body, and in a
 * subject those that are not for the body only (the link; in an invitation, the owner's name).
 */
export function placeholdersOf(key: MailMessageKey, part: MessagePart): readonly string[] {
  const all: readonly string[] = MESSAGES[key].placeholders;
  const bodyOnly: readonly string[] = MESSAGES[key].bodyOnly;
  return part === "subject" ? all.filter((name) => !bodyOnly.includes(name)) : all;
}

/**
 * One part of a message, filled, and where each name a person typed stands in it (for whoever
 * has to show that a name is no part of a link: the tests do). Only the placeholders that part
 * may hold are filled, whatever `values` has and whatever the text names: this is where a
 * subject is kept free of the link and of an owner's name. And a name a person typed is never
 * joined to the text around it into a link or an address (setApart).
 */
export function filledMessage(
  key: MailMessageKey,
  part: MessagePart,
  text: string,
  values: Readonly<Record<string, string>>,
): { text: string; names: TextSpan[] } {
  const allowed: Record<string, string> = {};
  for (const name of placeholdersOf(key, part)) {
    if (Object.hasOwn(values, name)) allowed[name] = values[name] ?? "";
  }
  const filled = fill(text, allowed, MESSAGES[key].names);
  return setApart(filled.text, filled.marked);
}

/** One part of a message, filled (filledMessage): the text that is sent. */
export function fillMessage(
  key: MailMessageKey,
  part: MessagePart,
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return filledMessage(key, part, text, values).text;
}

/** A conference's own wording, as its configuration holds it (`ConferenceConfig.messages`). */
export type ConferenceMessages = Partial<
  Record<MailMessageKey, Partial<Record<MessagePart, Partial<Record<MailLang, string>>>>>
>;

/**
 * The text a reader gets, for one part of a message: the conference's own in the reader's
 * language where it has written one, otherwise the standard text in the reader's language.
 * Subject and body are looked up separately. Another language's text is never used: people
 * must be able to read their mail.
 */
export function messageText(
  messages: ConferenceMessages | undefined,
  key: MailMessageKey,
  part: MessagePart,
  lang: MailLang,
): string {
  const own = messages?.[key]?.[part]?.[lang];
  // The schema refuses an empty text. Were one stored all the same, nobody gets an empty mail.
  return own ? own : MESSAGES[key].standard[lang][part];
}

/** A subject is one line: no control character (a line break is one) and no line separator. */
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/**
 * A link that something touches: text right before it, or right after it. Whatever touches an
 * address may be taken for part of it ("{link}." or "{link}{role}"), and then the link an
 * invitee needs does not work. Nothing shows that in a preview.
 */
const LINK_TOUCHED = /(?<!^|\s)\{link\}|\{link\}(?!\s|$)/u;
/**
 * What may touch a name, so that it stays a word of its own. Before it, between it and the
 * space or the start: only brackets and quotation marks that open, and the Spanish ¿ and ¡.
 * After it, up to the next space or the end: an English possessive ('s), then only brackets
 * and quotation marks that close and the punctuation that ends a phrase.
 *
 * None of these is a letter, a digit, a hyphen, an underscore, a slash, an at sign or a domain
 * dot followed by more, which is what a link or an address is made of: "({owner})",
 * "{owner}," and "{owner}'s proposal" pass; "https://{owner}.example", "{owner}.com",
 * "{owner}@example.org", "mailto:{owner}", "{owner}-site.org", "{owner}:8080" and "x{owner}"
 * do not. Everything from the name to the nearest space counts, not only the character next to
 * it, because an address runs on to the space: in "x@y.org({owner})" the bracket would not
 * stop it.
 */
const NAME_OPENS = /^[\p{Ps}\p{Pi}"'¿¡]*$/u;
const NAME_CLOSES = /^(?:['’]s)?[\p{Pe}\p{Pf}"',.;:!?…]*$/u;

export type MessageProblemCode =
  | "message_empty"
  | "message_not_one_line"
  | "message_too_long"
  | "message_unknown_placeholder"
  | "message_not_in_subject"
  | "message_missing_placeholder"
  | "message_link_touched"
  | "message_name_touched"
  | "message_invisible";

/** Why a text cannot be a message's subject or body, with what the explanation names. */
export type MessageProblem = {
  code: MessageProblemCode;
  /** `names`: the placeholders concerned, in braces. `max`: the most characters allowed. */
  values?: Record<string, string | number>;
};

/**
 * What is wrong with a text written for one part of a message; nothing when it can be sent.
 * - It has to say something that shows: spaces and invisible characters alone are nothing.
 * - It holds no invisible character that writing does not need (hasStrayInvisible: the same
 *   definition as for what an owner writes). A bidi override or a zero-width character can
 *   hide or reorder words, in ELO's own mail as in a name.
 * - A subject is one line.
 * - A subject has at most LIMITS.messageSubject characters and a body LIMITS.messageBody,
 *   before its placeholders are filled.
 * - It names only this message's placeholders, and a subject none that is for the body only
 *   (placeholdersOf).
 * - A body names every placeholder the message requires.
 * - In a body the link stands apart, with a space or a line break (or nothing) on either side.
 * - A placeholder that stands for a name a person typed stands as a word of its own
 *   (NAME_OPENS, NAME_CLOSES).
 */
export function messageProblems(
  key: MailMessageKey,
  part: MessagePart,
  text: string,
): MessageProblem[] {
  if (removeStrayInvisible(text).trim() === "") return [{ code: "message_empty" }];
  const out: MessageProblem[] = [];
  const inBraces = (names: readonly string[]) => names.map((name) => `{${name}}`).join(", ");
  if (hasStrayInvisible(text)) out.push({ code: "message_invisible" });
  if (part === "subject" && NOT_ONE_LINE.test(text)) out.push({ code: "message_not_one_line" });
  const max = part === "subject" ? LIMITS.messageSubject : LIMITS.messageBody;
  if (text.length > max) out.push({ code: "message_too_long", values: { max } });
  const written = placeholdersIn(text);
  const known: readonly string[] = MESSAGES[key].placeholders;
  const unknown = written.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    out.push({ code: "message_unknown_placeholder", values: { names: inBraces(unknown) } });
  }
  const refused = written.filter(
    (name) => known.includes(name) && !placeholdersOf(key, part).includes(name),
  );
  if (refused.length > 0) {
    out.push({ code: "message_not_in_subject", values: { names: inBraces(refused) } });
  }
  if (part === "body") {
    const required: readonly string[] = MESSAGES[key].required;
    const missing = required.filter((name) => !written.includes(name));
    if (missing.length > 0) {
      out.push({ code: "message_missing_placeholder", values: { names: inBraces(missing) } });
    }
    if (known.includes("link") && LINK_TOUCHED.test(text)) {
      out.push({ code: "message_link_touched", values: { names: inBraces(["link"]) } });
    }
  }
  const names: readonly string[] = MESSAGES[key].names;
  const touched = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1] ?? "";
    if (!names.includes(name) || !placeholdersOf(key, part).includes(name)) continue;
    const before = /\S*$/u.exec(text.slice(0, m.index))?.[0] ?? "";
    const after = /^\S*/u.exec(text.slice(m.index + m[0].length))?.[0] ?? "";
    if (!NAME_OPENS.test(before) || !NAME_CLOSES.test(after)) touched.add(name);
  }
  if (touched.size > 0) {
    out.push({ code: "message_name_touched", values: { names: inBraces([...touched]) } });
  }
  return out;
}
