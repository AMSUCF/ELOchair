import type { Setting } from "@elochair/schema/pure";

/** What is in a control of the settings screen: text as typed, or a ticked box. */
export type Raw = string | boolean;
/**
 * What the person has typed and not saved, by setting path. A deadline is typed in three parts,
 * kept under its path with "#date", "#time" and "#offset". Only values that differ from the
 * configuration are here, so an edit taken back is no change.
 */
export type Edits = Record<string, Raw>;

/** What a control shows for a stored value: a ticked box, or the value as text. */
export const rawOf = (s: Setting): Raw =>
  s.kind === "bool" ? s.value === true : s.value == null ? "" : String(s.value);

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
