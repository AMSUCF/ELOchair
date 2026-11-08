import { createHmac, randomInt } from "node:crypto";
import type { AgentViewer, PersonViewer, Tier } from "@elochair/policy";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { apiTokens, loginTokens, sessions } from "./db/schema";
import { enqueueMail, magicLinkMessage } from "./mail";
import { findOrCreatePerson, loadPersonViewer, normalizeEmail } from "./repo";
import { hashToken, newToken } from "./secrets";

export const LINK_TTL_MS = 20 * 60 * 1000;
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "elo_session";
/** Wrong codes allowed per sign-in email before its code stops working. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Codes have only 10^8 values, so a plain hash could be reversed from a database copy in
 * seconds. They are keyed with SECRET_KEY, which lives outside the database.
 */
const codeHash = (secret: string, email: string, code: string) =>
  createHmac("sha256", secret).update(`${email}\n${code}`).digest("hex");

export async function requestMagicLink(
  db: Db,
  opts: { email: string; lang: string; appOrigin: string; now: Date; secret: string },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const token = newToken();
  // An 8-digit code in the same email, for installed apps that cannot open links in place.
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  await db.insert(loginTokens).values({
    email,
    tokenHash: hashToken(token),
    codeHash: codeHash(opts.secret, email, code),
    lang: opts.lang,
    expiresAt: new Date(opts.now.getTime() + LINK_TTL_MS),
  });
  // The token travels in the URL fragment: browsers never send it to the server or in Referer
  // headers. The verify page asks for a tap before using it, so link scanners and other sites
  // cannot use it up or sign someone in without their knowledge.
  const link = `${opts.appOrigin}/${opts.lang}/auth/verify#token=${token}`;
  await enqueueMail(db, "magic_link", magicLinkMessage(opts.lang, email, link, code), opts.now);
}

/** The email a still-valid link signs in as (so the verify page can say so before using it). */
export async function linkEmail(db: Db, token: string, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ email: loginTokens.email })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.tokenHash, hashToken(token)),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, now),
      ),
    );
  return row?.email ?? null;
}

async function openSession(db: Db, email: string, now: Date, userAgent?: string) {
  const person = await findOrCreatePerson(db, email);
  const sessionToken = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(sessionToken),
    personId: person.id,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { personId: person.id, sessionToken, expiresAt };
}

/**
 * Sign in with the typed code instead of the link. Every guess, right or wrong, first uses up
 * one attempt on each of the address's live codes, atomically; a code is accepted only if its
 * attempt was within MAX_CODE_ATTEMPTS. Concurrent guesses therefore cannot exceed the limit.
 */
export async function verifyCode(
  db: Db,
  opts: { email: string; code: string; now: Date; secret: string; userAgent?: string },
): Promise<{ personId: string; sessionToken: string; expiresAt: Date } | null> {
  const email = normalizeEmail(opts.email);
  const code = opts.code.replace(/\D/g, "");
  const charged = await db
    .update(loginTokens)
    .set({ codeAttempts: sql`${loginTokens.codeAttempts} + 1` })
    .where(
      and(
        eq(loginTokens.email, email),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, opts.now),
        lt(loginTokens.codeAttempts, MAX_CODE_ATTEMPTS),
      ),
    )
    .returning({
      id: loginTokens.id,
      codeHash: loginTokens.codeHash,
      codeAttempts: loginTokens.codeAttempts,
    });
  if (code.length !== 8) return null;
  const expected = codeHash(opts.secret, email, code);
  const match = charged.find((r) => r.codeHash === expected && r.codeAttempts <= MAX_CODE_ATTEMPTS);
  if (!match) return null;
  const [used] = await db
    .update(loginTokens)
    .set({ usedAt: opts.now })
    .where(and(eq(loginTokens.id, match.id), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  return used ? openSession(db, email, opts.now, opts.userAgent) : null;
}

/** Consume a magic-link token (once) and open a session. Null when invalid, used or expired. */
export async function verifyMagicLink(
  db: Db,
  opts: { token: string; now: Date; userAgent?: string },
): Promise<{ personId: string; sessionToken: string; expiresAt: Date } | null> {
  const [used] = await db
    .update(loginTokens)
    .set({ usedAt: opts.now })
    .where(
      and(
        eq(loginTokens.tokenHash, hashToken(opts.token)),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, opts.now),
      ),
    )
    .returning({ email: loginTokens.email });
  if (!used) return null;
  return openSession(db, used.email, opts.now, opts.userAgent);
}

export async function sessionViewer(
  db: Db,
  token: string,
  now: Date,
): Promise<PersonViewer | null> {
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  if (!s) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, s.tokenHash));
  }
  return loadPersonViewer(db, s.personId);
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function tokenViewer(db: Db, token: string, now: Date): Promise<AgentViewer | null> {
  const [t] = await db
    .select()
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    );
  if (!t) return null;
  const owner = await loadPersonViewer(db, t.personId);
  if (!owner) return null;
  if (!t.lastUsedAt || now.getTime() - t.lastUsedAt.getTime() > 60 * 1000) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, t.id));
  }
  return {
    kind: "agent",
    tokenId: t.id,
    tier: t.tier as Tier,
    conferenceId: t.conferenceId,
    owner,
  };
}
