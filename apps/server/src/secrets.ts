import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url. Optional prefix makes tokens recognizable (e.g. "elo_m_"). */
export function newToken(prefix = ""): string {
  return prefix + randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
