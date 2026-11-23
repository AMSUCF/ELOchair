import { describe, expect, it } from "vitest";
import {
  ConferenceConfig,
  type ConferenceConfigInput,
  ContributionRole,
  readStoredConfig,
  withoutUnknownEmails,
} from "./config";
import { DECISION_OUTCOMES } from "./decisions";
import { LIMITS, ROLE_INVITATIONS } from "./limits";
import {
  ANSWER_WORDS,
  type ConferenceMessages,
  commentsBlock,
  committeeList,
  DECISION_MESSAGES,
  DECLINE_REASON_WORDS,
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
  noCommentsSentence,
  placeholdersIn,
  placeholdersOf,
  ROLE_WORDS,
  reasonList,
  reviewerLabel,
  reviewsDueSentence,
  UNNAMED_OWNER,
} from "./messages";
import { MESSAGES_BEFORE, type MessageBefore } from "./messages.before";
import { DECLINE_REASONS, type DeclineReason } from "./reviewForm";

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
    // The names a reviewer's invitation was called with, " | " between them.
    committees: c.cleaned?.committees ?? committeeList(input("committees").split(" | ")),
    // The four emails of the review phase: a number, the two links, and what the server makes
    // of the day reviews are due and of the reasons a proposal was given back for.
    count: input("count"),
    choices: input("choices"),
    due: reviewsDueSentence(c.input.deadline, c.lang),
    reason: reasonList(
      input("reasons")
        .split(" | ")
        .filter((r): r is DeclineReason => (DECLINE_REASONS as readonly string[]).includes(r))
        .map((r) => DECLINE_REASON_WORDS[c.lang][r]),
    ),
    // The emails about a decision: the reviewers' comments as one block. Where the server
    // cleaned them it is the block as the server made it; otherwise it is made of the comments
    // the function was called with, " | " between them, and of none where there were none.
    comments:
      c.cleaned?.comments ??
      commentsBlock(
        input("comments") === ""
          ? []
          : input("comments")
              .split(" | ")
              .map((text) => ({ text, cut: false })),
        input("link"),
        c.lang,
      ),
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
  it("are these fifteen, by keys that are stored and never renamed", () => {
    expect(MESSAGE_KEYS).toEqual([
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
      "decision_accepted",
      "decision_waitlisted",
      "decision_rejected",
    ]);
    for (const key of MESSAGE_KEYS) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(Object.keys(MESSAGES)).toEqual([...MESSAGE_KEYS]);
  });

  it("name what each has always carried, and require what it is useless without", () => {
    const shape = Object.fromEntries(
      MESSAGE_KEYS.map((key) => {
        const { placeholders, required, bodyOnly, names } = MESSAGES[key];
        return [key, { placeholders, required, bodyOnly, names }];
      }),
    );
    expect(shape).toEqual({
      invitation: {
        placeholders: ["owner", "role", "format", "conference", "link"],
        required: ["link"],
        bodyOnly: ["owner", "link"],
        names: ["owner"],
      },
      submission_received: {
        placeholders: ["title", "format", "conference", "deadline", "link"],
        required: ["link"],
        bodyOnly: ["link"],
        names: [],
      },
      submission_withdrawn: {
        placeholders: ["title", "format", "conference", "link"],
        required: ["link"],
        bodyOnly: ["link"],
        names: [],
      },
      invitation_withdrawn: {
        placeholders: ["conference"],
        required: [],
        bodyOnly: [],
        names: [],
      },
      invitation_answered: {
        placeholders: ["person", "answer", "conference", "link"],
        required: ["person", "answer", "link"],
        bodyOnly: ["link"],
        names: ["person"],
      },
      draft_deleted: { placeholders: ["conference"], required: [], bodyOnly: [], names: [] },
      reviewer_invitation: {
        placeholders: ["committees", "conference", "link"],
        required: ["link"],
        bodyOnly: ["link"],
        names: [],
      },
      chair_invitation: {
        placeholders: ["conference", "link"],
        required: ["link"],
        bodyOnly: ["link"],
        names: [],
      },
      new_assignments: {
        placeholders: ["count", "conference", "due", "link", "choices"],
        required: ["link", "choices"],
        bodyOnly: ["link", "choices"],
        names: [],
      },
      review_reminder: {
        placeholders: ["count", "conference", "due", "link", "choices"],
        required: ["link", "choices"],
        bodyOnly: ["link", "choices"],
        names: [],
      },
      reviewer_declined: {
        placeholders: ["count", "reason", "conference", "link", "choices"],
        required: ["link", "choices"],
        bodyOnly: ["link", "choices"],
        names: [],
      },
      reviews_complete: {
        placeholders: ["count", "conference", "link", "choices"],
        required: ["link", "choices"],
        bodyOnly: ["link", "choices"],
        names: [],
      },
      decision_accepted: {
        placeholders: ["title", "format", "conference", "comments", "link"],
        required: ["link"],
        bodyOnly: ["comments", "link"],
        names: [],
      },
      decision_waitlisted: {
        placeholders: ["title", "format", "conference", "comments", "link"],
        required: ["link"],
        bodyOnly: ["comments", "link"],
        names: [],
      },
      decision_rejected: {
        placeholders: ["title", "format", "conference", "comments", "link"],
        required: ["link"],
        bodyOnly: ["comments", "link"],
        names: [],
      },
    });
    for (const key of MESSAGE_KEYS) {
      for (const name of [...MESSAGES[key].bodyOnly, ...MESSAGES[key].names]) {
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

  it("give people invited to a role nothing a person typed: no name at all, of anyone", () => {
    // Not the chair who invites, not the name that chair typed for the invitee, no title: only
    // what the conference's configuration says, and the link.
    const typed = ["owner", "person", "title", "name", "chair", "inviter", "invitee", "email"];
    for (const key of ["reviewer_invitation", "chair_invitation"] as const) {
      const { placeholders, names, required, bodyOnly } = MESSAGES[key];
      for (const name of typed) expect(placeholders, `${key} ${name}`).not.toContain(name);
      expect([...names], key).toEqual([]);
      // The link is the only way to answer, and stays out of the subject.
      expect([...required], key).toEqual(["link"]);
      expect([...bodyOnly], key).toEqual(["link"]);
    }
    expect([...MESSAGES.reviewer_invitation.placeholders].sort()).toEqual([
      "committees",
      "conference",
      "link",
    ]);
    expect([...MESSAGES.chair_invitation.placeholders].sort()).toEqual(["conference", "link"]);
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
      "reviewer_invitation",
      "chair_invitation",
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

describe("a name in a text", () => {
  /** An invitation's body around `{owner}`, with the link it has to have. */
  const body = (around: string) => `${around}\n\n{link}`;
  const touched = (name: string) => [
    { code: "message_name_touched", values: { names: `{${name}}` } },
  ];
  /** Text that leaves the name a word of its own. */
  const apart = [
    "{owner} has listed you",
    "Listed by {owner}",
    "{owner}",
    "({owner})",
    "[{owner}]",
    "{owner}, who created the proposal",
    "You were listed by {owner}.",
    "You were listed by {owner}. Please answer.",
    "Listed by: {owner}",
    "{owner}: a proposal",
    "{owner}'s proposal",
    "{owner}’s proposal",
    "It is {owner}'s.",
    "«{owner}»",
    "“{owner}”",
    '"{owner}"',
    "'{owner}'",
    "‘{owner}’",
    "({owner}).",
    "“{owner}”, they wrote",
    "¿Conoces a {owner}?",
    "¡{owner}!",
    "{owner}; then",
    "{owner}…",
    "First line\n{owner}\nlast line",
    "{owner}\tand a tab",
    "{owner} {role}",
    "Twice: {owner} and {owner}.",
  ];
  /** Text that would make the name part of a link or an address, or of another word. */
  const joined = [
    "https://{owner}.example",
    "http://{owner}",
    "{owner}.com",
    "{owner}.example.org",
    "www.{owner}.org",
    "www.{owner}",
    "{owner}@example.org",
    "user@{owner}",
    "@{owner}",
    "mailto:{owner}",
    "tel:{owner}",
    "x{owner}",
    "{owner}x",
    "1{owner}",
    "{owner}1",
    "{owner}/path",
    "/{owner}",
    "example.org/{owner}",
    "example.org/?q={owner}",
    "{owner}-site.org",
    "-{owner}",
    "{owner}_x",
    "{owner}:8080",
    "{owner}://example.org",
    "{owner}:x",
    "{owner}#top",
    "{owner}?q=1",
    "{owner}.1",
    "10.0.0.{owner}",
    // The dots that mail clients also take for a domain's.
    "{owner}\u3002com",
    "{owner}\uFF0Ecom",
    "{owner}\uFF61com",
    "www\u3002{owner}",
    "{owner}\uFF20example.org",
    // Next to another placeholder, whose value could be anything.
    "{owner}{role}",
    "{role}{owner}",
    "{conference}/{owner}",
    // What touches it counts as far as the next space: an address runs on through a bracket.
    "user@example.org({owner})",
    "https://example.org/({owner})",
    "({owner})@example.org",
    "“{owner}”.example.org",
    "{owner}'s@example.org",
    "{owner}'sx",
    "{owner}—and others",
    // A mark that an address is made with, though nothing follows it yet.
    "{owner}/",
    "{owner}/ and",
    "{owner}#",
    "{owner}@",
    "{owner}-",
    "{owner}_",
    "{owner}=",
    "{owner}&",
    "{owner}*",
    "#{owner}",
    "={owner}",
    "_{owner}",
    "*{owner}*",
    ":{owner}",
    ".{owner}",
    // One that stands apart does not excuse one that does not.
    "{owner} and www.{owner}.org",
  ];

  it("may be touched by brackets, quotation marks and the punctuation that ends a phrase", () => {
    for (const text of apart) {
      expect(messageProblems("invitation", "body", body(text)), text).toEqual([]);
    }
  });

  it("is refused next to anything that could make it part of a link or an address", () => {
    for (const text of joined) {
      expect(messageProblems("invitation", "body", body(text)), text).toEqual(touched("owner"));
    }
  });

  it("is the same for the name an owner typed for someone, in a subject as in a body", () => {
    const answered = (text: string) => text.replaceAll("{owner}", "{person}");
    for (const text of apart) {
      // "{role}" is an invitation's; the answer to an owner has "{answer}" instead.
      const mine = answered(text).replaceAll("{role}", "{answer}");
      expect(
        messageProblems("invitation_answered", "subject", mine.replaceAll(/\s+/g, " ")),
        mine,
      ).toEqual([]);
      expect(
        messageProblems("invitation_answered", "body", `${mine}\n\n{answer} {person}\n\n{link}`),
        mine,
      ).toEqual([]);
    }
    for (const text of joined) {
      const mine = answered(text).replaceAll("{role}", "{answer}");
      expect(messageProblems("invitation_answered", "subject", mine), mine).toEqual(
        touched("person"),
      );
      expect(
        messageProblems("invitation_answered", "body", `${mine}\n\n{answer} {person}\n\n{link}`),
        mine,
      ).toEqual(touched("person"));
    }
  });

  it("is not a rule for what nobody typed: a title, a format, the conference", () => {
    expect(
      messageProblems("submission_received", "body", "“{title}”/{format}:{conference}\n\n{link}"),
    ).toEqual([]);
    for (const key of MESSAGE_KEYS) {
      const { names } = MESSAGES[key];
      expect([...names], key).toEqual(
        key === "invitation" ? ["owner"] : key === "invitation_answered" ? ["person"] : [],
      );
    }
  });

  it("is set apart by a space where it and its neighbours still read as a link", () => {
    const invitation = (text: string, owner: string) =>
      fillMessage("invitation", "body", text, { owner, link: "L", role: "co-author" });
    // The rule lets a comma and a question mark touch a name. These names end in what the
    // detectors take for the start of a link, so the mark is kept off them.
    expect(invitation("Listed by {owner}, as {role}.", "Tel:")).toBe(
      "Listed by Tel: , as co-author.",
    );
    expect(invitation("Do you know {owner}?", "J.R")).toBe("Do you know J.R ?");
    expect(invitation("({owner})", "Data:")).toBe("(Data: )");
    // Ordinary names are left exactly where the text puts them.
    for (const owner of ["Ana María Pérez-Gómez", "J. R. R. Tolkien", "O'Neil", "Tel", "Data"]) {
      expect(invitation("({owner}), {owner}'s, “{owner}”. Is it {owner}?", owner)).toBe(
        `(${owner}), ${owner}'s, “${owner}”. Is it ${owner}?`,
      );
    }
    // Whatever a text says, were one stored that the rule refuses: the name is no part of a link.
    expect(invitation("https://{owner}.example\n\n{link}", "attacker")).toBe(
      "https:// attacker .example\n\nL",
    );
    expect(invitation("{owner}@example.org www.{owner}.org", "attacker")).toBe(
      "attacker @example.org www. attacker .org",
    );
  });

  it("keeps what is a link in the name itself, where the name is shown as its owner typed it", () => {
    const answered = (text: string, person: string) =>
      fillMessage("invitation_answered", "body", text, { person, answer: "declined", link: "L" });
    // The owner invited an address and is told about that address: brackets do not change it.
    expect(answered("({person}) {answer}.", "bruno@example.net")).toBe(
      "(bruno@example.net) declined.",
    );
    expect(answered("{person}, {answer}", "Bruno bruno@example.net")).toBe(
      "Bruno bruno@example.net, declined",
    );
    // What the text would add to a plain name is still kept off it.
    expect(answered("{person}@example.org", "Bruno")).toBe("Bruno @example.org");
  });
});

describe("the invitations to a role", () => {
  const ROLE_KEYS = ["reviewer_invitation", "chair_invitation"] as const;

  it("take a text that names the conference, a reviewer's committees and the link", () => {
    expect(
      messageProblems(
        "reviewer_invitation",
        "body",
        "Would you review for {conference}? ({committees})\n\n{link}",
      ),
    ).toEqual([]);
    expect(messageProblems("reviewer_invitation", "subject", "{conference}: {committees}")).toEqual(
      [],
    );
    expect(messageProblems("chair_invitation", "body", "Join us at {conference}:\n{link}")).toEqual(
      [],
    );
    // No placeholder but the link is required: a conference may name itself in its own words.
    for (const key of ROLE_KEYS) expect(messageProblems(key, "body", "{link}")).toEqual([]);
  });

  it("refuse a text without the link, or with something touching it", () => {
    for (const key of ROLE_KEYS) {
      expect(messageProblems(key, "body", "You are invited to {conference}."), key).toEqual([
        { code: "message_missing_placeholder", values: { names: "{link}" } },
      ]);
      for (const text of ["Answer here: {link}.", "<{link}>", "{conference}{link}"]) {
        expect(messageProblems(key, "body", text), `${key} ${text}`).toEqual([
          { code: "message_link_touched", values: { names: "{link}" } },
        ]);
      }
    }
  });

  it("refuse a text that names a person: there is no such value to put in", () => {
    for (const key of ROLE_KEYS) {
      for (const name of ["owner", "person", "name", "chair", "title", "role", "format"]) {
        expect(messageProblems(key, "body", `{${name}} invites you:\n\n{link}`), name).toEqual([
          { code: "message_unknown_placeholder", values: { names: `{${name}}` } },
        ]);
        expect(messageProblems(key, "subject", `From {${name}}`), name).toEqual([
          { code: "message_unknown_placeholder", values: { names: `{${name}}` } },
        ]);
      }
    }
    // The committees are a reviewer's: an invitation to be a chair has none to name.
    expect(messageProblems("chair_invitation", "body", "{committees}\n\n{link}")).toEqual([
      { code: "message_unknown_placeholder", values: { names: "{committees}" } },
    ]);
  });

  it("refuse invisible characters, and a subject on two lines, like every other text", () => {
    for (const key of ROLE_KEYS) {
      expect(messageProblems(key, "subject", "Hello\u202Eevil"), key).toEqual([
        { code: "message_invisible" },
      ]);
      expect(messageProblems(key, "body", "Answer:\n\n{link}\n\n\u200Bhidden\u200B"), key).toEqual([
        { code: "message_invisible" },
      ]);
      expect(messageProblems(key, "subject", "Two\nlines"), key).toEqual([
        { code: "message_not_one_line" },
      ]);
      expect(messageProblems(key, "body", " \n "), key).toEqual([{ code: "message_empty" }]);
    }
  });

  it("are never given a value that is not theirs, and no link in a subject", () => {
    const values = {
      committees: "Committee",
      conference: "Made-up Meeting",
      link: "https://chair.example.org/en/role-invitation#token=made-up-token",
      // Not values of these messages: never put in, even if they are handed over.
      owner: "Ana",
      person: "Bruno",
      title: "A title",
    };
    const text = "{conference} {committees} {owner} {person} {title} {link}";
    expect(fillMessage("reviewer_invitation", "body", text, values)).toBe(
      `Made-up Meeting Committee {owner} {person} {title} ${values.link}`,
    );
    expect(fillMessage("reviewer_invitation", "subject", text, values)).toBe(
      "Made-up Meeting Committee {owner} {person} {title} {link}",
    );
    expect(fillMessage("chair_invitation", "body", text, values)).toBe(
      `Made-up Meeting {committees} {owner} {person} {title} ${values.link}`,
    );
    expect(fillMessage("chair_invitation", "subject", text, values)).toBe(
      "Made-up Meeting {committees} {owner} {person} {title} {link}",
    );
  });

  it("say how long the link works, which is how long it does", () => {
    expect(ROLE_INVITATIONS.days).toBe(30);
    for (const key of ROLE_KEYS) {
      for (const lang of MAIL_LANGUAGES) {
        expect(MESSAGES[key].standard[lang].body, `${key} ${lang}`).toMatch(
          /\b30 (days|días|dias)\b/,
        );
      }
    }
  });

  it("list a reviewer's committees in one line, in the order given", () => {
    expect(committeeList(["Scientific committee"])).toBe("Scientific committee");
    expect(committeeList(["Scientific committee", "Artistic committee"])).toBe(
      "Scientific committee, Artistic committee",
    );
    expect(committeeList([])).toBe("");
  });

  it("were captured with one committee, with two, and with names the server cleans", () => {
    for (const lang of MAIL_LANGUAGES) {
      const reviewer = MESSAGES_BEFORE.filter(
        (c) => c.key === "reviewer_invitation" && c.lang === lang,
      );
      expect(reviewer.map((c) => (c.input.committees ?? "").split(" | ").length)).toEqual([
        1, 2, 2,
      ]);
      expect(reviewer.filter((c) => c.cleaned?.committees !== undefined)).toHaveLength(1);
      expect(
        MESSAGES_BEFORE.filter((c) => c.key === "chair_invitation" && c.lang === lang),
      ).toHaveLength(1);
    }
  });
});

describe("the emails of the review phase", () => {
  const REVIEW_KEYS = [
    "new_assignments",
    "review_reminder",
    "reviewer_declined",
    "reviews_complete",
  ] as const;
  const LINK = "https://chair.example.org/en/reviews";
  const CHOICES = "https://chair.example.org/en/me#emails";

  it("carry nothing a person typed: no title, no author, no reviewer, no word of a review", () => {
    const typed = [
      "title",
      "abstract",
      "owner",
      "person",
      "name",
      "author",
      "reviewer",
      "chair",
      "email",
      "note",
      "comments",
      "format",
      "committees",
    ];
    for (const key of REVIEW_KEYS) {
      const { placeholders, names } = MESSAGES[key];
      for (const name of typed) expect(placeholders, `${key} ${name}`).not.toContain(name);
      // None of what they carry is a name a person typed.
      expect([...names], key).toEqual([]);
      for (const name of typed) {
        expect(messageProblems(key, "body", `{${name}}\n\n{link}\n\n{choices}`), name).toEqual([
          { code: "message_unknown_placeholder", values: { names: `{${name}}` } },
        ]);
      }
    }
    // What they do carry: a number, the conference, a day or a reason, and the two links.
    expect(
      [...new Set(REVIEW_KEYS.flatMap((key) => [...MESSAGES[key].placeholders]))].sort(),
    ).toEqual(["choices", "conference", "count", "due", "link", "reason"]);
  });

  it("require the link to the work and the link to the reader's choices, each standing apart", () => {
    for (const key of REVIEW_KEYS) {
      expect([...MESSAGES[key].required], key).toEqual(["link", "choices"]);
      expect(messageProblems(key, "body", "{count}\n{link}\n{choices}"), key).toEqual([]);
      expect(messageProblems(key, "body", "{count} at {conference}:\n{link}"), key).toEqual([
        { code: "message_missing_placeholder", values: { names: "{choices}" } },
      ]);
      expect(messageProblems(key, "body", "Change it here:\n{choices}"), key).toEqual([
        { code: "message_missing_placeholder", values: { names: "{link}" } },
      ]);
      // Whatever touches an address may be taken for part of it: either of the two.
      expect(messageProblems(key, "body", "{link}\n\nChoices: {choices}."), key).toEqual([
        { code: "message_link_touched", values: { names: "{choices}" } },
      ]);
      expect(messageProblems(key, "body", "({link})\n\n{choices}"), key).toEqual([
        { code: "message_link_touched", values: { names: "{link}" } },
      ]);
      expect(messageProblems(key, "body", "{link}{choices}"), key).toEqual([
        { code: "message_link_touched", values: { names: "{link}, {choices}" } },
      ]);
    }
  });

  it("keep both links out of a subject, and are never given them there", () => {
    for (const key of REVIEW_KEYS) {
      expect([...MESSAGES[key].bodyOnly], key).toEqual(["link", "choices"]);
      expect(
        messageProblems(key, "subject", "{conference}: {count} {link} {choices}"),
        key,
      ).toEqual([{ code: "message_not_in_subject", values: { names: "{link}, {choices}" } }]);
      const values = { count: "2", conference: "Made-up Meeting", link: LINK, choices: CHOICES };
      expect(fillMessage(key, "subject", "{conference} {count} {link} {choices}", values)).toBe(
        "Made-up Meeting 2 {link} {choices}",
      );
      expect(fillMessage(key, "body", "{conference} {count}\n{link}\n{choices}", values)).toBe(
        `Made-up Meeting 2\n${LINK}\n${CHOICES}`,
      );
    }
  });

  it("say in each language why the person got it, and where to change that", () => {
    const why: Record<MailLang, RegExp> = {
      en: /^You are getting this (email|reminder) because you (review for|are a chair of) \{conference\}/m,
      es: /^Recibes este (correo|recordatorio) porque (revisas para|presides) \{conference\}/m,
      pt: /^Recebe este (email|lembrete) porque (revê para|preside a) \{conference\}/m,
    };
    for (const key of REVIEW_KEYS) {
      for (const lang of MAIL_LANGUAGES) {
        const { body } = MESSAGES[key].standard[lang];
        expect(body, `${key} ${lang}`).toMatch(why[lang]);
        // The last thing in it is the link to the choices, on a line of its own.
        expect(body.endsWith("\n\n{choices}"), `${key} ${lang}`).toBe(true);
      }
    }
  });

  it("have a word for each reason a proposal is given back for, in each language", () => {
    for (const lang of MAIL_LANGUAGES) {
      expect(Object.keys(DECLINE_REASON_WORDS[lang])).toEqual([...DECLINE_REASONS]);
      for (const word of Object.values(DECLINE_REASON_WORDS[lang])) {
        expect(word.trim()).not.toBe("");
      }
    }
    expect(reasonList(["no time"])).toBe("no time");
    expect(reasonList(["a conflict of interest", "no time"])).toBe(
      "a conflict of interest; no time",
    );
    expect(reasonList([])).toBe("");
  });

  it("say when reviews are due in a sentence, and say so where no day is set", () => {
    expect(reviewsDueSentence("March 28, 2031 at 11:59 PM (America/Bogota)", "en")).toBe(
      "Reviews are due by March 28, 2031 at 11:59 PM (America/Bogota).",
    );
    expect(reviewsDueSentence("28 de marzo de 2031", "es")).toBe(
      "Las revisiones se entregan hasta el 28 de marzo de 2031.",
    );
    expect(reviewsDueSentence("28 de março de 2031", "pt")).toBe(
      "As revisões são entregues até 28 de março de 2031.",
    );
    expect(reviewsDueSentence(null, "en")).toBe(
      "The chairs have not set a day when reviews are due.",
    );
    for (const lang of MAIL_LANGUAGES) {
      for (const none of [null, undefined, ""]) {
        expect(reviewsDueSentence(none, lang).trim()).not.toBe("");
        expect(reviewsDueSentence(none, lang)).toBe(reviewsDueSentence(null, lang));
      }
    }
  });

  it("were captured about one thing and about several, with a day and without, for one reason and for all", () => {
    for (const lang of MAIL_LANGUAGES) {
      const of = (key: MailMessageKey) =>
        MESSAGES_BEFORE.filter((c) => c.key === key && c.lang === lang);
      expect(of("new_assignments").map((c) => [c.input.count, c.input.deadline !== null])).toEqual([
        ["1", true],
        ["4", false],
      ]);
      expect(of("review_reminder").map((c) => c.input.count)).toEqual(["3"]);
      expect(of("reviewer_declined").map((c) => [c.input.count, c.input.reasons])).toEqual([
        ["1", "time"],
        ["3", DECLINE_REASONS.join(" | ")],
      ]);
      expect(of("reviews_complete").map((c) => c.input.count)).toEqual(["2"]);
    }
  });
});

describe("the emails about a decision", () => {
  const DECISION_KEYS = ["decision_accepted", "decision_waitlisted", "decision_rejected"] as const;
  const LINK = "https://chair.example.org/en/s/0d6f1c1e-5a4b-4c3d-9e2f-7a8b9c0d1e2f";

  it("are one for each outcome a chair can decide", () => {
    expect(DECISION_MESSAGES).toEqual({
      accepted: "decision_accepted",
      waitlisted: "decision_waitlisted",
      rejected: "decision_rejected",
    });
    expect(Object.keys(DECISION_MESSAGES)).toEqual([...DECISION_OUTCOMES]);
    expect(Object.values(DECISION_MESSAGES)).toEqual([...DECISION_KEYS]);
  });

  it("name the proposal as the receipt does, and carry of its reviews the comments and nothing else", () => {
    // Not who reviewed, what they scored or recommended, or what they told the chairs; no
    // person at all; and nothing of the emails of the review phase.
    const never = [
      "reviewer",
      "reviewers",
      "score",
      "scores",
      "recommendation",
      "note",
      "chairNote",
      "owner",
      "person",
      "name",
      "author",
      "chair",
      "email",
      "abstract",
      "status",
      "outcome",
      "count",
      "choices",
      "due",
      "deadline",
    ];
    for (const key of DECISION_KEYS) {
      const { placeholders, names } = MESSAGES[key];
      expect([...placeholders].sort(), key).toEqual([
        "comments",
        "conference",
        "format",
        "link",
        "title",
      ]);
      // None of what they carry is a name a person typed.
      expect([...names], key).toEqual([]);
      for (const name of never) {
        expect(placeholders, `${key} ${name}`).not.toContain(name);
        expect(messageProblems(key, "body", `{${name}}\n\n{link}`), `${key} ${name}`).toEqual([
          { code: "message_unknown_placeholder", values: { names: `{${name}}` } },
        ]);
      }
    }
  });

  it("require the link, which stands apart, and may leave the comments out", () => {
    for (const key of DECISION_KEYS) {
      expect([...MESSAGES[key].required], key).toEqual(["link"]);
      expect(messageProblems(key, "body", "{title}\n\n{comments}\n\n{link}"), key).toEqual([]);
      // A rewording may leave the comments out: the proposal's page has them.
      expect(
        messageProblems(key, "body", "A decision on {title} ({format}):\n{link}"),
        key,
      ).toEqual([]);
      expect(messageProblems(key, "body", "{title}\n\n{comments}"), key).toEqual([
        { code: "message_missing_placeholder", values: { names: "{link}" } },
      ]);
      expect(messageProblems(key, "body", "{comments}\n\nRead it ({link})."), key).toEqual([
        { code: "message_link_touched", values: { names: "{link}" } },
      ]);
    }
  });

  it("keep the comments and the link out of a subject, and are never given them there", () => {
    const values = {
      title: "Poems with p5.js",
      format: "Short talk",
      conference: "Made-up Meeting",
      comments: "Comments from the reviewers:\n\nReviewer 1:\nA comment.",
      link: LINK,
    };
    for (const key of DECISION_KEYS) {
      expect([...MESSAGES[key].bodyOnly], key).toEqual(["comments", "link"]);
      expect(
        messageProblems(key, "subject", "{conference}: {title} {comments} {link}"),
        key,
      ).toEqual([{ code: "message_not_in_subject", values: { names: "{comments}, {link}" } }]);
      expect(fillMessage(key, "subject", "{conference}: {title} {comments} {link}", values)).toBe(
        "Made-up Meeting: Poems with p5.js {comments} {link}",
      );
      // The title and the format may stand in a subject, as they are one line each.
      expect(messageProblems(key, "subject", "{conference}: {title} ({format})"), key).toEqual([]);
      // What a reviewer typed is put in once and never read again: a placeholder in it stays.
      const typed = { ...values, comments: "See {link} and {conference}, or {title}." };
      expect(fillMessage(key, "body", "{comments}\n\n{link}", typed)).toBe(
        `See {link} and {conference}, or {title}.\n\n${LINK}`,
      );
    }
  });

  it("say the outcome in their standard texts, then the comments, then the link, in each language", () => {
    const says: Record<(typeof DECISION_KEYS)[number], Record<MailLang, RegExp>> = {
      decision_accepted: {
        en: /^The chairs of \{conference\} have accepted your proposal /,
        es: /^Quienes presiden \{conference\} han aceptado tu propuesta /,
        pt: /^Quem preside a \{conference\} aceitou a sua proposta /,
      },
      decision_waitlisted: {
        en: /^The chairs of \{conference\} have put your proposal .* on the waiting list\. It is not accepted so far, and it may still be: you will get another email when they decide\.$/m,
        es: /^Quienes presiden \{conference\} han puesto tu propuesta .* en lista de espera\. Por ahora no está aceptada, y todavía puede estarlo: recibirás otro correo cuando lo decidan\.$/m,
        pt: /^Quem preside a \{conference\} colocou a sua proposta .* em lista de espera\. Por agora não está aceite, e ainda pode vir a estar: receberá outro email quando houver uma decisão\.$/m,
      },
      decision_rejected: {
        en: /^The chairs of \{conference\} have not accepted your proposal /,
        es: /^Quienes presiden \{conference\} no han aceptado tu propuesta /,
        pt: /^Quem preside a \{conference\} não aceitou a sua proposta /,
      },
    };
    for (const key of DECISION_KEYS) {
      for (const lang of MAIL_LANGUAGES) {
        const { subject, body } = MESSAGES[key].standard[lang];
        expect(body, `${key} ${lang}`).toMatch(says[key][lang]);
        // The comments are a paragraph of their own, and the last thing is the link, alone.
        expect(body.split("\n\n"), `${key} ${lang}`).toContain("{comments}");
        expect(body.endsWith("\n\n{link}"), `${key} ${lang}`).toBe(true);
        expect(subject.startsWith("{conference}: "), `${key} ${lang}`).toBe(true);
      }
    }
    // The three subjects of a language differ: a reader can tell them apart in a list.
    for (const lang of MAIL_LANGUAGES) {
      const subjects = DECISION_KEYS.map((key) => MESSAGES[key].standard[lang].subject);
      expect(new Set(subjects).size, lang).toBe(3);
    }
  });

  it("put each review's comments under a number, in the order given, and never leave a hole", () => {
    const one = { text: "A first comment.", cut: false };
    const two = { text: "A second one,\n\nin two paragraphs.", cut: false };
    expect(commentsBlock([one, two], LINK, "en")).toBe(
      "Comments from the reviewers:\n\nReviewer 1:\nA first comment.\n\nReviewer 2:\nA second one,\n\nin two paragraphs.",
    );
    expect(commentsBlock([one], LINK, "es")).toBe(
      "Comentarios de quienes revisaron la propuesta:\n\nRevisión 1:\nA first comment.",
    );
    expect(commentsBlock([one], LINK, "pt")).toBe(
      "Comentários de quem reviu a proposta:\n\nRevisão 1:\nA first comment.",
    );
    // No comments: one plain sentence in their place, in the reader's language.
    expect(commentsBlock([], LINK, "en")).toBe(
      "No comments from reviewers come with this decision.",
    );
    for (const lang of MAIL_LANGUAGES) {
      expect(commentsBlock([], LINK, lang)).toBe(noCommentsSentence(lang));
      expect(noCommentsSentence(lang).trim()).not.toBe("");
      expect(noCommentsSentence(lang)).not.toContain("\n");
      // A number, and nothing that could be a name.
      expect(reviewerLabel(1, lang)).toMatch(/^\p{L}+ 1$/u);
      expect(reviewerLabel(12, lang)).toBe(reviewerLabel(1, lang).replace("1", "12"));
    }
    expect([1, 2].map((n) => reviewerLabel(n, "en"))).toEqual(["Reviewer 1", "Reviewer 2"]);
  });

  it("say so where comments were cut to fit an email, with the link on a line of its own", () => {
    const cut = { text: "A long comment that was cut…", cut: true };
    const whole = { text: "A short one.", cut: false };
    expect(commentsBlock([cut, whole], LINK, "en")).toBe(
      `Comments from the reviewers:\n\nReviewer 1:\nA long comment that was cut…\n[This comment is longer than an email carries. All of it is on the proposal's page:]\n${LINK}\n\nReviewer 2:\nA short one.`,
    );
    for (const lang of MAIL_LANGUAGES) {
      const lines = commentsBlock([cut], LINK, lang).split("\n");
      // The note is one line in the app's own words, and the link is the last line, alone.
      expect(lines.at(-1), lang).toBe(LINK);
      expect(lines.at(-2), lang).toMatch(/^\[.+:\]$/u);
      expect(commentsBlock([whole], LINK, lang), lang).not.toContain(LINK);
    }
    // The note, word for word, in the other two languages.
    expect(commentsBlock([cut], LINK, "es").split("\n").at(-2)).toBe(
      "[Este comentario es más largo de lo que cabe en un correo. Está completo en la página de la propuesta:]",
    );
    expect(commentsBlock([cut], LINK, "pt").split("\n").at(-2)).toBe(
      "[Este comentário é mais longo do que cabe num email. Está completo na página da proposta:]",
    );
    expect(LIMITS.mailedComment).toBe(4_000);
  });

  it("were captured for each outcome: with two reviewers' comments, with what the server cleans, and with none", () => {
    for (const lang of MAIL_LANGUAGES) {
      const of = (key: MailMessageKey) =>
        MESSAGES_BEFORE.filter((c) => c.key === key && c.lang === lang);
      const [accepted] = of("decision_accepted");
      const [waitlisted] = of("decision_waitlisted");
      const [rejected] = of("decision_rejected");
      expect(DECISION_KEYS.map((key) => of(key).length)).toEqual([1, 1, 1]);
      expect(accepted?.input.comments?.split(" | ")).toHaveLength(2);
      expect(accepted?.text).toContain(`${reviewerLabel(2, lang)}:\n`);
      // A title on two lines and comments with an invisible character: both cleaned.
      expect(Object.keys(waitlisted?.cleaned ?? {}).sort()).toEqual(["comments", "title"]);
      expect(waitlisted?.input.comments).toContain("\u200B");
      expect(waitlisted?.text).not.toContain("\u200B");
      expect(waitlisted?.text).not.toMatch(/[\t\r]| \n|\n{3}/);
      expect(rejected?.input.comments).toBe("");
      expect(rejected?.text).toContain(noCommentsSentence(lang));
    }
  });
});

describe("invisible characters in a text", () => {
  it("are refused: a bidi override or a zero-width character can hide or reorder words", () => {
    const invisible = [{ code: "message_invisible" }];
    // The two texts the reviewers filed: a subject that reads backwards from a point on, and a
    // body that hides text between zero-width characters.
    expect(messageProblems("invitation", "subject", "Hello\u202Eevil")).toEqual(invisible);
    expect(
      messageProblems(
        "invitation",
        "body",
        "Please answer:\n\n{link}\n\nThank you\u202Edetucexe\u202C.\u200B\u200Bhidden\u200B",
      ),
    ).toEqual(invisible);
    for (const hidden of [
      "\u200B",
      "\u200E",
      "\u2066",
      "\u00AD",
      "\uFEFF",
      "\u{E0041}",
      "\uFE01",
    ]) {
      expect(messageProblems("draft_deleted", "body", `Never${hidden} mind.`), hidden).toEqual(
        invisible,
      );
      expect(messageProblems("draft_deleted", "subject", `Never${hidden} mind`), hidden).toEqual(
        invisible,
      );
    }
    // A joiner where no writing needs one: between Latin letters.
    expect(messageProblems("draft_deleted", "body", "Nev\u200Der mind.")).toEqual(invisible);
  });

  it("are taken where writing needs them: joiners in Persian and Indic words, and in emoji", () => {
    const persian = "می\u200Cخواهم";
    const artist = "\u{1F469}\u{1F3FD}\u200D\u{1F3A8}";
    const heart = "❤\uFE0F";
    for (const text of [persian, `Thank you ${artist}`, `With ${heart} from the chairs`]) {
      expect(messageProblems("draft_deleted", "subject", text), text).toEqual([]);
      expect(messageProblems("draft_deleted", "body", `${text}\n\n{conference}`), text).toEqual([]);
    }
  });

  it("are a text that says nothing when there is nothing else", () => {
    expect(messageProblems("draft_deleted", "body", "\u202E\u200B")).toEqual([
      { code: "message_empty" },
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
    expect(at("body", "{link} \uD83D")).toEqual([
      { path: "messages.invitation.body.es", params: { code: "message_invisible" } },
    ]);
    expect(at("body", "{link} \u0000")).toEqual([{ path: "messages.invitation.body.es" }]);
    expect(at("body", "{link} \u001B[31m")).toEqual([{ path: "messages.invitation.body.es" }]);
    expect(at("body", "Hola:\r\n\t{link}\n")).toEqual([]);
  });

  it("refuses a text that builds a link around a name, as a reviewer filed it", () => {
    // RC-github---amsucf-elochair-39-001: the name "attacker" would have been mailed as
    // https://attacker.example to someone who has agreed to nothing.
    expect(
      refusals(withMessages({ invitation: { body: { en: "https://{owner}.example\n\n{link}" } } })),
    ).toEqual([
      {
        path: "messages.invitation.body.en",
        params: { code: "message_name_touched", values: { names: "{owner}" } },
      },
    ]);
    expect(
      refusals(withMessages({ invitation_answered: { subject: { es: "{person}@example.org" } } })),
    ).toEqual([
      {
        path: "messages.invitation_answered.subject.es",
        params: { code: "message_name_touched", values: { names: "{person}" } },
      },
    ]);
  });

  it("refuses a text with invisible characters, in a subject and in a body, as two reviewers filed it", () => {
    // RC-github---amsucf-elochair-39-002 and -003.
    const invisible = (path: string) => [{ path, params: { code: "message_invisible" } }];
    expect(refusals(withMessages({ invitation: { subject: { en: "Hello\u202Eevil" } } }))).toEqual(
      invisible("messages.invitation.subject.en"),
    );
    expect(
      refusals(
        withMessages({
          invitation: {
            body: {
              en: "Please answer:\n\n{link}\n\nThank you\u202Edetucexe\u202C.\u200Bhidden\u200B",
            },
          },
        }),
      ),
    ).toEqual(invisible("messages.invitation.body.en"));
    // A joiner that Persian spelling needs is taken, in a subject and in a body.
    const persian = "می\u200Cخواهم";
    expect(
      refusals(
        withMessages({
          draft_deleted: { subject: { en: persian }, body: { en: `${persian} {conference}` } },
        }),
      ),
    ).toEqual([]);
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
    ).toEqual([
      { path: "messages.invitation.body.en", params: { code: "message_invisible" } },
      { path: "messages.draft_deleted" },
    ]);
  });
});

/*
 * Reading a configuration back from where it was stored (readStoredConfig). A later version of
 * the app may have stored the wording of an email this version does not send: after a
 * roll-back the conference must still load. Nothing else about reading is any more lenient
 * than saving, and nothing about saving changes.
 */
describe("a stored configuration that holds an email this version does not know", () => {
  /** An email a later version might add, as that version would have stored its wording. */
  const LATER = {
    decision_sent: {
      subject: { en: "{conference}: a decision on your proposal" },
      body: { en: "{outcome}\n\n{comments}\n\n{link}" },
    },
  };
  const KNOWN = { draft_deleted: { body: { es: "Olvídalo: {conference}." } } };
  const stored = (messages: unknown) => ({ ...input, messages });
  const refusedOnRead = (candidate: unknown) => {
    try {
      readStoredConfig(candidate);
      return [];
    } catch (err) {
      return (err as { issues: { path: (string | number)[] }[] }).issues.map((issue) =>
        issue.path.join("."),
      );
    }
  };

  it("loads without it, and with everything else the configuration holds", () => {
    const read = readStoredConfig(stored({ ...KNOWN, ...LATER }));
    expect(read.messages).toEqual(KNOWN);
    // Everything else is what reading the configuration without that email gives.
    expect(read).toEqual(ConferenceConfig.parse(stored(KNOWN)));
    // Whatever the unknown email holds: it is not this version's to judge.
    for (const anything of [{}, null, "text", 5, { footer: { fr: "\u202E" } }]) {
      expect(readStoredConfig(stored({ ...KNOWN, made_up: anything })).messages).toEqual(KNOWN);
    }
  });

  it("holds no messages at all where that email was the only wording stored", () => {
    const read = readStoredConfig(stored(LATER));
    expect(read).not.toHaveProperty("messages");
    expect(read).toEqual(ConferenceConfig.parse(input));
    // Stored with nothing in it to begin with is still refused: only what was left out counts.
    expect(refusedOnRead(stored({}))).toEqual(["messages"]);
  });

  it("is still refused when it comes in: only reading leaves it out", () => {
    for (const messages of [LATER, { ...KNOWN, ...LATER }]) {
      const parsed = ConferenceConfig.safeParse(stored(messages));
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["messages"]);
    }
  });

  it("takes the three emails about a decision, reworded, when they come in and when they are read back", () => {
    // To the version before decisions these three are emails "added since", which the tests
    // above are about: it reads the conference without them. That version was run against a
    // database that holds them (spec 03, §2, "Going back a version").
    // What a chair may have stored under this version: each of the three, reworded.
    const reworded = {
      decision_accepted: {
        subject: { en: "{conference}: yes to {title}" },
        body: { en: "Yes ({format}).\n\n{comments}\n\n{link}", es: "Sí.\n\n{link}" },
      },
      decision_waitlisted: { body: { pt: "Em lista de espera: {title}.\n\n{comments}\n\n{link}" } },
      decision_rejected: { subject: { es: "{conference}: no" } },
    };
    // This version takes them, when they come in and when they are read back.
    const now = ConferenceConfig.parse(stored({ ...KNOWN, ...reworded }));
    expect(now.messages).toEqual({ ...KNOWN, ...reworded });
    expect(readStoredConfig(stored({ ...KNOWN, ...reworded }))).toEqual(now);
    // Nothing is left out: the same object comes back.
    const all = stored({ ...KNOWN, ...reworded });
    expect(withoutUnknownEmails(all)).toBe(all);
  });

  it("leaves out nothing else, and changes nothing where every email is known", () => {
    const plain = stored(KNOWN);
    // The very same object where there is nothing to leave out.
    expect(withoutUnknownEmails(plain)).toBe(plain);
    expect(withoutUnknownEmails(input)).toBe(input);
    for (const odd of [null, undefined, "text", 5, [], { messages: [] }, { messages: "x" }]) {
      expect(withoutUnknownEmails(odd)).toBe(odd);
    }
    // Only keys of `messages` itself are looked at, and what is handed in is not changed.
    const both = stored({ ...KNOWN, ...LATER });
    const before = JSON.stringify(both);
    expect(withoutUnknownEmails(both)).toEqual(plain);
    expect(JSON.stringify(both)).toBe(before);
    // Every email this version sends is known to it.
    const every = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, {}]));
    expect(withoutUnknownEmails({ messages: every })).toEqual({ messages: every });
  });

  it("refuses on reading whatever is refused on saving, everywhere else", () => {
    const cases: [string, unknown, string[]][] = [
      [
        "an unknown part of an email it sends",
        { invitation: { footer: { en: "Bye." } } },
        ["messages.invitation"],
      ],
      [
        "a language the app does not write mail in",
        { draft_deleted: { body: { fr: "Oubliez." } } },
        ["messages.draft_deleted.body"],
      ],
      [
        "a text without a placeholder it must hold",
        { invitation: { body: { en: "You are invited." } } },
        ["messages.invitation.body.en"],
      ],
      [
        "a placeholder the email does not have",
        { draft_deleted: { body: { en: "Gone: {title}" } } },
        ["messages.draft_deleted.body.en"],
      ],
      ["an email with nothing written", { draft_deleted: {} }, ["messages.draft_deleted"]],
    ];
    for (const [what, messages, paths] of cases) {
      // On its own, and beside an email this version does not know: leaving that one out
      // excuses nothing else.
      for (const candidate of [stored(messages), stored({ ...(messages as object), ...LATER })]) {
        expect(refusedOnRead(candidate), what).toEqual(paths);
        expect(ConferenceConfig.safeParse(stored(messages)).success, what).toBe(false);
      }
    }
    // And outside the emails: a configuration that is not one is not read.
    expect(refusedOnRead({ ...input, messages: LATER, timezone: "Nowhere/At_All" })).toEqual([
      "timezone",
    ]);
    expect(refusedOnRead({ ...input, messages: LATER, reviewPools: [] })).toContain("reviewPools");
  });
});
