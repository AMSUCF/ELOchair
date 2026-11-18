import type { Setting } from "@elochair/schema/pure";
import type { UnsavedValues } from "./unsaved";

/** What is in a control of the settings screen: text as typed, or a ticked box. */
export type Raw = string | boolean;
/**
 * What the person has typed and not saved, by setting path. A deadline is typed in three parts,
 * kept under its path with "#date", "#time" and "#offset". Only values that differ from the
 * configuration are here, so an edit taken back is no change.
 */
export type Edits = Record<string, Raw>;

const DEADLINE_PARTS = ["date", "time", "offset"];

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
      if (part && DEADLINE_PARTS.includes(part) && typeof v === "string") out[key] = v;
    } else if (part === null) {
      if (setting.kind === "bool") {
        if (typeof v === "boolean") out[key] = v;
      } else if (typeof v === "string") out[key] = v;
    }
  }
  return out;
}
