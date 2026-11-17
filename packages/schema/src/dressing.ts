/**
 * Which conferences wear a distinct visual identity (fonts, contour art, palette — see
 * docs/design/visual-identity.md), beyond the app's shared default look. Hand-maintained and
 * deliberately separate from the `conferences` registry: conference *content* is always
 * server-fetched, never bundled into the client, and this lookup needs to stay that way too —
 * it only ever returns a key, never config data.
 */
const DRESSED = new Map<string, string>([
  ["elo2027", "elo2027"],
  // apps/server/src/fixtures.ts's seedOpenCall() clones elo2027 under this slug for dev/e2e use.
  ["elo2027-open", "elo2027"],
]);

/** The identity key a conference's pages should wear, if any. Pure; safe for the browser bundle. */
export function dressedAs(slug: string): string | undefined {
  return DRESSED.get(slug);
}
