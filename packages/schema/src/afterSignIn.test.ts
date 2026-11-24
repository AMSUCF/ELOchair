import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AFTER_SIGN_IN_MAX, afterSignIn } from "./afterSignIn";

const ID = "3f2b8c1e-5d47-4a90-8b6e-0c9d1e2f3a4b";

describe("where a person may be sent after signing in", () => {
  it.each([
    "/en/",
    "/es/my",
    "/pt/reviews",
    "/en/me",
    "/en/my/",
    // The start page, with the format a person chose on the conference's page.
    "/en/c/made-up-call/submit?format=reading",
    "/es/c/made-up-call/submit?format=artists_talk",
    `/en/s/${ID}`,
    `/pt/s/${ID}/cannot-review`,
    "/en/c/made-up-call/manage",
    "/en/c/made-up-call/settings",
    "/en/c/made-up-call/people",
    "/en/c/made-up-call/assignments",
    "/en/c/made-up-call/decisions",
    "/en/my?",
    "/en/my?a=1&b=two-words_here",
    "/en/c/made_up-2/manage/",
    // Pages that only begin like the ones that sign a person in.
    "/en/sign-in-help",
    "/en/auth",
    "/en/c/sign-in",
  ])("%s is an address inside the app", (address) => {
    expect(afterSignIn(address)).toBe(address);
  });

  it.each([
    // Another site, in the ways a browser reads as one.
    ["a host after two slashes", "//evil.example"],
    ["a host after two slashes and a path", "//evil.example/en/my"],
    ["a backslash a browser reads as a slash", "/\\evil.example"],
    ["two backslashes", "\\\\evil.example"],
    ["a scheme", "https://evil.example/en/my"],
    ["a scheme without slashes", "https:evil.example"],
    ["a scheme in capitals", "HTTPS://evil.example"],
    ["a script", "javascript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["two slashes after the language", "/en//evil.example"],
    ["two slashes and nothing else after the language", "/en//"],
    ["two slashes further on", "/en/my//evil.example"],
    ["two slashes at the end", "/en/my//"],
    ["a backslash after the language", "/en/\\evil.example"],
    ["a backslash in place of a slash", "/en\\my"],
    ["a name and a password before a host", "/en/@evil.example"],
    ["a port", "/en:8080/my"],
    ["a dotted name", "/en/evil.example"],
    // The same, encoded: nothing in an address is encoded, so nothing is decoded.
    ["an encoded slash at the start", "/%2Fevil.example"],
    ["two encoded slashes", "%2F%2Fevil.example"],
    ["encoded slashes after the language", "/en/%2F%2Fevil.example"],
    ["an encoded backslash", "/en/%5Cevil.example"],
    ["a slash encoded twice", "/en/%252F%252Fevil.example"],
    ["encoded dots", "/en/%2e%2e/%2e%2e/api/me"],
    ["an encoded scheme", "https%3A%2F%2Fevil.example"],
    ["an encoded line break", "/en/my%0d%0aBcc:x"],
    ["an encoded null", "/en/my%00"],
    ["an encoded address in the query", "/en/my?to=%2F%2Fevil.example"],
    // Out of the page it names.
    ["a step up", "/en/../api/me"],
    ["a step up at the end", "/en/my/.."],
    ["a step nowhere", "/en/./my"],
    ["two dots in the query", "/en/my?a=.."],
    ["an address in the query", "/en/my?to=https://evil.example"],
    ["two slashes in the query", "/en/my?to=//evil.example"],
    ["a second question mark", "/en/my?a=1?b=2"],
    ["a semicolon", "/en/my;jsessionid=1"],
    ["a semicolon in the query", "/en/my?a;b"],
    ["an encoded slash in the query, in small letters", "/en/my?a=%2f"],
    ["a space in the query", "/en/my?a b"],
    ["a backslash in the query", "/en/my?a\\b"],
    // What a query may hold elsewhere, and the app's own never do.
    ["a plus in the query", "/en/my?a+b"],
    ["a plus in the path", "/en/my+proposals"],
    ["a comma", "/en/my?a=1,2"],
    ["a colon in the query", "/en/my?a=b:c"],
    ["an at sign in the query", "/en/my?a=b@c"],
    ["a tilde", "/en/~my"],
    ["an asterisk", "/en/my?a=*"],
    ["an exclamation mark", "/en/my!"],
    ["a dollar sign", "/en/my$"],
    ["a quotation mark", "/en/my?a='b'"],
    ["brackets", "/en/my?a[]=1"],
    // Capitals: the app writes none, and a sentence in a link is easier to read with them.
    ["a page in capitals", "/en/My"],
    ["a word in capitals", "/en/c/Made-Up-Call/manage"],
    ["capitals in the query", "/en/my?Format=reading"],
    ["an id in capitals", "/en/s/3F2B8C1E-5D47-4A90-8B6E-0C9D1E2F3A4B"],
    // A fragment: an invitation's token travels in one, and never in here.
    ["a fragment", "/en/my#top"],
    ["an empty fragment", "/en/my#"],
    ["a token in a fragment", "/en/invitation#token=abcdefghijklmnopqrstuvwxyz"],
    ["a fragment in the query", "/en/my?a=1#token=abc"],
    // What cannot be seen, or breaks a line of an email.
    ["a line feed at the end", "/en/my\n"],
    ["a line break and a header", "/en/my\r\nBcc: someone@evil.example"],
    ["a line feed at the start", "\n/en/my"],
    ["a tab", "/en/my\t"],
    ["a null", "/en/my\u0000"],
    ["a space", "/en/my proposals"],
    ["a space at the start", " /en/my"],
    ["a space at the end", "/en/my "],
    ["a no-break space", "/en/my\u00A0"],
    ["a right-to-left override", "/en/my\u202Elpmaxe.live"],
    ["a zero-width space", "/en/\u200Bmy"],
    ["a byte-order mark", "\uFEFF/en/my"],
    ["a tag character", "/en/my\u{E0061}"],
    ["a soft hyphen", "/en/my\u00AD"],
    ["a line separator", "/en/my\u2028"],
    // Letters and slashes that only look like the ones the app writes.
    ["a division slash", "/en/\u2215\u2215evil.example"],
    ["a fullwidth slash", "/en/\uFF0Fevil"],
    ["a letter outside ASCII", "/en/m\u00FD"],
    ["a Cyrillic letter", "/\u0435n/my"],
    ["a Kelvin sign for a k", "/en/c/made-up/\u212Aeep"],
    // Not one of the app's pages.
    ["no language", "/my"],
    ["another language", "/fr/my"],
    ["a language of three letters", "/eng/my"],
    ["a language in capitals", "/EN/my"],
    ["a language and no slash", "/en"],
    ["a language and a query", "/en?a=1"],
    ["no slash at the start", "en/my"],
    ["a dot at the start", "./en/my"],
    ["the API", "/api/me"],
    ["nothing", ""],
    ["a slash", "/"],
    // The pages that sign a person in.
    ["the sign-in page", "/en/sign-in"],
    ["the sign-in page with a slash", "/es/sign-in/"],
    ["the sign-in page in capitals", "/en/Sign-In"],
    ["the sign-in page with a query", "/en/sign-in?a=1"],
    ["the page a sign-in link opens", "/pt/auth/verify"],
    ["that page with a slash", "/en/auth/verify/"],
    ["that page in capitals", "/en/AUTH/Verify"],
  ])("%s is refused", (_what, address) => {
    expect(afterSignIn(address)).toBeNull();
  });

  it("only the characters the app writes pass, in a word and in a query", () => {
    const written = "abcdefghijklmnopqrstuvwxyz0123456789-_";
    const inOrder = (characters: string) => Array.from(characters).sort().join("");
    let inWord = "";
    let inQuery = "";
    // Every code unit there is, one at a time, in the middle of a word and of a query.
    for (let unit = 0; unit <= 0xffff; unit++) {
      const c = String.fromCharCode(unit);
      if (afterSignIn(`/en/m${c}y`) !== null) inWord += c;
      if (afterSignIn(`/en/my?a${c}b`) !== null) inQuery += c;
    }
    // In a word, a slash ends it and a question mark begins the query.
    expect(inOrder(inWord)).toBe(inOrder(`${written}/?`));
    expect(inOrder(inQuery)).toBe(inOrder(`${written}=&`));
    // And a character outside the first 65,536 is two of those, neither of which passes.
    expect(afterSignIn("/en/m\u{1F600}y")).toBeNull();
    expect(afterSignIn("/en/my?a\u{E0061}b")).toBeNull();
  });

  it("an address is short", () => {
    const most = `/en/${"a".repeat(AFTER_SIGN_IN_MAX - 4)}`;
    expect(most).toHaveLength(AFTER_SIGN_IN_MAX);
    expect(afterSignIn(most)).toBe(most);
    expect(afterSignIn(`${most}a`)).toBeNull();
    // Refused by its length alone, before anything in it is read.
    expect(afterSignIn(`/en/${"a/".repeat(1_000_000)}!`)).toBeNull();
  });

  it("what is no text is refused, whatever it holds", () => {
    for (const value of [
      undefined,
      null,
      7,
      true,
      {},
      ["/en/my"],
      { toString: () => "/en/my" },
      new String("/en/my"),
    ]) {
      expect(afterSignIn(value)).toBeNull();
    }
  });

  // Whatever passes is made of the characters the app writes its own addresses with.
  const ALLOWED = /^\/(?:en|es|pt)\/[a-z0-9_\-/]*(?:\?[a-z0-9_=&-]*)?$/;
  /**
   * Text made of what the app's addresses and open redirects are made of, so that a good part
   * of it passes and the rest comes close.
   */
  const piece = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.constantFrom(
        "my",
        "c",
        "s",
        "made-up-call",
        "submit",
        "sign-in",
        "auth",
        "verify",
        "a_b",
        "9",
        "/",
        "/",
        "?",
        "=",
        "&",
        "-",
      ),
    },
    {
      weight: 2,
      arbitrary: fc.constantFrom(
        "//",
        "\\",
        ".",
        "..",
        ":",
        "#",
        "@",
        "%",
        "%2F",
        "%5C",
        " ",
        "\n",
        "\r",
        "\t",
        "\u202E",
        "\u200B",
        "https:",
        "evil.example",
        "A",
        "+",
      ),
    },
    { weight: 1, arbitrary: fc.string({ maxLength: 2 }) },
  );
  const hostile = fc
    .tuple(
      fc.constantFrom(
        "/en/",
        "/es/",
        "/pt/",
        "/en/",
        "/en",
        "/",
        "//",
        "",
        "/fr/",
        "/EN/",
        "https://",
        "\\",
      ),
      fc.array(piece, { maxLength: 8 }),
    )
    .map(([start, pieces]) => start + pieces.join(""));

  it("whatever passes stays inside the app, wherever a browser reads it from", () => {
    fc.assert(
      fc.property(
        hostile,
        fc.constantFrom(
          "https://chair.example.org/en/auth/verify",
          "https://chair.example.org/",
          "http://localhost:8080/es/c/made-up-call/submit?format=reading",
        ),
        (text, from) => {
          const address = afterSignIn(text);
          if (address === null) return;
          expect(address).toBe(text);
          expect(address).toMatch(ALLOWED);
          expect(address).not.toContain("//");
          // A browser that is on any of the app's pages reads it as a page of the same site,
          // written exactly as it came: nothing in it is taken for a host or resolved away.
          const read = new URL(address, from);
          expect(read.href).toBe(new URL(from).origin + address);
          expect(read.hash).toBe("");
          expect(read.username + read.password).toBe("");
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("the test's hostile text does reach addresses that pass, and ones that do not", () => {
    const sample = fc.sample(hostile, { numRuns: 5000, seed: 7 });
    const passed = sample.filter((text) => afterSignIn(text) !== null);
    expect(passed.length).toBeGreaterThan(sample.length / 50);
    expect(passed.length).toBeLessThan(sample.length / 2);
  });

  it("an address that passes comes whole out of the link's fragment, beside the token", () => {
    fc.assert(
      fc.property(hostile, (text) => {
        const address = afterSignIn(text);
        if (address === null) return;
        // As the server writes the link, and as the page that signs a person in reads it.
        const fragment = `token=abc_DEF-123&next=${encodeURIComponent(address)}`;
        expect(fragment).not.toMatch(/\s/);
        const read = new URLSearchParams(fragment);
        expect(read.get("token")).toBe("abc_DEF-123");
        expect(read.get("next")).toBe(address);
      }),
      { numRuns: 2000 },
    );
  });
});
