import type { ContributionRole } from "./config";
import { hasStrayInvisible, removeStrayInvisible } from "./invisible";
import { LIMITS } from "./limits";
import { linkSpans } from "./links";
import type { DeclineReason } from "./reviewForm";

/*
 * The emails the app sends to the people on a proposal, to the people a chair invites to a
 * role at the conference, and to its reviewers and its chairs while proposals are reviewed: one
 * definition of each, shared by the server, which sends them, and the settings screen, where
 * chairs change their wording and see what will be sent. Zod-free, so that the browser can use
 * it.
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
 *
 * Adding a key is safe to take back. The wording of an email this version does not know (one a
 * later version added, found after the app was rolled back) is left out when a stored
 * configuration is read, so the conference loads: readStoredConfig in config.ts. A new
 * placeholder, part or language of an email that exists already has no such way back: an
 * earlier version refuses a text that uses one.
 */
export const MESSAGE_KEYS = [
  "invitation",
  "submission_received",
  "submission_withdrawn",
  "invitation_withdrawn",
  "invitation_answered",
  "draft_deleted",
  "reviewer_invitation",
  "chair_invitation",
  "new_assignments",
  "review_reminder",
  "reviewer_declined",
  "reviews_complete",
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
 * The two invitations to a role (`reviewer_invitation`, `chair_invitation`; spec 03, §1.2) go to
 * people who have agreed to nothing as well, and carry nothing a person typed at all: not the
 * name of the chair who invites, not the name that chair typed for the invitee. They name the
 * conference, for a reviewer the review pools (the committees, as the configuration names them),
 * and the link, which is the only way to answer.
 *
 * A name is a word of its own. The server takes links out of an owner's name (sanitizeName), but
 * a text could put the rest of a link around the placeholder: "https://{owner}.example" would
 * turn the name "attacker" into an address in ELO-signed mail. So the placeholders that stand
 * for a name a person typed are marked (`names`), a text may let only brackets, quotation marks
 * and the punctuation that ends a phrase touch them, and the name is set apart by a space
 * wherever it and its neighbours would still read as a link or an address.
 *
 * The four emails of the review phase (`new_assignments`, `review_reminder`, to a reviewer;
 * `reviewer_declined`, `reviews_complete`, to a chair; spec 03, §1.7) go to people who hold a
 * role at the conference, about their own work there. They carry nothing a person typed either:
 * no title, no author, no reviewer's name, no word of a review or of a note. What they name is
 * a number, the conference, a day, a reason out of three, and two links: one to the page where
 * the work is ("{link}"), and one to the person's own choices about these emails ("{choices}").
 * Both are required, and both stay out of the subject. One text serves an email about one thing
 * and a summary of several: it says how many.
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
  /**
   * To someone a chair invites to review, and again when the chair sends it again. They have
   * agreed to nothing: the text can name the conference and the committees, and no person.
   */
  reviewer_invitation: {
    placeholders: ["committees", "conference", "link"],
    // The only way to read the invitation and to accept or decline it, account or not.
    required: ["link"],
    bodyOnly: ["link"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: invitation to review proposals",
        body: "The chairs of {conference} invite you to be a reviewer ({committees}).\n\nIf you accept, the chairs will assign proposals to you; you read them and write a short review of each.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\n{link}\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
      },
      es: {
        subject: "{conference}: invitación para revisar propuestas",
        body: "Quienes presiden {conference} te invitan a revisar propuestas ({committees}).\n\nSi aceptas, te asignarán propuestas; las lees y escribes una breve revisión de cada una.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\n{link}\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
      },
      pt: {
        subject: "{conference}: convite para rever propostas",
        body: "Quem preside a {conference} convida-o/a a rever propostas ({committees}).\n\nSe aceitar, ser-lhe-ão atribuídas propostas; lê-as e escreve uma breve revisão de cada uma.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\n{link}\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
      },
    },
  },
  /** To someone a chair invites to be a chair, and again when the chair sends it again. */
  chair_invitation: {
    placeholders: ["conference", "link"],
    // As for a reviewer: without the link there is no way to answer.
    required: ["link"],
    bodyOnly: ["link"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: invitation to be a chair",
        body: "The chairs of {conference} invite you to be a chair of the conference.\n\nIf you accept, you will be able to see every proposal and everyone on it, change the conference's settings, invite people, and move the conference from one phase to the next.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\n{link}\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
      },
      es: {
        subject: "{conference}: invitación para presidir el congreso",
        body: "Quienes presiden {conference} te invitan a sumarte a la presidencia del congreso.\n\nSi aceptas, podrás ver todas las propuestas y a todas las personas que figuran en ellas, cambiar la configuración del congreso, invitar a personas y pasar el congreso de una fase a la siguiente.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\n{link}\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
      },
      pt: {
        subject: "{conference}: convite para presidir ao congresso",
        body: "Quem preside a {conference} convida-o/a a juntar-se à presidência do congresso.\n\nSe aceitar, poderá ver todas as propostas e todas as pessoas que nelas constam, alterar a configuração do congresso, convidar pessoas e passar o congresso de uma fase para a seguinte.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\n{link}\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
      },
    },
  },
  /**
   * To a reviewer, when proposals were assigned to them: one email for each, or one summary a
   * day, as they chose. It says how many, never which: the list is one tap away.
   */
  new_assignments: {
    placeholders: ["count", "conference", "due", "link", "choices"],
    // Where the proposals are, and where the person says how often they want these emails.
    required: ["link", "choices"],
    bodyOnly: ["link", "choices"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: proposals assigned to you for review",
        body: 'The chairs of {conference} have assigned proposals to you for review.\n\nNewly assigned: {count}\n{due}\n\nYour list is here, with each proposal and its review form:\n\n{link}\n\nYou are getting this email because you review for {conference}. To get these emails less often, or not at all, change your choices under "Your account":\n\n{choices}',
      },
      es: {
        subject: "{conference}: te han asignado propuestas para revisar",
        body: "Quienes presiden {conference} te han asignado propuestas para revisar.\n\nNuevas asignaciones: {count}\n{due}\n\nTu lista está aquí, con cada propuesta y su formulario de revisión:\n\n{link}\n\nRecibes este correo porque revisas para {conference}. Para recibir estos correos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\n{choices}",
      },
      pt: {
        subject: "{conference}: foram-lhe atribuídas propostas para rever",
        body: "Quem preside a {conference} atribuiu-lhe propostas para rever.\n\nNovas atribuições: {count}\n{due}\n\nA sua lista está aqui, com cada proposta e o respetivo formulário de revisão:\n\n{link}\n\nRecebe este email porque revê para {conference}. Para receber estes emails com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\n{choices}",
      },
    },
  },
  /**
   * To a reviewer who has reviews that are not sent, some days before the day reviews are due.
   * It is only sent where the chairs have set that day, which "{due}" says in a sentence, as
   * in the email about new assignments.
   */
  review_reminder: {
    placeholders: ["count", "conference", "due", "link", "choices"],
    required: ["link", "choices"],
    bodyOnly: ["link", "choices"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: reviews are due soon",
        body: 'A reminder about your reviews for {conference}.\n\n{due}\nReviews you have not sent yet: {count}\n\nYour list is here:\n\n{link}\n\nYou are getting this reminder because you review for {conference} and have reviews that are not sent. To get no reminder from this conference, change your choices under "Your account":\n\n{choices}',
      },
      es: {
        subject: "{conference}: se acerca la entrega de las revisiones",
        body: "Un recordatorio sobre tus revisiones para {conference}.\n\n{due}\nRevisiones que aún no has enviado: {count}\n\nTu lista está aquí:\n\n{link}\n\nRecibes este recordatorio porque revisas para {conference} y tienes revisiones sin enviar. Para no recibir recordatorios de este congreso, cambia tus preferencias en «Tu cuenta»:\n\n{choices}",
      },
      pt: {
        subject: "{conference}: aproxima-se a entrega das revisões",
        body: "Um lembrete sobre as suas revisões para {conference}.\n\n{due}\nRevisões que ainda não enviou: {count}\n\nA sua lista está aqui:\n\n{link}\n\nRecebe este lembrete porque revê para {conference} e tem revisões por enviar. Para não receber lembretes deste congresso, altere as suas escolhas em «A sua conta»:\n\n{choices}",
      },
    },
  },
  /**
   * To a chair, when a reviewer said they cannot review a proposal and gave it back. It says
   * how many proposals, and why in the app's own words; who it was is on the proposal's page.
   */
  reviewer_declined: {
    placeholders: ["count", "reason", "conference", "link", "choices"],
    required: ["link", "choices"],
    bodyOnly: ["link", "choices"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: proposals given back by reviewers",
        body: 'This is a notice for the chairs of {conference}.\n\nProposals that a reviewer gave back, saying they cannot review them: {count}\nReason given: {reason}\n\nThe Assignments page lists the proposals that still need reviewers first, and each proposal\'s page says who gave it back and why:\n\n{link}\n\nYou are getting this email because you are a chair of {conference}. To get these notices less often, or not at all, change your choices under "Your account":\n\n{choices}',
      },
      es: {
        subject: "{conference}: propuestas devueltas por quienes revisan",
        body: "Aviso para quienes presiden {conference}.\n\nPropuestas que alguien devolvió porque no puede revisarlas: {count}\nMotivo indicado: {reason}\n\nLa página de asignaciones muestra primero las propuestas a las que aún les falta quien las revise, y la página de cada propuesta dice quién la devolvió y por qué:\n\n{link}\n\nRecibes este correo porque presides {conference}. Para recibir estos avisos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\n{choices}",
      },
      pt: {
        subject: "{conference}: propostas devolvidas por quem revê",
        body: "Aviso para quem preside a {conference}.\n\nPropostas que alguém devolveu por não as poder rever: {count}\nMotivo indicado: {reason}\n\nA página de atribuições mostra primeiro as propostas a que ainda falta quem as reveja, e a página de cada proposta diz quem a devolveu e porquê:\n\n{link}\n\nRecebe este email porque preside a {conference}. Para receber estes avisos com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\n{choices}",
      },
    },
  },
  /** To a chair, when a proposal has as many sent reviews as its committee asks for. */
  reviews_complete: {
    placeholders: ["count", "conference", "link", "choices"],
    required: ["link", "choices"],
    bodyOnly: ["link", "choices"],
    names: [],
    standard: {
      en: {
        subject: "{conference}: proposals that have all their reviews",
        body: 'This is a notice for the chairs of {conference}.\n\nProposals that now have all the reviews their committee asks for: {count}\n\nThe Assignments page lists every proposal with how many reviews of it were sent; open a proposal to read them:\n\n{link}\n\nYou are getting this email because you are a chair of {conference}. To get these notices less often, or not at all, change your choices under "Your account":\n\n{choices}',
      },
      es: {
        subject: "{conference}: propuestas que ya tienen todas sus revisiones",
        body: "Aviso para quienes presiden {conference}.\n\nPropuestas que ya tienen todas las revisiones que pide su comité: {count}\n\nLa página de asignaciones muestra cada propuesta con las revisiones que se han enviado; abre una propuesta para leerlas:\n\n{link}\n\nRecibes este correo porque presides {conference}. Para recibir estos avisos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\n{choices}",
      },
      pt: {
        subject: "{conference}: propostas que já têm todas as revisões",
        body: "Aviso para quem preside a {conference}.\n\nPropostas que já têm todas as revisões que a respetiva comissão pede: {count}\n\nA página de atribuições mostra cada proposta com as revisões que foram enviadas; abra uma proposta para as ler:\n\n{link}\n\nRecebe este email porque preside a {conference}. Para receber estes avisos com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\n{choices}",
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

/**
 * What "{committees}" stands for: the names of the review pools a reviewer is invited to, as
 * the conference's configuration has them in the reader's language, in one list.
 */
export function committeeList(names: readonly string[]): string {
  return names.join(", ");
}

/**
 * The words that "{reason}" stands for: why a reviewer said they cannot review a proposal. They
 * read after "Reason given:" and its translations.
 */
export const DECLINE_REASON_WORDS: Record<MailLang, Record<DeclineReason, string>> = {
  en: {
    conflict: "a conflict of interest",
    expertise: "outside what they can judge",
    time: "no time",
  },
  es: {
    conflict: "un conflicto de interés",
    expertise: "fuera de lo que puede juzgar",
    time: "falta de tiempo",
  },
  pt: {
    conflict: "um conflito de interesses",
    expertise: "fora do que consegue avaliar",
    time: "falta de tempo",
  },
};

/**
 * What "{reason}" stands for in a summary of several proposals given back: each reason that was
 * given, once, in the order the app lists them.
 */
export function reasonList(reasons: readonly string[]): string {
  return reasons.join("; ");
}

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
 * What "{due}" stands for, in the two emails to a reviewer: a sentence that says when reviews
 * are due, or that the chairs have set no day. A sentence, not a date, so that a text reads
 * well either way. `when` is the day as formatDeadline writes it, or nothing.
 */
export function reviewsDueSentence(when: string | null | undefined, lang: MailLang): string {
  if (!when) return NO_REVIEWS_DUE[lang];
  const sentences: Record<MailLang, string> = {
    en: `Reviews are due by ${when}.`,
    es: `Las revisiones se entregan hasta el ${when}.`,
    pt: `As revisões são entregues até ${when}.`,
  };
  return sentences[lang];
}

const NO_REVIEWS_DUE: Record<MailLang, string> = {
  en: "The chairs have not set a day when reviews are due.",
  es: "La presidencia no ha fijado un día de entrega de las revisiones.",
  pt: "A presidência não fixou um dia de entrega das revisões.",
};

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
 * The placeholders that stand for an address: a message's link, and in the emails of the review
 * phase the link to the reader's own choices about them.
 */
const LINK_PLACEHOLDERS = ["link", "choices"] as const;
/**
 * A link that something touches: text right before it, or right after it. Whatever touches an
 * address may be taken for part of it ("{link}." or "{link}{role}"), and then the link an
 * invitee needs does not work. Nothing shows that in a preview.
 */
const LINK_TOUCHED: Record<(typeof LINK_PLACEHOLDERS)[number], RegExp> = {
  link: /(?<!^|\s)\{link\}|\{link\}(?!\s|$)/u,
  choices: /(?<!^|\s)\{choices\}|\{choices\}(?!\s|$)/u,
};
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
 * - In a body a link stands apart, with a space or a line break (or nothing) on either side:
 *   the message's own, and the link to a person's choices about the emails of the review phase.
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
    const touchedLinks = LINK_PLACEHOLDERS.filter(
      (name) => known.includes(name) && LINK_TOUCHED[name].test(text),
    );
    if (touchedLinks.length > 0) {
      out.push({ code: "message_link_touched", values: { names: inBraces(touchedLinks) } });
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
