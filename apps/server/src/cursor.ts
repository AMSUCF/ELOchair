import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** A position in the paging order: (createdAt in milliseconds, id). */
export type PagePosition = readonly [number, string];

/**
 * Turns paging positions into the cursors clients hold, and back. `context` names the list the
 * cursor belongs to (its conference and who is looking): a cursor opens only in that list.
 */
export interface CursorCodec {
  seal(position: PagePosition, context: string): string;
  /**
   * The position, or null for a cursor this server did not seal for `context` (forged, damaged,
   * another conference's or another person's, sealed under an old key, or not in the exact
   * encoding the server produced).
   */
  open(cursor: string, context: string): PagePosition | null;
}

const IV = 12;
const TAG = 16;
const POSITION = /^(\d{1,15})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const codecs = new Map<string, CursorCodec>();

/**
 * Cursors are sealed with AES-256-GCM under a key derived from SECRET_KEY. Sealed, a cursor is
 * opaque: it shows no creation time that the viewer's projection leaves out. It is also
 * unforgeable, so it cannot be used to probe for submissions. As a position rather than an ID,
 * it still continues correctly whatever happened to the last item shown (withdrawn, returned to
 * draft, deleted). The list's context is authenticated with it, so a cursor replayed on another
 * conference's list, or by another person, does not open there and cannot be used to bracket a
 * creation time that list shows. Cursors sealed before SECRET_KEY changes stop opening; clients
 * start over.
 */
export function cursorsFor(secret: string): CursorCodec {
  const cached = codecs.get(secret);
  if (cached) return cached;
  const key = Buffer.from(hkdfSync("sha256", secret, "", "elochair page cursor v1", 32));
  const codec: CursorCodec = {
    seal([ms, id], context) {
      const iv = randomBytes(IV);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(`${ms}.${id}`, "utf8"), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
    },
    open(cursor, context) {
      const raw = Buffer.from(cursor, "base64url");
      // Only the exact text seal() produced: base64url decoding ignores some extra characters.
      if (raw.length <= IV + TAG || raw.toString("base64url") !== cursor) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(raw.subarray(raw.length - TAG));
        const text = Buffer.concat([
          decipher.update(raw.subarray(IV, raw.length - TAG)),
          decipher.final(),
        ]).toString("utf8");
        const m = POSITION.exec(text);
        return m ? [Number(m[1]), m[2] as string] : null;
      } catch {
        return null;
      }
    },
  };
  codecs.set(secret, codec);
  return codec;
}

/** For paging that never leaves the server (CSV exports page internally): a key of its own. */
export const internalCursors = cursorsFor(randomBytes(32).toString("hex"));
