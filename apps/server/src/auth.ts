import type { AgentViewer, PersonViewer, Tier } from "@elochair/policy";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "./db/client";
import { apiTokens, loginTokens, sessions } from "./db/schema";
import { enqueueMail, magicLinkMessage } from "./mail";
import { findOrCreatePerson, loadPersonViewer, normalizeEmail } from "./repo";
import { hashToken, newToken } from "./secrets";

export const LINK_TTL_MS = 20 * 60 * 1000;
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "elo_session";

export async function requestMagicLink(
  db: Db,
  opts: { email: string; lang: string; appOrigin: string; now: Date },
): Promise<void> {
  const email = normalizeEmail(opts.email);
  const token = newToken();
  await db.insert(loginTokens).values({
    email,
    tokenHash: hashToken(token),
    lang: opts.lang,
    expiresAt: new Date(opts.now.getTime() + LINK_TTL_MS),
  });
  // The token travels in the URL fragment: browsers never send it to the server or in Referer
  // headers, and link scanners that prefetch the URL cannot use it up.
  const link = `${opts.appOrigin}/${opts.lang}/auth/verify#token=${token}`;
  await enqueueMail(db, "magic_link", magicLinkMessage(opts.lang, email, link));
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

  const person = await findOrCreatePerson(db, used.email);
  const sessionToken = newToken();
  const expiresAt = new Date(opts.now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(sessionToken),
    personId: person.id,
    expiresAt,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
  });
  return { personId: person.id, sessionToken, expiresAt };
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
