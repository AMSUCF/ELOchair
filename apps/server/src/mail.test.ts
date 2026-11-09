import { eq } from "drizzle-orm";
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
import { invitationMessage, sanitizeName } from "./templates";

const db0 = openDatabase({});
const db = db0.db;
beforeAll(() => db0.migrate());
afterAll(() => db0.close());

const at = new Date("2027-02-01T12:00:00Z");
const now = () => at;

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
    invitationMessage("en", to, {
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
      ["evil​.com Ana", "Ana"],
      ["Ana ‮moc.live‬", "Ana"],
      ["​⁦⁩", "?"],
      ["mailto:a tel:5550100 Ana", "Ana"],
      ["10.0.0.1 Ana", "Ana"],
      ["Line\nbreak here", "Line break here"],
    ];
    for (const [input, out] of cases) expect(sanitizeName(input, "?")).toBe(out);
    expect([...sanitizeName("ü".repeat(150), "?")]).toHaveLength(100);
  });
});
