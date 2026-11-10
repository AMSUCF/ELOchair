import { z } from "zod";
import { LanguageCode, LocalizedText } from "./i18n";
import { LIMITS } from "./limits";

/** Machine key: lowercase letters, digits, underscores; starts with a letter; at most 64. */
export const Key = z
  .string()
  .max(LIMITS.key)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "use lowercase letters, digits and underscores, starting with a letter",
  );

export const BlindMode = z.enum(["double", "single", "open"]);
export type BlindMode = z.infer<typeof BlindMode>;

/** Roles a person can hold on a submission. The presenter-cap rule counts some of them. */
export const ContributionRole = z.enum(["lead", "presenter", "coauthor", "panelist", "moderator"]);
export type ContributionRole = z.infer<typeof ContributionRole>;

export const Modality = z.enum(["online", "in_person", "hybrid"]);

/** Conference phases, in order. They move forward only, except draft ⇄ cfp_open. */
export const ConferencePhase = z.enum([
  "draft",
  "cfp_open",
  "reviewing",
  "deciding",
  "confirming",
  "scheduling",
  "published",
  "archived",
]);
export type ConferencePhase = z.infer<typeof ConferencePhase>;

/** Whether a phase change is allowed without --force. */
export function isForwardPhaseMove(from: string, to: string): boolean {
  const order = ConferencePhase.options as readonly string[];
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return false;
  if ((from === "draft" && to === "cfp_open") || (from === "cfp_open" && to === "draft"))
    return true;
  return b > a;
}

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();

/**
 * An IANA zone name such as "America/Bogota" (or "UTC"). Offsets ("+05:00") and abbreviations
 * ("EST") are refused even where the runtime accepts them: they ignore daylight saving.
 */
function isValidTimeZone(tz: string): boolean {
  if (!/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date ("2026-05-15") of an instant, as seen in a time zone. */
function dateIn(iso: string, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export const Criterion = z.object({
  key: Key,
  label: LocalizedText,
  min: z.int().default(1),
  max: z.int().default(5),
});

export const ReviewPool = z.object({
  key: Key,
  name: LocalizedText,
  /** Default blind mode for every submission type reviewed by this pool. */
  blindMode: BlindMode,
  reviewsPerSubmission: z.int().min(1).max(10),
  criteria: z.array(Criterion).min(1),
});
export type ReviewPool = z.infer<typeof ReviewPool>;

export const FieldKind = z.enum([
  "text",
  "longtext",
  "url",
  "select",
  "multiselect",
  "boolean",
  "number",
]);

/**
 * Something participants must acknowledge: the privacy notice, code of conduct, recordings policy.
 * Owners acknowledge the current version to submit; invitees to confirm. Bump the version when
 * the text changes, and everyone acknowledges again next time.
 */
export const Agreement = z.object({
  key: Key,
  title: LocalizedText,
  url: z.url().optional(),
  text: LocalizedText.optional(),
  version: z.string().min(1).max(40),
});
export type Agreement = z.infer<typeof Agreement>;

export const CustomField = z.object({
  key: Key,
  label: LocalizedText,
  help: LocalizedText.optional(),
  kind: FieldKind,
  required: z.boolean().default(false),
  /**
   * True when the value can reveal who submitted (a URL to the work, a named collaborator...).
   * Identifying values are hidden from reviewers in double-blind review.
   */
  identifying: z.boolean().default(false),
  /** True when the value appears on the public program once the submission is published. */
  public: z.boolean().default(false),
  options: z.array(z.object({ key: Key, label: LocalizedText })).optional(),
  maxWords: z.int().positive().optional(),
  /** For number fields: the smallest and largest value accepted (both inclusive). */
  min: z.number().optional(),
  max: z.number().optional(),
});
export type CustomField = z.infer<typeof CustomField>;

export const SubmissionType = z.object({
  key: Key,
  name: LocalizedText,
  description: LocalizedText,
  reviewPool: Key,
  /** Overrides the pool's blind mode for this type only. */
  blindMode: BlindMode.optional(),
  abstract: z.object({
    label: LocalizedText,
    minWords: z.int().min(0),
    maxWords: z.int().positive(),
  }),
  /** Length of the slot on the program. Absent for things that are not scheduled (exhibition). */
  durationMinutes: z.int().positive().optional(),
  team: z.object({ min: z.int().min(1), max: z.int().min(1) }),
  countsTowardPresenterCap: z.boolean().default(true),
  fields: z.array(CustomField).default([]),
});
export type SubmissionType = z.infer<typeof SubmissionType>;

const ConferenceConfigShape = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and hyphens"),
  year: z.int().min(1999),
  title: LocalizedText,
  theme: LocalizedText,
  host: z.string().min(1),
  location: LocalizedText,
  modality: Modality,
  timezone: z.string().refine(isValidTimeZone, "unknown IANA time zone"),
  defaultLanguage: LanguageCode,
  languages: z.array(LanguageCode).min(1),
  contactEmail: z.email(),
  /** The conference's own site, where the full call lives. The conference page links to it. */
  website: z.url({ protocol: /^https$/, error: "use an https:// address" }).optional(),
  /** Where the conference takes place, in decimal degrees. Shown as on the conference's site. */
  coordinates: z
    .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .optional(),
  dates: z.object({ start: IsoDate, end: IsoDate }),
  deadlines: z.object({
    submissionsOpen: IsoDateTime,
    submissionsClose: IsoDateTime,
    notification: IsoDateTime,
    finalMaterials: IsoDateTime,
  }),
  rules: z.object({
    presenterCap: z
      .object({ max: z.int().min(1), countedRoles: z.array(ContributionRole).min(1) })
      .nullable(),
    /** Whether contributors are asked for a bio, and how long it may be. Missing: not asked. */
    bio: z.object({ requested: z.boolean(), maxWords: z.int().positive() }).optional(),
  }),
  agreements: z.array(Agreement).default([]),
  tracks: z.array(z.object({ key: Key, name: LocalizedText })).default([]),
  topics: z.array(z.object({ key: Key, label: LocalizedText })).default([]),
  reviewPools: z.array(ReviewPool).min(1),
  submissionTypes: z.array(SubmissionType).min(1),
  /**
   * Formats the call offers that are not submitted through ELOchair (ELO 2027 takes curatorial
   * pitches by email). The conference page lists them so the call is complete; nothing else
   * uses them.
   */
  otherFormats: z
    .array(z.object({ key: Key, name: LocalizedText, description: LocalizedText }))
    .default([]),
  /** True while the content is a stand-in (e.g. dates not yet announced). The UI says so. */
  placeholder: z.boolean().default(false),
});

type Shape = z.infer<typeof ConferenceConfigShape>;

function checkConfig(c: Shape, ctx: z.core.$RefinementCtx<Shape>): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  if (!c.languages.includes(c.defaultLanguage)) {
    issue(["defaultLanguage"], "defaultLanguage must be one of languages");
  }

  const text = (path: (string | number)[], t: Record<string, string> | undefined) => {
    if (t && !(c.defaultLanguage in t)) {
      issue(path, `missing text in the default language (${c.defaultLanguage})`);
    }
  };
  const unique = (path: (string | number)[], keys: string[]) => {
    const seen = new Set<string>();
    keys.forEach((k, i) => {
      if (seen.has(k)) issue([...path, i, "key"], `duplicate key "${k}"`);
      seen.add(k);
    });
  };

  text(["title"], c.title);
  text(["theme"], c.theme);
  text(["location"], c.location);
  for (const [i, t] of c.tracks.entries()) text(["tracks", i, "name"], t.name);
  for (const [i, t] of c.topics.entries()) text(["topics", i, "label"], t.label);
  unique(
    ["tracks"],
    c.tracks.map((t) => t.key),
  );
  unique(
    ["topics"],
    c.topics.map((t) => t.key),
  );
  unique(
    ["agreements"],
    c.agreements.map((a) => a.key),
  );
  for (const [i, a] of c.agreements.entries()) {
    text(["agreements", i, "title"], a.title);
    text(["agreements", i, "text"], a.text);
    if (!a.url && !a.text) issue(["agreements", i], "an agreement needs a url or a text");
  }
  unique(
    ["reviewPools"],
    c.reviewPools.map((p) => p.key),
  );
  unique(
    ["submissionTypes"],
    c.submissionTypes.map((t) => t.key),
  );

  // A format is either submitted here or it is not: the two lists share one set of keys.
  const typeKeys = new Set(c.submissionTypes.map((t) => t.key));
  unique(
    ["otherFormats"],
    c.otherFormats.map((f) => f.key),
  );
  c.otherFormats.forEach((f, i) => {
    if (typeKeys.has(f.key)) {
      issue(["otherFormats", i, "key"], `"${f.key}" is already a submission type`);
    }
    text(["otherFormats", i, "name"], f.name);
    text(["otherFormats", i, "description"], f.description);
  });

  c.reviewPools.forEach((p, i) => {
    text(["reviewPools", i, "name"], p.name);
    unique(
      ["reviewPools", i, "criteria"],
      p.criteria.map((k) => k.key),
    );
    p.criteria.forEach((k, j) => {
      text(["reviewPools", i, "criteria", j, "label"], k.label);
      if (k.min >= k.max) issue(["reviewPools", i, "criteria", j], "min must be less than max");
    });
  });

  const pools = new Set(c.reviewPools.map((p) => p.key));
  c.submissionTypes.forEach((t, i) => {
    const at = ["submissionTypes", i];
    text([...at, "name"], t.name);
    text([...at, "description"], t.description);
    text([...at, "abstract", "label"], t.abstract.label);
    if (!pools.has(t.reviewPool)) {
      issue([...at, "reviewPool"], `unknown review pool "${t.reviewPool}"`);
    }
    if (t.abstract.minWords > t.abstract.maxWords) {
      issue([...at, "abstract"], "minWords must not exceed maxWords");
    }
    if (t.team.min > t.team.max) issue([...at, "team"], "team.min must not exceed team.max");
    unique(
      [...at, "fields"],
      t.fields.map((f) => f.key),
    );
    t.fields.forEach((f, j) => {
      const fat = [...at, "fields", j];
      text([...fat, "label"], f.label);
      text([...fat, "help"], f.help);
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
        issue(fat, "min must not exceed max");
      }
      if ((f.min !== undefined || f.max !== undefined) && f.kind !== "number") {
        issue(fat, "min and max are for number fields");
      }
      const hasOptions = (f.options?.length ?? 0) > 0;
      if ((f.kind === "select" || f.kind === "multiselect") && !hasOptions) {
        issue([...fat, "options"], "select fields need options");
      }
      unique(
        [...fat, "options"],
        (f.options ?? []).map((o) => o.key),
      );
      for (const [k, o] of (f.options ?? []).entries())
        text([...fat, "options", k, "label"], o.label);
    });
  });

  const d = c.deadlines;
  const order: [keyof typeof d, keyof typeof d][] = [
    ["submissionsOpen", "submissionsClose"],
    ["submissionsClose", "notification"],
    ["notification", "finalMaterials"],
  ];
  for (const [a, b] of order) {
    if (Date.parse(d[a]) > Date.parse(d[b]))
      issue(["deadlines", b], `${b} must not be before ${a}`);
  }
  if (c.dates.start > c.dates.end) issue(["dates", "end"], "end must not be before start");
  // Compare calendar dates in the conference's own time zone: due strictly before day one.
  const finalDay = dateIn(d.finalMaterials, c.timezone);
  if (finalDay && finalDay >= c.dates.start) {
    issue(["deadlines", "finalMaterials"], "final materials must be due before the conference");
  }
}

/** One conference's whole setup. Each year's conference is data, not code. */
export const ConferenceConfig = ConferenceConfigShape.superRefine(checkConfig);
export type ConferenceConfig = z.infer<typeof ConferenceConfig>;
export type ConferenceConfigInput = z.input<typeof ConferenceConfig>;

export { effectiveBlindMode, findType } from "./lookup";
