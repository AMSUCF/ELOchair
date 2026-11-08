import { z } from "zod";

/** BCP-47 primary language subtag, optionally with a region: "en", "es", "pt-BR". */
export const LanguageCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "expected a language code such as en, es, pt-BR");
export type LanguageCode = z.infer<typeof LanguageCode>;

/** Text in several languages, keyed by language code. */
export const LocalizedText = z.record(LanguageCode, z.string().min(1));
export type LocalizedText = z.infer<typeof LocalizedText>;

export { localize, localizeWithLang } from "./text";
