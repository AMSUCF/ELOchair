import type { ConferenceConfig, CustomField, SubmissionType } from "@elochair/schema";
import type { MySubmission } from "./api";
import type { UnsavedValue, UnsavedValues } from "./unsaved";

/** The part of a proposal that its owner edits in the form. */
export type ProposalForm = Pick<
  MySubmission,
  "title" | "abstract" | "trackKey" | "topicKeys" | "language" | "participationMode" | "fields"
>;
type FieldValue = ProposalForm["fields"][string];

/**
 * An unsaved value as one of the format's own fields takes it, or undefined when it does not
 * fit the field as it is configured now: the field became another kind, the option chosen is
 * gone, or the stored value was tampered with. A number comes back as the number it was.
 */
export function fitField(field: CustomField, v: UnsavedValue): FieldValue | undefined {
  const options = (field.options ?? []).map((o) => o.key);
  switch (field.kind) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "select":
      return typeof v === "string" && options.includes(v) ? v : undefined;
    case "multiselect": {
      if (!Array.isArray(v)) return undefined;
      const still = v.filter((k) => options.includes(k));
      // Nothing left of what was ticked is no answer; an emptied list stays an emptied list.
      return still.length > 0 || v.length === 0 ? still : undefined;
    }
    default:
      return typeof v === "string" ? v : undefined;
  }
}

/**
 * Whether the editor shows a control for this path of the form, as the conference is configured
 * now. The editor renders by it, and withUnsaved() restores by it, so the two cannot drift: a
 * value with no control on screen is never put back. Its owner could neither see it nor change
 * it, and it would go out with the next save.
 */
export function showsControl(
  path: string,
  config: Pick<ConferenceConfig, "modality" | "tracks" | "topics">,
  type: SubmissionType | undefined,
): boolean {
  switch (path) {
    case "title":
    case "abstract":
    case "language":
      return true;
    // How someone takes part is a question only where there is a choice.
    case "participationMode":
      return config.modality === "hybrid";
    case "trackKey":
      return config.tracks.length > 0;
    case "topicKeys":
      return config.topics.length > 0;
    default: {
      if (!path.startsWith("fields.")) return false;
      const key = path.slice("fields.".length);
      return type?.fields.some((f) => f.key === key) ?? false;
    }
  }
}

/**
 * `base` with unsaved values from the browser put back. A value comes back only where the
 * editor shows its control (showsControl), and only if it still fits: a field the format no
 * longer has, a way of taking part where the conference no longer offers the choice, a
 * language, a track or a topic that is gone, a value of the wrong kind are all left out, so
 * they are neither shown nor sent.
 */
export function withUnsaved(
  base: ProposalForm,
  values: UnsavedValues,
  config: ConferenceConfig,
  type: SubmissionType | undefined,
): ProposalForm {
  const out: ProposalForm = { ...base, topicKeys: [...base.topicKeys], fields: { ...base.fields } };
  for (const [path, v] of Object.entries(values)) {
    if (!showsControl(path, config, type)) continue;
    if (path === "title" || path === "abstract") {
      if (typeof v === "string") out[path] = v;
    } else if (path === "language") {
      if (typeof v === "string" && config.languages.includes(v)) out.language = v;
    } else if (path === "trackKey") {
      if (v === null || config.tracks.some((x) => x.key === v)) out.trackKey = v as string | null;
    } else if (path === "topicKeys") {
      if (Array.isArray(v)) out.topicKeys = v.filter((k) => config.topics.some((x) => x.key === k));
    } else if (path === "participationMode") {
      if (v === null || v === "in_person" || v === "online" || v === "undecided") {
        out.participationMode = v;
      }
    } else if (path.startsWith("fields.")) {
      const key = path.slice("fields.".length);
      const field = type?.fields.find((f) => f.key === key);
      if (!field) continue;
      if (v === null) {
        delete out.fields[key];
        continue;
      }
      const fitted = fitField(field, v);
      if (fitted !== undefined) out.fields[key] = fitted;
    }
  }
  return out;
}
