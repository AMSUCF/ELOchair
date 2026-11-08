import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { invitationTokens } from "./db/schema";
import { hashToken, newToken } from "./secrets";

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

/**
 * A single-use invitation link token (stored only as a hash). It lives until the call closes or
 * for 14 days, whichever is later, so people can always decline.
 */
export async function createInvitationToken(
  db: Db,
  v: { submissionId: string; personId: string; lang: string; now: Date; callCloses: Date },
): Promise<string> {
  const token = newToken("inv_");
  const expiresAt = new Date(Math.max(v.callCloses.getTime(), v.now.getTime() + FOURTEEN_DAYS));
  await db.insert(invitationTokens).values({
    submissionId: v.submissionId,
    personId: v.personId,
    tokenHash: hashToken(token),
    lang: v.lang,
    expiresAt,
  });
  return token;
}

export async function findInvitationToken(db: Db, token: string, now: Date) {
  const [row] = await db
    .select()
    .from(invitationTokens)
    .where(
      and(
        eq(invitationTokens.tokenHash, hashToken(token)),
        isNull(invitationTokens.usedAt),
        gt(invitationTokens.expiresAt, now),
      ),
    );
  return row ?? null;
}

/** Use up every outstanding link for one invitation (after an answer). */
export async function useInvitationTokens(
  db: Db,
  submissionId: string,
  personId: string,
  now: Date,
): Promise<void> {
  await db
    .update(invitationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(invitationTokens.submissionId, submissionId),
        eq(invitationTokens.personId, personId),
        isNull(invitationTokens.usedAt),
      ),
    );
}
