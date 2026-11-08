/**
 * Self-identification warnings for anonymized text. Zod-free: the submission form runs it live
 * in the browser (via "@elochair/schema/pure") and the server runs it on check and submit.
 *
 * It looks for the authors' own details in text that reviewers will read in double-blind
 * review. Matching ignores case and accents and respects word boundaries. Results carry the
 * path, the kind, and the matched detail, which is the author's own data; the server reports
 * only counts to anyone else.
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

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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

/**
 * Words that may be cited as a surname: every word after the first with at least three letters
 * that is not a particle. "María José Rodríguez Vera" gives josé, rodríguez and vera (normalized),
 * so "(Rodríguez 2021)" is found as well as "(Vera 2021)".
 */
export function surnameCandidates(displayName: string): string[] {
  const words = normalizeWords(displayName).trim().split(" ").filter(Boolean);
  if (words.length < 2) return [];
  return [...new Set(words.slice(1).filter((w) => w.length >= 3 && !PARTICLES.has(w)))];
}

/** URLs in text, with their host labels and path segments split for whole-word matching. */
function urlsIn(text: string): { host: string; parts: Set<string> }[] {
  const out: { host: string; parts: Set<string> }[] = [];
  const re = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/giu;
  for (const m of text.matchAll(re)) {
    try {
      const u = new URL(m[0].startsWith("www.") ? `https://${m[0]}` : m[0]);
      const host = u.hostname.toLowerCase();
      const parts = new Set(
        stripAccents(`${host}/${decodeURIComponent(u.pathname)}`)
          .split(/[./\-_~]+/)
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
    const urls = urlsIn(text);

    for (const p of people) {
      const name = p.displayName?.trim();
      if (name) {
        const n = normalizeWords(name);
        if (n.trim().split(" ").length >= 2 && words.includes(n)) add(path, "name", name);
        for (const surname of surnameCandidates(name)) {
          const s = escapeRe(surname);
          // "(Pérez 2021)", "(Smith and Pérez, eds., 2020)" or "Pérez (2019)"
          const citation = new RegExp(
            `\\([^)]{0,60}\\b${s}\\b[^)]{0,60}\\b(?:19|20)\\d{2}|\\b${s}\\s*\\(\\s*(?:19|20)\\d{2}`,
            "u",
          );
          if (citation.test(plain)) add(path, "citation", surname);
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
      // Surnames match whole host labels or path segments only ("cruz" is not in veracruz.gob.mx).
      const surnames = name ? surnameCandidates(name).filter((w) => w.length >= 4) : [];
      for (const u of urls) {
        const onOwnDomain = ownDomain && (u.host === ownDomain || u.host.endsWith(`.${ownDomain}`));
        const hasSurname = surnames.some((w) => u.parts.has(w));
        if (onOwnDomain || hasSurname) add(path, "url", u.host);
      }
    }
  }
  return [...found.values()];
}
