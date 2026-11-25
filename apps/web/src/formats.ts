import type { CallState, ConferenceConfig, SubmissionType } from "@elochair/schema";
import { hasMinimum } from "./format";
import type { MessageKey } from "./i18n";

/*
 * A call's formats, as the conference's page shows them: one at a time, chosen from a list or
 * a select (formatsView.tsx; the design it follows is the formats view of
 * docs/design/visitor-preview). This file holds which formats a call lists, which one an
 * address chooses, and what the panel says of one. All of it comes from the conference's
 * configuration.
 */

type Texts = Record<string, string>;

/**
 * A format the call lists. `type` is there for one that is submitted here, with everything the
 * form asks for; a format the call takes some other way (by email) has only a name and a
 * description.
 */
export type ListedFormat = {
  key: string;
  name: Texts;
  description: Texts;
  type?: SubmissionType;
};

/** The call's formats in its own order: those submitted here, then those that are not. */
export function listedFormats(
  c: Pick<ConferenceConfig, "submissionTypes" | "otherFormats">,
): ListedFormat[] {
  return [
    ...c.submissionTypes.map((type) => ({
      key: type.key,
      name: type.name,
      description: type.description,
      type,
    })),
    ...c.otherFormats.map(({ key, name, description }) => ({ key, name, description })),
  ];
}

/** The id of a format's heading on the conference's page, which a way to contribute leads to. */
export const formatAnchor = (key: string) => `format-${key}`;

/** "01", "08": a format's place in the call, as the page numbers it. */
export const two = (n: number) => String(n).padStart(2, "0");

/**
 * The place of the format an address chooses: the one its "#format-<key>" names. Any other
 * address ("#formats", none, a format the call does not list) chooses the first.
 */
export function chosenIndex(formats: readonly { key: string }[], hash: string): number {
  const at = formats.findIndex((format) => hash === `#${formatAnchor(format.key)}`);
  return Math.max(at, 0);
}

/** The place before or after another. Past either end it goes round to the other one. */
export function steppedIndex(count: number, index: number, step: -1 | 1): number {
  return count === 0 ? 0 : (index + step + count) % count;
}

/**
 * The format the start page begins with: the one its address names ("?format=<key>"), if the
 * call takes it here, or the only one the call takes. Otherwise none: the page asks which.
 */
export function startingFormat(
  types: readonly { key: string }[],
  named: string | null,
): string | null {
  const only = types.length === 1 ? types[0]?.key : undefined;
  return types.find((type) => type.key === named)?.key ?? only ?? null;
}

/** Where "Start this proposal" leads: the start page, with the format chosen. */
export const startAddress = (lang: string, slug: string, key: string) =>
  `/${lang}/c/${slug}/submit?format=${encodeURIComponent(key)}`;

/**
 * What the panel of a format offers, by where the call stands (the server says: `callState`).
 * - start: the call is open, and the format is submitted here: start a proposal in it.
 * - opens: the call has not opened yet: the panel says when it does.
 * - closed: nothing more can be sent in.
 * - elsewhere: the format is not submitted here, whatever the state of the call: the way to it
 *   is the conference's own site.
 */
export type FormatAction = "start" | "opens" | "closed" | "elsewhere";

export function formatAction(format: ListedFormat, state: CallState): FormatAction {
  if (!format.type) return "elsewhere";
  return state === "open" ? "start" : state === "upcoming" ? "opens" : "closed";
}

const range = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`);

/** A figure of a format: the number, and the message that says what it counts. */
export type Figure = { value: string; label: MessageKey };

/**
 * A format's figures, in the order the panel sets them: the words of its abstract, the minutes
 * of its slot where it has one, and the people on a proposal. Each is what the configuration
 * holds, so a format without a slot has two.
 */
export function formatFigures(type: SubmissionType, lang: string): Figure[] {
  const { minWords, maxWords } = type.abstract;
  const alone = type.team.max === 1 && new Intl.PluralRules(lang).select(1) === "one";
  return [
    hasMinimum(minWords)
      ? { value: range(minWords, maxWords), label: "statWords" }
      : { value: String(maxWords), label: "statWordsMax" },
    ...(type.durationMinutes
      ? [{ value: String(type.durationMinutes), label: "statMinutes" } as const]
      : []),
    { value: range(type.team.min, type.team.max), label: alone ? "statPerson" : "statPeople" },
  ];
}

/** Something the form of a format asks for, by the name the form gives it. */
export type Asked = { id: string; label: Texts; required: boolean };

/**
 * What the form asks for: the abstract, by what this format calls it, and then the format's
 * own fields. The abstract is required unless the format lets it be left empty (a minimum of
 * no words at all).
 */
export function formatAsks(type: SubmissionType): Asked[] {
  return [
    { id: "abstract", label: type.abstract.label, required: type.abstract.minWords !== 0 },
    ...type.fields.map((field) => ({
      id: `field-${field.key}`,
      label: field.label,
      required: field.required,
    })),
  ];
}
