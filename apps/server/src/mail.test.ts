import { commentsForAuthors } from "@elochair/policy";
import {
  AFTER_SIGN_IN_MAX,
  afterSignIn,
  hasStrayInvisible,
  linkSpans,
  type Review,
} from "@elochair/schema";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./db/client";
import { outbox } from "./db/schema";
import {
  deliverOnce,
  deliverPending,
  enqueueMail,
  MAX_ATTEMPTS,
  type MailTransport,
  MemoryTransport,
  magicLinkMessage,
} from "./mail";
import {
  answeredMessage,
  invitationMessage,
  mailedText,
  oneLine,
  receivedMessage,
  sanitizeName,
  withdrawnMessage,
} from "./templates";

const db0 = openDatabase({});
const db = db0.db;
beforeAll(() => db0.migrate());
afterAll(() => db0.close());

const at = new Date("2027-02-01T12:00:00Z");
const now = () => at;
/** A conference that has changed no email's wording: these tests are about the standard texts. */
const STANDARD = {};

describe("outbox delivery", () => {
  it("never sends a message twice when passes overlap", async () => {
    const mail = new MemoryTransport();
    for (let i = 0; i < 5; i++) {
      await enqueueMail(db, "note", { to: `p${i}@example.org`, subject: "s", text: "t" }, at);
    }
    const counts = await Promise.all([
      deliverPending(db, mail, { now }),
      deliverPending(db, mail, { now }),
      deliverPending(db, mail, { now }),
    ]);
    await deliverPending(db, mail, { now });
    expect(mail.sent).toHaveLength(5);
    expect(new Set(mail.sent.map((m) => m.to)).size).toBe(5);
    expect(counts.reduce((a, b) => Math.max(a, b), 0)).toBe(5);
  });

  it("removes the sign-in link and code from the stored copy once sent", async () => {
    const mail = new MemoryTransport();
    const msg = magicLinkMessage(
      "en",
      "redact@example.org",
      "https://x.example/en/auth/verify#token=SECRETtoken_123",
      "12345678",
    );
    await enqueueMail(db, "magic_link", msg, at);
    await deliverPending(db, mail, { now });
    expect(mail.latestTo("redact@example.org")?.text).toContain("#token=SECRETtoken_123");
    expect(mail.latestTo("redact@example.org")?.text).toContain("1234 5678");
    const [row] = await db.select().from(outbox).where(eq(outbox.toEmail, "redact@example.org"));
    expect(row?.bodyText).not.toContain("SECRETtoken_123");
    expect(row?.bodyText).not.toContain("1234 5678");
  });

  it("removes the token from a sign-in link that says where to go, and leaves that address", async () => {
    const mail = new MemoryTransport();
    const link =
      "https://x.example/en/auth/verify#token=SECRET_token-456&next=%2Fen%2Fc%2Fmade-up-call%2Fsubmit%3Fformat%3Dreading";
    const msg = magicLinkMessage("en", "redact-next@example.org", link, "87654321");
    await enqueueMail(db, "magic_link", msg, at);
    await deliverPending(db, mail, { now });
    expect(mail.latestTo("redact-next@example.org")?.text).toContain(`\n${link}\n`);
    const [row] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.toEmail, "redact-next@example.org"));
    expect(row?.bodyText).not.toContain("SECRET_token-456");
    expect(row?.bodyText).not.toContain("8765 4321");
    expect(row?.bodyText).toContain(
      "\nhttps://x.example/en/auth/verify#token=[redacted]&next=%2Fen%2Fc%2Fmade-up-call%2Fsubmit%3Fformat%3Dreading\n",
    );
  });

  it("a sign-in email carries its link on one unbroken line, however long the address in it", async () => {
    // The longest address a link may carry, made of the characters that grow most when encoded.
    const next = `/pt/${"a/".repeat((AFTER_SIGN_IN_MAX - 4) / 2)}`;
    expect(next).toHaveLength(AFTER_SIGN_IN_MAX);
    expect(afterSignIn(next)).toBe(next);
    const link = `https://submissions.a-long-conference-name.example.org/pt/auth/verify#token=${"t".repeat(43)}&next=${encodeURIComponent(next)}`;
    expect(link).not.toMatch(/\s/);
    // As it is sent: the same call SmtpTransport makes, written out instead of handed to a server.
    const smtp = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
    });
    for (const lang of ["en", "es", "pt"]) {
      const msg = magicLinkMessage(lang, "long@example.org", link, "12345678");
      const sent = await smtp.sendMail({
        from: "ELOchair <no-reply@example.org>",
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      const raw = String(sent.message);
      const [head = "", ...rest] = raw.split("\r\n\r\n");
      // A line of the message itself stays far below what a mail server takes (998 characters):
      // the long line is folded for transport, and a mail program puts it back together.
      expect(head).toMatch(/^Content-Transfer-Encoding: quoted-printable$/m);
      for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
      const read = Buffer.from(
        rest
          .join("\r\n\r\n")
          .replace(/=\r\n/g, "")
          .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          ),
        "latin1",
      ).toString("utf8");
      expect(read.replace(/\r\n/g, "\n").trimEnd()).toBe(msg.text);
      expect(read.split("\r\n")).toContain(link);
    }
  });

  it("does not send a sign-in email after its link has expired", async () => {
    const mail = new MemoryTransport();
    const msg = magicLinkMessage(
      "en",
      "late@example.org",
      "https://x.example/en/auth/verify#token=LATEtoken",
      "87654321",
    );
    await enqueueMail(db, "magic_link", msg, at);
    await deliverPending(db, mail, { now: () => new Date(at.getTime() + 21 * 60_000) });
    expect(mail.sent).toHaveLength(0);
    const [row] = await db.select().from(outbox).where(eq(outbox.toEmail, "late@example.org"));
    expect(row?.bodyText).not.toContain("LATEtoken");
    expect(row?.lastError).toBe("expired before delivery");
  });

  it("backs off after failures instead of burning every attempt at once", async () => {
    const failing: MailTransport = { send: async () => Promise.reject(new Error("smtp down")) };
    await enqueueMail(db, "note", { to: "retry@example.org", subject: "s", text: "t" }, at);
    for (let i = 0; i < 20; i++) await deliverPending(db, failing, { now });
    const [row] = await db.select().from(outbox).where(eq(outbox.toEmail, "retry@example.org"));
    expect(row?.attempts).toBe(1);
    expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(at.getTime());

    // When SMTP is back and the backoff has passed, it goes out.
    const mail = new MemoryTransport();
    await deliverPending(db, mail, { now: () => new Date(at.getTime() + 2 * 60_000) });
    expect(mail.latestTo("retry@example.org")).toBeDefined();
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

class SlowTransport extends MemoryTransport {
  override async send(msg: Parameters<MemoryTransport["send"]>[0]): Promise<void> {
    await new Promise((r) => setTimeout(r, 30));
    await super.send(msg);
  }
}

describe("review fixes, round 2: delivery passes", () => {
  it("two overlapping passes (as from two processes) send each message once", async () => {
    const mail = new SlowTransport();
    for (let i = 0; i < 4; i++)
      await enqueueMail(db, "note", { to: `claim${i}@example.org`, subject: "s", text: "t" }, at);
    await Promise.all([deliverOnce(db, mail, now), deliverOnce(db, mail, now)]);
    const mine = mail.sent.filter((m) => m.to.startsWith("claim"));
    expect(mine).toHaveLength(4);
    expect(new Set(mine.map((m) => m.to)).size).toBe(4);
  });

  it("mail queued during a pass goes out in a follow-up pass, not at the next timer tick", async () => {
    const mail = new SlowTransport();
    await enqueueMail(db, "note", { to: "first@example.org", subject: "s", text: "t" }, at);
    const firstPass = deliverPending(db, mail, { now });
    await enqueueMail(db, "note", { to: "second@example.org", subject: "s", text: "t" }, at);
    await deliverPending(db, mail, { now });
    await firstPass;
    expect(mail.latestTo("first@example.org")).toBeDefined();
    expect(mail.latestTo("second@example.org")).toBeDefined();
  });
});

describe("review fixes, round 3: secrets and owner-written text in mail", () => {
  const invitation = (to: string, token: string) =>
    invitationMessage(STANDARD, "en", to, {
      ownerName: "Olga Owner",
      conference: "ELO 2027",
      format: "Talk",
      role: "coauthor",
      link: `https://x.example/en/invitation#token=${token}`,
    });

  it("removes the invitation link token from the stored copy once sent (#13 #22)", async () => {
    const mail = new MemoryTransport();
    await enqueueMail(db, "invitation", invitation("inv-sent@example.org", "inv_SENTsecret"), at);
    await deliverPending(db, mail, { now });
    expect(mail.latestTo("inv-sent@example.org")?.text).toContain("#token=inv_SENTsecret");
    const [row] = await db.select().from(outbox).where(eq(outbox.toEmail, "inv-sent@example.org"));
    expect(row?.sentAt).not.toBeNull();
    expect(row?.bodyText).not.toContain("inv_SENTsecret");
    expect(row?.bodyText).toContain("#token=[redacted]");
    // The rest of the stored copy stays readable (nothing else looks like a secret).
    expect(row?.bodyText).toContain("Olga Owner has listed you as co-author");
  });

  it("removes link tokens and codes when delivery gives up (#13 #22)", async () => {
    const failing: MailTransport = { send: async () => Promise.reject(new Error("smtp down")) };
    await enqueueMail(db, "invitation", invitation("inv-fail@example.org", "inv_FAILsecret"), at);
    const link = magicLinkMessage(
      "en",
      "link-fail@example.org",
      "https://x.example/en/auth/verify#token=LINKfail",
      "24681357",
    );
    await enqueueMail(db, "magic_link", link, at);
    const stored = async (to: string) =>
      (await db.select().from(outbox).where(eq(outbox.toEmail, to)))[0];
    // Retry until the last attempt, waiting out each backoff (sign-in mail expires on the way).
    let clock = at.getTime();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await deliverOnce(db, failing, () => new Date(clock));
      if (i === MAX_ATTEMPTS - 2) {
        expect((await stored("inv-fail@example.org"))?.bodyText).toContain("inv_FAILsecret");
      }
      clock += 5 * 60 * 60 * 1000;
    }
    const row = await stored("inv-fail@example.org");
    expect(row?.attempts).toBe(MAX_ATTEMPTS);
    expect(row?.sentAt).toBeNull();
    expect(row?.bodyText).not.toContain("inv_FAILsecret");
    const signIn = await stored("link-fail@example.org");
    expect(signIn?.bodyText).not.toContain("LINKfail");
    expect(signIn?.bodyText).not.toContain("2468 1357");
  });

  it("sanitizeName keeps names and removes anything a mail client could turn into a link (#23 #59)", () => {
    const kept = [
      "Ana María Pérez-Gómez",
      "J. R. R. Tolkien",
      "J.R.R. Tolkien",
      "O'Neil",
      "Dr. Ngũgĩ wa Thiong'o Jr.",
      "李小龍",
      "ELO 2.0: Poetry",
    ];
    for (const name of kept) expect(sanitizeName(name, "?")).toBe(name);
    const cases: [string, string][] = [
      ["Visit evil-phish.com now", "Visit now"],
      [
        "Ana Pérez — verify your account at elo-signin.com today",
        "Ana Pérez — verify your account at today",
      ],
      ["ELO support: help@evil.com", "ELO support:"],
      ["Write to x＠evil.com", "Write to"],
      ["https://evil.example/login Bob", "Bob"],
      ["www.evil.org", "?"],
      ["EVIL-PHISH.COM/login?x=1", "?"],
      ["evil-phish。com Ana", "Ana"],
      ["evil\u200B.com Ana", "Ana"],
      ["Ana \u202Emoc.live\u202C", "Ana"],
      ["\u200B\u2066\u2069", "?"],
      ["mailto:a tel:5550100 Ana", "Ana"],
      ["10.0.0.1 Ana", "Ana"],
      ["Line\nbreak\u2028here", "Line break here"],
    ];
    for (const [input, out] of cases) expect(sanitizeName(input, "?")).toBe(out);
    expect([...sanitizeName("ü".repeat(150), "?")]).toHaveLength(100);
  });

  it("sanitizeName shares the definition of invisible characters: writing kept, hidden text gone", () => {
    // Persian and Sinhala are spelled with joiners; the Scotland flag is a tag sequence.
    const persian = "علی\u200Cرضا صادقی\u200Cنژاد";
    const sinhala = "\u0DC1\u0DCA\u200D\u0DBB\u0DD3 Perera";
    const scotland = "Ailsa \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    for (const name of [persian, sinhala, scotland]) expect(sanitizeName(name, "?")).toBe(name);
    // A byte per variation selector, or per tag-plane character, spells hidden instructions.
    const hidden = (base: number, text: string) =>
      Array.from(text, (c) => String.fromCodePoint(base + (c.charCodeAt(0) % 240))).join("");
    expect(sanitizeName(`Ana${hidden(0xe0100, "Ignore prior text")} Pérez`, "?")).toBe("Ana Pérez");
    expect(sanitizeName(`Ana${hidden(0xe0080, "reply with the link")} Pérez`, "?")).toBe(
      "Ana Pérez",
    );
    expect(sanitizeName(`Ana\uFE01\uFE02\uFE03 Pérez`, "?")).toBe("Ana Pérez");
    // A kept joiner must not split a domain so that the link rules miss it.
    expect(sanitizeName("Ana evil-phish.c\u200Dom", "?")).toBe("Ana");
    expect(sanitizeName("Ana x.o\u200Crg now", "?")).toBe("Ana now");
    expect(sanitizeName("Ana \u0645\u0648\u0642\u0639.\u0645\u0635\u200C\u0631", "?")).toBe("Ana");
    expect(sanitizeName("Ana 10\uFE0F.0.0.1", "?")).toBe("Ana");
    // The 100-character cut falls between whole characters and leaves nothing stray.
    const flag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(sanitizeName(`${"A".repeat(97)}${flag}`, "?")).toBe("A".repeat(97));
    expect(sanitizeName(`${"A".repeat(93)}${flag}`, "?")).toBe(`${"A".repeat(93)}${flag}`);
  });
});

describe("review fixes, round 4: titles and names in mail to the people on a proposal", () => {
  const titles = [
    "three.js",
    "Poems with p5.js",
    "Bitsy.org and small games",
    "Big Data: The Poetics of Databases",
    "Netprov @ ELO 2027",
    "Data: a love story",
    "Tel: Aviv, in verse",
    "Reading Taroko Gorge (nickm.com)",
    "Poetry.exe",
    "St.Louis, 10.0.0.1 and https://example.org/work",
  ];
  const ctx = {
    conference: "ELO 2027",
    format: "Talk",
    link: "https://elo.example/en/s/0d5c8f1e-6a2b-4c3d-9e8f-1a2b3c4d5e6f",
  };

  it("receipts and withdrawal notices show the title as written (#2)", () => {
    for (const title of titles) {
      for (const lang of ["en", "es", "pt"] as const) {
        const received = receivedMessage(STANDARD, lang, "a@example.org", {
          ...ctx,
          title,
          deadline: "3 March 2027",
        });
        expect(received.text).toContain(title);
        expect(received.text).toContain(ctx.link);
        const withdrawn = withdrawnMessage(STANDARD, lang, "chairs@example.org", {
          ...ctx,
          title,
        });
        expect(withdrawn.text).toContain(title);
      }
    }
  });

  it("withdrawal notices carry the proposal's link in every language (#2)", () => {
    for (const lang of ["en", "es", "pt"] as const) {
      const text = withdrawnMessage(STANDARD, lang, "chairs@example.org", {
        ...ctx,
        title: "T",
      }).text;
      expect(text.split("\n").at(-1)).toBe(ctx.link);
    }
  });

  it("the title is put on one line, without invisible characters, and never cut silently (#2)", () => {
    expect(oneLine("A title\nin\ttwo\r\n lines\u2028here", "—")).toBe("A title in two lines here");
    // Bidi overrides and zero-width spaces go; joiners inside words and emoji stay.
    expect(oneLine("Ana \u202Emoc.live\u202C Pérez\u200B", "—")).toBe("Ana moc.live Pérez");
    expect(oneLine("می\u200Cخواهم", "—")).toBe("می\u200Cخواهم");
    const artist = "\u{1F469}\u{1F3FD}\u200D\u{1F3A8}";
    const scotland = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(oneLine(`Poems ${artist} ${scotland}`, "—")).toBe(`Poems ${artist} ${scotland}`);
    // Tags that are not a standard flag can spell hidden instructions for AI mail readers.
    const hidden = Array.from("IGNORE PREVIOUS", (c) =>
      String.fromCodePoint(0xe0000 + c.charCodeAt(0)),
    );
    expect(oneLine(`Poems \u{1F4CE}${hidden.join("")}\u{E007F} for the web`, "—")).toBe(
      "Poems \u{1F4CE} for the web",
    );
    expect(oneLine(" \u200B\n ", "—")).toBe("—");
    expect(oneLine(null, "—")).toBe("—");
    // A generous cap, ending in an ellipsis, never splitting a character.
    const long = `${"word ".repeat(80)}end`;
    const cut = oneLine(long, "—");
    expect(cut.endsWith("…")).toBe(true);
    expect(Array.from(cut)).toHaveLength(300);
    expect(oneLine("x".repeat(300), "—")).toBe("x".repeat(300));
    const emoji = oneLine(artist.repeat(301), "—");
    expect(emoji).toBe(`${artist.repeat(299)}…`);
  });

  it("what a reviewer wrote for the authors is mailed as plain text: its line breaks kept, nothing invisible, and never cut silently", () => {
    // Every kind of line break becomes one line feed. Tabs and other control characters
    // become spaces: a vertical tab, a form feed and a "next line" among them.
    expect(mailedText("one\r\ntwo\rthree\u2028four\u2029five").text).toBe(
      "one\ntwo\nthree\nfour\nfive",
    );
    expect(mailedText("a\tb\u000Bc\u000Cd\u0085e\u0000f").text).toBe("a b c d e f");
    // Spaces at the end of a line go, and more than one empty line becomes one.
    expect(mailedText("  One.  \n\t\n\n\n Two. \n").text).toBe("One.\n\n Two.");
    // Bidi overrides, zero-width spaces and hidden tags go; joiners in words and emoji stay.
    const persian = "می\u200Cخواهم";
    expect(mailedText(`Ana \u202Emoc.live\u202C Pérez\u200B\n${persian}`).text).toBe(
      `Ana moc.live Pérez\n${persian}`,
    );
    const artist = "\u{1F469}\u{1F3FD}\u200D\u{1F3A8}";
    const hidden = Array.from("IGNORE PREVIOUS", (c) =>
      String.fromCodePoint(0xe0000 + c.charCodeAt(0)),
    );
    expect(
      mailedText(`Poems ${artist}\n\u{1F4CE}${hidden.join("")}\u{E007F} for the web`).text,
    ).toBe(`Poems ${artist}\n\u{1F4CE} for the web`);
    // A link stays as it was written: the reader is one of the proposal's own people.
    expect(mailedText("See https://example.org/a?b=1#c.").text).toBe(
      "See https://example.org/a?b=1#c.",
    );
    // Nothing that can be read: nothing is mailed.
    for (const nothing of ["", "   ", " \u200B\n \u0001\t", null, undefined]) {
      expect(mailedText(nothing)).toEqual({ text: "", cut: false });
    }
    // Bounded, between whole characters, and it says that it was cut.
    expect(mailedText("x".repeat(4_000))).toEqual({ text: "x".repeat(4_000), cut: false });
    expect(mailedText("x".repeat(4_001))).toEqual({ text: `${"x".repeat(3_999)}…`, cut: true });
    expect(mailedText(artist.repeat(4_001))).toEqual({
      text: `${artist.repeat(3_999)}…`,
      cut: true,
    });
    expect(mailedText("word ".repeat(10), 8)).toEqual({ text: "word wo…", cut: true });
    expect(mailedText("word ".repeat(10), 6)).toEqual({ text: "word…", cut: true });
    // A cut never leaves a joiner whose partner was cut off.
    const name = "علی\u200Cرضا";
    for (let max = 2; max < 8; max++) {
      const cut = mailedText(name.repeat(3), max);
      expect(cut.cut, String(max)).toBe(true);
      expect(hasStrayInvisible(cut.text), String(max)).toBe(false);
    }
  });

  // A pattern that looked for spaces at the end of a line took the square of the length over
  // this (half a minute here); line by line it takes a few hundredths of a second. This runs
  // while a send holds its rows, so the time is part of what is tested.
  it("a long run of spaces that ends no line is no more work to clean than any other text", () => {
    const spaced = `x${" ".repeat(200_000)}x`;
    expect(mailedText(spaced, 1_000_000).text).toBe(spaced);
  }, 5_000);

  it("what the authors are given of a review's comments is the text that is mailed: one text, numbered alike", () => {
    // The policy hands on the comments (commentsForAuthors): they are stored with the decision
    // and shown on the proposal's page. The email carries them through mailedText. Both clean
    // with one function, so the page shows what the email does; were they to differ on what
    // is empty, "Reviewer 2" on the page would be "Reviewer 1" in the email.
    const given = (comments: string) =>
      commentsForAuthors(
        {
          reviews: [
            {
              id: "r1",
              submissionId: "s1",
              status: "sent",
              sentAt: "2027-01-01T00:00:00.000Z",
              comments,
            } as unknown as Review,
          ],
        },
        "s1",
      );
    for (const text of ["", " ", "\n\n", "\u200B", "\u200B \u2060\n", "\u0001", "\t\u0085\u000B"]) {
      expect([given(text), mailedText(text).text], JSON.stringify(text)).toEqual([[], ""]);
    }
    for (const [text, clean] of [
      ["x", "x"],
      [" x ", "x"],
      ["\u200Bx", "x"],
      [".", "."],
      ["\u0001é", "é"],
      ["Good\u202E work\u200B.\r\n\r\n\r\nNext.\u202C  ", "Good work.\n\nNext."],
    ] as const) {
      expect([given(text), mailedText(text)], JSON.stringify(text)).toEqual([
        [clean],
        { text: clean, cut: false },
      ]);
    }
    const piece = fc.constantFrom(
      " ",
      "\n",
      "\t",
      "\r",
      "\u00A0",
      "\u0001",
      "\u0085",
      "\u200B",
      "\u200C",
      "\u200D",
      "\u2028",
      "\u202E",
      "\u2060",
      "\uFEFF",
      "a",
      "é",
      "م",
      "\u{1F3A8}",
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 6 }), (pieces) => {
        const text = pieces.join("");
        const mailed = mailedText(text).text;
        expect(given(text)).toEqual(mailed === "" ? [] : [mailed]);
      }),
      { numRuns: 20_000 },
    );
  });

  it("the owner learns who answered from what they typed, the address included (#1)", () => {
    for (const lang of ["en", "es", "pt"] as const) {
      const msg = answeredMessage(STANDARD, lang, "owner@example.org", {
        conference: "ELO 2027",
        who: "bruno@example.net",
        answer: "declined",
        link: ctx.link,
      });
      expect(msg.subject).toContain("bruno@example.net");
      expect(msg.text).toContain("bruno@example.net");
    }
    const named = answeredMessage(STANDARD, "en", "owner@example.org", {
      conference: "ELO 2027",
      who: "Nina\nNuñez",
      answer: "confirmed",
      link: ctx.link,
    });
    expect(named.subject).toBe("ELO 2027: Nina Nuñez confirmed your proposal");
  });

  it("invitations still strip links and addresses from the owner's name (#2)", () => {
    const text = (ownerName: string) =>
      invitationMessage(STANDARD, "en", "x@example.org", {
        ownerName,
        conference: "ELO 2027",
        format: "Talk",
        role: "coauthor",
        link: "https://elo.example/en/invitation#token=inv_x",
      }).text;
    const phish = text("Ana Pérez verify at elo-signin.com or help@evil.example now");
    expect(phish).toMatch(/^Ana Pérez verify at or now has listed you/);
    expect(phish).not.toMatch(/elo-signin|evil\.example|help@/);
    // A scheme needs a target: "Data:" and "Tel:" followed by a space are words, not links.
    expect(sanitizeName("Big Data: The Poetics", "?")).toBe("Big Data: The Poetics");
    expect(sanitizeName("Tel: Aviv", "?")).toBe("Tel: Aviv");
    expect(sanitizeName("Data:", "?")).toBe("Data:");
    expect(sanitizeName("Ana tel:+15550100 sms:5550100 data:text/html,x Pérez", "?")).toBe(
      "Ana Pérez",
    );
    expect(sanitizeName("Ana JavaScript:alert(1) Pérez", "?")).toBe("Ana Pérez");
  });
});

describe("review fixes, round 6: removals never join, cuts never strand a joiner", () => {
  it("a removed IP address or link leaves a space, so its neighbours cannot form a domain", () => {
    expect(sanitizeName("Ana evil.c1.2.3.4om", "?")).not.toMatch(/evil\.com/);
    expect(sanitizeName("Ana evil.1.2.3.4com", "?")).not.toMatch(/evil\.com/);
    expect(sanitizeName("Ana evil-phish.c0.0.0.0om now", "?")).not.toMatch(/evil-phish\.com/);
    expect(sanitizeName("Ana evil.chttps://x.yom", "?")).not.toMatch(/evil\.com/);
    expect(sanitizeName("Ana evil.ca@b.cdom", "?")).not.toMatch(/evil\.com/);
  });

  it("a joiner after an ideographic full stop does not hide an internationalized domain", () => {
    expect(
      sanitizeName("Ana Pérez verify at elo-signin\u3002\u200D\u0915\u0949\u092E now", "?"),
    ).toBe("Ana Pérez verify at now");
    expect(sanitizeName("Ana paypal\u3002\u200D\u0DBD\u0D82\u0D9A\u0DCF", "?")).toBe("Ana");
    expect(sanitizeName("Ana \u0628\u0646\u0643\u200D\u3002\u200D\u0645\u0635\u0631", "?")).toBe(
      "Ana",
    );
  });

  it("no host name survives sanitizeName, whatever dots and joiners surround it", () => {
    const atoms = [
      "a",
      "bc",
      "\u0915\u0949\u092E",
      "\u0645\u0635\u0631",
      "\u0DBD\u0D82\u0D9A\u0DCF",
      ".",
      "\u3002",
      "\uFF0E",
      "\u200C",
      "\u200D",
      "\u202F",
      " ",
      "-",
    ];
    const HOST =
      /[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}_-]|\u200C|\u200D)*[.\u3002\uFF0E\uFF61](?:\u200C|\u200D)*\p{L}[\p{L}\p{M}]/u;
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 16 }), (parts) => {
        expect(sanitizeName(parts.join(""), "?")).not.toMatch(HOST);
      }),
      { numRuns: 30_000 },
    );
  });

  it("sanitizeName goes on until nothing is left to take out", () => {
    // Taking the numbers out gives "tel" the word break it lacked: what is left is a link too.
    expect(sanitizeName("1.2.3.4tel:5550100", "?")).toBe("?");
    expect(sanitizeName("Ana 1.2.3.4data:text/html,x Pérez", "?")).toBe("Ana Pérez");
    // The cut at 100 characters ends a run of digits early: "1.2.3.4567" is no address, and
    // the "1.2.3.4" the cut would leave is one.
    const cut = sanitizeName(`${"A".repeat(92)} 1.2.3.4567`, "?");
    expect(cut).toBe("A".repeat(92));
    expect(linkSpans(cut)).toEqual([]);
    // Names that had nothing to take out are as they were.
    for (const name of [
      "Ana Mar\u00EDa Pérez-G\u00F3mez",
      "J. R. R. Tolkien",
      "Tel: Aviv",
      "Data:",
    ]) {
      expect(sanitizeName(name, "?")).toBe(name);
    }
  });

  it("nothing the detectors take for a link or an address survives sanitizeName", () => {
    const atoms = [
      ..."aZ0159 .-/@:#*'()",
      "com",
      "org",
      "https://",
      "www.",
      "tel:",
      "Data:",
      "mailto:",
      "1.2.3.4",
      "1.2.3.4567",
      "\u3002",
      "\uFF20",
      "\u200B",
      "\u200C",
      "\u200D",
      "\uFE0F",
      "\u0646",
      "\u{1F469}",
      "\u202F",
      "\u0915\u0949\u092E",
      "Ana",
    ];
    fc.assert(
      // Long enough for the cut at 100 characters to fall anywhere.
      fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 90 }), (parts) => {
        const name = sanitizeName(parts.join(""), "?");
        expect(linkSpans(name)).toEqual([]);
        expect(sanitizeName(name, "?")).toBe(name);
        expect(Array.from(name).length).toBeLessThanOrEqual(100);
      }),
      { numRuns: 20_000 },
    );
  });

  it("sanitizeName is idempotent and leaves nothing stray, whatever it is given", () => {
    const atoms = [
      ..."aZ0159 .-/@:#*",
      "com",
      "org",
      "https://",
      "www.",
      "\u3002",
      "\u200B",
      "\u200C",
      "\u200D",
      "\uFE0F",
      "\u20E3",
      "\u0D30",
      "\u0D4D",
      "\u0646",
      "\u{1F469}",
      "\u{1F3F4}",
      "\u{E0067}",
      "\u202F",
      "\u0915\u0949\u092E",
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 30 }), (parts) => {
        const once = sanitizeName(parts.join(""), "?");
        expect(sanitizeName(once, "?")).toBe(once);
        expect(hasStrayInvisible(once)).toBe(false);
      }),
      { numRuns: 30_000 },
    );
  });

  it("a cut title never ends in a joiner whose partner was cut off", () => {
    const persian = "\u0639\u0644\u06CC\u200C\u0631\u0636\u0627";
    const cut = oneLine(persian, "?", 4);
    expect(hasStrayInvisible(cut)).toBe(false);
    expect(cut.endsWith("…")).toBe(true);
    for (let max = 2; max < 8; max++) {
      expect(hasStrayInvisible(oneLine(persian.repeat(3), "?", max))).toBe(false);
    }
  });
});
