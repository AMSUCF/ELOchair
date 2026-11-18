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
 * `base` with unsaved values from the browser put back. Whatever no longer fits the form is
 * left out, so it is neither shown nor sent: a field the format no longer has, a language, a
 * track or a topic the conference no longer offers, a value of the wrong kind.
 */
export function withUnsaved(
  base: ProposalForm,
  values: UnsavedValues,
  config: ConferenceConfig,
  type: SubmissionType | undefined,
): ProposalForm {
  const out: ProposalForm = { ...base, topicKeys: [...base.topicKeys], fields: { ...base.fields } };
  for (const [path, v] of Object.entries(values)) {
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
