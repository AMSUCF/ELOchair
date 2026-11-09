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
 * Citations are found in citationText(): the text without accents, case kept, and with every
 * run of whitespace collapsed to one character. The text is split into words once; at each
 * occurrence of a surname, a few patterns are tried where the surname starts or ends. The
 * patterns are the same for everyone, so they are compiled once. None of them can take more
 * than linear time: the server runs this on every /check, chair list, CSV export and MCP call,
 * and the browser on every keystroke, for each surname of each contributor. So:
 * - No two adjacent quantifiers may match the same characters. `\s*,?\s+` can split a run
 *   of n spaces in n ways, and trying that at each candidate surname takes quadratic time.
 *   Since whitespace here is never longer than one character, `\s` and `\s?` are enough.
 * - Every repetition is bounded, and a word is matched whole (a lookahead stops it from ending
 *   before its last letter), so a failed match cannot retry a word at each of its letters.
 * Words are runs of Unicode letters and digits: \b only knows ASCII letters ("(Østergaard 2020)"
 * has no \b before the Ø).
 */
const LINE_BREAK = /[\n\r\v\f\u2028\u2029]/u;

const YEAR = String.raw`(?<!\p{N})(?:19|20)\d{2}(?!\p{N})`;

/** Particles that may open a co-author's surname ("y de la Cruz"); "y" and "e" join names. */
const COAUTHOR_PARTICLE = `(?:(?:${[...PARTICLES].filter((p) => p !== "y" && p !== "e").join("|")})\\s){0,3}`;
/** A capitalized word, matched whole: the lookahead stops it from ending before its last letter. */
const COAUTHOR_WORD = String.raw`\p{Lu}[\p{L}'’\-]{0,40}(?![\p{L}'’\-])`;
const COAUTHOR = String.raw`${COAUTHOR_PARTICLE}${COAUTHOR_WORD}(?:\s${COAUTHOR_PARTICLE}${COAUTHOR_WORD})?`;
/** " and ", " y ", " e ", " & ", each with an optional serial comma (spaced or not). */
const CONJUNCTION = String.raw`(?:\s?,?\s(?:and|y|e)\s|\s?,?\s?&\s?)`;
const ET_AL = String.raw`\s?,?\set\.?\sal(?:ii)?\.?`;
/**
 * What may stand between a cited surname and "(2021)": co-authors, "et al.", a possessive.
 * Co-authors listed with commas count only when the list ends with a conjunction or "et al."
 * ("Pérez, Gómez y Ruiz (2020)", "Pérez, Gómez et al. (2020)", "Pérez y Gómez et al. (2020)",
 * "Pérez y Gómez y Ruiz (2020)"): a comma alone is how places are written ("León, Guanajuato
 * (2019)", "La Paz, Bolivia (2019)"). Every repetition is bounded and whitespace has been
 * collapsed to single characters, so matching stays linear.
 */
const AUTHOR_TAIL = String.raw`(?:(?:\s?,\s?${COAUTHOR}){0,3}(?:(?:${CONJUNCTION}${COAUTHOR}){1,3}(?:${ET_AL})?|${ET_AL}))?(?:['’]s?)?`;
const OPEN_YEAR = String.raw`\s?[(\[]\s?(?:(?:eds?|orgs?|coords?|comps?)\.?\s?,?\s?)?${YEAR}`;

/**
 * Articles that make the capitalized word after them a place or a title rather than someone's
 * surname: "La Paz", "La Cruz y la Espada", "Los Santos". The person's own article is allowed
 * ("La Rosa (2019)" for Ana La Rosa, "De la Cruz (2020)" for Juan de la Cruz). "El" and "Le"
 * are not in the list: they are as often part of a cited surname that a profile may leave out
 * ("El Amrani" for Mohamed Amrani, "Le Nguyen" for Thanh Nguyen), and a missed self-citation
 * costs more than a needless warning.
 */
const ARTICLES = new Set(["LA", "LAS", "LO", "LOS", "LES"]);

/** After a surname cited narratively: " (2019)", " et al. (2021)", " y Gómez (2020)", "'s (2019)". */
const NARRATIVE = new RegExp(`${AUTHOR_TAIL}${OPEN_YEAR}`, "uy");
/** After a surname inside parentheses or brackets: a year before they close ("Pérez, 2021)"). */
const YEAR_IN_BRACKETS = new RegExp(String.raw`[^)\]]{0,60}?${YEAR}`, "uy");
/** After a surname in a reference entry: ", Ana" or ", A.", to compare with the given name. */
const REFERENCE_GIVEN = /\s?,\s?([\p{L}\p{N}]+)(\.?)/uy;
/** A year further along the same line of a reference entry. */
const YEAR_ON_LINE = new RegExp(String.raw`[^\n]{0,200}?${YEAR}`, "uy");
const WORD = /[\p{L}\p{N}]+/gu;

/** Whether the sticky pattern `re` matches `text` at `index`. */
function matchesAt(re: RegExp, text: string, index: number): boolean {
  re.lastIndex = index;
  return re.test(text);
}

type Word = { text: string; upper: string; start: number; end: number };
type CitationText = { text: string; words: Word[]; at: Map<string, number[]> };

/** The text the patterns see, split into words and indexed by word (in capitals). */
function citationText(raw: string): CitationText {
  const text = fold(raw).replace(/\s+/gu, (ws) => (LINE_BREAK.test(ws) ? "\n" : " "));
  const words: Word[] = [];
  const at = new Map<string, number[]>();
  for (const m of text.matchAll(WORD)) {
    const upper = m[0].toUpperCase();
    const i = words.push({ text: m[0], upper, start: m.index, end: m.index + m[0].length }) - 1;
    const list = at.get(upper);
    if (list) list.push(i);
    else at.set(upper, [i]);
  }
  return { text, words, at };
}

/** The first letter of a word in capitals ("p" gives "P"; "ß", whose capital is "SS", stays). */
function capitalFirst(word: string): string {
  const first = [...word][0] ?? "";
  const up = first.toUpperCase();
  return [...up].length === 1 ? up : first;
}

/** Capitalized as a name is ("Pérez", "PÉREZ", or in a script without case), not as a word. */
const isCapitalized = (word: string) => word.startsWith(capitalFirst(word));

/** Whether a parenthesis or bracket opens at most 60 characters before `index`, still open. */
function insideBrackets(text: string, index: number): boolean {
  for (let i = index - 1; i >= Math.max(0, index - 61); i--) {
    const ch = text[i];
    if (ch === "(" || ch === "[") return true;
    if (ch === ")" || ch === "]") return false;
  }
  return false;
}

/** ", Ana" or ", A." just after a surname (`index`), then a year on the same line. */
function referenceEntry(text: string, index: number, given: string): boolean {
  REFERENCE_GIVEN.lastIndex = index;
  const m = REFERENCE_GIVEN.exec(text);
  if (!m) return false;
  const [all, word = "", dot = ""] = m;
  const end = m.index + all.length;
  if (word.toUpperCase() === given.toUpperCase() && isCapitalized(word)) {
    return matchesAt(YEAR_ON_LINE, text, end - dot.length);
  }
  return dot === "." && word === capitalFirst(given) && matchesAt(YEAR_ON_LINE, text, end);
}

/**
 * Whether the text cites `surname` with a year:
 * - in parentheses or brackets: "(Pérez 2021)", "(Smith and Pérez, eds., 2020)", "[Pérez 2019]";
 * - narratively: "Pérez (2019)", "Pérez [2019]", "Pérez et al. (2021)", "Pérez y Gómez (2020)",
 *   "Gonçalves e Silva (2018)", "Pérez, Smith & Jones (2020)", "Pérez's (2019)";
 * - as a reference-list entry, with the person's first given name or its initial:
 *   "Pérez, A. L. (2021).", "Pérez, Ana Lucía. Bots y poesía. Editorial, 2021.",
 *   "GONÇALVES, João Carlos. Poesia digital. São Paulo: Editora, 2020."
 * Outside brackets the surname must be capitalized, so "la paz (2020)" is not Sofía Paz.
 * `given` is the person's first given name and `before` the word just before the surname in
 * their name, both normalized. Words compare in capitals, so case never matters otherwise.
 */
function citesSurname(
  t: CitationText,
  surname: string,
  given: string | undefined,
  before: string | undefined,
): boolean {
  const ownArticle = before?.toUpperCase();
  for (const i of t.at.get(surname.toUpperCase()) ?? []) {
    const w = t.words[i] as Word;
    const prev = t.words[i - 1];
    const afterArticle =
      prev !== undefined &&
      prev.end === w.start - 1 &&
      /\s/u.test(t.text[prev.end] ?? "") &&
      ARTICLES.has(prev.upper) &&
      prev.upper !== ownArticle;
    if (afterArticle) continue;
    if (insideBrackets(t.text, w.start) && matchesAt(YEAR_IN_BRACKETS, t.text, w.end)) return true;
    if (!isCapitalized(w.text)) continue;
    if (matchesAt(NARRATIVE, t.text, w.end)) return true;
    if (given && referenceEntry(t.text, w.end, given)) return true;
  }
  return false;
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
    const cited = citationText(text);
    const urls = urlsIn(text);

    for (const p of people) {
      const name = p.displayName?.trim();
      if (name) {
        const n = normalizeWords(name);
        if (n.trim().split(" ").length >= 2 && words.includes(n)) add(path, "name", name);
        const all = nameWords(name);
        for (const surname of surnameCandidates(name)) {
          const at = all.indexOf(surname);
          const given = all.slice(0, at).find((w) => !PARTICLES.has(w));
          if (citesSurname(cited, surname, given, all[at - 1])) add(path, "citation", surname);
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
