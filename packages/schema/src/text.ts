/** Zod-free helpers for localized text; safe to import in the browser bundle. */

/**
 * Pick the best string for `lang`: exact match, then the bare language ("pt" for "pt-BR"),
 * then the fallback language, then any value.
 */
export function localize(text: Record<string, string>, lang: string, fallback = "en"): string {
  return localizeWithLang(text, lang, fallback).text;
}

/**
 * Like `localize`, but also says which language the text is in, so the UI can mark fallback
 * text with a lang attribute. Order: exact match ("pt-BR"), bare language ("pt"), any regional
 * variant of it ("pt-PT" for "pt"), the fallback language, then anything.
 */
export function localizeWithLang(
  text: Record<string, string>,
  lang: string,
  fallback = "en",
): { text: string; lang: string } {
  const base = lang.split("-")[0] ?? lang;
  const keys = Object.keys(text);
  const pick =
    (lang in text && lang) ||
    (base in text && base) ||
    keys.find((k) => k.split("-")[0] === base) ||
    (fallback in text && fallback) ||
    keys[0];
  return pick ? { text: text[pick] ?? "", lang: pick } : { text: "", lang };
}
