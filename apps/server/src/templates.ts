import { type ContributionRole, LIMITS } from "@elochair/schema";
import type { MailMessage } from "./mail";

/*
 * Participant emails: fixed text in en, es and pt.
 * - Invitations go to people who have agreed to nothing yet. They carry no text an owner wrote
 *   except the owner's display name, sanitized to one line without links (sanitizeName): ELO's
 *   signed mail must not become a vehicle for someone else's message.
 * - Mail to people who are part of the proposal (confirmed contributors, its owner, the
 *   conference's contact address) shows owner-written text, such as the title, as it was
 *   typed, cleaned up to one line (oneLine).
 */

export type MailLang = "en" | "es" | "pt";

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
const LABEL = "[\\p{L}\\p{M}\\p{N}_-]+";
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
const BARE_HOST = new RegExp(`${LABEL}(?:${DOT}${LABEL})*${DOT}\\p{L}[\\p{L}\\p{M}-]+\\S*`, "gu");
/** A dotted name followed by a path, whatever it ends in ("10.0.0.1/x"). */
const HOST_WITH_PATH = new RegExp(`${LABEL}(?:${DOT}${LABEL})+[/?#]\\S*`, "gu");
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/gu;

/**
 * Owner-written text for ELO-signed mail to people who have agreed to nothing (the owner's name
 * in an invitation): one line, at most 100 characters, without links. It removes anything a
 * mail client might turn into a link (URLs, bare domains, email addresses) and invisible format
 * characters (bidi overrides, zero-width), which could otherwise hide or reorder text. Ordinary
 * names ("Ana María Pérez-Gómez", "J. R. R. Tolkien", "O'Neil") pass.
 */
export function sanitizeName(name: string | null | undefined, fallback: string): string {
  const clean = (name ?? "")
    // Format characters go first, so "evil​.com" cannot slip past the domain rule.
    .replace(/[\p{Cf}\p{Co}]/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\S*[@＠]\S*/gu, "")
    .replace(SCHEME_LINK, "")
    .replace(HOST_WITH_PATH, "")
    .replace(BARE_HOST, "")
    .replace(IPV4, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(clean).slice(0, 100).join("").trim() || fallback;
}

/**
 * Format characters that oneLine() removes: every one except zero-width (non-)joiners between
 * letters or pictographs (how Persian, Indic scripts and emoji sequences are spelled) and tag
 * sequences after a pictograph (subdivision flags). The first two alternatives match what is
 * kept; only the last one (captured) is a stray character.
 */
const FORMAT_CHAR =
  /(?<=[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}])[\u200C\u200D](?=[\p{L}\p{M}\p{Extended_Pictographic}])|(?<=\p{Extended_Pictographic})[\u{E0020}-\u{E007E}]+\u{E007F}|(\p{Cf})/gu;

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Owner-written text for mail to people who are part of the proposal (its title in receipts and
 * withdrawal notices): kept as written, links and all, on one line. Line breaks, tabs and other
 * control characters become spaces, invisible format characters (bidi overrides, zero-width
 * spaces) are removed, runs of spaces become one, and text longer than `max` characters is cut
 * between characters and ends with an ellipsis, never silently.
 */
export function oneLine(text: string | null | undefined, fallback: string, max = 300): string {
  const clean = (text ?? "")
    .replace(FORMAT_CHAR, (kept, stray: string | undefined) => (stray === undefined ? kept : ""))
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  const chars = Array.from(GRAPHEMES.segment(clean), (g) => g.segment);
  if (chars.length <= max) return clean;
  const kept = chars
    .slice(0, max - 1)
    .join("")
    .trimEnd();
  return `${kept}…`;
}

const DATE_LOCALE: Record<MailLang, string> = { en: "en", es: "es-CO", pt: "pt-BR" };

/** A deadline for mail: in the reader's language, in the conference's time zone (named). */
export function formatDeadline(iso: string, timeZone: string, lang: MailLang): string {
  const when = new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
  return `${when} (${timeZone})`;
}

const ROLE: Record<MailLang, Record<ContributionRole, string>> = {
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

const SOMEONE: Record<MailLang, string> = { en: "Someone", es: "Alguien", pt: "Alguém" };

export function invitationMessage(
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
  const owner = sanitizeName(v.ownerName, SOMEONE[lang]);
  const role = ROLE[lang][v.role];
  const text = {
    en: `${owner} has listed you as ${role} on a proposal (${v.format}) for ${v.conference}.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\n${v.link}\n\nIf you do not know this person or this proposal, decline it: you will not be listed.`,
    es: `${owner} te ha incluido con el rol de ${role} en una propuesta (${v.format}) para ${v.conference}.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\n${v.link}\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.`,
    pt: `${owner} incluiu-o com o papel de ${role} numa proposta (${v.format}) para ${v.conference}.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\n${v.link}\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.`,
  }[lang];
  const subject = {
    en: `${v.conference}: please confirm your participation`,
    es: `${v.conference}: confirma tu participación`,
    pt: `${v.conference}: confirme a sua participação`,
  }[lang];
  return { to, subject, text };
}

export function receivedMessage(
  lang: MailLang,
  to: string,
  v: { conference: string; format: string; title: string; link: string; deadline: string },
): MailMessage {
  const title = oneLine(v.title, "—");
  return {
    to,
    subject: {
      en: `${v.conference}: proposal received`,
      es: `${v.conference}: propuesta recibida`,
      pt: `${v.conference}: proposta recebida`,
    }[lang],
    text: {
      en: `Your proposal "${title}" (${v.format}) for ${v.conference} has been submitted.\n\nIt can still be edited until ${v.deadline}:\n\n${v.link}`,
      es: `Tu propuesta «${title}» (${v.format}) para ${v.conference} se ha enviado.\n\nAún puede editarse hasta el ${v.deadline}:\n\n${v.link}`,
      pt: `A sua proposta «${title}» (${v.format}) para ${v.conference} foi submetida.\n\nAinda pode ser editada até ${v.deadline}:\n\n${v.link}`,
    }[lang],
  };
}

/**
 * Withdrawal notice for confirmed contributors and the conference's contact address: the title
 * and the proposal's link, so that the contact address can tell which proposal it was.
 */
export function withdrawnMessage(
  lang: MailLang,
  to: string,
  v: { conference: string; format: string; title: string; link: string },
): MailMessage {
  const title = oneLine(v.title, "—");
  return {
    to,
    subject: {
      en: `${v.conference}: proposal withdrawn`,
      es: `${v.conference}: propuesta retirada`,
      pt: `${v.conference}: proposta retirada`,
    }[lang],
    text: {
      en: `The proposal "${title}" (${v.format}) for ${v.conference} has been withdrawn by its owner.\n\n${v.link}`,
      es: `La propuesta «${title}» (${v.format}) para ${v.conference} ha sido retirada por quien la creó.\n\n${v.link}`,
      pt: `A proposta «${title}» (${v.format}) para ${v.conference} foi retirada por quem a criou.\n\n${v.link}`,
    }[lang],
  };
}

/**
 * Withdrawal notice for people still invited: they never agreed to anything, so it carries no
 * title or other owner-written text (like the invitation itself).
 */
export function invitationWithdrawnMessage(
  lang: MailLang,
  to: string,
  v: { conference: string },
): MailMessage {
  return {
    to,
    subject: {
      en: `${v.conference}: a proposal you were invited to was withdrawn`,
      es: `${v.conference}: se retiró una propuesta a la que te invitaron`,
      pt: `${v.conference}: foi retirada uma proposta para a qual foi convidado/a`,
    }[lang],
    text: {
      en: `A proposal for ${v.conference} that listed you was withdrawn by its owner. It can no longer be confirmed, and there is nothing you need to do.`,
      es: `Quien creó una propuesta para ${v.conference} en la que figurabas la ha retirado. Ya no se puede confirmar y no tienes que hacer nada.`,
      pt: `Foi retirada por quem a criou uma proposta para ${v.conference} em que constava. Já não pode ser confirmada e não precisa de fazer nada.`,
    }[lang],
  };
}

export type Answer = "confirmed" | "declined" | "left";

/**
 * Tells the owner, its only recipient, that someone confirmed, declined or left. `who` is what
 * the owner typed when inviting them (the name, else the email address), shown as typed on one
 * line.
 */
export function answeredMessage(
  lang: MailLang,
  to: string,
  v: { conference: string; who: string; answer: Answer; link: string },
): MailMessage {
  const who = oneLine(v.who, "—", LIMITS.name);
  const verb = {
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
  }[lang][v.answer];
  return {
    to,
    subject: {
      en: `${v.conference}: ${who} ${verb} your proposal`,
      es: `${v.conference}: ${who} ${verb} tu propuesta`,
      pt: `${v.conference}: ${who} ${verb} a sua proposta`,
    }[lang],
    text: {
      en: `${who} ${verb} your proposal for ${v.conference}. Check that it still meets the format's requirements:\n\n${v.link}`,
      es: `${who} ${verb} tu propuesta para ${v.conference}. Comprueba que sigue cumpliendo los requisitos del formato:\n\n${v.link}`,
      pt: `${who} ${verb} a sua proposta para ${v.conference}. Verifique se continua a cumprir os requisitos do formato:\n\n${v.link}`,
    }[lang],
  };
}

export function draftDeletedMessage(
  lang: MailLang,
  to: string,
  v: { conference: string },
): MailMessage {
  return {
    to,
    subject: {
      en: `${v.conference}: an invitation was cancelled`,
      es: `${v.conference}: se canceló una invitación`,
      pt: `${v.conference}: um convite foi cancelado`,
    }[lang],
    text: {
      en: `A draft proposal for ${v.conference} that listed you was deleted by its owner. There is nothing you need to do.`,
      es: `Se eliminó un borrador de propuesta para ${v.conference} en el que figurabas. No tienes que hacer nada.`,
      pt: `Foi eliminado um rascunho de proposta para ${v.conference} em que constava. Não precisa de fazer nada.`,
    }[lang],
  };
}
