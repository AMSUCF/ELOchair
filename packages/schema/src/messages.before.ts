import type { MailLang, MailMessageKey } from "./messages";

/*
 * What the participant emails said before a conference could change their wording: the proof
 * that a conference which customizes nothing still sends the same mail, byte for byte.
 *
 * These strings were not written by hand. They are the output of the six functions of
 * apps/server/src/templates.ts as they stood at commit 0a849b0 (their texts were template
 * literals then), called with the `input` of each case: every message in en, es and pt, every
 * role and every answer, an owner without a name, and names and titles that the server cleans
 * (a name that is someone's link, a title on two lines). Two tests compare against them:
 * - packages/schema/src/messages.test.ts fills the standard texts with the same values;
 * - apps/server/src/messages.test.ts calls the functions as they are now.
 *
 * The two invitations to a role (`reviewer_invitation`, `chair_invitation`) came later, with the
 * People page. Their cases, at the end, are the output of their two functions in templates.ts
 * as they were first written: every language, one committee and two, committee names that the
 * server cleans, and the invitation to be a chair. `committees` holds the names it was called
 * with, separated by " | ".
 *
 * The four emails of the review phase (`new_assignments`, `review_reminder`,
 * `reviewer_declined`, `reviews_complete`) came with those emails. Their cases, at the end, are
 * the output of their four functions in templates.ts as they were first written: every
 * language; new assignments with a day reviews are due and without one; a proposal given back
 * for one reason, and several for all three; and each email about one thing and about several.
 * `deadline` is the day as the caller had formatted it, or null where the chairs set none;
 * `reasons` holds the reasons it was called with, separated by " | ".
 *
 * The three emails about a decision (`decision_accepted`, `decision_waitlisted`,
 * `decision_rejected`) came with decisions. Their cases, at the end, are the output of their
 * function in templates.ts (decisionMessage) as it was first written: every language and every
 * outcome; an accept with two reviewers' comments, one of them in two paragraphs; a waiting
 * list with a title and comments that the server cleans (an invisible character, a tab, a line
 * break of another kind, spaces at the end of a line, too many empty lines); and a reject that
 * comes with no comments. `comments` holds the comments it was called with, separated by
 * " | ", and is empty where there were none.
 *
 * A case changes only when the standard wording is changed on purpose, and then in the same
 * commit as the text in messages.ts. People and conferences are made up.
 */

export type MessageBefore = {
  key: MailMessageKey;
  lang: MailLang;
  /** What the server's function was called with (after the language and the recipient). */
  input: Record<string, string | null>;
  /** What the server made of a value before putting it in, by placeholder, where it cleaned it. */
  cleaned?: Record<string, string>;
  subject: string;
  text: string;
};

export const MESSAGES_BEFORE: readonly MessageBefore[] = [
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "lead",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana María Pérez-Gómez has listed you as lead author on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "presenter",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana María Pérez-Gómez has listed you as presenter on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "coauthor",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana María Pérez-Gómez has listed you as co-author on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "panelist",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana María Pérez-Gómez has listed you as panelist on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "moderator",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana María Pérez-Gómez has listed you as moderator on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: null,
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "coauthor",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Someone has listed you as co-author on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "invitation",
    lang: "en",
    input: {
      ownerName: "Ana evil-phish.com Pérez\u202E see https://evil.example/x",
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      role: "presenter",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
    },
    cleaned: { owner: "Ana Pérez see" },
    subject: "Made-up Meeting 2031: please confirm your participation",
    text: "Ana Pérez see has listed you as presenter on a proposal (Short talk) for Made-up Meeting 2031.\n\nOpen this link to see the proposal and confirm or decline. You can decline without an account:\n\nhttps://chair.example.org/en/invitation#token=made-up-token\n\nIf you do not know this person or this proposal, decline it: you will not be listed.",
  },
  {
    key: "submission_received",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "Poems with p5.js",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "February 15, 2031 at 6:59 AM (America/Bogota)",
    },
    subject: "Made-up Meeting 2031: proposal received",
    text: 'Your proposal "Poems with p5.js" (Short talk) for Made-up Meeting 2031 has been submitted.\n\nIt can still be edited until February 15, 2031 at 6:59 AM (America/Bogota):\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "submission_withdrawn",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "Poems with p5.js",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Made-up Meeting 2031: proposal withdrawn",
    text: 'The proposal "Poems with p5.js" (Short talk) for Made-up Meeting 2031 has been withdrawn by its owner.\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "submission_received",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "February 15, 2031 at 6:59 AM (America/Bogota)",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Made-up Meeting 2031: proposal received",
    text: 'Your proposal "A title in two lines, with a tab here" (Short talk) for Made-up Meeting 2031 has been submitted.\n\nIt can still be edited until February 15, 2031 at 6:59 AM (America/Bogota):\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "submission_withdrawn",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Made-up Meeting 2031: proposal withdrawn",
    text: 'The proposal "A title in two lines, with a tab here" (Short talk) for Made-up Meeting 2031 has been withdrawn by its owner.\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "submission_received",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "February 15, 2031 at 6:59 AM (America/Bogota)",
    },
    cleaned: { title: "—" },
    subject: "Made-up Meeting 2031: proposal received",
    text: 'Your proposal "—" (Short talk) for Made-up Meeting 2031 has been submitted.\n\nIt can still be edited until February 15, 2031 at 6:59 AM (America/Bogota):\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "submission_withdrawn",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "—" },
    subject: "Made-up Meeting 2031: proposal withdrawn",
    text: 'The proposal "—" (Short talk) for Made-up Meeting 2031 has been withdrawn by its owner.\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "invitation_withdrawn",
    lang: "en",
    input: { conference: "Made-up Meeting 2031" },
    subject: "Made-up Meeting 2031: a proposal you were invited to was withdrawn",
    text: "A proposal for Made-up Meeting 2031 that listed you was withdrawn by its owner. It can no longer be confirmed, and there is nothing you need to do.",
  },
  {
    key: "invitation_answered",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      who: "Bruno Coauthor",
      answer: "confirmed",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Made-up Meeting 2031: Bruno Coauthor confirmed your proposal",
    text: "Bruno Coauthor confirmed your proposal for Made-up Meeting 2031. Check that it still meets the format's requirements:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      who: "Bruno Coauthor",
      answer: "declined",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Made-up Meeting 2031: Bruno Coauthor declined your proposal",
    text: "Bruno Coauthor declined your proposal for Made-up Meeting 2031. Check that it still meets the format's requirements:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      who: "Bruno Coauthor",
      answer: "left",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Made-up Meeting 2031: Bruno Coauthor left your proposal",
    text: "Bruno Coauthor left your proposal for Made-up Meeting 2031. Check that it still meets the format's requirements:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      who: "bruno@example.org\nBcc: someone",
      answer: "declined",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { person: "bruno@example.org Bcc: someone" },
    subject: "Made-up Meeting 2031: bruno@example.org Bcc: someone declined your proposal",
    text: "bruno@example.org Bcc: someone declined your proposal for Made-up Meeting 2031. Check that it still meets the format's requirements:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "draft_deleted",
    lang: "en",
    input: { conference: "Made-up Meeting 2031" },
    subject: "Made-up Meeting 2031: an invitation was cancelled",
    text: "A draft proposal for Made-up Meeting 2031 that listed you was deleted by its owner. There is nothing you need to do.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "lead",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana María Pérez-Gómez te ha incluido con el rol de autoría principal en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "presenter",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana María Pérez-Gómez te ha incluido con el rol de presentación en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "coauthor",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana María Pérez-Gómez te ha incluido con el rol de coautoría en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "panelist",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana María Pérez-Gómez te ha incluido con el rol de panelista en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "moderator",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana María Pérez-Gómez te ha incluido con el rol de moderación en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: null,
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "coauthor",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Alguien te ha incluido con el rol de coautoría en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "invitation",
    lang: "es",
    input: {
      ownerName: "Ana evil-phish.com Pérez\u202E see https://evil.example/x",
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      role: "presenter",
      link: "https://chair.example.org/es/invitation#token=made-up-token",
    },
    cleaned: { owner: "Ana Pérez see" },
    subject: "Encuentro Inventado 2031: confirma tu participación",
    text: "Ana Pérez see te ha incluido con el rol de presentación en una propuesta (Charla breve) para Encuentro Inventado 2031.\n\nAbre este enlace para ver la propuesta y confirmar o rechazar. Puedes rechazar sin tener cuenta:\n\nhttps://chair.example.org/es/invitation#token=made-up-token\n\nSi no conoces a esta persona o esta propuesta, recházala: no aparecerás en ella.",
  },
  {
    key: "submission_received",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota)",
    },
    subject: "Encuentro Inventado 2031: propuesta recibida",
    text: "Tu propuesta «Poems with p5.js» (Charla breve) para Encuentro Inventado 2031 se ha enviado.\n\nAún puede editarse hasta el 15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota):\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encuentro Inventado 2031: propuesta retirada",
    text: "La propuesta «Poems with p5.js» (Charla breve) para Encuentro Inventado 2031 ha sido retirada por quien la creó.\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_received",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota)",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Encuentro Inventado 2031: propuesta recibida",
    text: "Tu propuesta «A title in two lines, with a tab here» (Charla breve) para Encuentro Inventado 2031 se ha enviado.\n\nAún puede editarse hasta el 15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota):\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Encuentro Inventado 2031: propuesta retirada",
    text: "La propuesta «A title in two lines, with a tab here» (Charla breve) para Encuentro Inventado 2031 ha sido retirada por quien la creó.\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_received",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota)",
    },
    cleaned: { title: "—" },
    subject: "Encuentro Inventado 2031: propuesta recibida",
    text: "Tu propuesta «—» (Charla breve) para Encuentro Inventado 2031 se ha enviado.\n\nAún puede editarse hasta el 15 de febrero de 2031, 6:59 a.\u00A0m. (America/Bogota):\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "—" },
    subject: "Encuentro Inventado 2031: propuesta retirada",
    text: "La propuesta «—» (Charla breve) para Encuentro Inventado 2031 ha sido retirada por quien la creó.\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_withdrawn",
    lang: "es",
    input: { conference: "Encuentro Inventado 2031" },
    subject: "Encuentro Inventado 2031: se retiró una propuesta a la que te invitaron",
    text: "Quien creó una propuesta para Encuentro Inventado 2031 en la que figurabas la ha retirado. Ya no se puede confirmar y no tienes que hacer nada.",
  },
  {
    key: "invitation_answered",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "confirmed",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encuentro Inventado 2031: Bruno Coauthor confirmó su participación en tu propuesta",
    text: "Bruno Coauthor confirmó su participación en tu propuesta para Encuentro Inventado 2031. Comprueba que sigue cumpliendo los requisitos del formato:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "declined",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encuentro Inventado 2031: Bruno Coauthor rechazó participar en tu propuesta",
    text: "Bruno Coauthor rechazó participar en tu propuesta para Encuentro Inventado 2031. Comprueba que sigue cumpliendo los requisitos del formato:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "left",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encuentro Inventado 2031: Bruno Coauthor dejó tu propuesta",
    text: "Bruno Coauthor dejó tu propuesta para Encuentro Inventado 2031. Comprueba que sigue cumpliendo los requisitos del formato:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      who: "bruno@example.org\nBcc: someone",
      answer: "declined",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { person: "bruno@example.org Bcc: someone" },
    subject:
      "Encuentro Inventado 2031: bruno@example.org Bcc: someone rechazó participar en tu propuesta",
    text: "bruno@example.org Bcc: someone rechazó participar en tu propuesta para Encuentro Inventado 2031. Comprueba que sigue cumpliendo los requisitos del formato:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "draft_deleted",
    lang: "es",
    input: { conference: "Encuentro Inventado 2031" },
    subject: "Encuentro Inventado 2031: se canceló una invitación",
    text: "Se eliminó un borrador de propuesta para Encuentro Inventado 2031 en el que figurabas. No tienes que hacer nada.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "lead",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana María Pérez-Gómez incluiu-o com o papel de autoria principal numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "presenter",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana María Pérez-Gómez incluiu-o com o papel de apresentação numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "coauthor",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana María Pérez-Gómez incluiu-o com o papel de coautoria numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "panelist",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana María Pérez-Gómez incluiu-o com o papel de painelista numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana María Pérez-Gómez",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "moderator",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana María Pérez-Gómez incluiu-o com o papel de moderação numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: null,
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "coauthor",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Alguém incluiu-o com o papel de coautoria numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "invitation",
    lang: "pt",
    input: {
      ownerName: "Ana evil-phish.com Pérez\u202E see https://evil.example/x",
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      role: "presenter",
      link: "https://chair.example.org/pt/invitation#token=made-up-token",
    },
    cleaned: { owner: "Ana Pérez see" },
    subject: "Encontro Inventado 2031: confirme a sua participação",
    text: "Ana Pérez see incluiu-o com o papel de apresentação numa proposta (Comunicação breve) para Encontro Inventado 2031.\n\nAbra este link para ver a proposta e confirmar ou recusar. Pode recusar sem ter conta:\n\nhttps://chair.example.org/pt/invitation#token=made-up-token\n\nSe não conhece esta pessoa ou esta proposta, recuse-a: não ficará associado/a a ela.",
  },
  {
    key: "submission_received",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de fevereiro de 2031 às 06:59 (America/Bogota)",
    },
    subject: "Encontro Inventado 2031: proposta recebida",
    text: "A sua proposta «Poems with p5.js» (Comunicação breve) para Encontro Inventado 2031 foi submetida.\n\nAinda pode ser editada até 15 de fevereiro de 2031 às 06:59 (America/Bogota):\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encontro Inventado 2031: proposta retirada",
    text: "A proposta «Poems with p5.js» (Comunicação breve) para Encontro Inventado 2031 foi retirada por quem a criou.\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_received",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de fevereiro de 2031 às 06:59 (America/Bogota)",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Encontro Inventado 2031: proposta recebida",
    text: "A sua proposta «A title in two lines, with a tab here» (Comunicação breve) para Encontro Inventado 2031 foi submetida.\n\nAinda pode ser editada até 15 de fevereiro de 2031 às 06:59 (America/Bogota):\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "A title in two lines, with a tab here" },
    subject: "Encontro Inventado 2031: proposta retirada",
    text: "A proposta «A title in two lines, with a tab here» (Comunicação breve) para Encontro Inventado 2031 foi retirada por quem a criou.\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_received",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      deadline: "15 de fevereiro de 2031 às 06:59 (America/Bogota)",
    },
    cleaned: { title: "—" },
    subject: "Encontro Inventado 2031: proposta recebida",
    text: "A sua proposta «—» (Comunicação breve) para Encontro Inventado 2031 foi submetida.\n\nAinda pode ser editada até 15 de fevereiro de 2031 às 06:59 (America/Bogota):\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "submission_withdrawn",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { title: "—" },
    subject: "Encontro Inventado 2031: proposta retirada",
    text: "A proposta «—» (Comunicação breve) para Encontro Inventado 2031 foi retirada por quem a criou.\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_withdrawn",
    lang: "pt",
    input: { conference: "Encontro Inventado 2031" },
    subject: "Encontro Inventado 2031: foi retirada uma proposta para a qual foi convidado/a",
    text: "Foi retirada por quem a criou uma proposta para Encontro Inventado 2031 em que constava. Já não pode ser confirmada e não precisa de fazer nada.",
  },
  {
    key: "invitation_answered",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "confirmed",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encontro Inventado 2031: Bruno Coauthor confirmou a participação em a sua proposta",
    text: "Bruno Coauthor confirmou a participação em a sua proposta para Encontro Inventado 2031. Verifique se continua a cumprir os requisitos do formato:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "declined",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encontro Inventado 2031: Bruno Coauthor recusou participar em a sua proposta",
    text: "Bruno Coauthor recusou participar em a sua proposta para Encontro Inventado 2031. Verifique se continua a cumprir os requisitos do formato:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      who: "Bruno Coauthor",
      answer: "left",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    subject: "Encontro Inventado 2031: Bruno Coauthor saiu de a sua proposta",
    text: "Bruno Coauthor saiu de a sua proposta para Encontro Inventado 2031. Verifique se continua a cumprir os requisitos do formato:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "invitation_answered",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      who: "bruno@example.org\nBcc: someone",
      answer: "declined",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
    },
    cleaned: { person: "bruno@example.org Bcc: someone" },
    subject:
      "Encontro Inventado 2031: bruno@example.org Bcc: someone recusou participar em a sua proposta",
    text: "bruno@example.org Bcc: someone recusou participar em a sua proposta para Encontro Inventado 2031. Verifique se continua a cumprir os requisitos do formato:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "draft_deleted",
    lang: "pt",
    input: { conference: "Encontro Inventado 2031" },
    subject: "Encontro Inventado 2031: um convite foi cancelado",
    text: "Foi eliminado um rascunho de proposta para Encontro Inventado 2031 em que constava. Não precisa de fazer nada.",
  },
  // The two invitations to a role (spec 03, §1.2), as they were first written: see above.
  {
    key: "reviewer_invitation",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      committees: "Scientific committee",
      link: "https://chair.example.org/en/role-invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: invitation to review proposals",
    text: "The chairs of Made-up Meeting 2031 invite you to be a reviewer (Scientific committee).\n\nIf you accept, the chairs will assign proposals to you; you read them and write a short review of each.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\nhttps://chair.example.org/en/role-invitation#token=made-up-token\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
  },
  {
    key: "reviewer_invitation",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      committees: "Scientific committee | Artistic committee",
      link: "https://chair.example.org/en/role-invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: invitation to review proposals",
    text: "The chairs of Made-up Meeting 2031 invite you to be a reviewer (Scientific committee, Artistic committee).\n\nIf you accept, the chairs will assign proposals to you; you read them and write a short review of each.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\nhttps://chair.example.org/en/role-invitation#token=made-up-token\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
  },
  {
    key: "reviewer_invitation",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      committees: "Scientific\ncommittee\u200B | Artistic\tcommittee",
      link: "https://chair.example.org/en/role-invitation#token=made-up-token",
    },
    cleaned: { committees: "Scientific committee, Artistic committee" },
    subject: "Made-up Meeting 2031: invitation to review proposals",
    text: "The chairs of Made-up Meeting 2031 invite you to be a reviewer (Scientific committee, Artistic committee).\n\nIf you accept, the chairs will assign proposals to you; you read them and write a short review of each.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\nhttps://chair.example.org/en/role-invitation#token=made-up-token\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
  },
  {
    key: "chair_invitation",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      link: "https://chair.example.org/en/role-invitation#token=made-up-token",
    },
    subject: "Made-up Meeting 2031: invitation to be a chair",
    text: "The chairs of Made-up Meeting 2031 invite you to be a chair of the conference.\n\nIf you accept, you will be able to see every proposal and everyone on it, change the conference's settings, invite people, and move the conference from one phase to the next.\n\nOpen this link to read the invitation and to accept or decline it. You do not need an account:\n\nhttps://chair.example.org/en/role-invitation#token=made-up-token\n\nThe link works for 30 days. If you did not expect this invitation, decline it or ignore this email: you get no role unless you accept.",
  },
  {
    key: "reviewer_invitation",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      committees: "Comité científico",
      link: "https://chair.example.org/es/role-invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: invitación para revisar propuestas",
    text: "Quienes presiden Encuentro Inventado 2031 te invitan a revisar propuestas (Comité científico).\n\nSi aceptas, te asignarán propuestas; las lees y escribes una breve revisión de cada una.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\nhttps://chair.example.org/es/role-invitation#token=made-up-token\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
  },
  {
    key: "reviewer_invitation",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      committees: "Comité científico | Comité artístico",
      link: "https://chair.example.org/es/role-invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: invitación para revisar propuestas",
    text: "Quienes presiden Encuentro Inventado 2031 te invitan a revisar propuestas (Comité científico, Comité artístico).\n\nSi aceptas, te asignarán propuestas; las lees y escribes una breve revisión de cada una.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\nhttps://chair.example.org/es/role-invitation#token=made-up-token\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
  },
  {
    key: "reviewer_invitation",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      committees: "Comité\ncientífico\u200B | Comité\tartístico",
      link: "https://chair.example.org/es/role-invitation#token=made-up-token",
    },
    cleaned: { committees: "Comité científico, Comité artístico" },
    subject: "Encuentro Inventado 2031: invitación para revisar propuestas",
    text: "Quienes presiden Encuentro Inventado 2031 te invitan a revisar propuestas (Comité científico, Comité artístico).\n\nSi aceptas, te asignarán propuestas; las lees y escribes una breve revisión de cada una.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\nhttps://chair.example.org/es/role-invitation#token=made-up-token\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
  },
  {
    key: "chair_invitation",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      link: "https://chair.example.org/es/role-invitation#token=made-up-token",
    },
    subject: "Encuentro Inventado 2031: invitación para presidir el congreso",
    text: "Quienes presiden Encuentro Inventado 2031 te invitan a sumarte a la presidencia del congreso.\n\nSi aceptas, podrás ver todas las propuestas y a todas las personas que figuran en ellas, cambiar la configuración del congreso, invitar a personas y pasar el congreso de una fase a la siguiente.\n\nAbre este enlace para leer la invitación y aceptarla o rechazarla. No necesitas tener cuenta:\n\nhttps://chair.example.org/es/role-invitation#token=made-up-token\n\nEl enlace funciona durante 30 días. Si no esperabas esta invitación, recházala o ignora este correo: no recibes ningún rol si no aceptas.",
  },
  {
    key: "reviewer_invitation",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      committees: "Comissão científica",
      link: "https://chair.example.org/pt/role-invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: convite para rever propostas",
    text: "Quem preside a Encontro Inventado 2031 convida-o/a a rever propostas (Comissão científica).\n\nSe aceitar, ser-lhe-ão atribuídas propostas; lê-as e escreve uma breve revisão de cada uma.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\nhttps://chair.example.org/pt/role-invitation#token=made-up-token\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
  },
  {
    key: "reviewer_invitation",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      committees: "Comissão científica | Comissão artística",
      link: "https://chair.example.org/pt/role-invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: convite para rever propostas",
    text: "Quem preside a Encontro Inventado 2031 convida-o/a a rever propostas (Comissão científica, Comissão artística).\n\nSe aceitar, ser-lhe-ão atribuídas propostas; lê-as e escreve uma breve revisão de cada uma.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\nhttps://chair.example.org/pt/role-invitation#token=made-up-token\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
  },
  {
    key: "reviewer_invitation",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      committees: "Comissão\ncientífica\u200B | Comissão\tartística",
      link: "https://chair.example.org/pt/role-invitation#token=made-up-token",
    },
    cleaned: { committees: "Comissão científica, Comissão artística" },
    subject: "Encontro Inventado 2031: convite para rever propostas",
    text: "Quem preside a Encontro Inventado 2031 convida-o/a a rever propostas (Comissão científica, Comissão artística).\n\nSe aceitar, ser-lhe-ão atribuídas propostas; lê-as e escreve uma breve revisão de cada uma.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\nhttps://chair.example.org/pt/role-invitation#token=made-up-token\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
  },
  {
    key: "chair_invitation",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      link: "https://chair.example.org/pt/role-invitation#token=made-up-token",
    },
    subject: "Encontro Inventado 2031: convite para presidir ao congresso",
    text: "Quem preside a Encontro Inventado 2031 convida-o/a a juntar-se à presidência do congresso.\n\nSe aceitar, poderá ver todas as propostas e todas as pessoas que nelas constam, alterar a configuração do congresso, convidar pessoas e passar o congresso de uma fase para a seguinte.\n\nAbra este link para ler o convite e aceitá-lo ou recusá-lo. Não precisa de ter conta:\n\nhttps://chair.example.org/pt/role-invitation#token=made-up-token\n\nO link funciona durante 30 dias. Se não esperava este convite, recuse-o ou ignore este email: não recebe nenhum papel se não aceitar.",
  },
  {
    key: "new_assignments",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "1",
      deadline: "March 28, 2031 at 11:59 PM (America/Bogota)",
      link: "https://chair.example.org/en/reviews",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: proposals assigned to you for review",
    text: 'The chairs of Made-up Meeting 2031 have assigned proposals to you for review.\n\nNewly assigned: 1\nReviews are due by March 28, 2031 at 11:59 PM (America/Bogota).\n\nYour list is here, with each proposal and its review form:\n\nhttps://chair.example.org/en/reviews\n\nYou are getting this email because you review for Made-up Meeting 2031. To get these emails less often, or not at all, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "new_assignments",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "4",
      deadline: null,
      link: "https://chair.example.org/en/reviews",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: proposals assigned to you for review",
    text: 'The chairs of Made-up Meeting 2031 have assigned proposals to you for review.\n\nNewly assigned: 4\nThe chairs have not set a day when reviews are due.\n\nYour list is here, with each proposal and its review form:\n\nhttps://chair.example.org/en/reviews\n\nYou are getting this email because you review for Made-up Meeting 2031. To get these emails less often, or not at all, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "review_reminder",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "3",
      deadline: "March 28, 2031 at 11:59 PM (America/Bogota)",
      link: "https://chair.example.org/en/reviews",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: reviews are due soon",
    text: 'A reminder about your reviews for Made-up Meeting 2031.\n\nReviews are due by March 28, 2031 at 11:59 PM (America/Bogota).\nReviews you have not sent yet: 3\n\nYour list is here:\n\nhttps://chair.example.org/en/reviews\n\nYou are getting this reminder because you review for Made-up Meeting 2031 and have reviews that are not sent. To get no reminder from this conference, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "reviewer_declined",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "1",
      reasons: "time",
      link: "https://chair.example.org/en/c/made-up-2031/assignments",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: proposals given back by reviewers",
    text: 'This is a notice for the chairs of Made-up Meeting 2031.\n\nProposals that a reviewer gave back, saying they cannot review them: 1\nReason given: no time\n\nThe Assignments page lists the proposals that still need reviewers first, and each proposal\'s page says who gave it back and why:\n\nhttps://chair.example.org/en/c/made-up-2031/assignments\n\nYou are getting this email because you are a chair of Made-up Meeting 2031. To get these notices less often, or not at all, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "reviewer_declined",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "3",
      reasons: "conflict | expertise | time",
      link: "https://chair.example.org/en/c/made-up-2031/assignments",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: proposals given back by reviewers",
    text: 'This is a notice for the chairs of Made-up Meeting 2031.\n\nProposals that a reviewer gave back, saying they cannot review them: 3\nReason given: a conflict of interest; outside what they can judge; no time\n\nThe Assignments page lists the proposals that still need reviewers first, and each proposal\'s page says who gave it back and why:\n\nhttps://chair.example.org/en/c/made-up-2031/assignments\n\nYou are getting this email because you are a chair of Made-up Meeting 2031. To get these notices less often, or not at all, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "reviews_complete",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      count: "2",
      link: "https://chair.example.org/en/c/made-up-2031/assignments",
      choices: "https://chair.example.org/en/me#emails",
    },
    subject: "Made-up Meeting 2031: proposals that have all their reviews",
    text: 'This is a notice for the chairs of Made-up Meeting 2031.\n\nProposals that now have all the reviews their committee asks for: 2\n\nThe Assignments page lists every proposal with how many reviews of it were sent; open a proposal to read them:\n\nhttps://chair.example.org/en/c/made-up-2031/assignments\n\nYou are getting this email because you are a chair of Made-up Meeting 2031. To get these notices less often, or not at all, change your choices under "Your account":\n\nhttps://chair.example.org/en/me#emails',
  },
  {
    key: "new_assignments",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "1",
      deadline: "28 de marzo de 2031, 11:59 p. m. (America/Bogota)",
      link: "https://chair.example.org/es/reviews",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: te han asignado propuestas para revisar",
    text: "Quienes presiden Encuentro Inventado 2031 te han asignado propuestas para revisar.\n\nNuevas asignaciones: 1\nLas revisiones se entregan hasta el 28 de marzo de 2031, 11:59 p. m. (America/Bogota).\n\nTu lista está aquí, con cada propuesta y su formulario de revisión:\n\nhttps://chair.example.org/es/reviews\n\nRecibes este correo porque revisas para Encuentro Inventado 2031. Para recibir estos correos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "new_assignments",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "4",
      deadline: null,
      link: "https://chair.example.org/es/reviews",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: te han asignado propuestas para revisar",
    text: "Quienes presiden Encuentro Inventado 2031 te han asignado propuestas para revisar.\n\nNuevas asignaciones: 4\nLa presidencia no ha fijado un día de entrega de las revisiones.\n\nTu lista está aquí, con cada propuesta y su formulario de revisión:\n\nhttps://chair.example.org/es/reviews\n\nRecibes este correo porque revisas para Encuentro Inventado 2031. Para recibir estos correos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "review_reminder",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "3",
      deadline: "28 de marzo de 2031, 11:59 p. m. (America/Bogota)",
      link: "https://chair.example.org/es/reviews",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: se acerca la entrega de las revisiones",
    text: "Un recordatorio sobre tus revisiones para Encuentro Inventado 2031.\n\nLas revisiones se entregan hasta el 28 de marzo de 2031, 11:59 p. m. (America/Bogota).\nRevisiones que aún no has enviado: 3\n\nTu lista está aquí:\n\nhttps://chair.example.org/es/reviews\n\nRecibes este recordatorio porque revisas para Encuentro Inventado 2031 y tienes revisiones sin enviar. Para no recibir recordatorios de este congreso, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "reviewer_declined",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "1",
      reasons: "time",
      link: "https://chair.example.org/es/c/made-up-2031/assignments",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: propuestas devueltas por quienes revisan",
    text: "Aviso para quienes presiden Encuentro Inventado 2031.\n\nPropuestas que alguien devolvió porque no puede revisarlas: 1\nMotivo indicado: falta de tiempo\n\nLa página de asignaciones muestra primero las propuestas a las que aún les falta quien las revise, y la página de cada propuesta dice quién la devolvió y por qué:\n\nhttps://chair.example.org/es/c/made-up-2031/assignments\n\nRecibes este correo porque presides Encuentro Inventado 2031. Para recibir estos avisos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "reviewer_declined",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "3",
      reasons: "conflict | expertise | time",
      link: "https://chair.example.org/es/c/made-up-2031/assignments",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: propuestas devueltas por quienes revisan",
    text: "Aviso para quienes presiden Encuentro Inventado 2031.\n\nPropuestas que alguien devolvió porque no puede revisarlas: 3\nMotivo indicado: un conflicto de interés; fuera de lo que puede juzgar; falta de tiempo\n\nLa página de asignaciones muestra primero las propuestas a las que aún les falta quien las revise, y la página de cada propuesta dice quién la devolvió y por qué:\n\nhttps://chair.example.org/es/c/made-up-2031/assignments\n\nRecibes este correo porque presides Encuentro Inventado 2031. Para recibir estos avisos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "reviews_complete",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      count: "2",
      link: "https://chair.example.org/es/c/made-up-2031/assignments",
      choices: "https://chair.example.org/es/me#emails",
    },
    subject: "Encuentro Inventado 2031: propuestas que ya tienen todas sus revisiones",
    text: "Aviso para quienes presiden Encuentro Inventado 2031.\n\nPropuestas que ya tienen todas las revisiones que pide su comité: 2\n\nLa página de asignaciones muestra cada propuesta con las revisiones que se han enviado; abre una propuesta para leerlas:\n\nhttps://chair.example.org/es/c/made-up-2031/assignments\n\nRecibes este correo porque presides Encuentro Inventado 2031. Para recibir estos avisos con menos frecuencia, o no recibirlos, cambia tus preferencias en «Tu cuenta»:\n\nhttps://chair.example.org/es/me#emails",
  },
  {
    key: "new_assignments",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "1",
      deadline: "28 de março de 2031 às 23:59 (America/Bogota)",
      link: "https://chair.example.org/pt/reviews",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: foram-lhe atribuídas propostas para rever",
    text: "Quem preside a Encontro Inventado 2031 atribuiu-lhe propostas para rever.\n\nNovas atribuições: 1\nAs revisões são entregues até 28 de março de 2031 às 23:59 (America/Bogota).\n\nA sua lista está aqui, com cada proposta e o respetivo formulário de revisão:\n\nhttps://chair.example.org/pt/reviews\n\nRecebe este email porque revê para Encontro Inventado 2031. Para receber estes emails com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "new_assignments",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "4",
      deadline: null,
      link: "https://chair.example.org/pt/reviews",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: foram-lhe atribuídas propostas para rever",
    text: "Quem preside a Encontro Inventado 2031 atribuiu-lhe propostas para rever.\n\nNovas atribuições: 4\nA presidência não fixou um dia de entrega das revisões.\n\nA sua lista está aqui, com cada proposta e o respetivo formulário de revisão:\n\nhttps://chair.example.org/pt/reviews\n\nRecebe este email porque revê para Encontro Inventado 2031. Para receber estes emails com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "review_reminder",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "3",
      deadline: "28 de março de 2031 às 23:59 (America/Bogota)",
      link: "https://chair.example.org/pt/reviews",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: aproxima-se a entrega das revisões",
    text: "Um lembrete sobre as suas revisões para Encontro Inventado 2031.\n\nAs revisões são entregues até 28 de março de 2031 às 23:59 (America/Bogota).\nRevisões que ainda não enviou: 3\n\nA sua lista está aqui:\n\nhttps://chair.example.org/pt/reviews\n\nRecebe este lembrete porque revê para Encontro Inventado 2031 e tem revisões por enviar. Para não receber lembretes deste congresso, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "reviewer_declined",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "1",
      reasons: "time",
      link: "https://chair.example.org/pt/c/made-up-2031/assignments",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: propostas devolvidas por quem revê",
    text: "Aviso para quem preside a Encontro Inventado 2031.\n\nPropostas que alguém devolveu por não as poder rever: 1\nMotivo indicado: falta de tempo\n\nA página de atribuições mostra primeiro as propostas a que ainda falta quem as reveja, e a página de cada proposta diz quem a devolveu e porquê:\n\nhttps://chair.example.org/pt/c/made-up-2031/assignments\n\nRecebe este email porque preside a Encontro Inventado 2031. Para receber estes avisos com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "reviewer_declined",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "3",
      reasons: "conflict | expertise | time",
      link: "https://chair.example.org/pt/c/made-up-2031/assignments",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: propostas devolvidas por quem revê",
    text: "Aviso para quem preside a Encontro Inventado 2031.\n\nPropostas que alguém devolveu por não as poder rever: 3\nMotivo indicado: um conflito de interesses; fora do que consegue avaliar; falta de tempo\n\nA página de atribuições mostra primeiro as propostas a que ainda falta quem as reveja, e a página de cada proposta diz quem a devolveu e porquê:\n\nhttps://chair.example.org/pt/c/made-up-2031/assignments\n\nRecebe este email porque preside a Encontro Inventado 2031. Para receber estes avisos com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "reviews_complete",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      count: "2",
      link: "https://chair.example.org/pt/c/made-up-2031/assignments",
      choices: "https://chair.example.org/pt/me#emails",
    },
    subject: "Encontro Inventado 2031: propostas que já têm todas as revisões",
    text: "Aviso para quem preside a Encontro Inventado 2031.\n\nPropostas que já têm todas as revisões que a respetiva comissão pede: 2\n\nA página de atribuições mostra cada proposta com as revisões que foram enviadas; abra uma proposta para as ler:\n\nhttps://chair.example.org/pt/c/made-up-2031/assignments\n\nRecebe este email porque preside a Encontro Inventado 2031. Para receber estes avisos com menos frequência, ou não os receber, altere as suas escolhas em «A sua conta»:\n\nhttps://chair.example.org/pt/me#emails",
  },
  {
    key: "decision_accepted",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "Poems with p5.js",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "A made-up comment: the argument is clear, and the examples carry it. | Another made-up comment, in two paragraphs.\n\nThe second one asks for a word about the method.",
    },
    subject: "Made-up Meeting 2031: your proposal has been accepted",
    text: 'The chairs of Made-up Meeting 2031 have accepted your proposal "Poems with p5.js" (Short talk).\n\nComments from the reviewers:\n\nReviewer 1:\nA made-up comment: the argument is clear, and the examples carry it.\n\nReviewer 2:\nAnother made-up comment, in two paragraphs.\n\nThe second one asks for a word about the method.\n\nYou can also read this on the proposal\'s page:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "decision_waitlisted",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "A made-up comment\u200B with a tab\there,\r\na second line and spaces at its end   \n\n\n\nand a last paragraph.",
    },
    cleaned: {
      title: "A title in two lines, with a tab here",
      comments:
        "Comments from the reviewers:\n\nReviewer 1:\nA made-up comment with a tab here,\na second line and spaces at its end\n\nand a last paragraph.",
    },
    subject: "Made-up Meeting 2031: your proposal is on the waiting list",
    text: 'The chairs of Made-up Meeting 2031 have put your proposal "A title in two lines, with a tab here" (Short talk) on the waiting list. It is not accepted so far, and it may still be: you will get another email when they decide.\n\nComments from the reviewers:\n\nReviewer 1:\nA made-up comment with a tab here,\na second line and spaces at its end\n\nand a last paragraph.\n\nYou can also read this on the proposal\'s page:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "decision_rejected",
    lang: "en",
    input: {
      conference: "Made-up Meeting 2031",
      format: "Short talk",
      title: "Poems with p5.js",
      link: "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments: "",
    },
    subject: "Made-up Meeting 2031: your proposal was not accepted",
    text: 'The chairs of Made-up Meeting 2031 have not accepted your proposal "Poems with p5.js" (Short talk).\n\nNo comments from reviewers come with this decision.\n\nYou can also read this on the proposal\'s page:\n\nhttps://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f',
  },
  {
    key: "decision_accepted",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "Un comentario inventado: el argumento es claro y los ejemplos lo sostienen. | Otro comentario inventado, en dos párrafos.\n\nEl segundo pide unas palabras sobre el método.",
    },
    subject: "Encuentro Inventado 2031: tu propuesta ha sido aceptada",
    text: "Quienes presiden Encuentro Inventado 2031 han aceptado tu propuesta «Poems with p5.js» (Charla breve).\n\nComentarios de quienes revisaron la propuesta:\n\nRevisión 1:\nUn comentario inventado: el argumento es claro y los ejemplos lo sostienen.\n\nRevisión 2:\nOtro comentario inventado, en dos párrafos.\n\nEl segundo pide unas palabras sobre el método.\n\nTambién puedes leerlo en la página de la propuesta:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "decision_waitlisted",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "Un comentario inventado\u200B con un tabulador\taquí,\r\nuna segunda línea y espacios al final   \n\n\n\ny un último párrafo.",
    },
    cleaned: {
      title: "A title in two lines, with a tab here",
      comments:
        "Comentarios de quienes revisaron la propuesta:\n\nRevisión 1:\nUn comentario inventado con un tabulador aquí,\nuna segunda línea y espacios al final\n\ny un último párrafo.",
    },
    subject: "Encuentro Inventado 2031: tu propuesta está en lista de espera",
    text: "Quienes presiden Encuentro Inventado 2031 han puesto tu propuesta «A title in two lines, with a tab here» (Charla breve) en lista de espera. Por ahora no está aceptada, y todavía puede estarlo: recibirás otro correo cuando lo decidan.\n\nComentarios de quienes revisaron la propuesta:\n\nRevisión 1:\nUn comentario inventado con un tabulador aquí,\nuna segunda línea y espacios al final\n\ny un último párrafo.\n\nTambién puedes leerlo en la página de la propuesta:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "decision_rejected",
    lang: "es",
    input: {
      conference: "Encuentro Inventado 2031",
      format: "Charla breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments: "",
    },
    subject: "Encuentro Inventado 2031: tu propuesta no ha sido aceptada",
    text: "Quienes presiden Encuentro Inventado 2031 no han aceptado tu propuesta «Poems with p5.js» (Charla breve).\n\nEsta decisión no viene acompañada de comentarios de quienes revisan.\n\nTambién puedes leerlo en la página de la propuesta:\n\nhttps://chair.example.org/es/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "decision_accepted",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "Um comentário inventado: o argumento é claro e os exemplos sustentam-no. | Outro comentário inventado, em dois parágrafos.\n\nO segundo pede umas palavras sobre o método.",
    },
    subject: "Encontro Inventado 2031: a sua proposta foi aceite",
    text: "Quem preside a Encontro Inventado 2031 aceitou a sua proposta «Poems with p5.js» (Comunicação breve).\n\nComentários de quem reviu a proposta:\n\nRevisão 1:\nUm comentário inventado: o argumento é claro e os exemplos sustentam-no.\n\nRevisão 2:\nOutro comentário inventado, em dois parágrafos.\n\nO segundo pede umas palavras sobre o método.\n\nTambém pode ler isto na página da proposta:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "decision_waitlisted",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "A title\nin two lines\u200B, with a tab\there",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments:
        "Um comentário inventado\u200B com um tabulador\taqui,\r\numa segunda linha e espaços no fim   \n\n\n\ne um último parágrafo.",
    },
    cleaned: {
      title: "A title in two lines, with a tab here",
      comments:
        "Comentários de quem reviu a proposta:\n\nRevisão 1:\nUm comentário inventado com um tabulador aqui,\numa segunda linha e espaços no fim\n\ne um último parágrafo.",
    },
    subject: "Encontro Inventado 2031: a sua proposta está em lista de espera",
    text: "Quem preside a Encontro Inventado 2031 colocou a sua proposta «A title in two lines, with a tab here» (Comunicação breve) em lista de espera. Por agora não está aceite, e ainda pode vir a estar: receberá outro email quando houver uma decisão.\n\nComentários de quem reviu a proposta:\n\nRevisão 1:\nUm comentário inventado com um tabulador aqui,\numa segunda linha e espaços no fim\n\ne um último parágrafo.\n\nTambém pode ler isto na página da proposta:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
  {
    key: "decision_rejected",
    lang: "pt",
    input: {
      conference: "Encontro Inventado 2031",
      format: "Comunicação breve",
      title: "Poems with p5.js",
      link: "https://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
      comments: "",
    },
    subject: "Encontro Inventado 2031: a sua proposta não foi aceite",
    text: "Quem preside a Encontro Inventado 2031 não aceitou a sua proposta «Poems with p5.js» (Comunicação breve).\n\nEsta decisão não é acompanhada de comentários de quem revê.\n\nTambém pode ler isto na página da proposta:\n\nhttps://chair.example.org/pt/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f",
  },
];
