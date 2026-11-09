import { createContext, useContext, useMemo } from "react";
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";
import { pt } from "./pt";

export const LANGS = ["en", "es", "pt"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español", pt: "Português" };

const catalogs: Record<Lang, Messages> = { en, es, pt };

export const isLang = (x: string | undefined): x is Lang => LANGS.includes(x as Lang);

/** For keys built from server data at run time (issue codes): check before translating. */
export const isMessageKey = (x: string): x is MessageKey => Object.hasOwn(en, x);

export function translate(
  lang: Lang,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  // The typecheck guarantees every key; the fallbacks only keep a page alive if data from a newer
  // server slips through untyped.
  const text: string | undefined = catalogs[lang][key] ?? en[key];
  return (text ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}

/** First supported language in the browser's preferences, else English. */
export function detectLang(preferences: readonly string[] = navigator.languages): Lang {
  for (const p of preferences) {
    const base = p.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export const LangContext = createContext<Lang>("en");

export function useT() {
  const lang = useContext(LangContext);
  // Stable per language, so it can be an effect dependency.
  const t = useMemo(
    () => (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
  return { lang, t };
}

export type { MessageKey };
