/*
 * Where a person may be sent after signing in: an address inside the app, and nothing else.
 *
 * A page that needs someone signed in asks for the sign-in email with its own address ("next").
 * The email's link carries it beside the token, and the page that signs the person in goes
 * there (spec 02, §1.11). The route that takes it is public, so it is hostile input that ends
 * up in an email the conference signs, and then in a navigation. One definition, Zod-free: the
 * server asks it before it writes the link, the browser before it goes anywhere.
 *
 * An address passes if it is written the way the app writes its own:
 * - "/", one of the three interface languages, "/";
 * - then words of lower-case ASCII letters, digits, "-" and "_", with one "/" between them
 *   (and one at the end, if any);
 * - then, after a "?", the same characters with "=" and "&";
 * - AFTER_SIGN_IN_MAX characters at most;
 * - and not the sign-in page or the page a sign-in link opens, where signing in would only
 *   lead to being asked again.
 *
 * So it has no scheme, no host, no "//", no backslash, no "." (and so no ".."), no "%" (nothing
 * in it is encoded, so nothing can be decoded into any of those), no "#" (an invitation's token
 * travels in a fragment, and never in here), no "+", no space, no control or invisible
 * character, no capital and no letter outside ASCII: none of them is among the characters. What
 * passes is returned as it came; nothing is repaired.
 *
 * Whatever does not pass is null, and is left out without an error: the person signs in and
 * lands on "Your account", as they do without one. That includes an address the app does have,
 * written another way (in capitals, or with a query somebody added by hand).
 *
 * It says how an address is written, not which pages there are: words like these are what a
 * conference's slug and a format's key are made of, and only a database knows those. So
 * whoever asks for a sign-in email can put a few words of their own into its link, after the
 * token: letters, digits and hyphens, never a dot, a space or a second link. The link still
 * leads to the app, and to a page that does nothing by being opened.
 */

/** The most characters an address may have. The app's own are well under 100. */
export const AFTER_SIGN_IN_MAX = 200;

/** The interface languages: every page's address begins with one of them. */
const LANGUAGES = ["en", "es", "pt"];
const WORD = /^[a-z0-9_-]+$/;
const QUERY = /^[a-z0-9_=&-]*$/;
/** The pages that sign a person in. */
const SIGN_IN_PAGES = ["sign-in", "auth/verify"];

/** `address` if a person may be sent there after signing in; otherwise null. */
export function afterSignIn(address: unknown): string | null {
  if (typeof address !== "string" || address.length > AFTER_SIGN_IN_MAX) return null;
  const mark = address.indexOf("?");
  const path = mark < 0 ? address : address.slice(0, mark);
  const query = mark < 0 ? "" : address.slice(mark + 1);
  const language = LANGUAGES.find((code) => path.startsWith(`/${code}/`));
  if (!language) return null;
  // What follows "/en/": nothing (the front page), or words with one "/" between them and
  // perhaps one after the last. An empty word is a second "/" in a row, and fails below.
  const rest = path.slice(language.length + 2);
  const words = rest === "" ? [] : (rest.endsWith("/") ? rest.slice(0, -1) : rest).split("/");
  if (!words.every((word) => WORD.test(word)) || !QUERY.test(query)) return null;
  if (SIGN_IN_PAGES.includes(words.join("/"))) return null;
  return address;
}
