import { and, asc, eq, isNull, lt } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { Db } from "./db/client";
import { outbox } from "./db/schema";

export type MailMessage = { to: string; subject: string; text: string };

export interface MailTransport {
  send(msg: MailMessage): Promise<void>;
}

/** Development: print the message (and so the magic link) to the server log. */
export class LogTransport implements MailTransport {
  async send(msg: MailMessage): Promise<void> {
    console.log(`\n--- mail to ${msg.to}: ${msg.subject}\n${msg.text}\n---\n`);
  }
}

/** Tests: keep messages in memory. */
export class MemoryTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }
  latestTo(to: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}

export class SmtpTransport implements MailTransport {
  private readonly transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(url);
  }
  async send(msg: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
  }
}

/** All mail goes through the outbox table so nothing is lost if delivery fails. */
export async function enqueueMail(db: Db, kind: string, msg: MailMessage): Promise<void> {
  await db
    .insert(outbox)
    .values({ kind, toEmail: msg.to, subject: msg.subject, bodyText: msg.text });
}

const MAX_ATTEMPTS = 5;

/** Send pending mail. Safe to call often; returns how many messages were sent. */
export async function deliverPending(
  db: Db,
  transport: MailTransport,
  limit = 50,
): Promise<number> {
  const pending = await db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.sentAt), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
  let sent = 0;
  for (const m of pending) {
    try {
      await transport.send({ to: m.toEmail, subject: m.subject, text: m.bodyText });
      await db
        .update(outbox)
        .set({ sentAt: new Date(), attempts: m.attempts + 1, lastError: null })
        .where(eq(outbox.id, m.id));
      sent++;
    } catch (err) {
      await db
        .update(outbox)
        .set({ attempts: m.attempts + 1, lastError: String(err).slice(0, 500) })
        .where(eq(outbox.id, m.id));
    }
  }
  return sent;
}

type Lang = "en" | "es" | "pt";

const MAGIC_LINK: Record<Lang, (link: string) => { subject: string; text: string }> = {
  en: (link) => ({
    subject: "Your ELOchair sign-in link",
    text: `Use this link to sign in to ELOchair. It works once and expires in 20 minutes:\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  }),
  es: (link) => ({
    subject: "Tu enlace para entrar en ELOchair",
    text: `Usa este enlace para entrar en ELOchair. Funciona una sola vez y caduca en 20 minutos:\n\n${link}\n\nSi no lo solicitaste, puedes ignorar este correo.`,
  }),
  pt: (link) => ({
    subject: "O seu link de acesso ao ELOchair",
    text: `Use este link para entrar no ELOchair. Funciona uma única vez e expira em 20 minutos:\n\n${link}\n\nSe não o pediu, pode ignorar este email.`,
  }),
};

export function magicLinkMessage(lang: string, to: string, link: string): MailMessage {
  const l: Lang = lang === "es" || lang === "pt" ? lang : "en";
  return { to, ...MAGIC_LINK[l](link) };
}
