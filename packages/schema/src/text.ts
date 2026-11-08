/** Zod-free helpers for localized text; safe to import in the browser bundle. */

/**
 * Pick the best string for `lang`: exact match, then the bare language ("pt" for "pt-BR"),
 * then the fallback language, then any value.
 */
export function localize(text: Record<string, string>, lang: string, fallback = "en"): string {
  const base = lang.split("-")[0] ?? lang;
  return text[lang] ?? text[base] ?? text[fallback] ?? Object.values(text)[0] ?? "";
}
