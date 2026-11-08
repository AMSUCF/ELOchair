import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
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

/**
 * All mail goes through the outbox table so nothing is lost if delivery fails.
 * `at` is the app clock's "now" (tests use a fixed clock); it stamps creation and first attempt.
 */
export async function enqueueMail(
  db: Db,
  kind: string,
  msg: MailMessage,
  at: Date = new Date(),
): Promise<void> {
  await db.insert(outbox).values({
    kind,
    toEmail: msg.to,
    subject: msg.subject,
    bodyText: msg.text,
    createdAt: at,
    nextAttemptAt: at,
  });
}

export const MAX_ATTEMPTS = 8;
/** Minutes to wait after the 1st, 2nd, ... failed attempt. */
const BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 120, 240];
/** A claim older than this is presumed abandoned (crashed process) and may be retried. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
/** Sign-in mail is useless after the link expires; it is never sent late. */
const MAGIC_LINK_TTL_MS = 20 * 60 * 1000;

/** Remove sign-in secrets from a stored message body once it no longer needs them. */
export function redactSecrets(body: string): string {
  return body
    .replace(/#token=[A-Za-z0-9_-]+/g, "#token=[redacted]")
    .replace(/\b\d{4} \d{4}\b/g, "[redacted]");
}

const inFlight = new WeakMap<Db, Promise<number>>();
const queued = new WeakMap<Db, Promise<number>>();

/**
 * Send pending mail; resolves with how many messages the pass that covers this call sent.
 * Safe to call often and from several places. Within one process at most one pass runs at a
 * time; a call that arrives during a pass gets a follow-up pass (shared by everyone who arrives
 * meanwhile), so mail queued mid-pass is not left for the timer. Across processes, rows are
 * claimed atomically, so no message is sent twice.
 */
export function deliverPending(
  db: Db,
  transport: MailTransport,
  opts: { now?: () => Date; limit?: number } = {},
): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const limit = opts.limit ?? 50;
  const start = (): Promise<number> => {
    const pass: Promise<number> = deliverPass(db, transport, now, limit).finally(() => {
      if (inFlight.get(db) === pass) inFlight.delete(db);
    });
    inFlight.set(db, pass);
    return pass;
  };
  const current = inFlight.get(db);
  if (!current) return start();
  const waiting = queued.get(db);
  if (waiting) return waiting;
  const next = current
    .catch(() => 0)
    .then(() => {
      queued.delete(db);
      return start();
    });
  queued.set(db, next);
  return next;
}

/** One delivery pass. Exported for tests that need two passes to overlap. */
export function deliverOnce(db: Db, transport: MailTransport, now: () => Date, limit = 50) {
  return deliverPass(db, transport, now, limit);
}

async function deliverPass(
  db: Db,
  transport: MailTransport,
  now: () => Date,
  limit: number,
): Promise<number> {
  const t = now();
  const due = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        isNull(outbox.sentAt),
        lt(outbox.attempts, MAX_ATTEMPTS),
        lte(outbox.nextAttemptAt, t),
        or(
          isNull(outbox.claimedAt),
          lt(outbox.claimedAt, new Date(t.getTime() - CLAIM_TIMEOUT_MS)),
        ),
      ),
    )
    .orderBy(asc(outbox.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(outbox)
    .set({ claimedAt: t })
    .where(inArray(outbox.id, due))
    .returning();

  let sent = 0;
  for (const m of claimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const isSignIn = m.kind === "magic_link";
    if (isSignIn && now().getTime() - m.createdAt.getTime() > MAGIC_LINK_TTL_MS) {
      await db
        .update(outbox)
        .set({
          claimedAt: null,
          attempts: MAX_ATTEMPTS,
          lastError: "expired before delivery",
          bodyText: redactSecrets(m.bodyText),
        })
        .where(eq(outbox.id, m.id));
      continue;
    }
    try {
      await transport.send({ to: m.toEmail, subject: m.subject, text: m.bodyText });
      await db
        .update(outbox)
        .set({
          sentAt: now(),
          claimedAt: null,
          attempts: m.attempts + 1,
          lastError: null,
          // The token and code now exist only in the recipient's inbox.
          ...(isSignIn ? { bodyText: redactSecrets(m.bodyText) } : {}),
        })
        .where(eq(outbox.id, m.id));
      sent++;
    } catch (err) {
      const attempts = m.attempts + 1;
      const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 240;
      await db
        .update(outbox)
        .set({
          claimedAt: null,
          attempts,
          lastError: String(err).slice(0, 500),
          nextAttemptAt: new Date(now().getTime() + wait * 60_000),
        })
        .where(eq(outbox.id, m.id));
      if (attempts >= MAX_ATTEMPTS) {
        console.error(
          `mail ${m.id} (${m.kind}) gave up after ${attempts} attempts: ${String(err)}`,
        );
      }
    }
  }
  return sent;
}

type Lang = "en" | "es" | "pt";

const MAGIC_LINK: Record<Lang, (link: string, code: string) => { subject: string; text: string }> =
  {
    en: (link, code) => ({
      subject: "Your ELOchair sign-in link",
      text: `Use this link to sign in to ELOchair. It works once and expires in 20 minutes:\n\n${link}\n\nOr type this code on the sign-in page (useful in the installed app):\n\n${code}\n\nIf you did not ask for this, you can ignore this email.`,
    }),
    es: (link, code) => ({
      subject: "Tu enlace para entrar en ELOchair",
      text: `Usa este enlace para entrar en ELOchair. Funciona una sola vez y caduca en 20 minutos:\n\n${link}\n\nO escribe este código en la página de entrada (útil en la app instalada):\n\n${code}\n\nSi no lo solicitaste, puedes ignorar este correo.`,
    }),
    pt: (link, code) => ({
      subject: "O seu link de acesso ao ELOchair",
      text: `Use este link para entrar no ELOchair. Funciona uma única vez e expira em 20 minutos:\n\n${link}\n\nOu escreva este código na página de entrada (útil na aplicação instalada):\n\n${code}\n\nSe não o pediu, pode ignorar este email.`,
    }),
  };

/** `code` is the 8-digit sign-in code; it is shown as "1234 5678". */
export function magicLinkMessage(
  lang: string,
  to: string,
  link: string,
  code: string,
): MailMessage {
  const l: Lang = lang === "es" || lang === "pt" ? lang : "en";
  return { to, ...MAGIC_LINK[l](link, `${code.slice(0, 4)} ${code.slice(4)}`) };
}
