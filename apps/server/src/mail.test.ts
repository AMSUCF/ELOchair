import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./db/client";
import { outbox } from "./db/schema";
import {
  deliverPending,
  enqueueMail,
  MAX_ATTEMPTS,
  type MailTransport,
  MemoryTransport,
  magicLinkMessage,
} from "./mail";

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
