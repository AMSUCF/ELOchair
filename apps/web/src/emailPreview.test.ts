import {
  fillMessage,
  formatDeadline,
  MAIL_LANGUAGES,
  MESSAGE_KEYS,
  MESSAGE_PARTS,
  MESSAGES,
  placeholdersIn,
} from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { type PreviewSource, sampleValues } from "./emailPreview";

/** What a preview reads of a small made-up conference in two languages. */
const config: PreviewSource = {
  slug: "made-up-2031",
  title: { en: "Made-up meeting", es: "Encuentro inventado" },
  defaultLanguage: "en",
  timezone: "America/Bogota",
  deadlines: { submissionsClose: "2031-02-14T23:59:00-12:00" },
  submissionTypes: [{ name: { en: "Talk", es: "Charla" } }],
  reviewPools: [
    { name: { en: "Scientific committee", es: "Comité científico" } },
    { name: { en: "Artistic committee" } },
  ],
};
const ORIGIN = "https://chair.example.org";

describe("the made-up values an email is previewed with", () => {
  it("fill every placeholder of every message, in each language", () => {
    for (const key of MESSAGE_KEYS) {
      for (const lang of MAIL_LANGUAGES) {
        const values = sampleValues(key, lang, config, ORIGIN);
        for (const name of MESSAGES[key].placeholders) {
          expect(values[name], `${key} ${lang} ${name}`).toBeTruthy();
        }
        // The standard email, previewed, has nothing left in braces.
        for (const part of MESSAGE_PARTS) {
          const shown = fillMessage(key, part, MESSAGES[key].standard[lang][part], values);
          expect(placeholdersIn(shown), `${key} ${lang} ${part}`).toEqual([]);
        }
      }
    }
  });

  it("are in the language of the email, not of the interface", () => {
    const en = sampleValues("invitation", "en", config, ORIGIN);
    const es = sampleValues("invitation", "es", config, ORIGIN);
    const pt = sampleValues("invitation", "pt", config, ORIGIN);
    expect([en.owner, es.owner, pt.owner]).toEqual(["Ana Example", "Ana Ejemplo", "Ana Exemplo"]);
    expect([en.title, es.title, pt.title]).toEqual([
      "A made-up title",
      "Un título inventado",
      "Um título inventado",
    ]);
    // The words the server supplies are the server's own.
    expect([en.role, es.role, pt.role]).toEqual(["co-author", "coautoría", "coautoria"]);
    expect([en.answer, es.answer]).toEqual(["confirmed", "confirmó su participación en"]);
  });

  it("take from the conference what the conference supplies, as the server writes it", () => {
    const es = sampleValues("submission_received", "es", config, ORIGIN);
    expect(es.conference).toBe("Encuentro inventado");
    expect(es.format).toBe("Charla");
    expect(es.deadline).toBe(formatDeadline("2031-02-14T23:59:00-12:00", "America/Bogota", "es"));
    // A language the conference has not written falls back as the server's mail does.
    const pt = sampleValues("submission_received", "pt", config, ORIGIN);
    expect(pt.conference).toBe("Made-up meeting");
    expect(pt.format).toBe("Talk");
  });

  it("show links of the real shape that lead nowhere", () => {
    expect(sampleValues("invitation", "es", config, ORIGIN).link).toBe(
      "https://chair.example.org/es/invitation#token=…",
    );
    expect(sampleValues("submission_withdrawn", "en", config, ORIGIN).link).toBe(
      "https://chair.example.org/en/s/…",
    );
    // An invitation to a role has a page of its own.
    for (const key of ["reviewer_invitation", "chair_invitation"] as const) {
      expect(sampleValues(key, "pt", config, ORIGIN).link).toBe(
        "https://chair.example.org/pt/role-invitation#token=…",
      );
    }
  });

  it("show the emails of the review phase with a number, the real addresses, and the day the chairs set", () => {
    const due = "2031-03-28T23:59:00-05:00";
    const set = { ...config, deadlines: { ...config.deadlines, reviewsDue: due } };
    for (const key of ["new_assignments", "review_reminder"] as const) {
      const values = sampleValues(key, "es", set, ORIGIN);
      expect(values.count).toBe("3");
      // These addresses hold no secret and are the same for everyone: they are the real ones.
      expect(values.link).toBe("https://chair.example.org/es/reviews");
      expect(values.choices).toBe("https://chair.example.org/es/me#emails");
    }
    for (const key of ["reviewer_declined", "reviews_complete"] as const) {
      const values = sampleValues(key, "pt", set, ORIGIN);
      expect(values.link).toBe("https://chair.example.org/pt/c/made-up-2031/assignments");
      expect(values.choices).toBe("https://chair.example.org/pt/me#emails");
    }
    // The words the server supplies are the server's own, in the language of the email.
    expect(
      (["en", "es", "pt"] as const).map(
        (lang) => sampleValues("reviewer_declined", lang, set, ORIGIN).reason,
      ),
    ).toEqual(["no time", "falta de tiempo", "falta de tempo"]);
    // The day reviews are due is the conference's own, once the chairs have set one: both
    // emails to a reviewer say it in the same sentence.
    const when = formatDeadline(due, "America/Bogota", "en");
    for (const key of ["new_assignments", "review_reminder"] as const) {
      expect(sampleValues(key, "en", set, ORIGIN).due).toBe(`Reviews are due by ${when}.`);
      // Until then the preview says that no day is set, as the email about a new assignment
      // will. (A reminder is only ever sent once there is one.)
      expect(sampleValues(key, "en", config, ORIGIN).due).toBe(
        "The chairs have not set a day when reviews are due.",
      );
    }
    // The receipt's deadline is still the close of the call, whatever day reviews are due.
    expect(sampleValues("submission_received", "en", set, ORIGIN).deadline).toBe(
      formatDeadline("2031-02-14T23:59:00-12:00", "America/Bogota", "en"),
    );
  });

  it("show the emails about a decision with made-up comments under a number each, and the proposal's link", () => {
    for (const key of ["decision_accepted", "decision_waitlisted", "decision_rejected"] as const) {
      const en = sampleValues(key, "en", config, ORIGIN);
      expect(en.link).toBe("https://chair.example.org/en/s/…");
      expect(en.title).toBe("A made-up title");
      // Put together as the server puts the real ones together: one definition for both.
      expect(en.comments).toBe(
        "Comments from the reviewers:\n\nReviewer 1:\nA made-up comment: the argument is clear, and the examples carry it.\n\nReviewer 2:\nAnother made-up comment, in two paragraphs.\n\nThe second one asks for a word about the method.",
      );
      // In the language of the email, not of the interface.
      expect(sampleValues(key, "es", config, ORIGIN).comments).toMatch(
        /^Comentarios de quienes revisaron la propuesta:\n\nRevisión 1:\nUn comentario inventado/,
      );
      expect(sampleValues(key, "pt", config, ORIGIN).comments).toMatch(
        /^Comentários de quem reviu a proposta:\n\nRevisão 1:\nUm comentário inventado/,
      );
      // The standard email, previewed, says the outcome, the comments and the link, in order.
      const body = fillMessage(key, "body", MESSAGES[key].standard.en.body, en);
      expect(body.indexOf("A made-up title")).toBeLessThan(body.indexOf("Reviewer 1:"));
      expect(body.endsWith("\n\nhttps://chair.example.org/en/s/…")).toBe(true);
    }
  });

  it("name the conference's own review pools as a reviewer's committees", () => {
    expect(sampleValues("reviewer_invitation", "en", config, ORIGIN).committees).toBe(
      "Scientific committee, Artistic committee",
    );
    // In the email's language where the conference has written the name, else in its main one.
    expect(sampleValues("reviewer_invitation", "es", config, ORIGIN).committees).toBe(
      "Comité científico, Artistic committee",
    );
  });
});
