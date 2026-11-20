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
  title: { en: "Made-up meeting", es: "Encuentro inventado" },
  defaultLanguage: "en",
  timezone: "America/Bogota",
  deadlines: { submissionsClose: "2031-02-14T23:59:00-12:00" },
  submissionTypes: [{ name: { en: "Talk", es: "Charla" } }],
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
  });
});
