import { ConferenceConfig, filledMessage, linkSpans, messageProblems } from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureCall } from "./fixtures";
import { answeredMessage, invitationMessage, sanitizeName, type Wording } from "./templates";

/*
 * A conference's own text cannot turn a person's name into a link, and cannot hide or reorder
 * its words (spec 02, §1.9). Three review concerns on pull request 39 are reproduced here
 * as they were filed, and each is now refused:
 * - RC-github---amsucf-elochair-39-001: a text builds a link around the owner's name;
 * - RC-github---amsucf-elochair-39-002 and -003: a text carries bidirectional and zero-width
 *   format characters.
 *
 * What a link or an address is, is what the sanitizer of names says it is: the detectors of
 * packages/schema/src/links.ts (linkSpans), which sanitizeName removes from an owner's name.
 */

const TO = "reader@example.org";
const LINK = "https://chair.example.org/en/invitation#token=inv_made_up";
const FALLBACK = "Someone";
const VALUES = { role: "co-author", format: "Short talk", conference: "Made-up Meeting" };

/** Text around the owner's name that leaves it a word of its own. */
const APART = [
  "{owner} has listed you",
  "({owner})",
  "{owner},",
  "You were listed by {owner}.",
  "You were listed by {owner}. Please answer.",
  "{owner}: a proposal",
  "{owner}'s proposal",
  "«{owner}»",
  "“{owner}”",
  '"{owner}"',
  "Do you know {owner}?",
  "¿Conoces a {owner}?",
  "{owner}!",
  "({owner}), {owner}'s and “{owner}”.",
];
/** Text that would make the name part of a link, an address or another word. */
const JOINED = [
  "https://{owner}.example",
  "{owner}.com",
  "www.{owner}.org",
  "{owner}@example.org",
  "mailto:{owner}",
  "x{owner}",
  "{owner}x",
  "{owner}/path",
  "{owner}-site.org",
  "{owner}:8080",
  "{owner}\u3002com",
  "{owner}\uFF0Ecom",
  "{owner}\uFF61com",
  "www\u3002{owner}\u3002org",
  "{owner}\uFF20example.org",
  "user@{owner}",
  "tel:{owner}",
  "{owner}://example.org",
  "10.0.0.{owner}",
  "{owner}.1",
  "{owner}?q=1",
  "{owner}#top",
  "{owner}{role}",
  "{conference}/{owner}",
  "user@example.org({owner})",
  "https://example.org/({owner})",
  "({owner})@example.org",
  "{owner}'s@example.org",
];
/** Names an owner might choose to make trouble, and some that are only unusual. */
const NAMES = [
  "attacker",
  "evil",
  "www",
  "com",
  "org",
  "example",
  "https",
  "http",
  "ftp",
  "mailto",
  "tel",
  "sms",
  "javascript",
  "data",
  "Tel:",
  "Data:",
  "mailto:",
  "http:",
  "https:/",
  "//evil",
  "10.0.0",
  "1.2.3",
  "192.168.0",
  "J.R",
  "v1.2",
  "A.1",
  "x",
  "1",
  "a-b",
  "a_b",
  "name.",
  "name:",
  "name/",
  "name-",
  "#tag",
  "?q",
  "/path",
  ".hidden",
  "Ana María Pérez-Gómez",
  "J. R. R. Tolkien",
  "O'Neil",
  "Big Data: The Poetics",
  "Tel: Aviv",
  "\u0645\u0635\u0631",
  "\u0915\u0949\u092E",
  // Names the sanitizer empties or cuts down: what is left is what is put in.
  "evil-phish.com",
  "a@b.example",
  "https://evil.example/x",
  "1.2.3.4tel:5550100",
  `${"A".repeat(92)} 1.2.3.4567`,
];

/** The body `around` gives, with the link it must have, as an invitation in English. */
const wording = (around: string): Wording => ({
  messages: { invitation: { body: { en: `${around}\n\n{link}` } } },
});

/**
 * Whether an invitation worded with `around`, from an owner called `name`, holds a link or an
 * address that includes any character of that name. Null when the text is refused.
 */
function linksTheName(around: string, name: string): boolean | null {
  const body = `${around}\n\n{link}`;
  if (messageProblems("invitation", "body", body).length > 0) return null;
  const owner = sanitizeName(name, FALLBACK);
  const filled = filledMessage("invitation", "body", body, { ...VALUES, owner, link: LINK });
  // What is checked is what is sent.
  const sent = invitationMessage(wording(around), "en", TO, {
    ...VALUES,
    role: "coauthor",
    ownerName: name,
    link: LINK,
  });
  expect(sent.text).toBe(filled.text);
  for (const at of filled.names) expect(filled.text.slice(at.start, at.end)).toBe(owner);
  return linkSpans(filled.text).some((link) =>
    filled.names.some((at) => link.start < at.end && link.end > at.start),
  );
}

describe("a text cannot build a link out of the owner's name (RC-github---amsucf-elochair-39-001)", () => {
  it("refuses the text the reviewer filed, in the schema and in the shared rule", () => {
    const filed = "https://{owner}.example\n\n{link}";
    const parsed = ConferenceConfig.safeParse({
      ...fixtureCall,
      messages: { invitation: { body: { en: filed } } },
    });
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.map((issue) => ({
        path: issue.path.join("."),
        ...(issue.code === "custom" ? { params: issue.params } : {}),
      })),
    ).toEqual([
      {
        path: "messages.invitation.body.en",
        params: { code: "message_name_touched", values: { names: "{owner}" } },
      },
    ]);
    expect(messageProblems("invitation", "body", filed)).toEqual([
      { code: "message_name_touched", values: { names: "{owner}" } },
    ]);
  });

  it("does not mail https://attacker.example even if that text were stored", () => {
    // The schema refuses it, so it cannot be stored. Were it there all the same, the name is
    // set apart from what the text puts around it: no link in the mail includes it.
    const sent = invitationMessage(wording("https://{owner}.example"), "en", TO, {
      ...VALUES,
      role: "coauthor",
      ownerName: "attacker",
      link: LINK,
    });
    expect(sent.text).toBe(`https:// attacker .example\n\n${LINK}`);
    expect(sent.text).not.toContain("attacker.example");
    expect(sent.text).not.toMatch(/\/\/attacker/);
  });

  it("takes ordinary writing around a name, and refuses what could join it into a link", () => {
    for (const around of APART) {
      expect(messageProblems("invitation", "body", `${around}\n\n{link}`), around).toEqual([]);
    }
    for (const around of JOINED) {
      expect(messageProblems("invitation", "body", `${around}\n\n{link}`), around).toEqual([
        { code: "message_name_touched", values: { names: "{owner}" } },
      ]);
    }
  });

  it("for every text and every name of a table, the text is refused or no link includes the name", () => {
    for (const around of [...APART, ...JOINED]) {
      for (const name of NAMES) {
        const linked = linksTheName(around, name);
        // Every text that could join the name is refused, whatever the name is.
        expect(linked === null, around).toBe(JOINED.includes(around));
        expect(linked ?? false, `${JSON.stringify(around)} with ${JSON.stringify(name)}`).toBe(
          false,
        );
      }
    }
  });

  it("holds whatever is put around the name and whatever the name is", () => {
    const edges = [
      ..." ()[],.:;!?'\"/@-_#x1s",
      "’",
      "«",
      "»",
      "\u3002",
      "\uFF20",
      "\n",
      "www.",
      ".com",
      "https://",
      "mailto:",
      "tel:",
      "{role}",
      "{conference}",
    ];
    const pieces = [
      ..."aZ0159 .-/:#*'",
      "com",
      "org",
      "www",
      "https",
      "tel",
      "Tel:",
      "data:",
      "mailto",
      "1.2.3",
      "1.2.3.4",
      "J.R",
      "\u3002",
      "\u200C",
      "\u200D",
      "\u0646",
      "\u0915\u0949\u092E",
      "Ana",
      "Pérez",
    ];
    const around = fc.array(fc.constantFrom(...edges), { maxLength: 5 }).map((a) => a.join(""));
    const name = fc.array(fc.constantFrom(...pieces), { maxLength: 14 }).map((a) => a.join(""));
    let accepted = 0;
    fc.assert(
      fc.property(around, around, name, (before, after, owner) => {
        const linked = linksTheName(`${before}{owner}${after}`, owner);
        if (linked !== null) accepted += 1;
        expect(linked ?? false).toBe(false);
      }),
      { numRuns: 20_000 },
    );
    // Not vacuous: thousands of those texts pass the rule and were rendered.
    expect(accepted).toBeGreaterThan(1_000);
  });

  it("holds for the name an owner typed for someone, in a subject and in a body", () => {
    const answered = (text: string, part: "subject" | "body") =>
      messageProblems(
        "invitation_answered",
        part,
        part === "body" ? `${text}\n\n{person} {answer}\n\n{link}` : text,
      );
    for (const text of ["https://{person}.example", "{person}@example.org", "www.{person}.org"]) {
      for (const part of ["subject", "body"] as const) {
        expect(answered(text, part), `${part} ${text}`).toEqual([
          { code: "message_name_touched", values: { names: "{person}" } },
        ]);
      }
    }
    // That name is shown to the owner as the owner typed it, an address included: the text
    // around it adds nothing to it, and takes nothing from it.
    const sent = answeredMessage(
      { messages: { invitation_answered: { subject: { en: "({person}) {answer}" } } } },
      "en",
      TO,
      { conference: "Made-up Meeting", who: "bruno@example.net", answer: "declined", link: LINK },
    );
    expect(sent.subject).toBe("(bruno@example.net) declined");
  });
});

describe("a text cannot carry invisible characters (RC-github---amsucf-elochair-39-002 and -003)", () => {
  const refusal = (messages: unknown) => {
    const parsed = ConferenceConfig.safeParse({ ...fixtureCall, messages });
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          ...(issue.code === "custom" ? { params: issue.params } : {}),
        }));
  };
  /** The subject one reviewer filed, and a body as the other described it. */
  const SUBJECT = "Hello\u202Eevil";
  const BODY = "Please answer:\n\n{link}\n\nThank you\u202Edetucexe\u202C.\u200B\u200Bhidden\u200B";

  it("refuses the subject and the body the reviewers filed, in the schema and in the shared rule", () => {
    expect(refusal({ invitation: { subject: { en: SUBJECT } } })).toEqual([
      { path: "messages.invitation.subject.en", params: { code: "message_invisible" } },
    ]);
    expect(refusal({ invitation: { body: { en: BODY } } })).toEqual([
      { path: "messages.invitation.body.en", params: { code: "message_invisible" } },
    ]);
    expect(messageProblems("invitation", "subject", SUBJECT)).toEqual([
      { code: "message_invisible" },
    ]);
    expect(messageProblems("invitation", "body", BODY)).toEqual([{ code: "message_invisible" }]);
  });

  it("takes the joiners that Persian and Indic words and emoji are written with", () => {
    const persian = "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645";
    const artist = "\u{1F469}\u{1F3FD}\u200D\u{1F3A8}";
    expect(
      refusal({
        draft_deleted: {
          subject: { en: `${persian} ${artist}` },
          body: { en: `${persian} ${artist} {conference}` },
        },
      }),
    ).toEqual([]);
  });
});
