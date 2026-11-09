/**
 * Self-identification warnings for anonymized text. Zod-free: the submission form runs it live
 * in the browser (via "@elochair/schema/pure") and the server runs it on check and submit.
 *
 * It looks for the authors' own details in text that reviewers will read in double-blind
 * review. Matching ignores accents and respects (Unicode) word boundaries. It ignores case too,
 * except that a surname outside parentheses counts as a citation only when capitalized, so
 * "la paz (2020)" is not taken for a citation of Sofía Paz. Results carry the path, the kind,
 * and the matched detail, which is the author's own data; the server reports only counts to
 * anyone else.
 */

export type IdentityHint = {
  displayName: string | null;
  affiliation: string | null;
  email: string;
  orcid: string | null;
};

export type SelfIdKind = "name" | "citation" | "affiliation" | "email" | "orcid" | "url";
export type SelfIdWarning = { path: string; kind: SelfIdKind; match: string };

/** Mail providers whose domain says nothing about who someone is. */
const GENERIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
]);

/** Affiliations too generic to identify anyone. */
const GENERIC_AFFILIATIONS = new Set([
  "independent",
  "independent artist",
  "independent scholar",
  "independent researcher",
  "none",
  "n a",
  "artista independiente",
  "investigadora independiente",
  "investigador independiente",
  "artista independente",
  "pesquisador independente",
  "pesquisadora independente",
]);

/** Lowercase, strip accents, and keep only letters and digits as space-separated words. */
export function normalizeWords(s: string): string {
  return ` ${s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Without accents, case kept: citations are told apart from ordinary words by their capitals. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const stripAccents = (s: string) => fold(s).toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Name particles that are never cited on their own ("de la Cruz" is cited as "Cruz"). */
const PARTICLES = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "da",
  "das",
  "do",
  "dos",
  "di",
  "du",
  "y",
  "e",
  "van",
  "von",
  "der",
  "den",
  "le",
  "el",
  "al",
  "bin",
  "ibn",
]);

/** The words of a name, normalized ("Ana Lucía Pérez" gives ana, lucia, perez). */
function nameWords(displayName: string): string[] {
  return normalizeWords(displayName).trim().split(" ").filter(Boolean);
}

/**
 * Words that may be cited as a surname: every word after the first with at least three letters
 * that is not a particle. "María José Rodríguez Vera" gives josé, rodríguez and vera (normalized),
 * so "(Rodríguez 2021)" is found as well as "(Vera 2021)".
 */
export function surnameCandidates(displayName: string): string[] {
  const words = nameWords(displayName);
  if (words.length < 2) return [];
  return [...new Set(words.slice(1).filter((w) => w.length >= 3 && !PARTICLES.has(w)))];
}

/**
 * The name written as one word, as in web addresses and handles: every word ("analuciaperez"),
 * without particles ("juancruz"), and each given name with each possible surname, either way
 * round ("anaperez", "perezana"). Short joins are left out: they are too often ordinary words.
 */
export function joinedNames(displayName: string): string[] {
  const words = nameWords(displayName);
  if (words.length < 2) return [];
  const out = new Set([words.join(""), words.filter((w) => !PARTICLES.has(w)).join("")]);
  for (const surname of surnameCandidates(displayName)) {
    for (const given of words.slice(0, words.indexOf(surname))) {
      if (PARTICLES.has(given)) continue;
      out.add(given + surname);
      out.add(surname + given);
    }
  }
  return [...out].filter((j) => j.length >= 6);
}

/*
 * Citation patterns, matched against accent-free text with its case kept. \b only knows ASCII
 * letters ("(Østergaard 2020)" has no \b before the Ø), so word edges are Unicode-aware.
 */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const YEAR = String.raw`(?<!\p{N})(?:19|20)\d{2}(?!\p{N})`;

/** A normalized (lowercase) word, in any case. */
function anyCase(word: string): string {
  return [...word]
    .map((ch) => {
      const up = ch.toUpperCase();
      return up !== ch && [...up].length === 1 ? `[${escapeRe(ch)}${escapeRe(up)}]` : escapeRe(ch);
    })
    .join("");
}

/** A normalized word capitalized as a name is ("Pérez", "PÉREZ"), not as a word ("la paz"). */
function capitalized(word: string): string {
  const [first = "", ...rest] = [...word];
  const up = first.toUpperCase();
  return `${escapeRe([...up].length === 1 ? up : first)}${anyCase(rest.join(""))}`;
}

/** Particles that may open a co-author's surname ("y de la Cruz"); "y" and "e" join names. */
const COAUTHOR_PARTICLE = `(?:(?:${[...PARTICLES].filter((p) => p !== "y" && p !== "e").join("|")})\\s+)*`;
const COAUTHOR_WORD = String.raw`\p{Lu}[\p{L}'’\-]*`;
const COAUTHOR = `${COAUTHOR_PARTICLE}${COAUTHOR_WORD}(?:\\s+${COAUTHOR_PARTICLE}${COAUTHOR_WORD})?`;
/** ", ", " and ", " y ", " e ", " & " (with an optional serial comma). */
const JOIN = String.raw`(?:\s*,?\s+(?:and|y|e)\s+|\s*,?\s*&\s*|\s*,\s*)`;
/** What may stand between a cited surname and "(2021)": co-authors, "et al.", a possessive. */
const AUTHOR_TAIL = String.raw`(?:${JOIN}${COAUTHOR}){0,4}(?:\s*,?\s+et\.?\s+al(?:ii)?\.?)?(?:['’]s?)?`;
const OPEN_YEAR = String.raw`\s*[(\[]\s*(?:(?:eds?|orgs?|coords?|comps?)\.?\s*,?\s*)?${YEAR}`;

/**
 * Whether `text` (accent-free, case kept) cites `surname` with a year:
 * - in parentheses or brackets: "(Pérez 2021)", "(Smith and Pérez, eds., 2020)", "[Pérez 2019]";
 * - narratively: "Pérez (2019)", "Pérez [2019]", "Pérez et al. (2021)", "Pérez y Gómez (2020)",
 *   "Gonçalves e Silva (2018)", "Pérez's (2019)";
 * - as a reference-list entry, with the person's first given name or its initial:
 *   "Pérez, A. L. (2021).", "Pérez, Ana Lucía. Bots y poesía. Editorial, 2021.",
 *   "GONÇALVES, João Carlos. Poesia digital. São Paulo: Editora, 2020."
 */
function citesSurname(text: string, surname: string, given: string | undefined): boolean {
  const any = `${START}${anyCase(surname)}${END}`;
  const cap = `${START}${capitalized(surname)}${END}`;
  const patterns = [
    String.raw`[(\[][^)\]]{0,60}?${any}[^)\]]{0,60}?${YEAR}`,
    `${cap}${AUTHOR_TAIL}${OPEN_YEAR}`,
  ];
  if (given) {
    const initial = capitalized([...given][0] ?? "");
    patterns.push(
      String.raw`${cap}\s*,\s*(?:${capitalized(given)}${END}|${initial}\.)[^\n]{0,200}?${YEAR}`,
    );
  }
  return patterns.some((p) => new RegExp(p, "u").test(text));
}

/** URLs in text, with their host labels and path segments split for whole-word matching. */
function urlsIn(text: string): { host: string; parts: Set<string> }[] {
  const out: { host: string; parts: Set<string> }[] = [];
  const re = /(?<![\p{L}\p{N}])(?:https?:\/\/|www\.)[^\s<>()"']+/giu;
  for (const m of text.matchAll(re)) {
    try {
      const u = new URL(m[0].startsWith("www.") ? `https://${m[0]}` : m[0]);
      const host = u.hostname.toLowerCase();
      const parts = new Set(
        stripAccents(`${host}/${decodeURIComponent(u.pathname)}`)
          .split(/[./\-_~@+]+/)
          .filter(Boolean),
      );
      out.push({ host, parts });
    } catch {
      // not a URL after all
    }
  }
  return out;
}

export function selfIdentificationWarnings(
  texts: { path: string; text: string }[],
  people: IdentityHint[],
): SelfIdWarning[] {
  const found = new Map<string, SelfIdWarning>();
  const add = (path: string, kind: SelfIdKind, match: string) => {
    const key = `${path}|${kind}|${match}`;
    if (!found.has(key)) found.set(key, { path, kind, match });
  };

  for (const { path, text } of texts) {
    if (!text.trim()) continue;
    const words = normalizeWords(text);
    const plain = stripAccents(text);
    const folded = fold(text);
    const urls = urlsIn(text);

    for (const p of people) {
      const name = p.displayName?.trim();
      if (name) {
        const n = normalizeWords(name);
        if (n.trim().split(" ").length >= 2 && words.includes(n)) add(path, "name", name);
        const all = nameWords(name);
        for (const surname of surnameCandidates(name)) {
          const given = all.slice(0, all.indexOf(surname)).find((w) => !PARTICLES.has(w));
          if (citesSurname(folded, surname, given)) add(path, "citation", surname);
        }
      }

      const aff = p.affiliation?.trim();
      if (aff) {
        const a = normalizeWords(aff);
        if (!GENERIC_AFFILIATIONS.has(a.trim()) && a.trim().length >= 4 && words.includes(a)) {
          add(path, "affiliation", aff);
        }
      }

      const email = p.email.trim().toLowerCase();
      if (email && plain.includes(email)) add(path, "email", p.email);

      if (p.orcid) {
        const digits = p.orcid.replace(/[^\dX]/gi, "");
        if (digits.length === 16 && text.replace(/[^\dX]/gi, "").includes(digits)) {
          add(path, "orcid", p.orcid);
        }
      }

      const domain = email.split("@")[1];
      const ownDomain = domain && !GENERIC_MAIL_DOMAINS.has(domain) ? domain : null;
      // Surnames and joined names ("anaperez") match whole host labels or path segments only
      // ("cruz" is not in veracruz.gob.mx).
      const nameParts = name
        ? [...surnameCandidates(name).filter((w) => w.length >= 4), ...joinedNames(name)]
        : [];
      for (const u of urls) {
        const onOwnDomain = ownDomain && (u.host === ownDomain || u.host.endsWith(`.${ownDomain}`));
        const hasName = nameParts.some((w) => u.parts.has(w));
        if (onOwnDomain || hasName) add(path, "url", u.host);
      }
    }
  }
  return [...found.values()];
}
