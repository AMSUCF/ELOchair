import type { ContributionRole } from "./config";
import { removeStrayInvisible } from "./invisible";
import { LIMITS } from "./limits";

/*
 * The emails the app sends to the people on a proposal: one definition of each, shared by the
 * server, which sends them, and the settings screen, where chairs change their wording and see
 * what will be sent. Zod-free, so that the browser can use it.
 *
 * A message has a subject and a body, each with a standard text in English, Spanish and
 * Portuguese. A text names what is only known when the mail is sent with a placeholder: a name
 * in braces, "{link}" or "{conference}". A conference may hold its own wording of any subject or
 * body, language by language (`messages` in its configuration); what it has not written is the
 * standard text.
 *
 * The sign-in email is not here. It is the same for every conference (apps/server/src/mail.ts).
 */

/** The languages the app writes mail in. Each person gets theirs (mailLang() in the server). */
export const MAIL_LANGUAGES = ["en", "es", "pt"] as const;
export type MailLang = (typeof MAIL_LANGUAGES)[number];

export const isMailLanguage = (lang: string): lang is MailLang =>
  (MAIL_LANGUAGES as readonly string[]).includes(lang);

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
 */
export const MESSAGES = {
  /** To someone an owner has added to a proposal, and again when the owner sends it again. */
  invitation: {
    placeholders: ["owner", "role", "format", "conference", "link"],
    // The invitee's only way to see the proposal and to confirm or decline, account or not.
    required: ["link"],
    bodyOnly: ["owner", "link"],
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

/**
 * A text with its placeholders filled from `values`. A name `values` does not have is left as
 * it is written, braces and all. Each value is put in once and is not read again: a value that
 * itself holds "{link}" stays those six characters.
 */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (written: string, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? written) : written,
  );
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
 * One part of a message, filled. Only the placeholders that part may hold are filled, whatever
 * `values` has and whatever the text names: this is where a subject is kept free of the link
 * and of an owner's name.
 */
export function fillMessage(
  key: MailMessageKey,
  part: MessagePart,
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  const allowed: Record<string, string> = {};
  for (const name of placeholdersOf(key, part)) {
    if (Object.hasOwn(values, name)) allowed[name] = values[name] ?? "";
  }
  return fillPlaceholders(text, allowed);
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

export type MessageProblemCode =
  | "message_empty"
  | "message_not_one_line"
  | "message_too_long"
  | "message_unknown_placeholder"
  | "message_not_in_subject"
  | "message_missing_placeholder"
  | "message_link_touched";

/** Why a text cannot be a message's subject or body, with what the explanation names. */
export type MessageProblem = {
  code: MessageProblemCode;
  /** `names`: the placeholders concerned, in braces. `max`: the most characters allowed. */
  values?: Record<string, string | number>;
};

/**
 * What is wrong with a text written for one part of a message; nothing when it can be sent.
 * - It has to say something that shows: spaces and invisible characters alone are nothing.
 * - A subject is one line.
 * - A subject has at most LIMITS.messageSubject characters and a body LIMITS.messageBody,
 *   before its placeholders are filled.
 * - It names only this message's placeholders, and a subject none that is for the body only
 *   (placeholdersOf).
 * - A body names every placeholder the message requires.
 * - In a body the link stands apart, with a space or a line break (or nothing) on either side.
 */
export function messageProblems(
  key: MailMessageKey,
  part: MessagePart,
  text: string,
): MessageProblem[] {
  if (removeStrayInvisible(text).trim() === "") return [{ code: "message_empty" }];
  const out: MessageProblem[] = [];
  const inBraces = (names: readonly string[]) => names.map((name) => `{${name}}`).join(", ");
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
  return out;
}
