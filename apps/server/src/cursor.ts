import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** A position in the paging order: (createdAt in milliseconds, id). */
export type PagePosition = readonly [number, string];

/** Turns paging positions into the cursors clients hold, and back. */
export interface CursorCodec {
  seal(position: PagePosition): string;
  /** The position, or null for a cursor this server did not seal (forged, damaged, old key). */
  open(cursor: string): PagePosition | null;
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
 * draft, deleted). Cursors sealed before SECRET_KEY changes stop opening; clients start over.
 */
export function cursorsFor(secret: string): CursorCodec {
  const cached = codecs.get(secret);
  if (cached) return cached;
  const key = Buffer.from(hkdfSync("sha256", secret, "", "elochair page cursor v1", 32));
  const codec: CursorCodec = {
    seal([ms, id]) {
      const iv = randomBytes(IV);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(`${ms}.${id}`, "utf8"), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
    },
    open(cursor) {
      const raw = Buffer.from(cursor, "base64url");
      if (raw.length <= IV + TAG) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV));
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
