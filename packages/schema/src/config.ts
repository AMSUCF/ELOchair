import { z } from "zod";
import { LanguageCode, LocalizedText } from "./i18n";
import { LIMITS, REVIEW_EMAILS } from "./limits";
import {
  MAIL_LANGUAGES,
  MESSAGE_KEYS,
  MESSAGE_PARTS,
  type MessageProblemCode,
  messageProblems,
} from "./messages";
import { CONFERENCE_PHASES } from "./phases";

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

/** Conference phases, in order (phases.ts). They move forward only, except draft ⇄ cfp_open. */
export const ConferencePhase = z.enum(CONFERENCE_PHASES);
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
  /**
   * What the criterion asks, or what its lowest and highest scores mean: shown under its label
   * on the review form, where the chairs wrote one.
   */
  description: LocalizedText.optional(),
  min: z.int().default(1),
  max: z.int().default(5),
});

/**
 * The fixed part of a pool's review form (spec 03, §1.8), under the scores: the comments for
 * the authors, the note for the chairs only, and the overall recommendation. Their names are
 * the app's own; every limit and every description a reviewer meets on them is here, and is
 * the chairs' to set. All of it is optional, and a configuration that says nothing has the
 * form as the app words it: comments without a word limit, a note and a recommendation.
 *
 * Each part is always there once a configuration has been read (an empty object stands for
 * "nothing set"), so that its settings are offered whether or not anything is written yet.
 */
export const ReviewFormConfig = z.object({
  /** The comments for the authors: always on the form, and required to send a review. */
  comments: z
    .object({
      /** Shown under the field, in place of the app's standard sentence. */
      description: LocalizedText.optional(),
      /** The fewest and the most words a review that is sent may have. Left out: no limit. */
      minWords: z.int().min(1).optional(),
      maxWords: z.int().min(1).optional(),
    })
    .prefault({}),
  /** The note for the chairs only: optional for the reviewer, and the chairs can take it off. */
  chairNote: z
    .object({ enabled: z.boolean().default(true), description: LocalizedText.optional() })
    .prefault({}),
  /** Accept, unsure or reject: required to send while the form has it. */
  recommendation: z
    .object({ enabled: z.boolean().default(true), description: LocalizedText.optional() })
    .prefault({}),
});
export type ReviewFormConfig = z.infer<typeof ReviewFormConfig>;

export const ReviewPool = z.object({
  key: Key,
  name: LocalizedText,
  /** Default blind mode for every submission type reviewed by this pool. */
  blindMode: BlindMode,
  reviewsPerSubmission: z.int().min(1).max(10),
  /**
   * What the chairs want this pool's reviewers to read before they review. A reviewer is shown
   * it above each proposal of the pool. Like every text of a configuration it is public, and
   * like them it has no length limit of its own: the API limits a configuration as a whole.
   */
  guidelines: LocalizedText.optional(),
  criteria: z.array(Criterion).min(1),
  /** What the review form holds beside the criteria, and how it is worded (ReviewFormConfig). */
  form: ReviewFormConfig.prefault({}),
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
 * Owners acknowledge the current version to submit; invitees to confirm. Consent is recorded
 * against the version, so what an agreement says is changed only together with its version
 * (the server refuses a save that changes one without the other; spec 02, §1.5), and everyone
 * acknowledges the new one next time.
 *
 * The link is an https address: people open it from the page where they accept.
 */
export const Agreement = z.object({
  key: Key,
  title: LocalizedText,
  url: z.url({ protocol: /^https$/, error: "use an https:// address" }).optional(),
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
  /** For number fields: true when only whole numbers are accepted (a head count). */
  integer: z.boolean().optional(),
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
    /**
     * The fewest words accepted. Left out when the call gives no minimum: the abstract then only
     * has to be there. (0 says something else: the abstract may be left empty.)
     */
    minWords: z.int().min(0).optional(),
    maxWords: z.int().positive(),
  }),
  /** Length of the slot on the program. Absent for things that are not scheduled (exhibition). */
  durationMinutes: z.int().positive().optional(),
  team: z.object({ min: z.int().min(1), max: z.int().min(1) }),
  countsTowardPresenterCap: z.boolean().default(true),
  fields: z.array(CustomField).default([]),
});
export type SubmissionType = z.infer<typeof SubmissionType>;

/** Problems between values of a configuration that the settings screen explains by name. */
export type ConfigIssueCode =
  | "default_language_required"
  | "min_over_max"
  | "min_not_below_max"
  | "no_whole_number"
  | "deadline_order"
  | "reviews_due_order"
  | "dates_order"
  | "final_before_conference"
  | "agreement_needs_text_or_link"
  | MessageProblemCode;

/**
 * What a named problem carries. `code` names it for screens that explain it in the reader's
 * language (the settings screen); `leaf` is the value under the issue's path to show it beside;
 * `values` are what the explanation names (an email's placeholders, a length).
 */
type IssueParams = {
  code: ConfigIssueCode;
  leaf?: string;
  values?: Record<string, string | number>;
};

/**
 * One text of an email in each language it is written in, among those the app writes mail in:
 * any of them, whether or not it is a language of the conference, and none is required.
 * Plain text: line breaks and tabs, and no other control character. (Postgres refuses NUL
 * inside JSON, as it refuses half a character: that one is refused with the other invisible
 * characters, by messageProblems.)
 */
const MessageTexts = z.partialRecord(
  z.enum(MAIL_LANGUAGES),
  z
    .string()
    .refine(
      (s) => !/\p{Cc}/u.test(s.replace(/[\t\n\r]/g, "")),
      "text without control characters (other than tabs and line breaks)",
    ),
);

const WHY_NOT: Record<MessageProblemCode, string> = {
  message_empty: "an email's text cannot be empty: leave it out for the standard text",
  message_not_one_line: "a subject is one line",
  message_too_long: "too long",
  message_unknown_placeholder: "unknown placeholder",
  message_not_in_subject: "a subject cannot hold this placeholder",
  message_missing_placeholder: "a required placeholder is missing",
  message_link_touched: "put a space or a line break before and after the link",
  message_name_touched: "a name must stand as a word of its own",
  message_invisible: "invisible characters that writing does not need",
};

/**
 * The conference's own wording of the emails the app sends (messages.ts): for any message, a
 * subject, a body or both, each in any of the languages the app writes mail in. All of it is
 * optional, and what is absent is the standard text. That has one spelling: an object with
 * nothing in it is refused, so that a configuration nobody customized holds no `messages` at
 * all. Only known messages and their own parts are taken.
 *
 * Each text is checked here, whatever else is wrong with the configuration: it says something,
 * names only its message's placeholders and all the required ones, a subject is one line,
 * neither is too long, none holds an invisible character that writing does not need, and a
 * person's name stands as a word of its own (messageProblems). Chairs write these texts and
 * they are used as written, as plain text.
 */
const Messages = z
  .partialRecord(
    z.enum(MESSAGE_KEYS),
    z.strictObject({ subject: MessageTexts.optional(), body: MessageTexts.optional() }),
  )
  .superRefine((messages, ctx) => {
    const issue = (path: string[], message: string, params?: IssueParams) =>
      ctx.addIssue({ code: "custom", path, message, ...(params ? { params } : {}) });
    // An unknown key has been refused by now and is gone from `messages`: what that leaves
    // empty is not reported a second time.
    const keyRefused = ctx.issues.some((i) => i.code === "unrecognized_keys");
    const empty = (o: object) => !keyRefused && Object.keys(o).length === 0;
    const unwritten = "leave it out where no text is written: absent means the standard text";
    if (empty(messages)) issue([], unwritten);
    for (const key of MESSAGE_KEYS) {
      const message = messages[key];
      if (!message) continue;
      if (empty(message)) issue([key], unwritten);
      for (const part of MESSAGE_PARTS) {
        const texts = message[part];
        if (!texts) continue;
        if (empty(texts)) issue([key, part], unwritten);
        for (const [lang, text] of Object.entries(texts)) {
          for (const problem of messageProblems(key, part, text)) {
            const { names, max } = problem.values ?? {};
            const which = names ?? (max === undefined ? "" : `${max} characters at most`);
            issue([key, part, lang], `${WHY_NOT[problem.code]}${which ? `: ${which}` : ""}`, {
              code: problem.code,
              ...(problem.values ? { values: problem.values } : {}),
            });
          }
        }
      }
    }
  });

const ConferenceConfigShape = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and hyphens"),
  year: z.int().min(1999),
  title: LocalizedText,
  theme: LocalizedText,
  /**
   * What sets this edition apart, in one line ("the society's first meeting on the island").
   * Shown with the dates and the place where the conference invites people to its call.
   */
  distinction: LocalizedText.optional(),
  /**
   * The invitation: a short paragraph that says what work the call welcomes. The front page and
   * the conference's own page lead with it. Like every text of a configuration it is public.
   */
  invitation: LocalizedText.optional(),
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
    /**
     * The day reviews are due (spec 03, §1.4), where the chairs set one: after the call closes
     * and before decisions are sent. Reviewers are shown it. It locks nothing: a review can be
     * sent and changed for as long as the conference is in review.
     */
    reviewsDue: IsoDateTime.optional(),
  }),
  rules: z.object({
    presenterCap: z
      .object({ max: z.int().min(1), countedRoles: z.array(ContributionRole).min(1) })
      .nullable(),
    /** Whether contributors are asked for a bio, and how long it may be. Missing: not asked. */
    bio: z.object({ requested: z.boolean(), maxWords: z.int().positive() }).optional(),
    /**
     * How many days before the day reviews are due (`deadlines.reviewsDue`) reviewers are
     * reminded of what they have not sent (spec 03, §1.7). Left out: three
     * (REVIEW_EMAILS.reminderDays). It means nothing while no such day is set.
     */
    reviewReminderDays: z.int().min(1).max(REVIEW_EMAILS.maxReminderDays).optional(),
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
  /**
   * Ways to contribute: the call's formats in a few named groups ("Talks", "Art"), each with a
   * line that says what is in it. The invitation shows them, and each leads to its formats on
   * the conference page. `formats` are keys of formats the call offers, submitted here or not,
   * in the order to show them; a format is in one group at most, and may be in none.
   */
  contributionGroups: z
    .array(
      z.object({
        key: Key,
        name: LocalizedText,
        summary: LocalizedText,
        formats: z.array(Key).min(1),
      }),
    )
    .default([]),
  /** True while the content is a stand-in (e.g. dates not yet announced). The UI says so. */
  placeholder: z.boolean().default(false),
  /** The conference's own wording of the emails the app sends. Absent: the standard texts. */
  messages: Messages.optional(),
});

type Shape = z.infer<typeof ConferenceConfigShape>;

function checkConfig(c: Shape, ctx: z.core.$RefinementCtx<Shape>): void {
  const issue = (path: (string | number)[], message: string, params?: IssueParams) =>
    ctx.addIssue({ code: "custom", path, message, ...(params ? { params } : {}) });

  if (!c.languages.includes(c.defaultLanguage)) {
    issue(["defaultLanguage"], "defaultLanguage must be one of languages");
  }

  const text = (path: (string | number)[], t: Record<string, string> | undefined) => {
    if (t && !(c.defaultLanguage in t)) {
      issue(path, `missing text in the default language (${c.defaultLanguage})`, {
        code: "default_language_required",
        leaf: c.defaultLanguage,
      });
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
  text(["distinction"], c.distinction);
  text(["invitation"], c.invitation);
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
    if (!a.url && !a.text) {
      issue(["agreements", i], "an agreement needs a url or a text", {
        code: "agreement_needs_text_or_link",
        leaf: "url",
      });
    }
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

  // A group names formats the call offers, and no format twice: one that is in two groups,
  // or twice in one, would be listed twice among the ways to contribute.
  unique(
    ["contributionGroups"],
    c.contributionGroups.map((g) => g.key),
  );
  const offered = new Set([...typeKeys, ...c.otherFormats.map((f) => f.key)]);
  const grouped = new Set<string>();
  c.contributionGroups.forEach((g, i) => {
    text(["contributionGroups", i, "name"], g.name);
    text(["contributionGroups", i, "summary"], g.summary);
    g.formats.forEach((key, j) => {
      const at = ["contributionGroups", i, "formats", j];
      if (!offered.has(key)) issue(at, `unknown format "${key}"`);
      else if (grouped.has(key)) issue(at, `"${key}" is already in a group`);
      grouped.add(key);
    });
  });

  c.reviewPools.forEach((p, i) => {
    text(["reviewPools", i, "name"], p.name);
    text(["reviewPools", i, "guidelines"], p.guidelines);
    unique(
      ["reviewPools", i, "criteria"],
      p.criteria.map((k) => k.key),
    );
    const form = ["reviewPools", i, "form"];
    text([...form, "comments", "description"], p.form.comments.description);
    text([...form, "chairNote", "description"], p.form.chairNote.description);
    text([...form, "recommendation", "description"], p.form.recommendation.description);
    const { minWords, maxWords } = p.form.comments;
    if (minWords !== undefined && maxWords !== undefined && minWords > maxWords) {
      issue([...form, "comments"], "minWords must not exceed maxWords", {
        code: "min_over_max",
        leaf: "minWords",
      });
    }
    p.criteria.forEach((k, j) => {
      text(["reviewPools", i, "criteria", j, "label"], k.label);
      text(["reviewPools", i, "criteria", j, "description"], k.description);
      // A scale needs two ends that differ: the smallest score is below the largest.
      if (k.min >= k.max) {
        issue(["reviewPools", i, "criteria", j], "min must be less than max", {
          code: "min_not_below_max",
          leaf: "min",
        });
      }
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
    if (t.abstract.minWords !== undefined && t.abstract.minWords > t.abstract.maxWords) {
      issue([...at, "abstract"], "minWords must not exceed maxWords", {
        code: "min_over_max",
        leaf: "minWords",
      });
    }
    if (t.team.min > t.team.max) {
      issue([...at, "team"], "team.min must not exceed team.max", {
        code: "min_over_max",
        leaf: "min",
      });
    }
    unique(
      [...at, "fields"],
      t.fields.map((f) => f.key),
    );
    t.fields.forEach((f, j) => {
      const fat = [...at, "fields", j];
      text([...fat, "label"], f.label);
      text([...fat, "help"], f.help);
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
        issue(fat, "min must not exceed max", { code: "min_over_max", leaf: "min" });
      }
      if ((f.min !== undefined || f.max !== undefined) && f.kind !== "number") {
        issue(fat, "min and max are for number fields");
      }
      if (f.integer !== undefined && f.kind !== "number") {
        issue(fat, "integer is for number fields");
      }
      // Whole numbers only, between two ends with no whole number between them (15.1 to 15.9):
      // every answer would be refused, so nobody could submit the format.
      if (
        f.kind === "number" &&
        f.integer === true &&
        f.min !== undefined &&
        f.max !== undefined &&
        f.min <= f.max &&
        Math.ceil(f.min) > Math.floor(f.max)
      ) {
        issue(fat, "a whole-number field needs a whole number between min and max", {
          code: "no_whole_number",
          leaf: "min",
        });
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

  // An email's own wording is not held to the conference's languages, as its other texts are
  // on the screen: it may be written in any language the app writes mail in (MessageTexts),
  // because mail goes out in each of them whatever the conference's languages are.

  const d = c.deadlines;
  type Required = Exclude<keyof typeof d, "reviewsDue">;
  const order: [Required, Required][] = [
    ["submissionsOpen", "submissionsClose"],
    ["submissionsClose", "notification"],
    ["notification", "finalMaterials"],
  ];
  for (const [a, b] of order) {
    if (Date.parse(d[a]) > Date.parse(d[b]))
      issue(["deadlines", b], `${b} must not be before ${a}`, { code: "deadline_order" });
  }
  // Reviews are written between the day the call closes and the day decisions are sent: a day
  // for them that is not after the first and before the second is a mistake.
  if (d.reviewsDue !== undefined) {
    const due = Date.parse(d.reviewsDue);
    if (due <= Date.parse(d.submissionsClose) || due >= Date.parse(d.notification)) {
      issue(
        ["deadlines", "reviewsDue"],
        "reviewsDue must be after submissionsClose and before notification",
        { code: "reviews_due_order" },
      );
    }
  }
  if (c.dates.start > c.dates.end) {
    issue(["dates", "end"], "end must not be before start", { code: "dates_order" });
  }
  // Compare calendar dates in the conference's own time zone: due strictly before day one.
  const finalDay = dateIn(d.finalMaterials, c.timezone);
  if (finalDay && finalDay >= c.dates.start) {
    issue(["deadlines", "finalMaterials"], "final materials must be due before the conference", {
      code: "final_before_conference",
    });
  }
}

/** One conference's whole setup. Each year's conference is data, not code. */
export const ConferenceConfig = ConferenceConfigShape.superRefine(checkConfig);
export type ConferenceConfig = z.infer<typeof ConferenceConfig>;
export type ConferenceConfigInput = z.input<typeof ConferenceConfig>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A stored configuration without the wording of emails this version of the app does not send:
 * whatever `messages` holds under a key that is not one of MESSAGE_KEYS is left out, and
 * `messages` itself goes where that leaves it with nothing. Everything else is as it was
 * handed in, to be validated like any configuration: this judges nothing.
 */
export function withoutUnknownEmails(stored: unknown): unknown {
  if (!isRecord(stored) || !isRecord(stored.messages)) return stored;
  const all = Object.entries(stored.messages);
  const known = all.filter(([key]) => (MESSAGE_KEYS as readonly string[]).includes(key));
  if (known.length === all.length) return stored;
  const { messages: _stored, ...rest } = stored;
  return known.length > 0 ? { ...rest, messages: Object.fromEntries(known) } : rest;
}

/**
 * A configuration as it is read back from where it was stored. This is for reading only: what
 * comes in (a settings save, its review, an imported file) goes through ConferenceConfig, which
 * refuses an email it does not know.
 *
 * One thing is different on reading. A later version of the app may have stored the wording of
 * an email that this version does not send (the next step's emails, after the app was rolled
 * back one version). Refusing the whole conference for that would take its pages, and the list
 * of conferences with them, away from everyone. So that wording is left out
 * (withoutUnknownEmails), and what is left is held to the schema exactly as before: an unknown
 * part or language of an email this version does send, a text it cannot send, and `messages`
 * stored with nothing in it are refused on reading as they are on saving.
 *
 * What is left out is not kept anywhere: a save by this version stores the configuration as
 * it read it, like every other value a later version added and this one does not know.
 */
export function readStoredConfig(stored: unknown): ConferenceConfig {
  return ConferenceConfig.parse(withoutUnknownEmails(stored));
}

export { effectiveBlindMode, findType } from "./lookup";
