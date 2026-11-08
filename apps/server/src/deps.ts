import type { Deps } from "./context";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { LogTransport, type MailTransport, MemoryTransport, SmtpTransport } from "./mail";
import { RateLimiter } from "./ratelimit";

export function makeTransport(env: Env): MailTransport {
  if (env.MAIL_TRANSPORT === "smtp")
    return new SmtpTransport(env.SMTP_URL as string, env.MAIL_FROM);
  if (env.MAIL_TRANSPORT === "memory") return new MemoryTransport();
  return new LogTransport();
}

export function makeDeps(db: Db, env: Env, overrides: Partial<Deps> = {}): Deps {
  return {
    db,
    env,
    mail: makeTransport(env),
    now: () => new Date(),
    limits: {
      linkPerEmail: new RateLimiter(5, 15 * 60 * 1000),
      linkPerIp: new RateLimiter(30, 15 * 60 * 1000),
      codePerIp: new RateLimiter(30, 15 * 60 * 1000),
      writesPerPerson: new RateLimiter(60, 60 * 1000),
      invitationLinksPerIp: new RateLimiter(60, 15 * 60 * 1000),
    },
    ...overrides,
  };
}
