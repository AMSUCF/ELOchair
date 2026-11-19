import type { CustomField } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";

/** An answer to one of a format's own fields, as text to read; `href` when it is a web address. */
export type Answer = { text: string; href?: string };

/**
 * What to show for an answer nobody is editing: an option's name rather than its key, yes or no
 * for a tick box. Null when the field was left empty, so the page can leave its heading out.
 */
export function answerOf(
  field: Pick<CustomField, "kind" | "options">,
  value: string | string[] | boolean | number | undefined,
  words: { lang: string; fallback: string; yes: string; no: string },
): Answer | null {
  const optionName = (key: string) => {
    const option = field.options?.find((o) => o.key === key);
    return option ? localize(option.label, words.lang, words.fallback) : key;
  };
  if (value === undefined) return null;
  if (typeof value === "boolean") return { text: value ? words.yes : words.no };
  if (typeof value === "number") return { text: String(value) };
  if (Array.isArray(value)) {
    return value.length ? { text: value.map(optionName).join(", ") } : null;
  }
  if (!value.trim()) return null;
  if (field.kind === "select") return { text: optionName(value) };
  if (field.kind === "url") {
    const href = webAddress(value);
    return href ? { text: value, href } : { text: value };
  }
  return { text: value };
}

/** Only http and https addresses become links: never `javascript:` or `data:`. */
function webAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
