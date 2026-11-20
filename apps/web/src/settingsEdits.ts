import { removeStrayInvisible, type Setting } from "@elochair/schema/pure";
import type { UnsavedValues } from "./unsaved";

/** What is in a control of the settings screen: text as typed, or a ticked box. */
export type Raw = string | boolean;
/**
 * What the person has typed and not saved, by setting path. A deadline is typed in three parts,
 * kept under its path with "#date", "#time" and "#offset". Only values that differ from the
 * configuration are here, so an edit taken back is no change.
 */
export type Edits = Record<string, Raw>;

/**
 * What a control shows for a stored value: a ticked box, or the value as text. An email's text
 * that the conference has not written shows the standard text, which is what is sent.
 */
export const rawOf = (s: Setting): Raw =>
  s.kind === "bool" ? s.value === true : s.value == null ? (s.standard ?? "") : String(s.value);

/**
 * An email's text as it leaves the control: without the invisible characters that writing does
 * not need, then without outer spaces. A paste often brings such characters along (direction
 * marks, zero-width spaces, a byte-order mark), nobody can see them, and the server refuses a
 * text that has any, because they can hide or reorder words in mail (removeStrayInvisible keeps
 * the joiners that Persian and Indic words and emoji need). It is taken from the whole text
 * when the text is used, not at each key pressed: a joiner is stray until the letter after it
 * has been typed. The preview shows this text, and it is what is reviewed and saved.
 */
export const emailText = (raw: Raw): string => removeStrayInvisible(String(raw)).trim();

/**
 * The value that what is in a text control stands for. Outer spaces go, and an empty control is
 * no value. An email's text is the exception both ways: the standard text is no value (it is
 * what "nothing stored" already sends), and an emptied control stays an empty text, which the
 * review refuses beside it, so that it never quietly means the standard text again. It is also
 * cleaned of what cannot be seen (emailText).
 */
export function typedText(s: Setting, raw: Raw): string | undefined {
  if (s.standard !== undefined) {
    const text = emailText(raw);
    return text === s.standard ? undefined : text;
  }
  const text = String(raw).trim();
  return text === "" ? undefined : text;
}

export const DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A stored instant as its date, its time and its offset, the way it was written. */
export function parts(iso: unknown) {
  const m = typeof iso === "string" ? DATETIME.exec(iso) : null;
  return {
    date: m?.[1] ?? "",
    time: m?.[2] ?? "",
    seconds: m?.[3] ?? "00",
    offset: m ? (m[4] === "Z" ? "+00:00" : (m[4] ?? "")) : "",
  };
}

const DEADLINE_PARTS = ["date", "time", "offset"] as const;

/**
 * What the control under an edit's key shows while nothing is typed in it: the stored value of
 * a setting, or one part of a stored deadline. Undefined when the key names no control.
 */
export function storedRaw(settings: Setting[], key: string): Raw | undefined {
  const at = key.indexOf("#");
  const setting = settings.find((s) => s.path === (at < 0 ? key : key.slice(0, at)));
  if (!setting) return undefined;
  if (setting.kind !== "datetime") return at < 0 ? rawOf(setting) : undefined;
  const part = DEADLINE_PARTS.find((p) => p === key.slice(at + 1));
  return at < 0 || !part ? undefined : parts(setting.value)[part];
}

/**
 * What an earlier visit left typed and unsaved on the settings screen (kept in this browser, see
 * unsaved.ts), as far as it still fits the settings there are now. An edit to a value that is
 * no longer a setting (a format or a field was removed, a language dropped), or one of the wrong
 * kind (the stored text was tampered with), is left out.
 *
 * Nothing here is compared with the configuration it was typed on: an edit goes back on top of
 * whatever is stored now, as it does when the settings are reloaded, and the review before
 * saving shows each change against the stored value.
 */
export function restoredEdits(values: UnsavedValues | undefined, settings: Setting[]): Edits {
  const out: Edits = {};
  for (const [key, v] of Object.entries(values ?? {})) {
    const at = key.indexOf("#");
    const path = at < 0 ? key : key.slice(0, at);
    const part = at < 0 ? null : key.slice(at + 1);
    const setting = settings.find((s) => s.path === path);
    if (!setting) continue;
    if (setting.kind === "datetime") {
      if (DEADLINE_PARTS.some((p) => p === part) && typeof v === "string") out[key] = v;
    } else if (part === null) {
      if (setting.kind === "bool") {
        if (typeof v === "boolean") out[key] = v;
      } else if (typeof v === "string") out[key] = v;
    }
  }
  return out;
}

/**
 * After a save: what is still typed and not saved. The form stays open while a save is on its
 * way, so `current` (the edits when the answer came) may differ from `sent` (the edits that were
 * saved). A control that was not touched in between now shows what was saved, and has no edit.
 * One that was touched keeps what it shows, as an unsaved change to the saved configuration:
 * typed again, typed for the first time, or taken back to what it was before the save.
 *
 * `before` and `after` are the settings of the configuration the save started from and of the
 * one it stored (the server's answer, which may have tidied a value).
 */
export function editsAfterSave(
  sent: Edits,
  current: Edits,
  before: Setting[],
  after: Setting[],
): Edits {
  const out: Edits = {};
  for (const key of new Set([...Object.keys(sent), ...Object.keys(current)])) {
    const was = storedRaw(before, key);
    const saved = storedRaw(after, key);
    // No longer a control (the stored configuration lost the setting): nothing to keep.
    if (was === undefined || saved === undefined) continue;
    const shown = current[key] ?? was;
    if (shown === (sent[key] ?? was)) continue;
    if (shown !== saved) out[key] = shown;
  }
  return out;
}
