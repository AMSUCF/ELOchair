import type { ConferenceConfig, CustomField } from "./config";
import type { Contribution, FieldValue, Submission } from "./domain";
import { LIMITS } from "./limits";
import { findType } from "./lookup";
import { countWords } from "./words";

export type SubmissionIssue = {
  path: string;
  code:
    | "unknown_type"
    | "unknown_track"
    | "unknown_topic"
    | "too_few_words"
    | "too_many_words"
    | "required"
    | "wrong_kind"
    | "unknown_option"
    | "team_size"
    | "no_lead"
    | "multiple_leads"
    | "lead_unconfirmed"
    | "contributor_name_missing"
    | "unknown_language"
    | "too_long"
    /** The format can change only while a draft. */
    | "locked"
    /** The conference's agreements must be acknowledged (current versions). */
    | "agreements_required"
    | "already_contributor"
    | "declined_cannot_reinvite"
    | "owner_cannot_be_removed"
    /** A custom-field key the submission type does not define. */
    | "unknown_field"
    | "empty_title";
  params?: Record<string, string | number>;
};

const isUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

function checkField(f: CustomField, v: FieldValue | undefined, lang: string): SubmissionIssue[] {
  const path = `fields.${f.key}`;
  // A required checkbox (consent, licence) must be ticked; an unticked optional one is fine.
  if (f.kind === "boolean") {
    if (v === undefined || v === false) return f.required ? [{ path, code: "required" }] : [];
    return typeof v === "boolean" ? [] : [{ path, code: "wrong_kind" }];
  }
  const empty =
    v === undefined ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0);
  if (empty) return f.required ? [{ path, code: "required" }] : [];

  const options = new Set(f.options?.map((o) => o.key));
  switch (f.kind) {
    case "text":
    case "longtext": {
      if (typeof v !== "string") return [{ path, code: "wrong_kind" }];
      const n = countWords(v, lang);
      if (f.maxWords && n > f.maxWords) {
        return [{ path, code: "too_many_words", params: { count: n, max: f.maxWords } }];
      }
      return [];
    }
    case "url":
      return typeof v === "string" && isUrl(v) ? [] : [{ path, code: "wrong_kind" }];
    case "select":
      if (typeof v !== "string") return [{ path, code: "wrong_kind" }];
      return options.has(v) ? [] : [{ path, code: "unknown_option" }];
    case "multiselect":
      if (!Array.isArray(v)) return [{ path, code: "wrong_kind" }];
      return v.every((x) => options.has(x)) ? [] : [{ path, code: "unknown_option" }];
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? [] : [{ path, code: "wrong_kind" }];
  }
}

/**
 * Check a submission against its type's rules. Returns machine-readable issues; the UI turns
 * codes into localized messages. An empty array means the submission can be submitted.
 */
export function validateSubmission(
  config: ConferenceConfig,
  submission: Pick<
    Submission,
    "typeKey" | "trackKey" | "topicKeys" | "language" | "title" | "abstract" | "fields"
  > & { participationMode?: Submission["participationMode"] },
  /**
   * The submission's contributions. Declined people are ignored. `hasName` (whether a name is
   * known for the person, from their profile or the invitation) is checked when given.
   */
  contributions: (Pick<Contribution, "role"> &
    Partial<Pick<Contribution, "status">> & { hasName?: boolean })[],
): SubmissionIssue[] {
  const type = findType(config, submission.typeKey);
  if (!type) return [{ path: "typeKey", code: "unknown_type" }];

  const issues: SubmissionIssue[] = [...sizeIssues(config, submission)];
  if (!submission.title.trim()) issues.push({ path: "title", code: "empty_title" });
  if (!config.languages.includes(submission.language)) {
    issues.push({ path: "language", code: "unknown_language" });
  }
  if (config.modality === "hybrid" && !submission.participationMode) {
    issues.push({ path: "participationMode", code: "required" });
  }

  if (submission.trackKey && !config.tracks.some((t) => t.key === submission.trackKey)) {
    issues.push({ path: "trackKey", code: "unknown_track" });
  }
  const topics = new Set(config.topics.map((t) => t.key));
  submission.topicKeys.forEach((k, i) => {
    if (!topics.has(k)) issues.push({ path: `topicKeys.${i}`, code: "unknown_topic" });
  });

  const words = countWords(submission.abstract, submission.language);
  if (words < type.abstract.minWords) {
    issues.push({
      path: "abstract",
      code: "too_few_words",
      params: { count: words, min: type.abstract.minWords },
    });
  }
  if (words > type.abstract.maxWords) {
    issues.push({
      path: "abstract",
      code: "too_many_words",
      params: { count: words, max: type.abstract.maxWords },
    });
  }

  for (const f of type.fields) {
    issues.push(...checkField(f, submission.fields[f.key], submission.language));
  }

  const team = contributions.filter((c) => c.status !== "declined");
  const n = team.length;
  if (n < type.team.min || n > type.team.max) {
    issues.push({
      path: "contributions",
      code: "team_size",
      params: { count: n, min: type.team.min, max: type.team.max },
    });
  }
  const leads = team.filter((c) => c.role === "lead");
  if (leads.length === 0) issues.push({ path: "contributions", code: "no_lead" });
  if (leads.length > 1) issues.push({ path: "contributions", code: "multiple_leads" });
  if (leads.some((c) => c.status === "invited")) {
    issues.push({ path: "contributions", code: "lead_unconfirmed" });
  }
  if (team.some((c) => c.hasName === false)) {
    issues.push({ path: "contributions", code: "contributor_name_missing" });
  }
  return issues;
}

/**
 * Size ceilings that hold even for drafts (which skip word limits): they bound storage.
 * The abstract may be at most LIMITS.abstractCharsPerWord characters per allowed word.
 */
export function sizeIssues(
  config: ConferenceConfig,
  submission: Pick<Submission, "typeKey" | "title" | "abstract">,
): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  if (submission.title.length > LIMITS.title) {
    issues.push({ path: "title", code: "too_long", params: { max: LIMITS.title } });
  }
  const type = findType(config, submission.typeKey);
  const maxChars = Math.min(
    LIMITS.abstractCeiling,
    (type?.abstract.maxWords ?? 0) * LIMITS.abstractCharsPerWord || LIMITS.abstractCeiling,
  );
  if (submission.abstract.length > maxChars) {
    issues.push({ path: "abstract", code: "too_long", params: { max: maxChars } });
  }
  return issues;
}
