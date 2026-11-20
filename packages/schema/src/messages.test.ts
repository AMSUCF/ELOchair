import { describe, expect, it } from "vitest";
import { ConferenceConfig, type ConferenceConfigInput, ContributionRole } from "./config";
import { LIMITS } from "./limits";
import {
  ANSWER_WORDS,
  type ConferenceMessages,
  fillMessage,
  fillPlaceholders,
  formatDeadline,
  type InvitationAnswer,
  isMailLanguage,
  MAIL_LANGUAGES,
  type MailLang,
  type MailMessageKey,
  MESSAGE_KEYS,
  MESSAGE_PARTS,
  MESSAGES,
  mailLanguagesFor,
  messageProblems,
  messageText,
  placeholdersIn,
  placeholdersOf,
  ROLE_WORDS,
  UNNAMED_OWNER,
} from "./messages";
import { MESSAGES_BEFORE, type MessageBefore } from "./messages.before";

/*
 * The emails the app sends (spec 02, §1.9): the standard texts, what a text may name, which text
 * a reader gets, and what the schema takes as a conference's own wording.
 */

/** A value for each placeholder of a captured case, as the server worked it out at the time. */
function valuesOf(c: MessageBefore): Record<string, string> {
  const input = (name: string) => c.input[name] ?? "";
  const role = ContributionRole.safeParse(c.input.role);
  const answers: Record<string, InvitationAnswer> = {
    confirmed: "confirmed",
    declined: "declined",
    left: "left",
  };
  const answer = answers[input("answer")];
  return {
    owner: c.cleaned?.owner ?? c.input.ownerName ?? UNNAMED_OWNER[c.lang],
    role: role.success ? ROLE_WORDS[c.lang][role.data] : "",
    person: c.cleaned?.person ?? input("who"),
    answer: answer ? ANSWER_WORDS[c.lang][answer] : "",
    title: c.cleaned?.title ?? input("title"),
    format: input("format"),
    conference: input("conference"),
    deadline: input("deadline"),
    link: input("link"),
  };
}

describe("the standard texts", () => {
  it("are the emails the app sent before, byte for byte, for every message and language", () => {
    for (const c of MESSAGES_BEFORE) {
      const standard = MESSAGES[c.key].standard[c.lang];
      const at = `${c.key} ${c.lang} ${JSON.stringify(c.input)}`;
      expect(fillMessage(c.key, "subject", standard.subject, valuesOf(c)), at).toBe(c.subject);
      expect(fillMessage(c.key, "body", standard.body, valuesOf(c)), at).toBe(c.text);
    }
  });

  it("were captured for every message in every language, every role and every answer", () => {
    const seen = (pick: (c: MessageBefore) => string | null | undefined) =>
      [...new Set(MESSAGES_BEFORE.map(pick).filter((x) => x != null))].sort();
    expect(seen((c) => `${c.key} ${c.lang}`)).toEqual(
      MESSAGE_KEYS.flatMap((key) => MAIL_LANGUAGES.map((lang) => `${key} ${lang}`)).sort(),
    );
    for (const lang of MAIL_LANGUAGES) {
      const of = (key: MailMessageKey, name: string) =>
        seen((c) => (c.key === key && c.lang === lang ? c.input[name] : null));
      expect(of("invitation", "role")).toEqual([...ContributionRole.options].sort());
      expect(of("invitation_answered", "answer")).toEqual(["confirmed", "declined", "left"]);
      // An owner without a name, and values the server had to clean.
      expect(MESSAGES_BEFORE.some((c) => c.lang === lang && c.input.ownerName === null)).toBe(true);
      for (const name of ["owner", "title", "person"]) {
        expect(
          MESSAGES_BEFORE.some((c) => c.lang === lang && c.cleaned?.[name] !== undefined),
          `${lang} ${name}`,
        ).toBe(true);
      }
    }
  });

  it("obey every rule a conference's own text is held to", () => {
    for (const key of MESSAGE_KEYS) {
      for (const lang of MAIL_LANGUAGES) {
        for (const part of MESSAGE_PARTS) {
          const text = MESSAGES[key].standard[lang][part];
          expect(messageProblems(key, part, text), `${key} ${lang} ${part}`).toEqual([]);
          // The settings screen compares what is typed, trimmed, with the standard text.
          expect(text).toBe(text.trim());
        }
      }
    }
  });

  it("use every placeholder their message declares, in each language", () => {
    for (const key of MESSAGE_KEYS) {
      const { placeholders, required, standard } = MESSAGES[key];
      expect(new Set(placeholders).size).toBe(placeholders.length);
      for (const name of required) expect(placeholders, `${key} ${name}`).toContain(name);
      for (const lang of MAIL_LANGUAGES) {
        const used = placeholdersIn(`${standard[lang].subject}\n${standard[lang].body}`);
        expect([...used].sort(), `${key} ${lang}`).toEqual([...placeholders].sort());
      }
    }
  });
});

describe("the messages", () => {
  it("are these six, by keys that are stored and never renamed", () => {
    expect(MESSAGE_KEYS).toEqual([
      "invitation",
      "submission_received",
      "submission_withdrawn",
      "invitation_withdrawn",
      "invitation_answered",
      "draft_deleted",
    ]);
    for (const key of MESSAGE_KEYS) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(Object.keys(MESSAGES)).toEqual([...MESSAGE_KEYS]);
  });

  it("name what each has always carried, and require what it is useless without", () => {
    const shape = Object.fromEntries(
      MESSAGE_KEYS.map((key) => {
        const { placeholders, required, bodyOnly } = MESSAGES[key];
        return [key, { placeholders, required, bodyOnly }];
      }),
    );
    expect(shape).toEqual({
      invitation: {
        placeholders: ["owner", "role", "format", "conference", "link"],
        required: ["link"],
        bodyOnly: ["owner", "link"],
      },
      submission_received: {
        placeholders: ["title", "format", "conference", "deadline", "link"],
        required: ["link"],
        bodyOnly: ["link"],
      },
      submission_withdrawn: {
        placeholders: ["title", "format", "conference", "link"],
        required: ["link"],
        bodyOnly: ["link"],
      },
      invitation_withdrawn: { placeholders: ["conference"], required: [], bodyOnly: [] },
      invitation_answered: {
        placeholders: ["person", "answer", "conference", "link"],
        required: ["person", "answer", "link"],
        bodyOnly: ["link"],
      },
      draft_deleted: { placeholders: ["conference"], required: [], bodyOnly: [] },
    });
    for (const key of MESSAGE_KEYS) {
      for (const name of MESSAGES[key].bodyOnly) {
        expect(MESSAGES[key].placeholders, `${key} ${name}`).toContain(name);
      }
    }
  });

  it("give people who have agreed to nothing no text an owner wrote but the owner's name", () => {
    // The owner's name is cleaned by the server; a title, or a name the owner typed, is not
    // something these three may carry, whatever a conference writes.
    const ownerWritten = ["title", "person"];
    for (const key of ["invitation", "invitation_withdrawn", "draft_deleted"] as const) {
      for (const name of ownerWritten) expect(MESSAGES[key].placeholders).not.toContain(name);
    }
    expect(MESSAGES.invitation_withdrawn.placeholders).not.toContain("owner");
    expect(MESSAGES.draft_deleted.placeholders).not.toContain("owner");
  });

  it("are offered in all three languages at every conference, its main language first", () => {
    expect(mailLanguagesFor("en")).toEqual(["en", "es", "pt"]);
    expect(mailLanguagesFor("es")).toEqual(["es", "en", "pt"]);
    expect(mailLanguagesFor("pt")).toEqual(["pt", "en", "es"]);
    // A regional main language reads as its language; one the app does not write in changes
    // nothing.
    expect(mailLanguagesFor("pt-BR")).toEqual(["pt", "en", "es"]);
    expect(mailLanguagesFor("fr")).toEqual(["en", "es", "pt"]);
    expect(mailLanguagesFor("")).toEqual(["en", "es", "pt"]);
  });

  it("are written in the three languages the app writes mail in", () => {
    expect(MAIL_LANGUAGES).toEqual(["en", "es", "pt"]);
    expect(["en", "es", "pt", "pt-BR", "fr", "EN", ""].map(isMailLanguage)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("filling a text", () => {
  it("puts each value where its placeholder is, as often as it is named", () => {
    expect(
      fillPlaceholders("{conference}: {title} ({format}). {title}!", {
        conference: "Made-up Meeting",
        title: "Poems with p5.js",
        format: "Talk",
      }),
    ).toBe("Made-up Meeting: Poems with p5.js (Talk). Poems with p5.js!");
    expect(fillPlaceholders("No placeholders here.", { link: "x" })).toBe("No placeholders here.");
    expect(fillPlaceholders("{link}", { link: "" })).toBe("");
  });

  it("leaves a name it has no value for as it is written", () => {
    expect(fillPlaceholders("{unknown} and {link}", { link: "L" })).toBe("{unknown} and L");
    // Spaces, capitals and accents make another name: nothing is guessed.
    expect(fillPlaceholders("{ link } {Link} {enlace} {}", { link: "L" })).toBe(
      "{ link } {Link} {enlace} {}",
    );
    // A brace on its own, and braces around a line break, are ordinary text.
    expect(fillPlaceholders("a { b } c } {li\nnk} {{link}}", { link: "L" })).toBe(
      "a { b } c } {li\nnk} {L}",
    );
    // Names every object has are not values.
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(fillPlaceholders(`{${name}}`, { link: "L" })).toBe(`{${name}}`);
    }
  });

  it("puts a value in once and never reads it again", () => {
    // A name or a title an owner wrote cannot bring a placeholder of its own.
    expect(
      fillPlaceholders("{owner} invites you: {link}", { owner: "{link}", link: "https://x" }),
    ).toBe("{link} invites you: https://x");
    expect(fillPlaceholders("{title}", { title: "{title}{title}" })).toBe("{title}{title}");
    // Nor a pattern of the replacement itself.
    expect(fillPlaceholders("[{title}]", { title: "$& $1 $$ $`" })).toBe("[$& $1 $$ $`]");
  });

  it("lists the names written in a text, each once, in order", () => {
    expect(placeholdersIn("{b} {a} {b} { c } {} {d\n}")).toEqual(["b", "a", " c ", ""]);
    expect(placeholdersIn("nothing { here")).toEqual([]);
  });

  it("fills only what a part of a message may hold: a subject never gets the link, or an invitation's the owner", () => {
    const values = {
      owner: "Ana",
      role: "co-author",
      format: "Talk",
      conference: "Made-up Meeting",
      link: "https://chair.example.org/en/invitation#token=made-up-token",
      // Not a value of an invitation: it is never put in, even if it is handed over.
      title: "A title the invitee has not agreed to read",
    };
    const text = "{conference} {owner} {link} {title}";
    expect(placeholdersOf("invitation", "body")).toEqual(MESSAGES.invitation.placeholders);
    expect(placeholdersOf("invitation", "subject")).toEqual(["role", "format", "conference"]);
    expect(fillMessage("invitation", "body", text, values)).toBe(
      `Made-up Meeting Ana ${values.link} {title}`,
    );
    expect(fillMessage("invitation", "subject", text, values)).toBe(
      "Made-up Meeting {owner} {link} {title}",
    );
    for (const key of MESSAGE_KEYS) expect(placeholdersOf(key, "subject")).not.toContain("link");
    // The person who answered is named in the subject of the mail to the owner, who typed it.
    expect(placeholdersOf("invitation_answered", "subject")).toEqual([
      "person",
      "answer",
      "conference",
    ]);
  });
});

describe("which text a reader gets", () => {
  const own: ConferenceMessages = {
    invitation: {
      subject: { es: "Te han invitado a {conference}" },
      body: { en: "Answer here: {link}", es: "Responde aquí: {link}" },
    },
  };

  it("is the conference's own in the reader's language, where it has written one", () => {
    expect(messageText(own, "invitation", "subject", "es")).toBe("Te han invitado a {conference}");
    expect(messageText(own, "invitation", "body", "es")).toBe("Responde aquí: {link}");
    expect(messageText(own, "invitation", "body", "en")).toBe("Answer here: {link}");
  });

  it("is otherwise the standard text in the reader's language, never another language's", () => {
    // Subject and body are looked up separately: English has its own body and no subject.
    expect(messageText(own, "invitation", "subject", "en")).toBe(
      MESSAGES.invitation.standard.en.subject,
    );
    // Portuguese has neither: both are standard, in Portuguese.
    for (const part of MESSAGE_PARTS) {
      expect(messageText(own, "invitation", part, "pt")).toBe(
        MESSAGES.invitation.standard.pt[part],
      );
    }
    // Another message is untouched.
    expect(messageText(own, "draft_deleted", "body", "es")).toBe(
      MESSAGES.draft_deleted.standard.es.body,
    );
  });

  it("is the standard text for a conference that has written nothing", () => {
    for (const messages of [undefined, {}, { invitation: {} }, { invitation: { subject: {} } }]) {
      for (const key of MESSAGE_KEYS) {
        for (const lang of MAIL_LANGUAGES) {
          for (const part of MESSAGE_PARTS) {
            expect(messageText(messages, key, part, lang)).toBe(MESSAGES[key].standard[lang][part]);
          }
        }
      }
    }
    // An empty text is refused by the schema; were one stored, nobody gets an empty email.
    expect(messageText({ invitation: { body: { en: "" } } }, "invitation", "body", "en")).toBe(
      MESSAGES.invitation.standard.en.body,
    );
  });
});

describe("what is wrong with a text", () => {
  const codes = (key: MailMessageKey, part: "subject" | "body", text: string) =>
    messageProblems(key, part, text).map((p) => p.code);

  it("is nothing for a text that names only its message's placeholders, required ones included", () => {
    expect(messageProblems("invitation", "body", "Please answer: {link}")).toEqual([]);
    expect(
      messageProblems("invitation", "subject", "You are invited to {conference} ({format})"),
    ).toEqual([]);
    // A body may run to paragraphs, and no placeholder is required of a subject.
    expect(messageProblems("submission_received", "body", "Thank you.\n\n\t{link}\n")).toEqual([]);
    expect(messageProblems("invitation_answered", "subject", "News about your proposal")).toEqual(
      [],
    );
    expect(messageProblems("draft_deleted", "body", "Nothing to do.")).toEqual([]);
  });

  it("refuses a text that says nothing", () => {
    // Spaces, or characters that do not show (a zero-width space, a byte-order mark).
    for (const text of ["", " ", "\n\t ", "\u200B", " \uFEFF\u200B\n"]) {
      const at = JSON.stringify(text);
      expect(messageProblems("invitation", "body", text), at).toEqual([{ code: "message_empty" }]);
      expect(messageProblems("invitation", "subject", text), at).toEqual([
        { code: "message_empty" },
      ]);
    }
  });

  it("refuses a subject that is not one line", () => {
    for (const text of [
      "Two\nlines",
      "A\ttab",
      "Carriage\rreturn",
      "Sep\u2028arator",
      "Nul\u0000",
    ]) {
      expect(codes("draft_deleted", "subject", text), JSON.stringify(text)).toEqual([
        "message_not_one_line",
      ]);
    }
    expect(codes("draft_deleted", "subject", "One line, with “quotes” and ünïcödé")).toEqual([]);
  });

  it("refuses a subject over 200 characters and a body over 5,000, and says the limit", () => {
    expect(LIMITS.messageSubject).toBe(200);
    expect(LIMITS.messageBody).toBe(5000);
    expect(messageProblems("draft_deleted", "subject", "x".repeat(200))).toEqual([]);
    expect(messageProblems("draft_deleted", "subject", "x".repeat(201))).toEqual([
      { code: "message_too_long", values: { max: 200 } },
    ]);
    const body = (length: number) => `{link} ${"x".repeat(length - 7)}`;
    expect(messageProblems("invitation", "body", body(5000))).toEqual([]);
    expect(messageProblems("invitation", "body", body(5001))).toEqual([
      { code: "message_too_long", values: { max: 5000 } },
    ]);
  });

  it("refuses an unknown placeholder, naming it", () => {
    expect(messageProblems("invitation", "body", "{link} {titel}")).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{titel}" } },
    ]);
    // Several are named together, each once, as they are written.
    expect(
      messageProblems("invitation", "body", "{link} {Link} {enlace} { link } {} {enlace}"),
    ).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{Link}, {enlace}, { link }, {}" } },
    ]);
    expect(codes("invitation", "subject", "Hello {name}")).toEqual(["message_unknown_placeholder"]);
  });

  it("refuses another message's placeholder: an invitation cannot name the title", () => {
    expect(messageProblems("invitation", "body", "{link} for “{title}”")).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{title}" } },
    ]);
    for (const key of ["invitation_withdrawn", "draft_deleted"] as const) {
      expect(messageProblems(key, "body", "{title} by {owner}: {link}")).toEqual([
        { code: "message_unknown_placeholder", values: { names: "{title}, {owner}, {link}" } },
      ]);
    }
    expect(codes("submission_withdrawn", "body", "{link} until {deadline}")).toEqual([
      "message_unknown_placeholder",
    ]);
  });

  it("refuses in a subject what is for the body only: the link, and an invitation's owner", () => {
    for (const key of [
      "invitation",
      "submission_received",
      "submission_withdrawn",
      "invitation_answered",
    ] as const) {
      expect(messageProblems(key, "subject", "Open {link}"), key).toEqual([
        { code: "message_not_in_subject", values: { names: "{link}" } },
      ]);
    }
    // The owner's name is the one thing an owner wrote that reaches an invitee. It stays in
    // the body, where it has always been.
    expect(messageProblems("invitation", "subject", "{owner} invites you: {link}")).toEqual([
      { code: "message_not_in_subject", values: { names: "{owner}, {link}" } },
    ]);
    expect(messageProblems("invitation", "body", "{owner} invites you: {link}")).toEqual([]);
    // Where a message has no link at all, it is simply unknown.
    expect(codes("draft_deleted", "subject", "Open {link}")).toEqual([
      "message_unknown_placeholder",
    ]);
  });

  it("refuses a body without a required placeholder, naming what is missing", () => {
    expect(messageProblems("invitation", "body", "{owner} has listed you.")).toEqual([
      { code: "message_missing_placeholder", values: { names: "{link}" } },
    ]);
    expect(messageProblems("invitation_answered", "body", "Something happened: {link}")).toEqual([
      { code: "message_missing_placeholder", values: { names: "{person}, {answer}" } },
    ]);
    // Written another way, it is not there: both problems are said.
    expect(messageProblems("submission_received", "body", "Received. { link }")).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{ link }" } },
      { code: "message_missing_placeholder", values: { names: "{link}" } },
    ]);
  });
});

describe("a link in a text", () => {
  const touched = [{ code: "message_link_touched", values: { names: "{link}" } }];

  it("stands apart: with a space, a line break or nothing on either side", () => {
    for (const text of [
      "{link}",
      "Answer here: {link}",
      "Answer here:\n\n{link}\n\nThank you.",
      "{link} is where you answer.",
      "Twice, to be sure:\n{link}\n{link}",
      "With a tab:\t{link}\t.",
    ]) {
      expect(messageProblems("invitation", "body", text), JSON.stringify(text)).toEqual([]);
    }
  });

  it("is refused when something touches it, which would become part of its address", () => {
    for (const text of [
      "Answer here: {link}.",
      "Answer here: {link}. Thank you.",
      "Answer here ({link})",
      "Answer here:{link}",
      "{link}{role}",
      "{role}{link}",
      "<{link}>",
      // One that stands apart does not excuse one that does not.
      "{link}\n\nAgain: {link}, please.",
    ]) {
      expect(messageProblems("invitation", "body", text), JSON.stringify(text)).toEqual(touched);
    }
    // In every message that has a link, and only there.
    for (const key of ["submission_received", "submission_withdrawn"] as const) {
      expect(messageProblems(key, "body", "See {link}.")).toEqual(touched);
    }
    expect(messageProblems("invitation_answered", "body", "{person} {answer}: {link}!")).toEqual(
      touched,
    );
    expect(messageProblems("draft_deleted", "body", "See {link}.")).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{link}" } },
    ]);
  });
});

describe("the words and the deadline that placeholders stand for", () => {
  it("has a word for every role and every answer in each language", () => {
    for (const lang of MAIL_LANGUAGES) {
      expect(Object.keys(ROLE_WORDS[lang]).sort()).toEqual([...ContributionRole.options].sort());
      expect(Object.keys(ANSWER_WORDS[lang])).toEqual(["confirmed", "declined", "left"]);
      for (const word of [...Object.values(ROLE_WORDS[lang]), ...Object.values(ANSWER_WORDS[lang])])
        expect(word.trim()).not.toBe("");
      expect(UNNAMED_OWNER[lang]).not.toBe("");
    }
  });

  it("writes a deadline in the reader's language, in the conference's time zone, and names it", () => {
    const iso = "2031-02-14T23:59:00-12:00";
    const locales: Record<MailLang, string> = { en: "en", es: "es-CO", pt: "pt-BR" };
    for (const lang of MAIL_LANGUAGES) {
      for (const timeZone of ["America/Bogota", "Europe/Lisbon"]) {
        const when = new Intl.DateTimeFormat(locales[lang], {
          dateStyle: "long",
          timeStyle: "short",
          timeZone,
        }).format(new Date(iso));
        expect(formatDeadline(iso, timeZone, lang)).toBe(`${when} (${timeZone})`);
      }
    }
    // Midday UTC on the 15th is the 15th in Bogotá, whatever the day was where it was written.
    expect(formatDeadline(iso, "America/Bogota", "en")).toContain("February 15, 2031");
  });
});

/** A small made-up conference in two of the three languages. */
const input: ConferenceConfigInput = {
  slug: "wording-test",
  year: 2031,
  title: { en: "Made-up meeting", es: "Encuentro inventado" },
  theme: { en: "Nothing in particular" },
  host: "Instituto Inventado",
  location: { en: "Nowhere" },
  modality: "online",
  timezone: "America/Bogota",
  defaultLanguage: "en",
  languages: ["en", "es"],
  contactEmail: "meeting@example.org",
  dates: { start: "2031-08-03", end: "2031-08-06" },
  deadlines: {
    submissionsOpen: "2031-01-11T00:00:00-05:00",
    submissionsClose: "2031-02-14T23:59:00-12:00",
    notification: "2031-04-30T23:59:00-05:00",
    finalMaterials: "2031-05-31T23:59:00-05:00",
  },
  rules: { presenterCap: null },
  reviewPools: [
    {
      key: "committee",
      name: { en: "Committee" },
      blindMode: "double",
      reviewsPerSubmission: 2,
      criteria: [{ key: "fit", label: { en: "Fit" } }],
    },
  ],
  submissionTypes: [
    {
      key: "talk",
      name: { en: "Talk" },
      description: { en: "A short talk." },
      reviewPool: "committee",
      abstract: { label: { en: "Abstract" }, maxWords: 300 },
      team: { min: 1, max: 4 },
    },
  ],
};

describe("a conference's own wording in its configuration", () => {
  const withMessages = (messages: unknown, more: Record<string, unknown> = {}) => ({
    ...input,
    ...more,
    messages,
  });
  const refusals = (candidate: unknown) => {
    const parsed = ConferenceConfig.safeParse(candidate);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          ...(issue.code === "custom" && issue.params ? { params: issue.params } : {}),
        }));
  };

  it("is optional: a conference that has written nothing holds no messages at all", () => {
    const parsed = ConferenceConfig.parse(input);
    expect(parsed).not.toHaveProperty("messages");
    expect(Object.keys(parsed)).not.toContain("messages");
    // Parsing it again changes nothing, down to the bytes that are stored.
    expect(JSON.stringify(ConferenceConfig.parse(parsed))).toBe(JSON.stringify(parsed));
    expect(JSON.stringify(parsed)).not.toContain("messages");
  });

  it("takes a subject, a body or both, in any language of the conference, as written", () => {
    const messages = {
      invitation: {
        subject: { es: "Te han invitado a {conference}" },
        body: { en: "Please answer:\n\n{link}\n", es: "Responde aquí: {link}" },
      },
      draft_deleted: { body: { en: "Never mind." } },
    };
    const parsed = ConferenceConfig.parse(withMessages(messages));
    expect(parsed.messages).toEqual(messages);
    expect(refusals(withMessages({ invitation_answered: { subject: { en: "News" } } }))).toEqual(
      [],
    );
  });

  it("takes only the messages there are, and only a subject and a body", () => {
    expect(refusals(withMessages({ reminder: { body: { en: "Remember." } } }))).toEqual([
      { path: "messages" },
    ]);
    expect(refusals(withMessages({ invitation: { footer: { en: "Bye." } } }))).toEqual([
      { path: "messages.invitation" },
    ]);
    expect(refusals(withMessages({ invitation: { body: "Answer: {link}" } }))).toEqual([
      { path: "messages.invitation.body" },
    ]);
    expect(refusals(withMessages({ invitation: { body: { en: 5 } } }))).toEqual([
      { path: "messages.invitation.body.en" },
    ]);
  });

  it("takes a text in any language the app writes mail in, whatever the conference's are", () => {
    // This conference has English and Spanish. Someone can still be invited in Portuguese, and
    // is then sent Portuguese mail: its wording may be the conference's own too.
    expect(input.languages).toEqual(["en", "es"]);
    const three = {
      draft_deleted: { subject: { en: "Never mind.", es: "Olvídalo.", pt: "Esqueça." } },
      invitation: { body: { pt: "Responda aqui: {link}" } },
    };
    expect(refusals(withMessages(three))).toEqual([]);
    expect(ConferenceConfig.parse(withMessages(three)).messages).toEqual(three);
    // None of them is required, not even the conference's main language (English here).
    expect(refusals(withMessages({ draft_deleted: { body: { pt: "Não se preocupe." } } }))).toEqual(
      [],
    );
    // And it makes no difference which languages the conference has.
    for (const languages of [["en"], ["en", "fr"], ["en", "es", "pt"]]) {
      expect(refusals(withMessages(three, { languages })), languages.join()).toEqual([]);
    }
  });

  it("takes a text in no other language, even one the conference has", () => {
    // French and a regional Portuguese are languages a conference may have, and not ones the
    // app writes mail in: nobody would ever be sent such a text.
    for (const lang of ["fr", "pt-BR", "de", "EN"]) {
      expect(
        refusals(
          withMessages(
            { draft_deleted: { subject: { [lang]: "Oubliez." } } },
            { languages: ["en", "fr", "pt-BR"] },
          ),
        ),
        lang,
      ).toEqual([{ path: "messages.draft_deleted.subject" }]);
    }
  });

  it("names what is wrong with a text, at the text", () => {
    const at = (part: string, text: string) =>
      refusals(withMessages({ invitation: { [part]: { es: text } } }));
    expect(at("body", "Hola {nombre}: {link}")).toEqual([
      {
        path: "messages.invitation.body.es",
        params: { code: "message_unknown_placeholder", values: { names: "{nombre}" } },
      },
    ]);
    expect(at("body", "Te han invitado.")).toEqual([
      {
        path: "messages.invitation.body.es",
        params: { code: "message_missing_placeholder", values: { names: "{link}" } },
      },
    ]);
    expect(at("body", "{title}: {link}")).toEqual([
      {
        path: "messages.invitation.body.es",
        params: { code: "message_unknown_placeholder", values: { names: "{title}" } },
      },
    ]);
    expect(at("subject", "Dos\nlíneas")).toEqual([
      { path: "messages.invitation.subject.es", params: { code: "message_not_one_line" } },
    ]);
    expect(at("subject", "Abre {link}")).toEqual([
      {
        path: "messages.invitation.subject.es",
        params: { code: "message_not_in_subject", values: { names: "{link}" } },
      },
    ]);
    expect(at("subject", "x".repeat(201))).toEqual([
      {
        path: "messages.invitation.subject.es",
        params: { code: "message_too_long", values: { max: 200 } },
      },
    ]);
    expect(at("body", `{link} ${"x".repeat(5000)}`)).toEqual([
      {
        path: "messages.invitation.body.es",
        params: { code: "message_too_long", values: { max: 5000 } },
      },
    ]);
    expect(at("body", "  \n ")).toEqual([
      { path: "messages.invitation.body.es", params: { code: "message_empty" } },
    ]);
    expect(at("subject", "")).toEqual([
      { path: "messages.invitation.subject.es", params: { code: "message_empty" } },
    ]);
    expect(at("body", "Responde aquí: {link}.")).toEqual([
      {
        path: "messages.invitation.body.es",
        params: { code: "message_link_touched", values: { names: "{link}" } },
      },
    ]);
    // Half a character is no text, and a text is plain: line breaks and tabs, and no other
    // control character (Postgres refuses both a lone surrogate and NUL inside JSON).
    expect(at("body", "{link} \uD83D")).toEqual([{ path: "messages.invitation.body.es" }]);
    expect(at("body", "{link} \u0000")).toEqual([{ path: "messages.invitation.body.es" }]);
    expect(at("body", "{link} \u001B[31m")).toEqual([{ path: "messages.invitation.body.es" }]);
    expect(at("body", "Hola:\r\n\t{link}\n")).toEqual([]);
  });

  it("says so whatever else is wrong with the configuration", () => {
    const broken = withMessages({ invitation: { body: { en: "No link." } } }, { year: "soon" });
    expect(refusals(broken)).toEqual([
      { path: "year" },
      {
        path: "messages.invitation.body.en",
        params: { code: "message_missing_placeholder", values: { names: "{link}" } },
      },
    ]);
  });

  it("has one way to say nothing is written: an object with nothing in it is refused", () => {
    expect(refusals(withMessages({}))).toEqual([{ path: "messages" }]);
    expect(refusals(withMessages({ invitation: {} }))).toEqual([{ path: "messages.invitation" }]);
    expect(refusals(withMessages({ invitation: { subject: {} } }))).toEqual([
      { path: "messages.invitation.subject" },
    ]);
    expect(
      refusals(withMessages({ invitation: { subject: {}, body: { en: "Go: {link}" } } })),
    ).toEqual([{ path: "messages.invitation.subject" }]);
    // It is said beside whatever else is wrong with the texts, in one round.
    expect(
      refusals(withMessages({ invitation: { subject: {}, body: { en: "No link." } } })),
    ).toEqual([
      { path: "messages.invitation.subject" },
      {
        path: "messages.invitation.body.en",
        params: { code: "message_missing_placeholder", values: { names: "{link}" } },
      },
    ]);
    expect(
      refusals(withMessages({ invitation: { body: { en: "{link} \uD83D" } }, draft_deleted: {} })),
    ).toEqual([{ path: "messages.invitation.body.en" }, { path: "messages.draft_deleted" }]);
  });
});
